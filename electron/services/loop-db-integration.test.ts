import { describe, it, expect, beforeEach } from 'vitest'
import { LOOP_SCHEMA_SQL } from './loop-schema'

// Loop Phase gap-closure — REAL DB integration coverage that does NOT skip.
//
// The Electron-built better-sqlite3 (ABI 133) can't load under vitest's Node
// (ABI 137), so every better-sqlite3-backed suite skips. Node ships its own
// SQLite (`node:sqlite`, DatabaseSync) with NO native addon, so it loads under
// vitest. This suite runs the EXACT production v17 DDL (LOOP_SCHEMA_SQL, shared
// with migration v17) plus the loop-store query SHAPES against node:sqlite —
// catching schema typos, CHECK-constraint regressions, and query/ordering bugs
// at gate time instead of only in the live playbook.

type DB = {
  exec(sql: string): void
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number | bigint }
    get(...args: unknown[]): Record<string, unknown> | undefined
    all(...args: unknown[]): Record<string, unknown>[]
  }
}

let DatabaseSync: (new (path: string) => DB) | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DatabaseSync = (require('node:sqlite') as { DatabaseSync: new (path: string) => DB })
    .DatabaseSync
} catch {
  DatabaseSync = null
}

const hasNodeSqlite = !!DatabaseSync

let db: DB

beforeEach(() => {
  // If node:sqlite is ever unavailable, the it.skipIf below reports it loudly.
  if (!hasNodeSqlite) return
  db = new DatabaseSync!(':memory:')
  db.exec(LOOP_SCHEMA_SQL)
})

describe('loop DB integration (node:sqlite — never skips silently)', () => {
  it('node:sqlite is available in this runtime', () => {
    // A hard assertion (not skipIf) so a future Node without node:sqlite FAILS
    // the gate loudly instead of quietly losing this coverage.
    expect(hasNodeSqlite).toBe(true)
  })

  it.skipIf(!hasNodeSqlite)('creates all three tables from the production DDL', () => {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name)
    expect(names).toContain('loops')
    expect(names).toContain('loop_backlog')
    expect(names).toContain('loop_runs')
  })

  it.skipIf(!hasNodeSqlite)('round-trips a loop row', () => {
    db.prepare(
      `INSERT INTO loops (id, conversation_id, mode, status, iteration, tokens_used, created_at, updated_at, next_fire_at)
       VALUES ('l1','c1','interval','running',0,0,1000,1000,500)`
    ).run()
    const row = db.prepare('SELECT * FROM loops WHERE id = ?').get('l1')!
    expect(row.mode).toBe('interval')
    expect(row.status).toBe('running')
    expect(row.iteration).toBe(0)
  })

  it.skipIf(!hasNodeSqlite)('enforces the mode + status CHECK constraints', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO loops (id, conversation_id, mode, status, created_at, updated_at) VALUES ('x','c','BOGUS','running',1,1)`
        )
        .run()
    ).toThrow()
    expect(() =>
      db
        .prepare(
          `INSERT INTO loops (id, conversation_id, mode, status, created_at, updated_at) VALUES ('y','c','interval','BOGUS',1,1)`
        )
        .run()
    ).toThrow()
  })

  it.skipIf(!hasNodeSqlite)('nextBacklogItem = lowest-position pending row', () => {
    const ins = db.prepare(
      `INSERT INTO loop_backlog (id, loop_id, position, task, status, created_at) VALUES (?,?,?,?,?,?)`
    )
    ins.run('b2', 'l1', 1, 'B', 'pending', 1)
    ins.run('b1', 'l1', 0, 'A', 'pending', 1)
    ins.run('b0', 'l1', 0, 'old', 'done', 1) // done, must be ignored
    const next = db
      .prepare(
        "SELECT * FROM loop_backlog WHERE loop_id = ? AND status = 'pending' ORDER BY position ASC LIMIT 1"
      )
      .get('l1')!
    expect(next.task).toBe('A')
  })

  it.skipIf(!hasNodeSqlite)('countBacklog by status', () => {
    const ins = db.prepare(
      `INSERT INTO loop_backlog (id, loop_id, position, task, status, created_at) VALUES (?,?,?,?,?,?)`
    )
    ins.run('a', 'l1', 0, 'A', 'pending', 1)
    ins.run('b', 'l1', 1, 'B', 'pending', 1)
    ins.run('c', 'l1', 2, 'C', 'done', 1)
    const pending = db
      .prepare("SELECT COUNT(*) AS n FROM loop_backlog WHERE loop_id = ? AND status = 'pending'")
      .get('l1')!
    expect(pending.n).toBe(2)
  })

  it.skipIf(!hasNodeSqlite)('listRecentDone orders by finished_at DESC', () => {
    const ins = db.prepare(
      `INSERT INTO loop_backlog (id, loop_id, position, task, status, result, created_at, finished_at) VALUES (?,?,?,?,?,?,?,?)`
    )
    ins.run('a', 'l1', 0, 'first', 'done', 'r1', 1, 100)
    ins.run('b', 'l1', 1, 'second', 'done', 'r2', 1, 200)
    const recent = db
      .prepare(
        "SELECT task FROM loop_backlog WHERE loop_id = ? AND status = 'done' ORDER BY finished_at DESC LIMIT 5"
      )
      .all('l1')
      .map((r) => r.task)
    expect(recent).toEqual(['second', 'first'])
  })

  it.skipIf(!hasNodeSqlite)('listDueLoops = running with due/null next_fire_at', () => {
    const ins = db.prepare(
      `INSERT INTO loops (id, conversation_id, mode, status, created_at, updated_at, next_fire_at) VALUES (?,?,?,?,?,?,?)`
    )
    ins.run('due', 'c', 'interval', 'running', 1, 1, 500)
    ins.run('future', 'c', 'interval', 'running', 1, 1, 9999)
    ins.run('paused', 'c', 'interval', 'paused', 1, 1, 500)
    const due = db
      .prepare(
        "SELECT id FROM loops WHERE status = 'running' AND (next_fire_at IS NULL OR next_fire_at <= ?) ORDER BY next_fire_at ASC"
      )
      .all(1000)
      .map((r) => r.id)
    expect(due).toEqual(['due'])
  })

  it.skipIf(!hasNodeSqlite)('deleteLoop cascade removes backlog + runs', () => {
    db.prepare(
      `INSERT INTO loops (id, conversation_id, mode, status, created_at, updated_at) VALUES ('l1','c','autonomous','running',1,1)`
    ).run()
    db.prepare(
      `INSERT INTO loop_backlog (id, loop_id, position, task, status, created_at) VALUES ('b','l1',0,'t','pending',1)`
    ).run()
    db.prepare(
      `INSERT INTO loop_runs (id, loop_id, iteration, started_at, status, created_at) VALUES ('r','l1',1,1,'done',1)`
    ).run()
    // mirror loop-store.deleteLoop's three statements
    db.prepare('DELETE FROM loop_backlog WHERE loop_id = ?').run('l1')
    db.prepare('DELETE FROM loop_runs WHERE loop_id = ?').run('l1')
    db.prepare('DELETE FROM loops WHERE id = ?').run('l1')
    expect(db.prepare('SELECT COUNT(*) AS n FROM loop_backlog').get()!.n).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM loop_runs').get()!.n).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM loops').get()!.n).toBe(0)
  })
})
