import * as convStore from './conversation-store'
import { listStageMetrics, type PersistedStageMetric } from './stage-metrics-store'

// RT4 — pure implementation of the `get_conversation_history` model-callable
// tool. Reads from the SQLite messages table for the active (or a specified)
// conversation, optionally enriches each assistant row with stage metrics +
// tool calls + reasoning. Pure in the sense that all I/O is through the
// `convStore` + `stage-metrics-store` seams; no network, no provider calls.
//
// Risk classification: 'low' read-only — the tool can only see the user's own
// conversation rows on this machine; it cannot reach the network, cannot
// mutate state, cannot escape the active conversation unless the user
// explicitly passes a different conversation_id (the model is told the
// default is "active conversation").

export interface GetConversationHistoryArgs {
  conversation_id?: string
  turn_index?: number
  limit?: number
  include_reasoning?: boolean
  include_stage_metrics?: boolean
  include_tool_calls?: boolean
}

export interface ConversationHistoryTurn {
  turn_index: number
  role: 'user' | 'assistant' | 'system' | 'tool'
  model?: string
  timestamp: number
  content: string
  reasoning?: string
  stage_metrics?: PersistedStageMetric[]
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export interface GetConversationHistoryResult {
  conversation_id: string
  total_turns: number
  returned_turns: number
  turns: ConversationHistoryTurn[]
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 200

export function validateArgs(raw: unknown): GetConversationHistoryArgs {
  if (raw == null) return {}
  if (typeof raw !== 'object') {
    throw new Error('get_conversation_history: arguments must be an object.')
  }
  const a = raw as Record<string, unknown>
  const out: GetConversationHistoryArgs = {}
  if (a.conversation_id !== undefined) {
    if (typeof a.conversation_id !== 'string' || !a.conversation_id.trim()) {
      throw new Error('get_conversation_history: conversation_id must be a non-empty string.')
    }
    out.conversation_id = a.conversation_id.trim()
  }
  if (a.turn_index !== undefined) {
    if (typeof a.turn_index !== 'number' || !Number.isFinite(a.turn_index) || a.turn_index < 0) {
      throw new Error('get_conversation_history: turn_index must be a non-negative number.')
    }
    out.turn_index = Math.floor(a.turn_index)
  }
  if (a.limit !== undefined) {
    if (typeof a.limit !== 'number' || !Number.isFinite(a.limit) || a.limit <= 0) {
      throw new Error('get_conversation_history: limit must be a positive number.')
    }
    out.limit = Math.min(MAX_LIMIT, Math.floor(a.limit))
  }
  for (const key of ['include_reasoning', 'include_stage_metrics', 'include_tool_calls'] as const) {
    if (a[key] !== undefined) {
      if (typeof a[key] !== 'boolean') {
        throw new Error(`get_conversation_history: ${key} must be a boolean.`)
      }
      out[key] = a[key] as boolean
    }
  }
  return out
}

/**
 * Run the tool against the supplied conversation. The active-conversation
 * resolver is injected so the dispatcher can resolve it from the current
 * IPC turn's correlation state; tests pass a stub.
 */
export function runGetConversationHistory(
  args: GetConversationHistoryArgs,
  activeConversationId: string | null
): GetConversationHistoryResult {
  const conversationId = args.conversation_id ?? activeConversationId ?? ''
  if (!conversationId) {
    throw new Error(
      'get_conversation_history: no conversation_id provided and no active conversation.'
    )
  }

  const limit = args.limit ?? DEFAULT_LIMIT
  const includeReasoning = args.include_reasoning ?? true
  const includeStageMetrics = args.include_stage_metrics ?? false
  const includeToolCalls = args.include_tool_calls ?? false

  const allMessages = convStore.getMessages(conversationId)
  const indexed: ConversationHistoryTurn[] = allMessages.map((m, i) => {
    const turn: ConversationHistoryTurn = {
      turn_index: i,
      role: m.role,
      model: m.model,
      timestamp: m.timestamp,
      content: m.content
    }
    if (includeReasoning && m.reasoning) turn.reasoning = m.reasoning
    if (includeStageMetrics && m.role === 'assistant') {
      const metrics = listStageMetrics(m.id)
      if (metrics.length > 0) turn.stage_metrics = metrics
    }
    if (includeToolCalls && m.toolCalls && m.toolCalls.length > 0) {
      turn.tool_calls = m.toolCalls
    }
    return turn
  })

  let selected: ConversationHistoryTurn[]
  if (args.turn_index !== undefined) {
    const hit = indexed.find((t) => t.turn_index === args.turn_index)
    selected = hit ? [hit] : []
  } else {
    // Most recent `limit` turns, returned in chronological order.
    selected = indexed.slice(-limit)
  }

  return {
    conversation_id: conversationId,
    total_turns: allMessages.length,
    returned_turns: selected.length,
    turns: selected
  }
}

/**
 * Convenience wrapper that catches validation + runtime errors and returns a
 * shape suitable as a stringified tool result. Used by the dispatcher.
 */
export function runGetConversationHistorySafe(
  rawArgs: unknown,
  activeConversationId: string | null
): { ok: true; data: GetConversationHistoryResult } | { ok: false; error: string } {
  try {
    const args = validateArgs(rawArgs)
    const data = runGetConversationHistory(args, activeConversationId)
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
