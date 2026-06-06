import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { buildComposerSystemPrompt } from './system-prompt-builder'
import type { LampreyToolCall } from './tool-registry'
import type { PlanSnapshot } from './plan-goal-store'

export type ComposerSkipReason = 'no-tool-rounds' | 'composer-failed'

export const COMPOSER_DRAFT_CAP = 8192
export const COMPOSER_TOOL_RESULT_CAP = 4096

/** Reasoning Audit Phase R6 — generous-but-finite cap on the cumulative
 *  per-round + composer reasoning concatenation. Chain-of-thought is the
 *  most audit-load-bearing artifact a turn produces; 64 KB lets a 10-round
 *  tool-using turn keep ~6 KB of reasoning per round + composer without
 *  truncation, which covers nearly every real session.
 *
 *  When over-cap, `concatReasoningTrail()` truncates with an explicit
 *  `[truncated for length — N kb omitted]` marker so the user knows the
 *  history is incomplete (per Invariant §2.2 — no silent truncation). */
export const MAX_REASONING_BYTES = 65_536

/** Reasoning Audit Phase R6 — build the cumulative per-round reasoning
 *  trail for a composer-final assistant row. Format:
 *
 *    --- round 1 ---
 *    <round 1's chain-of-thought>
 *
 *    --- round 2 ---
 *    <round 2's chain-of-thought>
 *
 *    --- composer ---
 *    <composer's own chain-of-thought>
 *
 *  Empty round entries are skipped (filter out `null`/`undefined`/empty
 *  strings BEFORE numbering, so "round N" tracks the surviving rounds —
 *  not the absolute round index). Composer reasoning is appended last,
 *  always at the bottom, never re-numbered. Returns `undefined` when no
 *  reasoning exists at all so the saved row's `reasoning` column stays
 *  NULL instead of holding the empty string.
 *
 *  Over-cap behavior: truncate at MAX_REASONING_BYTES and append the
 *  honest `[truncated for length — N kb omitted]` marker (Invariant §2.2). */
export function concatReasoningTrail(
  roundReasonings: Array<string | undefined>,
  composerReasoning: string | undefined
): string | undefined {
  const rounds = roundReasonings
    .map((r) => (typeof r === 'string' ? r.trim() : ''))
    .filter((r) => r.length > 0)
  const composer =
    typeof composerReasoning === 'string' && composerReasoning.trim().length > 0
      ? composerReasoning.trim()
      : undefined
  if (rounds.length === 0 && !composer) return undefined
  const parts: string[] = []
  for (let i = 0; i < rounds.length; i++) {
    parts.push(`--- round ${i + 1} ---\n${rounds[i]}`)
  }
  if (composer) parts.push(`--- composer ---\n${composer}`)
  const joined = parts.join('\n\n')
  if (Buffer.byteLength(joined, 'utf8') <= MAX_REASONING_BYTES) return joined
  // Truncate to MAX_REASONING_BYTES bytes, leaving room for the marker.
  const marker = (kb: number): string => `\n\n[truncated for length — ${kb} kb omitted]`
  const reserve = marker(9999).length + 8 // generous reserve for the marker tail
  const head = joined.slice(0, Math.max(0, MAX_REASONING_BYTES - reserve))
  const omittedBytes = Buffer.byteLength(joined, 'utf8') - Buffer.byteLength(head, 'utf8')
  const omittedKb = Math.round(omittedBytes / 1024)
  return head + marker(omittedKb)
}

export interface RunSummaryMessage {
  role: string
  content?: unknown
}

export interface RunSummaryToolCall {
  id: string
  toolId: string
  name: string
  status: 'PASS' | 'FAIL' | 'SKIPPED'
  statusDetail?: string
  resultPreview?: string
  error?: string
}

export interface RunSummary {
  userGoal: string
  plan?: {
    steps: Array<{ text: string; status: string }>
    totals?: Record<string, number>
  }
  toolCalls: RunSummaryToolCall[]
  draftReply: string
}

/** Reasoning Audit Phase R2 — the composer runner now returns BOTH the
 *  rewritten body and any chain-of-thought the composer model emitted
 *  while doing the rewrite. The composer's reasoning is later folded
 *  into the cumulative round-trail by R6's `concatReasoningTrail()` so
 *  the final saved composer row carries the *whole turn*'s thought log,
 *  not just the last round's. Runner shape matches the
 *  `ChatOnceResult` from providers/registry.ts so chat.ts can pass
 *  `chatOnce` straight through. */
export interface ComposerRunnerResult {
  content: string
  reasoning?: string
}

export interface ComposerRunnerInput {
  summary: RunSummary
  model: string
  signal?: AbortSignal
  runner: (
    messages: ChatCompletionMessageParam[],
    model: string,
    signal?: AbortSignal
  ) => Promise<ComposerRunnerResult>
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content == null) return ''
  return String(content)
}

export function truncateForComposer(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 24)) + '\n[truncated for composer]'
}

function auditStatus(call: LampreyToolCall): RunSummaryToolCall['status'] {
  if (call.status === 'done') return 'PASS'
  if (call.status === 'denied') return 'SKIPPED'
  return 'FAIL'
}

function auditStatusDetail(call: LampreyToolCall): string | undefined {
  if (call.status === 'denied') return 'denied'
  if (call.status === 'error') return 'error'
  return undefined
}

export function shouldComposeFinalResponse(round: number): boolean {
  return round > 0
}

export function summarizeRun(
  messages: RunSummaryMessage[],
  planSnapshot: PlanSnapshot | null | undefined,
  toolCalls: LampreyToolCall[],
  draftReply: string
): RunSummary {
  const userGoal =
    [...messages]
      .reverse()
      .find((m) => m.role === 'user')
      ?.content ?? ''

  const plan =
    planSnapshot && planSnapshot.steps.length > 0
      ? {
          steps: planSnapshot.steps.map((step) => ({
            text: step.text,
            status: step.status
          })),
          totals: planSnapshot.totals
        }
      : undefined

  return {
    userGoal: truncateForComposer(stringifyContent(userGoal), 4096),
    plan,
    toolCalls: toolCalls
      .slice()
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((call) => ({
        id: call.id,
        toolId: call.toolId,
        name: call.name,
        status: auditStatus(call),
        statusDetail: auditStatusDetail(call),
        resultPreview: call.result
          ? truncateForComposer(call.result, COMPOSER_TOOL_RESULT_CAP)
          : undefined,
        error: call.error
          ? truncateForComposer(call.error, COMPOSER_TOOL_RESULT_CAP)
          : undefined
      })),
    draftReply: truncateForComposer(draftReply, COMPOSER_DRAFT_CAP)
  }
}

export function buildComposerPrompt(summary: RunSummary): { system: string; user: string } {
  return {
    system: buildComposerSystemPrompt(),
    user: [
      '<run_summary>',
      `User goal:\n${summary.userGoal || '(not available)'}`,
      '',
      'Plan snapshot:',
      summary.plan ? JSON.stringify(summary.plan, null, 2) : '(no plan recorded)',
      '',
      'Tool audit summary:',
      summary.toolCalls.length > 0
        ? summary.toolCalls
            .map((call) => {
              const detail = call.statusDetail ? ` (${call.statusDetail})` : ''
              const body = call.error ?? call.resultPreview ?? ''
              return `- ${call.status}${detail}: ${call.name} [${call.id}]${body ? `\n  ${body}` : ''}`
            })
            .join('\n')
        : '(no tool calls recorded)',
      '',
      'Model draft reply:',
      summary.draftReply || '(empty draft)',
      '</run_summary>'
    ].join('\n')
  }
}

export async function composeFinalResponse({
  summary,
  model,
  signal,
  runner
}: ComposerRunnerInput): Promise<ComposerRunnerResult> {
  const prompt = buildComposerPrompt(summary)
  const reply = await runner(
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ],
    model,
    signal
  )
  return {
    content: reply.content.trim(),
    // Reasoning trimmed at the chatOnce boundary already (see registry.ts);
    // pass through as-is so R6 can fold it into the cumulative trail.
    reasoning: reply.reasoning
  }
}
