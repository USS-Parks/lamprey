import { randomUUID } from 'crypto'
import { getDb } from './database'

// Track 2 / E1 — chapters store. Per-conversation, message-anchored
// section markers. Each chapter pins to the message id it sits under;
// the renderer (E2) uses the anchor id to deep-scroll and to draw
// dividers between messages.
//
// Schema (database.ts):
//   chapters(id, conversation_id, title, summary, anchor_message_id, created_at)
//
// Writes happen via the `session:markChapter` IPC and the inline
// `mark_chapter` tool handler in chat.ts (mirrors the memory_add /
// enter_plan_mode pattern — the tool handler emits a chat event so the
// renderer updates without polling).

export interface ChapterRow {
  id: string
  conversation_id: string
  title: string
  summary: string | null
  anchor_message_id: string
  created_at: number
}

export interface Chapter {
  id: string
  conversationId: string
  title: string
  summary: string | null
  anchorMessageId: string
  createdAt: number
}

function fromRow(r: ChapterRow): Chapter {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    title: r.title,
    summary: r.summary,
    anchorMessageId: r.anchor_message_id,
    createdAt: r.created_at
  }
}

export function createChapter(input: {
  conversationId: string
  title: string
  summary?: string | null
  anchorMessageId: string
}): Chapter {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO chapters
       (id, conversation_id, title, summary, anchor_message_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.conversationId,
    input.title,
    input.summary ?? null,
    input.anchorMessageId,
    now
  )
  return {
    id,
    conversationId: input.conversationId,
    title: input.title,
    summary: input.summary ?? null,
    anchorMessageId: input.anchorMessageId,
    createdAt: now
  }
}

export function listChapters(conversationId: string): Chapter[] {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT * FROM chapters WHERE conversation_id = ? ORDER BY created_at ASC'
    )
    .all(conversationId) as ChapterRow[]
  return rows.map(fromRow)
}

export function getChapter(id: string): Chapter | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as
    | ChapterRow
    | undefined
  return row ? fromRow(row) : undefined
}

export function listChaptersByAnchor(anchorMessageId: string): Chapter[] {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT * FROM chapters WHERE anchor_message_id = ? ORDER BY created_at ASC'
    )
    .all(anchorMessageId) as ChapterRow[]
  return rows.map(fromRow)
}

export function deleteChapter(id: string): boolean {
  const db = getDb()
  const r = db.prepare('DELETE FROM chapters WHERE id = ?').run(id)
  return r.changes > 0
}
