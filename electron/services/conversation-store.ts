import { randomUUID } from 'crypto'
import { getDb } from './database'
import { touchProject } from './projects-store'
import { clearConversationState } from './plan-goal-store'

export interface ConversationRow {
  id: string
  title: string | null
  model: string
  created_at: number
  updated_at: number
  kind?: string
  worktree_path?: string | null
  project_id?: string | null
}

export interface MessageRow {
  id: string
  conversation_id: string
  role: string
  content: string
  model: string | null
  tool_call_id: string | null
  tool_calls: string | null
  draft: string | null
  created_at: number
}

export interface StoredToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export function createConversation(
  model: string,
  opts?: {
    kind?: 'local' | 'cloud' | 'worktree'
    worktreePath?: string | null
    projectId?: string | null
  }
) {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  const kind = opts?.kind ?? 'local'
  const worktreePath = opts?.worktreePath ?? null
  const projectId = opts?.projectId ?? null
  db.prepare(
    'INSERT INTO conversations (id, title, model, created_at, updated_at, kind, worktree_path, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, null, model, now, now, kind, worktreePath, projectId)
  if (projectId) touchProject(projectId)
  return {
    id,
    title: null,
    model,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    kind,
    worktreePath,
    projectId
  }
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
    messageCount: count.cnt,
    kind: (row.kind as 'local' | 'cloud' | 'worktree' | undefined) ?? 'local',
    worktreePath: row.worktree_path ?? null,
    projectId: row.project_id ?? null
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
      messageCount: count.cnt,
      kind: (row.kind as 'local' | 'cloud' | 'worktree' | undefined) ?? 'local',
      worktreePath: row.worktree_path ?? null,
      projectId: row.project_id ?? null
    }
  })
}

export function deleteConversation(id: string) {
  const db = getDb()
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
  // plan_steps / goals have no FK to conversations (the '__global__' bucket and
  // ephemeral runs need rows without a conversation row), so clear them here.
  clearConversationState(id)
}

export function updateConversationTitle(id: string, title: string) {
  const db = getDb()
  db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
    title,
    Date.now(),
    id
  )
}

export function updateConversationModel(id: string, model: string) {
  const db = getDb()
  db.prepare('UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?').run(
    model,
    Date.now(),
    id
  )
}

export function setConversationProject(id: string, projectId: string | null) {
  const db = getDb()
  db.prepare('UPDATE conversations SET project_id = ?, updated_at = ? WHERE id = ?').run(
    projectId,
    Date.now(),
    id
  )
  if (projectId) touchProject(projectId)
}

export function touchConversation(id: string) {
  const db = getDb()
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), id)
  // Bubble activity up to the parent project so it sorts to the top.
  const row = db
    .prepare('SELECT project_id FROM conversations WHERE id = ?')
    .get(id) as { project_id?: string | null } | undefined
  if (row?.project_id) touchProject(row.project_id)
}

export function saveMessage(msg: {
  id: string
  conversationId: string
  role: string
  content: string
  model?: string
  toolCallId?: string
  toolCalls?: StoredToolCall[]
  draft?: string
}) {
  const db = getDb()
  const now = Date.now()
  const toolCallsJson = msg.toolCalls && msg.toolCalls.length > 0 ? JSON.stringify(msg.toolCalls) : null
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, model, tool_call_id, tool_calls, draft, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    msg.id,
    msg.conversationId,
    msg.role,
    msg.content,
    msg.model || null,
    msg.toolCallId || null,
    toolCallsJson,
    msg.draft || null,
    now
  )
  touchConversation(msg.conversationId)
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    role: msg.role,
    content: msg.content,
    timestamp: now,
    model: msg.model,
    toolCallId: msg.toolCallId,
    toolCalls: msg.toolCalls,
    draft: msg.draft
  }
}

export function getMessages(conversationId: string) {
  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(conversationId) as MessageRow[]
  return rows.map((row) => {
    let toolCalls: StoredToolCall[] | undefined
    if (row.tool_calls) {
      try {
        const parsed = JSON.parse(row.tool_calls)
        if (Array.isArray(parsed)) toolCalls = parsed as StoredToolCall[]
      } catch {
        // Corrupt JSON — drop. The orphan-tool filter in chat.ts will
        // handle the consequence (drop tool replies that have no parent).
      }
    }
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as 'user' | 'assistant' | 'system' | 'tool',
      content: row.content,
      timestamp: row.created_at,
      model: row.model || undefined,
      toolCallId: row.tool_call_id || undefined,
      toolCalls
    }
  })
}
