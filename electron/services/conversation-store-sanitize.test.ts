import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import BetterSqlite3, { type Database } from 'better-sqlite3'

// HX4 — Robustness Hotfix v0.8.4. Verifies saveMessage's pseudo-XML
// sanitisation round-trip:
//   - assistant rows with <bash> pseudo-tags → `content` is fenced clean,
//     `content_raw` retains the verbatim original
//   - assistant rows without pseudo-tags → `content_raw` is NULL (we only
//     persist the raw column when the sanitiser actually changed something)
//   - non-assistant rows → `content_raw` is NULL regardless
//
// We mock `./database`'s getDb to return an in-memory better-sqlite3
// instance carrying the columns saveMessage touches. The full DB schema
// is wider; we recreate only what the SUT and its dependent helpers read
// or write so the test stays focused.

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

// projects-store + plan-goal-store reach back through getDb too; the calls
// from conversation-store that we exercise are `touchConversation` (UPDATE
// on conversations) and ftsInsertMessage (INSERT on messages_fts). Stub
// touchProject / clearConversationState so they're no-ops without a real
// projects table.
vi.mock('./projects-store', () => ({
  touchProject: () => {}
}))
vi.mock('./plan-goal-store', () => ({
  clearConversationState: () => {}
}))

const SCHEMA = `
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    model TEXT NOT NULL,
    project_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    tool_call_id TEXT,
    tool_calls TEXT,
    draft TEXT,
    reasoning TEXT,
    documents TEXT,
    compressed_into TEXT,
    stage TEXT,
    content_raw TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='', tokenize='porter');
`

beforeEach(async () => {
  if (!HAS_NATIVE_SQLITE) return
  db = new BetterSqlite3(':memory:')
  db.exec(SCHEMA)
  db.prepare(
    'INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run('conv-1', 'test', 'deepseek-v4-pro', Date.now(), Date.now())
})

afterEach(() => {
  if (db) {
    db.close()
    db = null
  }
})

const importStore = async () => {
  // Late-import so vi.mock takes effect.
  return await import('./conversation-store')
}

describe('saveMessage — HX4 pseudo-XML sanitisation round-trip', () => {
  it.skipIf(!HAS_NATIVE_SQLITE)(
    'assistant row with <bash> pseudo-tags: content is fenced clean, content_raw retains the verbatim original',
    async () => {
      const { saveMessage, getMessages } = await importStore()
      const raw =
        'Let me locate the file. <bash>find . -name "x.md"</bash> after.'
      saveMessage({
        id: 'msg-1',
        conversationId: 'conv-1',
        role: 'assistant',
        content: raw,
        model: 'deepseek-v4-pro'
      })

      const rows = getMessages('conv-1')
      expect(rows).toHaveLength(1)
      const msg = rows[0]
      expect(msg.content).toContain('```bash\nfind . -name "x.md"\n```')
      expect(msg.content).not.toContain('<bash>')
      expect(msg.contentRaw).toBe(raw)
    }
  )

  it.skipIf(!HAS_NATIVE_SQLITE)(
    'assistant row with no pseudo-tags: content_raw is NULL (no-op rewrite optimisation)',
    async () => {
      const { saveMessage, getMessages } = await importStore()
      const clean = 'A perfectly clean assistant reply with no pseudo-XML.'
      saveMessage({
        id: 'msg-2',
        conversationId: 'conv-1',
        role: 'assistant',
        content: clean,
        model: 'deepseek-v4-pro'
      })

      const rows = getMessages('conv-1')
      expect(rows).toHaveLength(1)
      expect(rows[0].content).toBe(clean)
      expect(rows[0].contentRaw).toBeUndefined()
    }
  )

  it.skipIf(!HAS_NATIVE_SQLITE)(
    'user row with text that looks like pseudo-XML is NOT sanitised; content_raw is NULL',
    async () => {
      const { saveMessage, getMessages } = await importStore()
      // A user pasting `<bash>` should not have their input rewritten —
      // sanitisation is opt-in for assistant rows only.
      const userText = 'Why does <bash>ls</bash> appear in my chat history?'
      saveMessage({
        id: 'msg-3',
        conversationId: 'conv-1',
        role: 'user',
        content: userText
      })

      const rows = getMessages('conv-1')
      expect(rows).toHaveLength(1)
      expect(rows[0].content).toBe(userText)
      expect(rows[0].contentRaw).toBeUndefined()
    }
  )

  it.skipIf(!HAS_NATIVE_SQLITE)(
    'system + tool rows pass through unchanged with content_raw NULL',
    async () => {
      const { saveMessage, getMessages } = await importStore()
      saveMessage({
        id: 'msg-sys',
        conversationId: 'conv-1',
        role: 'system',
        content: '<bash>system prompt with literal tag</bash>'
      })
      saveMessage({
        id: 'msg-tool',
        conversationId: 'conv-1',
        role: 'tool',
        content: '<output>tool result</output>',
        toolCallId: 'call-1'
      })

      const rows = getMessages('conv-1')
      expect(rows).toHaveLength(2)
      for (const r of rows) {
        expect(r.contentRaw).toBeUndefined()
      }
      // Bodies untouched.
      expect(rows[0].content).toBe('<bash>system prompt with literal tag</bash>')
      expect(rows[1].content).toBe('<output>tool result</output>')
    }
  )

  it.skipIf(!HAS_NATIVE_SQLITE)(
    'idempotency at the DB layer: a round-tripped already-sanitised row stays unchanged on re-save',
    async () => {
      const { saveMessage, getMessages } = await importStore()
      // First save sanitises; re-saving the cleaned content under a new id
      // shouldn't double-fence.
      saveMessage({
        id: 'msg-orig',
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'before <bash>ls</bash> after'
      })
      const orig = getMessages('conv-1')[0]
      expect(orig.content).toContain('```bash\nls\n```')

      saveMessage({
        id: 'msg-resave',
        conversationId: 'conv-1',
        role: 'assistant',
        content: orig.content
      })
      const all = getMessages('conv-1')
      const resaved = all.find((m) => m.id === 'msg-resave')!
      expect(resaved.content).toBe(orig.content)
      // No rewrite happened on the second save, so contentRaw stays undefined.
      expect(resaved.contentRaw).toBeUndefined()
    }
  )
})
