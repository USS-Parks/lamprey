import { getDb } from './database'

export interface MemoryRow {
  id: number
  content: string
  created_at: number
  updated_at: number
  source_conversation_id: string | null
}

export function listMemories() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM memory_entries ORDER BY created_at ASC').all() as MemoryRow[]
  return rows.map(toMemoryEntry)
}

export function addMemory(content: string, sourceConversationId?: string) {
  const db = getDb()
  const now = Date.now()
  const result = db.prepare(
    'INSERT INTO memory_entries (content, created_at, updated_at, source_conversation_id) VALUES (?, ?, ?, ?)'
  ).run(content, now, now, sourceConversationId || null)
  return {
    id: result.lastInsertRowid as number,
    content,
    createdAt: now,
    updatedAt: now,
    sourceConversationId
  }
}

export function updateMemory(id: number, content: string) {
  const db = getDb()
  const now = Date.now()
  db.prepare('UPDATE memory_entries SET content = ?, updated_at = ? WHERE id = ?').run(
    content,
    now,
    id
  )
  const row = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id) as
    | MemoryRow
    | undefined
  return row ? toMemoryEntry(row) : null
}

export function deleteMemory(id: number) {
  const db = getDb()
  db.prepare('DELETE FROM memory_entries WHERE id = ?').run(id)
}

export function clearAllMemories() {
  const db = getDb()
  db.prepare('DELETE FROM memory_entries').run()
}

export function exportMemories(): string {
  const entries = listMemories()
  return JSON.stringify(entries, null, 2)
}

export function importMemories(entries: { content: string; sourceConversationId?: string }[]) {
  const db = getDb()
  const now = Date.now()
  const stmt = db.prepare(
    'INSERT INTO memory_entries (content, created_at, updated_at, source_conversation_id) VALUES (?, ?, ?, ?)'
  )
  const insertMany = db.transaction((items: typeof entries) => {
    for (const entry of items) {
      stmt.run(entry.content, now, now, entry.sourceConversationId || null)
    }
  })
  insertMany(entries)
}

export function buildMemoryBlock(): string {
  const entries = listMemories()
  if (entries.length === 0) return ''
  const lines = entries.map((e, i) => `${i + 1}. ${e.content}`)
  return `<memory>\n${lines.join('\n')}\n</memory>`
}

function toMemoryEntry(row: MemoryRow) {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceConversationId: row.source_conversation_id || undefined
  }
}
