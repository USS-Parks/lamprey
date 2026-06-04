import { getConversation, listConversations } from './conversation-store'
import { enqueueAsyncEvent } from './async-event-bridge'

export interface ActiveSession {
  id: string
  title: string
  model: string
  updatedAt: number
}

export interface IncomingSessionMessage {
  id: string
  fromSessionId: string | null
  targetSessionId: string
  body: string
  createdAt: number
}

export function listActiveSessions(limit = 50): ActiveSession[] {
  return listConversations()
    .filter((c: any) => c.archived !== true)
    .slice(0, Math.min(Math.max(limit, 1), 200))
    .map((c) => ({
      id: c.id,
      title: c.title,
      model: c.model,
      updatedAt: c.updatedAt
    }))
}

export function sendSessionMessage(input: {
  targetSessionId: string
  body: string
  fromSessionId?: string | null
}): IncomingSessionMessage {
  if (!input.targetSessionId) throw new Error('targetSessionId required')
  if (!getConversation(input.targetSessionId)) throw new Error('target session not found')
  if (!input.body || typeof input.body !== 'string') throw new Error('body required')
  const row = enqueueAsyncEvent({
    conversationId: input.targetSessionId,
    kind: 'sessions:incoming-message',
    payload: {
      title: 'Incoming session message',
      fromSessionId: input.fromSessionId ?? null,
      targetSessionId: input.targetSessionId,
      body: input.body
    }
  })
  return {
    id: row.id,
    fromSessionId: input.fromSessionId ?? null,
    targetSessionId: input.targetSessionId,
    body: input.body,
    createdAt: row.createdAt
  }
}
