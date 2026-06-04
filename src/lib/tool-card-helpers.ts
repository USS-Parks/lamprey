// Pure formatting helpers for ToolUseCard. Live in /lib so the test suite
// (vitest, node env) can exercise them without a render harness.

import type { ToolRisk } from './types'

// Plain-English description of the risk level — what the user sees on the
// badge hover. Keep these consumer-friendly; the audit log shows the raw key.
export const RISK_LABEL: Record<ToolRisk, string> = {
  read: 'Reads files or data',
  write: 'Modifies files or state',
  network: 'Makes a network request',
  destructive: 'Could be destructive',
  secret: 'Touches secrets or credentials'
}

// Color tokens for the risk pill background — token names exist in the
// Tailwind palette via the theme tokens (var(--accent), --error, etc).
export const RISK_TONE: Record<ToolRisk, string> = {
  read: 'border-[var(--border)] text-[var(--text-muted)]',
  network: 'border-[var(--accent-dim)] text-[var(--accent)]',
  write: 'border-[var(--warning)]/40 text-[var(--warning)]',
  destructive: 'border-[var(--error)]/40 text-[var(--error)]',
  secret: 'border-[var(--error)]/40 text-[var(--error)]'
}

const STRING_VALUE_CAP = 60
const ARG_PAIR_CAP = 3

/**
 * Build a compact "key=value, key=value" one-liner for the card header so
 * the args are useful at a glance without showing raw JSON. Strings are
 * trimmed and quoted; longer strings collapse to `"prefix…"`; arrays and
 * objects collapse to their type + length so a 50-row diff doesn't blow
 * out the layout. Falls back to `{empty}` when there are no args.
 */
export function summarizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args || typeof args !== 'object') return '{empty}'
  const keys = Object.keys(args)
  if (keys.length === 0) return '{empty}'

  const pairs: string[] = []
  for (const k of keys.slice(0, ARG_PAIR_CAP)) {
    pairs.push(`${k}=${formatArgValue(args[k])}`)
  }
  const remainder = keys.length - ARG_PAIR_CAP
  if (remainder > 0) pairs.push(`+${remainder} more`)
  return pairs.join(', ')
}

function formatArgValue(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  const t = typeof v
  if (t === 'string') {
    const s = v as string
    const trimmed = s.replace(/\s+/g, ' ').trim()
    if (trimmed.length <= STRING_VALUE_CAP) return JSON.stringify(trimmed)
    return JSON.stringify(trimmed.slice(0, STRING_VALUE_CAP - 1) + '…')
  }
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v)
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? '' : 's'}]`
  if (t === 'object') {
    const keys = Object.keys(v as Record<string, unknown>)
    return `{${keys.length} key${keys.length === 1 ? '' : 's'}}`
  }
  return String(v)
}

/**
 * Bounded result preview for the collapsed card body. Caps by both lines
 * and total characters so a single very long line and a huge multi-line
 * dump both fit predictably. Adds a `…` suffix when truncated; returns
 * the original string untouched when it fits.
 */
export function previewResult(
  result: string | undefined,
  opts: { lineCap?: number; charCap?: number } = {}
): { text: string; truncated: boolean } {
  if (!result) return { text: '', truncated: false }
  const lineCap = opts.lineCap ?? 4
  const charCap = opts.charCap ?? 240
  const lines = result.split('\n')
  let truncatedByLines = false
  let trimmedLines = lines
  if (lines.length > lineCap) {
    trimmedLines = lines.slice(0, lineCap)
    truncatedByLines = true
  }
  let text = trimmedLines.join('\n')
  let truncatedByChars = false
  if (text.length > charCap) {
    text = text.slice(0, charCap - 1)
    truncatedByChars = true
  }
  const truncated = truncatedByLines || truncatedByChars
  return { text: truncated ? text + '…' : text, truncated }
}

/**
 * Fluidity J6: compact one-line "args" summary capped at 60 characters
 * with a trailing ellipsis. Used by ToolUseCard's collapsed header shape.
 * Delegates to summarizeArgs for the "key=value, key=value" format then
 * caps the overall string so a triple-key argv doesn't push the elapsed
 * + status icons off-screen on narrow widths.
 */
export function collapsedSummary(args: Record<string, unknown> | undefined): string {
  const compact = summarizeArgs(args)
  if (compact.length <= 60) return compact
  return compact.slice(0, 59) + '…'
}

/**
 * Format an elapsed-time label suitable for the card header. Short form
 * matches StreamStatusLine — "12s" / "1m 4s" — so the two surfaces read the
 * same way next to each other.
 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}m ${r}s`
}
