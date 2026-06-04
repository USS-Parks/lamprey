import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { getDb } from './database'
import { emitChatEvent } from './chat-events'
import type { AgentRunNotifyEvent } from './subagent-runner'

export type AsyncEventKind =
  | 'agent:run:notify'
  | 'loops:wakeup-fired'
  | 'automations:run-completed'
  | 'tasks:spawn-completed'
  | 'sessions:incoming-message'
  | string

export interface AsyncEventRow {
  id: string
  conversationId: string
  kind: AsyncEventKind
  payload: Record<string, unknown>
  createdAt: number
  deliveredAt: number | null
}

export interface EnqueueAsyncEventInput {
  conversationId: string
  kind: AsyncEventKind
  payload?: Record<string, unknown>
  createdAt?: number
}

interface RawAsyncEventRow {
  id: string
  conversation_id: string
  kind: string
  payload_json: string
  created_at: number
  delivered_at: number | null
}

let memoryFallbackForced = false
const memory = new Map<string, AsyncEventRow>()

function useDb(): Database.Database | null {
  if (memoryFallbackForced) return null
  try {
    return getDb()
  } catch {
    memoryFallbackForced = true
    return null
  }
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through
  }
  return {}
}

function rowToDomain(row: RawAsyncEventRow): AsyncEventRow {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    kind: row.kind,
    payload: parsePayload(row.payload_json),
    createdAt: row.created_at,
    deliveredAt: row.delivered_at
  }
}

function truncate(text: string, max = 280): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1)}…`
}

function eventTitle(row: AsyncEventRow): string {
  const p = row.payload
  if (typeof p.title === 'string' && p.title.trim()) return p.title.trim()
  if (typeof p.label === 'string' && p.label.trim()) return p.label.trim()
  if (row.kind === 'agent:run:notify') return 'Background agent finished'
  if (row.kind === 'tasks:spawn-completed') return 'Spawned task ready'
  if (row.kind === 'automations:run-completed') return 'Automation completed'
  if (row.kind === 'loops:wakeup-fired') return 'Scheduled wake-up fired'
  if (row.kind === 'sessions:incoming-message') return 'Incoming session message'
  return row.kind
}

function eventBody(row: AsyncEventRow): string {
  const p = row.payload
  const candidates = [
    p.message,
    p.body,
    p.summary,
    p.resultText,
    p.error,
    p.prompt,
    p.tldr
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return truncate(c)
  }
  return truncate(JSON.stringify(p))
}

export function enqueueAsyncEvent(input: EnqueueAsyncEventInput): AsyncEventRow {
  const conversationId = input.conversationId?.trim()
  if (!conversationId) throw new Error('enqueueAsyncEvent: conversationId required')
  const now = input.createdAt ?? Date.now()
  const row: AsyncEventRow = {
    id: randomUUID(),
    conversationId,
    kind: input.kind,
    payload: input.payload ?? {},
    createdAt: now,
    deliveredAt: null
  }
  const db = useDb()
  if (db) {
    db.prepare(
      `INSERT INTO async_events
         (id, conversation_id, kind, payload_json, created_at, delivered_at)
       VALUES (?, ?, ?, ?, ?, NULL)`
    ).run(row.id, row.conversationId, row.kind, JSON.stringify(row.payload), row.createdAt)
  } else {
    memory.set(row.id, row)
  }

  emitChatEvent('async-event:received', {
    id: row.id,
    conversationId: row.conversationId,
    kind: row.kind,
    title: eventTitle(row),
    message: eventBody(row),
    createdAt: row.createdAt
  })

  return row
}

export function listPendingAsyncEvents(
  conversationId: string,
  limit = 20
): AsyncEventRow[] {
  const db = useDb()
  if (db) {
    const rows = db
      .prepare(
        `SELECT * FROM async_events
          WHERE conversation_id = ? AND delivered_at IS NULL
          ORDER BY created_at ASC
          LIMIT ?`
      )
      .all(conversationId, Math.max(1, Math.floor(limit))) as RawAsyncEventRow[]
    return rows.map(rowToDomain)
  }
  return [...memory.values()]
    .filter((row) => row.conversationId === conversationId && row.deliveredAt === null)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, Math.max(1, Math.floor(limit)))
}

export function drainAsyncEventsForPrompt(
  conversationId: string,
  limit = 20,
  deliveredAt = Date.now()
): AsyncEventRow[] {
  const rows = listPendingAsyncEvents(conversationId, limit)
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const db = useDb()
  if (db) {
    db.prepare(
      `UPDATE async_events
          SET delivered_at = ?
        WHERE id IN (${ids.map(() => '?').join(', ')})`
    ).run(deliveredAt, ...ids)
  } else {
    for (const id of ids) {
      const row = memory.get(id)
      if (row) memory.set(id, { ...row, deliveredAt })
    }
  }
  return rows.map((row) => ({ ...row, deliveredAt }))
}

export function buildTaskNotificationsBlock(events: AsyncEventRow[]): string {
  if (events.length === 0) return ''
  const lines = [
    '<task-notifications>',
    'Background activity completed since the last turn. Treat these as new context and decide whether to act on them.'
  ]
  for (const event of events) {
    lines.push(
      `- [${event.kind}] ${eventTitle(event)}: ${eventBody(event)}`
    )
  }
  lines.push('</task-notifications>')
  return lines.join('\n')
}

export function enqueueAgentRunNotification(event: AgentRunNotifyEvent): AsyncEventRow | null {
  if (!event.parentConvId) return null
  if (event.status === 'running') return null
  return enqueueAsyncEvent({
    conversationId: event.parentConvId,
    kind: 'agent:run:notify',
    payload: {
      runId: event.runId,
      agentType: event.agentType,
      label: event.label,
      status: event.status,
      resultText: event.resultText,
      error: event.error,
      worktreePath: event.worktreePath,
      background: event.background,
      startedAt: event.startedAt,
      finishedAt: event.finishedAt
    },
    createdAt: event.finishedAt ?? Date.now()
  })
}

export function __forceAsyncEventMemoryFallback(): void {
  memoryFallbackForced = true
}

export function __resetAsyncEventBridge(): void {
  memory.clear()
  memoryFallbackForced = false
}
