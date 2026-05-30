import { randomUUID } from 'crypto'
import { getDb } from './database'

export interface ConversationRow {
  id: string
  title: string | null
  model: string
  created_at: number
  updated_at: number
}

export interface MessageRow {
  id: string
  conversation_id: string
  role: string
  content: string
  model: string | null
  tool_call_id: string | null
  created_at: number
}

export function createConversation(model: string) {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    'INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, null, model, now, now)
  return { id, title: null, model, createdAt: now, updatedAt: now, messageCount: 0 }
}

export function getConversation(id: string) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
    | ConversationRow
    | undefined
  if (!row) return null
  const count = db.prepare(
    'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?'
  ).get(id) as { cnt: number }
  return {
    id: row.id,
    title: row.title || 'New conversation',
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: count.cnt
  }
}

export function listConversations() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as ConversationRow[]
  return rows.map((row) => {
    const count = db.prepare(
      'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?'
    ).get(row.id) as { cnt: number }
    return {
      id: row.id,
      title: row.title || 'New conversation',
      model: row.model,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: count.cnt
    }
  })
}

export function deleteConversation(id: string) {
  const db = getDb()
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function updateConversationTitle(id: string, title: string) {
  const db = getDb()
  db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
    title,
    Date.now(),
    id
  )
}

export function touchConversation(id: string) {
  const db = getDb()
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), id)
}

export function saveMessage(msg: {
  id: string
  conversationId: string
  role: string
  content: string
  model?: string
  toolCallId?: string
}) {
  const db = getDb()
  const now = Date.now()
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, model, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(msg.id, msg.conversationId, msg.role, msg.content, msg.model || null, msg.toolCallId || null, now)
  touchConversation(msg.conversationId)
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    role: msg.role,
    content: msg.content,
    timestamp: now,
    model: msg.model,
    toolCallId: msg.toolCallId
  }
}

export function getMessages(conversationId: string) {
  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(conversationId) as MessageRow[]
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as 'user' | 'assistant' | 'system' | 'tool',
    content: row.content,
    timestamp: row.created_at,
    model: row.model || undefined,
    toolCallId: row.tool_call_id || undefined
  }))
}
