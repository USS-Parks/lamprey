import { describe, it, expect, beforeEach, vi } from 'vitest'
import BetterSqlite3, { type Database } from 'better-sqlite3'

const HAS_NATIVE_SQLITE: boolean = (() => {
  try {
    const probe = new BetterSqlite3(':memory:')
    probe.close()
    return true
  } catch {
    return false
  }
})()

let db: Database | null = null

vi.mock('./database', () => ({
  getDb: () => {
    if (!db) throw new Error('test db not initialised')
    return db
  }
}))

import {
  countOrphanPipelineStages,
  findOrphanPipelineStages
} from './pipeline-orphans'

function makeDb(): Database {
  const fresh = new BetterSqlite3(':memory:')
  fresh.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      stage TEXT,
      created_at INTEGER NOT NULL
    );
  `)
  return fresh
}

interface Row {
  id: string
  conversationId: string
  role: 'assistant' | 'user' | 'system' | 'tool'
  stage: 'planner' | 'coder' | 'reviewer' | 'composer' | null
  createdAt: number
}

function insert(row: Row): void {
  db!
    .prepare(
      `INSERT INTO messages (id, conversation_id, role, stage, created_at)
         VALUES (?, ?, ?, ?, ?)`
    )
    .run(row.id, row.conversationId, row.role, row.stage, row.createdAt)
}

const CONV = 'conv-1'

describe.skipIf(!HAS_NATIVE_SQLITE)('pipeline-orphans (PS8)', () => {
  beforeEach(() => {
    if (db) db.close()
    db = makeDb()
  })

  it('returns empty when there are no messages', () => {
    expect(findOrphanPipelineStages(CONV)).toEqual([])
    expect(countOrphanPipelineStages(CONV)).toBe(0)
  })

  it('returns empty when planner is followed by a coder (NULL stage)', () => {
    insert({ id: 'p1', conversationId: CONV, role: 'assistant', stage: 'planner', createdAt: 100 })
    insert({ id: 'c1', conversationId: CONV, role: 'assistant', stage: null, createdAt: 200 })
    expect(findOrphanPipelineStages(CONV)).toEqual([])
    expect(countOrphanPipelineStages(CONV)).toBe(0)
  })

  it('returns empty when planner is followed by an explicit coder stage', () => {
    insert({ id: 'p1', conversationId: CONV, role: 'assistant', stage: 'planner', createdAt: 100 })
    insert({ id: 'c1', conversationId: CONV, role: 'assistant', stage: 'coder', createdAt: 200 })
    expect(findOrphanPipelineStages(CONV)).toEqual([])
  })

  it('returns empty when planner is followed by a composer rewrite', () => {
    insert({ id: 'p1', conversationId: CONV, role: 'assistant', stage: 'planner', createdAt: 100 })
    insert({ id: 'c1', conversationId: CONV, role: 'assistant', stage: 'composer', createdAt: 200 })
    expect(findOrphanPipelineStages(CONV)).toEqual([])
  })

  it('flags a planner row with NO later assistant follow-up as orphan', () => {
    insert({ id: 'p1', conversationId: CONV, role: 'assistant', stage: 'planner', createdAt: 100 })
    const orphans = findOrphanPipelineStages(CONV)
    expect(orphans).toHaveLength(1)
    expect(orphans[0].messageId).toBe('p1')
    expect(orphans[0].stage).toBe('planner')
    expect(countOrphanPipelineStages(CONV)).toBe(1)
  })

  it('flags a planner whose only follow-up is a reviewer row (no coder)', () => {
    insert({ id: 'p1', conversationId: CONV, role: 'assistant', stage: 'planner', createdAt: 100 })
    insert({ id: 'r1', conversationId: CONV, role: 'assistant', stage: 'reviewer', createdAt: 200 })
    const orphans = findOrphanPipelineStages(CONV)
    expect(orphans).toHaveLength(1)
    expect(orphans[0].messageId).toBe('p1')
  })

  it('flags a planner whose only follow-up is a user row (incomplete pipeline cancelled mid-flight)', () => {
    insert({ id: 'p1', conversationId: CONV, role: 'assistant', stage: 'planner', createdAt: 100 })
    insert({ id: 'u1', conversationId: CONV, role: 'user', stage: null, createdAt: 200 })
    const orphans = findOrphanPipelineStages(CONV)
    expect(orphans).toHaveLength(1)
    expect(orphans[0].messageId).toBe('p1')
  })

  it('does NOT flag earlier planner rows when a later coder caught up via a subsequent turn', () => {
    // turn 1: planner only (orphan)
    insert({ id: 'p1', conversationId: CONV, role: 'assistant', stage: 'planner', createdAt: 100 })
    // turn 2: planner + coder (clean)
    insert({ id: 'p2', conversationId: CONV, role: 'assistant', stage: 'planner', createdAt: 300 })
    insert({ id: 'c2', conversationId: CONV, role: 'assistant', stage: null, createdAt: 400 })
    const orphans = findOrphanPipelineStages(CONV)
    expect(orphans.map((o) => o.messageId)).toEqual(['p1'])
  })

  it('scopes by conversation_id (planner in other conv does not leak)', () => {
    insert({ id: 'p1', conversationId: CONV, role: 'assistant', stage: 'planner', createdAt: 100 })
    insert({ id: 'p2', conversationId: 'other-conv', role: 'assistant', stage: 'planner', createdAt: 100 })
    insert({ id: 'c2', conversationId: 'other-conv', role: 'assistant', stage: null, createdAt: 200 })
    const orphans = findOrphanPipelineStages(CONV)
    expect(orphans).toHaveLength(1)
    expect(orphans[0].messageId).toBe('p1')
  })

  it('returns multiple orphans sorted by created_at ascending', () => {
    insert({ id: 'p1', conversationId: CONV, role: 'assistant', stage: 'planner', createdAt: 100 })
    insert({ id: 'p2', conversationId: CONV, role: 'assistant', stage: 'planner', createdAt: 200 })
    insert({ id: 'p3', conversationId: CONV, role: 'assistant', stage: 'planner', createdAt: 50 })
    const orphans = findOrphanPipelineStages(CONV)
    expect(orphans.map((o) => o.messageId)).toEqual(['p3', 'p1', 'p2'])
  })
})
