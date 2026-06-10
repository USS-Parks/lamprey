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

export interface RunSummaryProofReceipt {
  id: string
  kind: string
  status: string
  command: string
  parsedMetrics?: Record<string, unknown>
  exitCode?: number
  durationMs?: number
}

export interface RunSummary {
  userGoal: string
  plan?: {
    steps: Array<{ text: string; status: string }>
    totals?: Record<string, number>
  }
  toolCalls: RunSummaryToolCall[]
  proofReceipts: RunSummaryProofReceipt[]
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

export type AgenticComposerMode = 'auto' | 'always' | 'never'

export interface AgenticCodingConfig {
  mode: boolean
  skills: string[]
  composer: AgenticComposerMode
}

export const DEFAULT_AGENTIC_SKILLS = ['plan', 'context', 'verify'] as const

/**
 * Resolve the agentic-coding config from raw settings.json content.
 *
 * SP-2 (Sweet Spot Phase, 2026-06-10) — the composer is now PART OF agentic
 * coding mode rather than a free-floating default: when `agenticCodingMode`
 * is off (the default), `composer` resolves to `'never'` regardless of the
 * stored `agenticCodingComposer` value. Before this change the composer ran a
 * second model pass over the model's final reply on EVERY tool-using turn
 * (E3 in SP_BASELINE.md) — the Opus 4.5-era product never rewrote the model's
 * answer. Turning agentic coding mode on restores the configured behavior
 * ('auto' default: compose when at least one tool round ran).
 */
export function loadAgenticCodingConfig(
  raw: Record<string, unknown> | null
): AgenticCodingConfig {
  const off: AgenticCodingConfig = {
    mode: false,
    skills: [...DEFAULT_AGENTIC_SKILLS],
    composer: 'never'
  }
  if (!raw) return off
  const mode = raw.agenticCodingMode === true
  const rawSkills = Array.isArray(raw.agenticCodingSkills)
    ? (raw.agenticCodingSkills as unknown[]).filter((s): s is string => typeof s === 'string')
    : [...DEFAULT_AGENTIC_SKILLS]
  if (!mode) return { ...off, skills: rawSkills }
  const composerRaw = raw.agenticCodingComposer
  const composer: AgenticComposerMode =
    composerRaw === 'always' || composerRaw === 'never' ? composerRaw : 'auto'
  return { mode, skills: rawSkills, composer }
}

/**
 * Composer gate honoring agentic coding settings. 'auto' composes only when
 * at least one tool round ran; 'always' composes on pure-chat turns too;
 * 'never' skips entirely. With agentic coding mode off,
 * `loadAgenticCodingConfig` already pins the mode to 'never' (SP-2).
 */
export function resolveComposerGate(mode: AgenticComposerMode, round: number): boolean {
  if (mode === 'never') return false
  if (mode === 'always') return true
  return shouldComposeFinalResponse(round)
}

export function summarizeRun(
  messages: RunSummaryMessage[],
  planSnapshot: PlanSnapshot | null | undefined,
  toolCalls: LampreyToolCall[],
  draftReply: string,
  proofReceipts: RunSummaryProofReceipt[] = []
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
    proofReceipts: proofReceipts.slice(0, 20).map((receipt) => ({
      id: receipt.id,
      kind: receipt.kind,
      status: receipt.status,
      command: truncateForComposer(receipt.command, 240),
      parsedMetrics: receipt.parsedMetrics ?? {},
      exitCode: receipt.exitCode,
      durationMs: receipt.durationMs
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
      'Proof receipts:',
      summary.proofReceipts.length > 0
        ? summary.proofReceipts
            .map((receipt) => {
              const metrics =
                receipt.parsedMetrics && Object.keys(receipt.parsedMetrics).length > 0
                  ? ` metrics=${JSON.stringify(receipt.parsedMetrics)}`
                  : ''
              const exit = typeof receipt.exitCode === 'number' ? ` exit=${receipt.exitCode}` : ''
              return `- ${receipt.kind} receipt ${receipt.id}: ${receipt.status}; command=${receipt.command}${exit}${metrics}`
            })
            .join('\n')
        : '(none recorded; if proof is relevant, say proof is missing instead of inventing counts)',
      '',
      'Model draft reply:',
      summary.draftReply || '(empty draft)',
      '</run_summary>'
    ].join('\n')
  }
}

/**
 * WC-6 — Format a deterministic verification footer that quotes the receipt
 * IDs and parsed metrics tied to the current turn. Appended to the model's
 * composer reply when at least one proof receipt exists, so the user always
 * sees the proof IDs that back the claim (M9 promise) — even if the model
 * forgets to inline them in prose.
 *
 * Format:
 *   ---
 *   **Verification:**
 *   - receipt prf_abc123 ✓ verify: vitest 142 passed, 0 failed (exit 0)
 *   - receipt prf_def456 ✗ verify: build failed (exit 1)
 *
 * Returns the empty string when receipts is empty so callers can blindly
 * append the result.
 */
export function formatVerificationFooter(
  receipts: RunSummaryProofReceipt[]
): string {
  if (!receipts || receipts.length === 0) return ''
  const lines: string[] = ['', '---', '**Verification:**']
  for (const receipt of receipts.slice(0, 20)) {
    const glyph =
      receipt.status === 'pass' || receipt.status === 'passed' || receipt.status === 'done'
        ? '✓'
        : receipt.status === 'skipped'
          ? '○'
          : '✗'
    const exit =
      typeof receipt.exitCode === 'number' ? ` (exit ${receipt.exitCode})` : ''
    const metrics = formatReceiptMetricsForCitation(receipt.parsedMetrics)
    const tail = metrics ? `: ${metrics}` : ''
    lines.push(
      `- receipt ${receipt.id} ${glyph} ${receipt.kind} \`${receipt.command}\`${tail}${exit}`
    )
  }
  return lines.join('\n')
}

/**
 * WC-6 — Render the most useful subset of parsed metrics in one short line,
 * favoring counts the user can verify at a glance (vitest pass/fail, tsc
 * errors, eslint counts, build duration). Unknown shapes are stringified
 * compactly to JSON. Returns undefined when no metrics exist.
 */
export function formatReceiptMetricsForCitation(
  metrics: Record<string, unknown> | undefined
): string | undefined {
  if (!metrics || Object.keys(metrics).length === 0) return undefined
  const pieces: string[] = []
  const passed = pickNumber(metrics, ['passed', 'pass', 'tests_passed', 'passedCount'])
  const failed = pickNumber(metrics, ['failed', 'fail', 'tests_failed', 'failedCount'])
  const skipped = pickNumber(metrics, ['skipped', 'skip'])
  const errors = pickNumber(metrics, ['errors', 'errorCount'])
  const warnings = pickNumber(metrics, ['warnings', 'warningCount'])
  if (typeof passed === 'number') pieces.push(`${passed} passed`)
  if (typeof failed === 'number') pieces.push(`${failed} failed`)
  if (typeof skipped === 'number') pieces.push(`${skipped} skipped`)
  if (typeof errors === 'number') pieces.push(`${errors} errors`)
  if (typeof warnings === 'number') pieces.push(`${warnings} warnings`)
  if (pieces.length > 0) return pieces.join(', ')
  // No known fields — fall back to compact JSON, capped so the footer stays
  // legible.
  const compact = JSON.stringify(metrics)
  return compact.length > 120 ? compact.slice(0, 117) + '...' : compact
}

function pickNumber(
  source: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const k of keys) {
    const v = source[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
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
  // WC-6 — Append a deterministic verification footer when proof receipts
  // exist. The model's reply is preserved exactly; we only add a
  // ``---\n**Verification:**\n…`` block so the user always sees the
  // receipt IDs and metrics that back the claim, even if the model
  // forgets to cite them in prose. M9 promised this; the composer
  // previously trusted the model to follow the citation instruction.
  const body = reply.content.trim()
  const footer = formatVerificationFooter(summary.proofReceipts)
  return {
    content: footer ? `${body}\n${footer}` : body,
    // Reasoning trimmed at the chatOnce boundary already (see registry.ts);
    // pass through as-is so R6 can fold it into the cumulative trail.
    reasoning: reply.reasoning
  }
}
