// The single integration point. Sits between `executeShellCommand`
// (electron/services/shell-tool.ts) and `formatShellResultForModel`
// (same file) in the K9 wire-up at tool-registry.ts. Pure-data layer
// — never throws, always returns a ShellResult.
//
// Decision flow:
//   1. snipEnabled === false  → pass-through, no DB write
//   2. args.bypass_snip === true → pass-through, log to command_log
//                                  with matched_filter=null (rtk proxy)
//   3. parseCommand(command)  → matcher; chains opt out
//   4. selectFilter           → no match → pass-through + command_log
//   5. exitCode mismatch      → pass-through + command_log
//   6. runPipeline            → transform
//   7. tokens_after > tokens_before → fall back + command_log (Inv 2)
//   8. record snip_event + command_log with matched filter name

import type { ShellResult } from '../shell-tool'
import { listActiveFilters } from './filter-loader'
import { parseCommand, selectFilter } from './matcher'
import { estimateTokens, runPipeline } from './engine'
import { recordCommandLog, recordEvent } from './tracking'
import type { Filter, SnipEvent } from './types'

export interface SnipApplyContext {
  /** Master kill-switch from `AppSettings.snipEnabled`. */
  snipEnabled: boolean
  /** Per-call escape hatch from `ShellArgs.bypass_snip` (K9 schema). */
  bypassThisCall: boolean
  /** Optional conversation correlation id for tracking rows. */
  conversationId?: string
  /** Now in ms, threaded so tests can pin time. Defaults to Date.now() at call. */
  nowMs?: number
}

export interface SnipApplyOutcome {
  result: ShellResult
  /** Set when a filter matched AND produced compressed output. */
  event: SnipEvent | null
  /** True when the caller asked for raw output via `bypass_snip`. */
  bypassed: boolean
  /** Name of the filter that ran, or null. */
  matchedFilter: string | null
}

/**
 * Apply the snip layer to a fresh ShellResult. Pure-ish — the only
 * side effect is the two best-effort DB writes (tracking.ts).
 */
export function applySnip(
  command: string,
  result: ShellResult,
  ctx: SnipApplyContext
): SnipApplyOutcome {
  const now = ctx.nowMs ?? Date.now()

  // Pre-parse the head for the command_log even on the disabled / bypass
  // path so the Discover panel still has data.
  const parsed = parseCommand(command)
  const head = parsed.head

  // Path 1: master switch off → fully transparent. No DB write so
  // disabled installs incur zero overhead beyond a string parse.
  if (!ctx.snipEnabled) {
    return { result, event: null, bypassed: false, matchedFilter: null }
  }

  // Path 2: per-call bypass → log the call for the Discover panel but
  // don't run any filter. Matches rtk's `rtk proxy <cmd>` UX.
  if (ctx.bypassThisCall) {
    const tokensRaw = estimateTokens(result.stdout) + estimateTokens(result.stderr)
    recordCommandLog({
      ts: now,
      command,
      commandHead: head,
      tokens: tokensRaw,
      matchedFilter: null,
      conversationId: ctx.conversationId
    })
    return { result, event: null, bypassed: true, matchedFilter: null }
  }

  let filter: Filter | null = null
  let filters: Filter[] = []
  try {
    filters = listActiveFilters()
  } catch (err) {
    // Loader failure (e.g. corrupt YAML mid-stream) — never block.
    console.error('[snip] listActiveFilters failed; passing through:', err)
  }
  filter = selectFilter(parsed, filters)

  const tokensRaw = estimateTokens(result.stdout) + estimateTokens(result.stderr)

  // Path 4: no matching filter → still log for Discover.
  if (filter === null) {
    recordCommandLog({
      ts: now,
      command,
      commandHead: head,
      tokens: tokensRaw,
      matchedFilter: null,
      conversationId: ctx.conversationId
    })
    return { result, event: null, bypassed: false, matchedFilter: null }
  }

  // Path 5: exit-code gate. Default: only on success (exit 0). A
  // filter that wants to run on failure sets `match.exitCodes`.
  const allowedCodes = filter.match.exitCodes ?? [0]
  if (result.exitCode === null || !allowedCodes.includes(result.exitCode)) {
    recordCommandLog({
      ts: now,
      command,
      commandHead: head,
      tokens: tokensRaw,
      matchedFilter: null,
      conversationId: ctx.conversationId
    })
    return { result, event: null, bypassed: false, matchedFilter: null }
  }

  // Path 6 + 7: run the pipeline. If the result would grow, fall back.
  const startedAt = now
  const stdoutAfter = runPipeline(result.stdout, filter.pipeline)
  const stderrAfter = filter.stderrPipeline
    ? runPipeline(result.stderr, filter.stderrPipeline)
    : result.stderr
  const finishedAt = now // no real clock here; durationMs is a coarse stamp

  const bytesBefore = result.stdout.length + result.stderr.length
  const bytesAfter = stdoutAfter.length + stderrAfter.length
  const tokensBefore = estimateTokens(result.stdout) + estimateTokens(result.stderr)
  const tokensAfter = estimateTokens(stdoutAfter) + estimateTokens(stderrAfter)

  if (tokensAfter >= tokensBefore) {
    // Filter would not save tokens. Don't record an event; the matched
    // filter is still logged so the dashboard can show coverage.
    recordCommandLog({
      ts: now,
      command,
      commandHead: head,
      tokens: tokensRaw,
      matchedFilter: filter.name,
      conversationId: ctx.conversationId
    })
    return { result, event: null, bypassed: false, matchedFilter: filter.name }
  }

  const filtered: ShellResult = {
    ...result,
    stdout: stdoutAfter,
    stderr: stderrAfter
  }

  const event: SnipEvent = {
    filter: filter.name,
    command,
    bytesBefore,
    bytesAfter,
    tokensBefore,
    tokensAfter,
    durationMs: Math.max(0, finishedAt - startedAt),
    ts: now,
    conversationId: ctx.conversationId
  }

  recordEvent(event)
  recordCommandLog({
    ts: now,
    command,
    commandHead: head,
    tokens: tokensAfter,
    matchedFilter: filter.name,
    conversationId: ctx.conversationId
  })

  return { result: filtered, event, bypassed: false, matchedFilter: filter.name }
}
