import { randomUUID } from 'crypto'
import { getDb } from './database'
import { recordEvent } from './event-log'
import type { StoredToolCall } from './conversation-store'

// Shape returned by `getEffectiveMessages`. Mirrors the renderer's
// `Message` interface from src/lib/types.ts — the two tsconfig roots
// can't reach across so we duplicate the structural type here. Keep in
// lockstep with `src/lib/types.Message`. `toolCalls` matches the
// `StoredChatMessage` shape (chat-history.ts) so the result feeds
// straight into `buildApiMessagesFromStoredMessages`.
export interface CompressorMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  model?: string
  toolCallId?: string
  draft?: string
  compressedInto?: string
  toolCalls?: StoredToolCall[]
  /** Reasoning Audit Phase R8 — chain-of-thought persisted on this row.
   *  Flows through to `buildApiMessagesFromStoredMessages` which prepends
   *  it as a leading `<think>` block when the
   *  `includePastReasoningInContext` setting is on. NULL for legacy rows
   *  + Coder rows + any row whose model didn't emit reasoning. */
  reasoning?: string
}

// Track 2 / E5 — auto context compressor.
//
// Conversations grow until their projected prompt size exceeds the
// active model's context window. The compressor selects the oldest
// messages, generates a structured summary, persists it as a new
// `role: 'system'` message inserted JUST BEFORE the oldest surviving
// message, and stamps each original's `messages.compressed_into` with
// the summary's id. `getEffectiveMessages` then hides any message
// whose `compressed_into` is set, so the next prompt assembly sees
// the summary in place of the originals.
//
// The summary itself is deterministic — a structured list of
// `[role timestamp]: excerpt` lines wrapped in
// `<conversation_summary>...</conversation_summary>`. This is the v1
// shape; a future iteration can swap in a model-driven summary by
// replacing `buildSummaryText`.

export const DEFAULT_COMPRESS_THRESHOLD_PCT = 0.75
export const DEFAULT_COMPRESS_TARGET_PCT = 0.4
/** ~4 chars per token is the rough heuristic used by every other
 *  rough budget calculation in this codebase (chat:send validation,
 *  RAG retrieval budgeting). Good enough for threshold-trip; the model
 *  call's own count is authoritative for billing. */
const CHARS_PER_TOKEN_ESTIMATE = 4

interface CompressorRow {
  id: string
  conversation_id: string
  role: string
  content: string
  created_at: number
  compressed_into: string | null
}

export interface CompressionResult {
  summaryMessageId: string
  compressedCount: number
  originalTokens: number
  summaryTokens: number
  reductionPct: number
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE)
}

export function estimateTokensForMessages(messages: { content: string }[]): number {
  let total = 0
  for (const m of messages) total += estimateTokens(m.content ?? '')
  return total
}

function loadRawMessages(conversationId: string): CompressorRow[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT id, conversation_id, role, content, created_at, compressed_into
         FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC`
    )
    .all(conversationId) as CompressorRow[]
}

/**
 * Project the prompt-bound token count for a conversation: the sum of
 * effective (post-compression) message tokens. Used by both
 * `shouldCompress` and the renderer's "tokens-in-context" indicator.
 */
export function projectedTokens(conversationId: string): number {
  const rows = loadRawMessages(conversationId).filter((r) => r.compressed_into === null)
  let total = 0
  for (const r of rows) total += estimateTokens(r.content)
  return total
}

/**
 * Returns true when the projected token count exceeds
 * `thresholdPct * contextWindow`. Idempotent against a conversation
 * that has already been compressed — the surviving summary keeps the
 * pre-compression tokens out of the projection.
 */
export function shouldCompress(
  conversationId: string,
  contextWindow: number,
  thresholdPct = DEFAULT_COMPRESS_THRESHOLD_PCT
): boolean {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return false
  const budget = Math.floor(contextWindow * thresholdPct)
  return projectedTokens(conversationId) > budget
}

/**
 * Select oldest non-compressed messages until the cumulative token
 * count meets or exceeds `targetPct` of the contextWindow. Returns the
 * selection in chronological order. At least the oldest message is
 * always returned (a one-message reduction is still a reduction);
 * callers should sanity-check the result against their own minimum
 * worthwhile selection.
 */
export function selectMessagesToCompress(
  conversationId: string,
  contextWindow: number,
  targetPct = DEFAULT_COMPRESS_TARGET_PCT
): CompressorRow[] {
  const rows = loadRawMessages(conversationId).filter((r) => r.compressed_into === null)
  if (rows.length === 0) return []
  const targetTokens = Math.floor(contextWindow * targetPct)
  let cumulative = 0
  const out: CompressorRow[] = []
  for (const r of rows) {
    out.push(r)
    cumulative += estimateTokens(r.content)
    if (cumulative >= targetTokens) break
  }
  // Avoid orphaning a tail-end tool/assistant pair: when the last
  // selected message has role 'assistant' and the next existing
  // message has role 'tool' (the response to its tool_calls), keep
  // the pair together by extending the selection. The full safer
  // policy is the windowing logic in tool-call-windowing.ts; for
  // compression purposes, keeping the pair together is enough.
  while (out.length < rows.length) {
    const last = out[out.length - 1]
    const next = rows[out.length]
    if (last.role === 'assistant' && next?.role === 'tool') {
      out.push(next)
      continue
    }
    break
  }
  return out
}

const EXCERPT_LEN = 120

function buildSummaryText(rows: CompressorRow[]): string {
  const lines: string[] = ['<conversation_summary>']
  lines.push(`Compressed ${rows.length} earlier messages from this conversation.`)
  lines.push('')
  for (const r of rows) {
    const excerpt = (r.content ?? '').trim().replace(/\s+/g, ' ').slice(0, EXCERPT_LEN)
    const stamp = new Date(r.created_at).toISOString().slice(11, 19)
    lines.push(`[${r.role} ${stamp}]: ${excerpt}`)
  }
  lines.push('</conversation_summary>')
  return lines.join('\n')
}

/**
 * Run the compression pipeline. Returns the result on success, or
 * `null` when the conversation does not warrant compression yet (no
 * selectable messages, or the projected reduction is below 5% of the
 * pre-compression tokens — a barely-worth-it run not worth the
 * disruption).
 */
export function compressOldestMessages(
  conversationId: string,
  contextWindow: number,
  opts?: { thresholdPct?: number; targetPct?: number; minReductionPct?: number }
): CompressionResult | null {
  const thresholdPct = opts?.thresholdPct ?? DEFAULT_COMPRESS_THRESHOLD_PCT
  const targetPct = opts?.targetPct ?? DEFAULT_COMPRESS_TARGET_PCT
  const minReductionPct = opts?.minReductionPct ?? 0.05

  if (!shouldCompress(conversationId, contextWindow, thresholdPct)) return null

  const selection = selectMessagesToCompress(conversationId, contextWindow, targetPct)
  if (selection.length === 0) return null

  const originalTokens = selection.reduce((s, r) => s + estimateTokens(r.content), 0)
  if (originalTokens === 0) return null

  const summaryText = buildSummaryText(selection)
  const summaryTokens = estimateTokens(summaryText)
  const reductionPct = 1 - summaryTokens / originalTokens
  if (reductionPct < minReductionPct) return null

  const db = getDb()
  // Place the summary BEFORE the oldest compressed message in time so
  // the ORDER BY created_at ASC iteration in `getMessages` /
  // `getEffectiveMessages` puts it ahead of the surviving messages.
  const summaryId = randomUUID()
  const summaryCreatedAt = Math.max(0, selection[0].created_at - 1)
  const summaryInsert = db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES (?, ?, 'system', ?, ?)`
  )
  const markCompressed = db.prepare(
    'UPDATE messages SET compressed_into = ? WHERE id = ?'
  )

  const tx = db.transaction((rows: CompressorRow[]) => {
    summaryInsert.run(summaryId, conversationId, summaryText, summaryCreatedAt)
    for (const r of rows) markCompressed.run(summaryId, r.id)
  })

  tx(selection)

  try {
    recordEvent({
      type: 'chat.compressed',
      actorKind: 'system',
      conversationId,
      entityKind: 'message',
      entityId: summaryId,
      payload: {
        compressedCount: selection.length,
        originalTokens,
        summaryTokens,
        reductionPct: Number(reductionPct.toFixed(3))
      }
    })
  } catch (err) {
    console.error('[compressor] chat.compressed event failed:', err)
  }

  return {
    summaryMessageId: summaryId,
    compressedCount: selection.length,
    originalTokens,
    summaryTokens,
    reductionPct
  }
}

/**
 * Return the effective view of a conversation's messages for prompt
 * assembly: any message whose `compressed_into` is set is hidden; the
 * summary message it points to is included once (it has its own row
 * with `compressed_into IS NULL`). Tool calls and tool results stay in
 * the order the dispatcher produced them.
 *
 * Shape matches `convStore.getMessages` so the chat dispatcher can swap
 * one for the other without other changes.
 */
export function getEffectiveMessages(conversationId: string): CompressorMessage[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, conversation_id, role, content, model, tool_call_id,
              tool_calls, draft, reasoning, created_at, compressed_into
         FROM messages
        WHERE conversation_id = ?
          AND compressed_into IS NULL
        ORDER BY created_at ASC`
    )
    .all(conversationId) as Array<CompressorRow & {
      model: string | null
      tool_call_id: string | null
      tool_calls: string | null
      draft: string | null
      reasoning: string | null
    }>
  return rows.map((r) => {
    let toolCalls: StoredToolCall[] | undefined
    if (r.tool_calls) {
      try {
        const parsed = JSON.parse(r.tool_calls)
        if (Array.isArray(parsed)) toolCalls = parsed as StoredToolCall[]
      } catch {
        /* drop corrupt JSON */
      }
    }
    return {
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role as CompressorMessage['role'],
      content: r.content,
      timestamp: r.created_at,
      model: r.model ?? undefined,
      toolCallId: r.tool_call_id ?? undefined,
      draft: r.draft ?? undefined,
      // R8 — surface reasoning so buildApiMessagesFromStoredMessages can
      // re-feed it as a leading <think> block on the next turn (gated
      // by the includePastReasoningInContext setting).
      reasoning: r.reasoning ?? undefined,
      // `tool_calls` lives off-type on the renderer mirror but the
      // dispatcher's chat-history builder reads it through the same
      // store. We surface it on the message body for compatibility
      // even though the public type omits it.
      ...(toolCalls ? { toolCalls } : {})
    }
  })
}
