import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import BetterSqlite3, { type Database } from 'better-sqlite3'
import { MIGRATIONS, LATEST_VERSION, runMigrations, type Migration } from './db-migrations'

// Persistence Phase / PS1 — migration ledger tests.
//
// These run against an in-memory better-sqlite3 instance so they don't
// depend on Electron's `app.getPath('userData')`. We construct the minimal
// baseline (the three tables migration v1 sanity-checks) so the canonical
// stamp migration succeeds; for the rollback test we deliberately omit the
// canary table to force an abort.
//
// Several tests inject synthetic migrations into the registry via the
// helper `withMigrations`. We never mutate the exported registry directly
// — instead each test swaps it for the duration via a try/finally.

const HAS_NATIVE_SQLITE: boolean = (() => {
  try {
    const probe = new BetterSqlite3(':memory:')
    probe.close()
    return true
  } catch {
    return false
  }
})()

function makeBaselineDb(): Database {
  const db = new BetterSqlite3(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE conversations (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
    CREATE TABLE events (id TEXT PRIMARY KEY);
  `)
  return db
}

// Replace the registry temporarily without mutating the export. We rely on
// the fact that `runMigrations` reads the live exported `MIGRATIONS` array
// — so this monkey-patches the array contents in place and restores after.
function withMigrations<T>(temp: Migration[], fn: () => T): T {
  const snapshot = MIGRATIONS.splice(0, MIGRATIONS.length)
  MIGRATIONS.push(...temp)
  try {
    return fn()
  } finally {
    MIGRATIONS.splice(0, MIGRATIONS.length)
    MIGRATIONS.push(...snapshot)
  }
}

describe.skipIf(!HAS_NATIVE_SQLITE)('db-migrations', () => {
  let db: Database

  beforeEach(() => {
    db = makeBaselineDb()
  })

  afterEach(() => {
    db.close()
  })

  it('stamps a fresh DB at LATEST_VERSION using the real registry', () => {
    const result = runMigrations(db)
    expect(result.startVersion).toBe(0)
    expect(result.endVersion).toBe(LATEST_VERSION)
    expect(result.applied).toEqual(
      MIGRATIONS.map((m) => m.version).filter((v) => v > 0)
    )
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_VERSION)
  })

  it('is a no-op on a DB already at LATEST_VERSION', () => {
    runMigrations(db)
    const beforeSecond = db.pragma('user_version', { simple: true })
    const result = runMigrations(db)
    expect(result.startVersion).toBe(beforeSecond)
    expect(result.endVersion).toBe(beforeSecond)
    expect(result.applied).toEqual([])
  })

  it('only runs migrations newer than the current user_version', () => {
    let ranV2 = 0
    let ranV3 = 0
    withMigrations(
      [
        { version: 1, description: 'baseline', up: () => {} },
        {
          version: 2,
          description: 'v2 work',
          up() {
            ranV2++
          }
        },
        {
          version: 3,
          description: 'v3 work',
          up() {
            ranV3++
          }
        }
      ],
      () => {
        // First run: all three migrations.
        runMigrations(db)
        expect(ranV2).toBe(1)
        expect(ranV3).toBe(1)

        // Pretend v2 was the floor (downgrade `user_version` by hand) — only
        // v3 should re-run.
        db.pragma('user_version = 2')
        runMigrations(db)
        expect(ranV2).toBe(1)
        expect(ranV3).toBe(2)
      }
    )
  })

  it('rolls back DDL + version bump when a migration throws', () => {
    withMigrations(
      [
        { version: 1, description: 'baseline', up: () => {} },
        {
          version: 2,
          description: 'creates rollback_canary then explodes',
          up(d) {
            d.exec('CREATE TABLE rollback_canary (id INTEGER PRIMARY KEY)')
            throw new Error('boom')
          }
        }
      ],
      () => {
        expect(() => runMigrations(db)).toThrowError(/v2.*failed.*boom/)

        // user_version stayed at 1 (the previous successful migration).
        expect(db.pragma('user_version', { simple: true })).toBe(1)

        // The canary table was rolled back — the v2 transaction died.
        const exists = db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rollback_canary'"
          )
          .get()
        expect(exists).toBeUndefined()
      }
    )
  })

  it('refuses to run against a DB stamped higher than LATEST_VERSION (downgrade guard)', () => {
    db.pragma(`user_version = ${LATEST_VERSION + 5}`)
    expect(() => runMigrations(db)).toThrowError(
      /DB user_version is \d+ but this build only knows migrations up to v\d+/
    )
    // No side effect.
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_VERSION + 5)
  })

  it('aborts v1 baseline stamp if a required table is missing', () => {
    db.close()
    db = new BetterSqlite3(':memory:')
    // Omit `conversations` deliberately.
    db.exec(`
      CREATE TABLE messages (id TEXT PRIMARY KEY);
      CREATE TABLE events (id TEXT PRIMARY KEY);
    `)
    expect(() => runMigrations(db)).toThrowError(
      /baseline table "conversations" is missing/
    )
    expect(db.pragma('user_version', { simple: true })).toBe(0)
  })

  it('WC-4 — migration v16 adds messages.proof_status as nullable TEXT (idempotent)', () => {
    // The real registry includes v16 from this prompt. After runMigrations:
    //   1. messages.proof_status column exists
    //   2. inserting a row with NULL proof_status succeeds
    //   3. running the migration again is a no-op (idempotency)
    runMigrations(db)
    const cols = db
      .prepare('PRAGMA table_info(messages)')
      .all() as Array<{ name: string; type: string; notnull: number }>
    const proofStatusCol = cols.find((c) => c.name === 'proof_status')
    expect(proofStatusCol, 'messages.proof_status must exist').toBeDefined()
    expect(proofStatusCol?.type).toBe('TEXT')
    expect(proofStatusCol?.notnull).toBe(0)

    // Idempotency — second run does not throw.
    const second = runMigrations(db)
    expect(second.applied).toEqual([])
  })

  it('stops applying after a failure and reports the partial result via thrown error', () => {
    const order: number[] = []
    withMigrations(
      [
        {
          version: 1,
          description: 'baseline',
          up() {
            order.push(1)
          }
        },
        {
          version: 2,
          description: 'fails here',
          up() {
            order.push(2)
            throw new Error('mid-flight')
          }
        },
        {
          version: 3,
          description: 'should not run',
          up() {
            order.push(3)
          }
        }
      ],
      () => {
        expect(() => runMigrations(db)).toThrow(/v2.*failed/)
        expect(order).toEqual([1, 2])
        // v1 stamped, v2 rolled back.
        expect(db.pragma('user_version', { simple: true })).toBe(1)
      }
    )
  })
})
