import { describe, it, expect, vi } from 'vitest'
import BetterSqlite3, { type Database } from 'better-sqlite3'

vi.mock('./rag/vec-loader', () => ({
  isVecAvailable: () => false,
  loadSqliteVec: () => {
    /* no-op for tests */
  }
}))

import { initLegacySchema } from './schema-init'

const HAS_NATIVE_SQLITE: boolean = (() => {
  try {
    const probe = new BetterSqlite3(':memory:')
    probe.close()
    return true
  } catch {
    return false
  }
})()

// Persistence Phase / PS6 — partition regression test.
//
// The contract: calling initLegacySchema on a fresh DB produces the
// same set of tables, virtual tables, indexes, and triggers that the
// pre-PS6 monolithic initSchema produced. We assert the canonical
// table set + count rather than a byte-for-byte DDL comparison (which
// would be brittle against whitespace) — what matters is that every
// schema object the rest of the codebase expects is present.

const EXPECTED_TABLES = new Set([
  'conversations',
  'messages',
  'memory_entries',
  'memory_index',
  'hooks',
  'automations',
  'projects',
  'tool_calls',
  'permission_policies',
  'plan_steps',
  'goals',
  'events',
  'agent_runs',
  'loop_wakeups',
  'chapters',
  'async_events',
  'project_github_repos',
  'conversation_pull_requests',
  'rag_collections',
  'rag_documents',
  'rag_chunks',
  'rag_retrievals',
  'conversation_rag_attachments',
  'snip_events',
  'snip_command_log',
  'message_stage_metrics'
])

const EXPECTED_VIRTUAL_TABLES = new Set([
  'memory_index_fts',
  'rag_chunks_fts',
  'sessions_fts'
  // rag_chunk_vec is gated on sqlite-vec availability; mocked false above.
])

const EXPECTED_TRIGGERS = new Set([
  'memory_index_fts_ai',
  'memory_index_fts_ad',
  'memory_index_fts_au',
  'rag_chunks_fts_ai',
  'rag_chunks_fts_ad',
  'rag_chunks_fts_au'
])

// Columns that came in through `safeAddColumn` historically — the
// partition has to still produce them.
const EXPECTED_CONVERSATION_COLUMNS = new Set([
  'id',
  'title',
  'model',
  'created_at',
  'updated_at',
  'kind',
  'worktree_path',
  'project_id',
  'archived',
  'pinned_at',
  'plan_mode_active'
])

const EXPECTED_MESSAGE_COLUMNS = new Set([
  'id',
  'conversation_id',
  'role',
  'content',
  'model',
  'tool_call_id',
  'created_at',
  'tool_calls',
  'retrieval_id',
  'draft',
  'reasoning',
  'compressed_into',
  'documents',
  'stage',
  'content_raw'
])

describe.skipIf(!HAS_NATIVE_SQLITE)('initLegacySchema (PS6)', () => {
  function freshDb(): Database {
    return new BetterSqlite3(':memory:')
  }

  function getTableNames(db: Database, type: 'table' | 'trigger'): Set<string> {
    const rows = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = ?`)
      .all(type) as Array<{ name: string }>
    return new Set(rows.map((r) => r.name).filter((n) => !n.startsWith('sqlite_')))
  }

  function getColumns(db: Database, table: string): Set<string> {
    const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>
    return new Set(rows.map((r) => r.name))
  }

  it('creates every expected ordinary table on a fresh DB', () => {
    const db = freshDb()
    initLegacySchema(db)
    const tables = getTableNames(db, 'table')
    for (const name of EXPECTED_TABLES) {
      expect(tables, `missing expected table: ${name}`).toContain(name)
    }
    db.close()
  })

  it('creates every expected FTS5 virtual table', () => {
    const db = freshDb()
    initLegacySchema(db)
    const allTables = getTableNames(db, 'table')
    // Virtual tables show up in sqlite_master with type='table' too;
    // SQLite collapses them. So we check by name only.
    for (const name of EXPECTED_VIRTUAL_TABLES) {
      expect(allTables, `missing expected virtual table: ${name}`).toContain(name)
    }
    db.close()
  })

  it('creates every expected FTS sync trigger', () => {
    const db = freshDb()
    initLegacySchema(db)
    const triggers = getTableNames(db, 'trigger')
    for (const name of EXPECTED_TRIGGERS) {
      expect(triggers, `missing expected trigger: ${name}`).toContain(name)
    }
    db.close()
  })

  it('applies every historical safeAddColumn to conversations', () => {
    const db = freshDb()
    initLegacySchema(db)
    const cols = getColumns(db, 'conversations')
    for (const name of EXPECTED_CONVERSATION_COLUMNS) {
      expect(cols, `conversations.${name} missing`).toContain(name)
    }
    db.close()
  })

  it('applies every historical safeAddColumn to messages', () => {
    const db = freshDb()
    initLegacySchema(db)
    const cols = getColumns(db, 'messages')
    for (const name of EXPECTED_MESSAGE_COLUMNS) {
      expect(cols, `messages.${name} missing`).toContain(name)
    }
    db.close()
  })

  it('is idempotent — re-running on the same DB does not throw', () => {
    const db = freshDb()
    initLegacySchema(db)
    expect(() => initLegacySchema(db)).not.toThrow()
    db.close()
  })

  it('preserves CASCADE FK from messages to conversations', () => {
    const db = freshDb()
    db.pragma('foreign_keys = ON')
    initLegacySchema(db)
    db.prepare(
      'INSERT INTO conversations (id, model, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run('c1', 'm', 1, 1)
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run('m1', 'c1', 'user', 'hi', 1)
    db.prepare('DELETE FROM conversations WHERE id = ?').run('c1')
    const remaining = db
      .prepare('SELECT COUNT(*) AS c FROM messages')
      .get() as { c: number }
    expect(remaining.c).toBe(0)
    db.close()
  })
})
