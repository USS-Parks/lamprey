// Pure implementations of the 11 pipeline actions. Each is a
// `(input: string, action: PipelineAction, ctx: ActionContext) => string`.
// No I/O, no allocation beyond what's necessary, no `Date.now()` (a
// pipeline run must be deterministic given its input).
//
// The engine in engine.ts dispatches on `action.action` and threads a
// shared `ActionContext` between calls so an `aggregate` step can leave
// counters that a later `format_template` step picks up.

import type { PipelineAction } from './types'

const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\[[0-9;?]*[ -/]*[@-~]/g

/**
 * Mutable per-run scratch shared across all pipeline steps. Currently
 * holds `aggregate` counters; future actions (group_by, json_extract)
 * would put their derived state here too.
 */
export interface ActionContext {
  counters: Record<string, number>
}

export function newActionContext(): ActionContext {
  return { counters: {} }
}

/**
 * Compile a regex with the given flags. Falls back to a never-match
 * regex when the pattern is malformed — the engine's try/catch would
 * also catch a throw, but failing soft here keeps the error local.
 */
function compile(pattern: string, flags?: string): RegExp {
  try {
    return new RegExp(pattern, flags ?? '')
  } catch {
    return /(?!)/
  }
}

function splitLines(input: string): string[] {
  return input.length === 0 ? [] : input.split(/\r?\n/)
}

function joinLines(lines: string[]): string {
  return lines.join('\n')
}

// ────────────────────────────────────────────────────────────────────
// Action implementations
// ────────────────────────────────────────────────────────────────────

function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, '')
}

function keepLines(input: string, pattern: string, flags?: string): string {
  const re = compile(pattern, flags)
  return joinLines(splitLines(input).filter((l) => re.test(l)))
}

function removeLines(input: string, pattern: string, flags?: string): string {
  const re = compile(pattern, flags)
  return joinLines(splitLines(input).filter((l) => !re.test(l)))
}

function truncateLines(input: string, max: number): string {
  if (max <= 0) return input
  return joinLines(
    splitLines(input).map((l) => (l.length <= max ? l : l.slice(0, max) + '…'))
  )
}

function head(input: string, n: number): string {
  if (n <= 0) return ''
  return joinLines(splitLines(input).slice(0, n))
}

function tail(input: string, n: number): string {
  if (n <= 0) return ''
  const lines = splitLines(input)
  return joinLines(lines.slice(Math.max(0, lines.length - n)))
}

function dedup(input: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const l of splitLines(input)) {
    if (seen.has(l)) continue
    seen.add(l)
    out.push(l)
  }
  return joinLines(out)
}

function replace(
  input: string,
  pattern: string,
  flags: string | undefined,
  replacement: string
): string {
  // Force `g` so the replacement is global by default; explicit flags
  // override (a filter author can pass `flags: ''` for one-shot replace).
  const effective = flags ?? 'g'
  const re = compile(pattern, effective)
  return input.replace(re, replacement)
}

function aggregate(
  input: string,
  ctx: ActionContext,
  counters: Array<{ name: string; pattern: string; flags?: string }>,
  totalAs: string | undefined
): string {
  const lines = splitLines(input)
  if (totalAs) ctx.counters[totalAs] = lines.length
  for (const c of counters) {
    const re = compile(c.pattern, c.flags)
    let count = 0
    for (const l of lines) if (re.test(l)) count++
    ctx.counters[c.name] = count
  }
  // aggregate is non-destructive — body flows to the next step unchanged
  return input
}

function formatTemplate(
  input: string,
  ctx: ActionContext,
  template: string
): string {
  const lines = splitLines(input)
  const joined = joinLines(lines)
  return template
    .replace(/\{\{\.lines\}\}/g, joined)
    .replace(/\{\{\.count\}\}/g, String(lines.length))
    .replace(/\{\{\.bytes\}\}/g, String(joined.length))
    .replace(/\{\{counter:([A-Za-z0-9_-]+)\}\}/g, (_, name) => {
      const v = ctx.counters[name]
      return v === undefined ? '0' : String(v)
    })
}

function matchOutput(
  input: string,
  pattern: string,
  flags: string | undefined,
  message: string
): string {
  const re = compile(pattern, flags)
  return re.test(input) ? message : input
}

function onEmpty(input: string, message: string): string {
  return input.trim().length === 0 ? message : input
}

// ────────────────────────────────────────────────────────────────────
// Dispatch
// ────────────────────────────────────────────────────────────────────

/**
 * Apply a single pipeline action to `input`. Pure; mutates `ctx` only
 * (counters). Returns the new body. The engine catches throws — actions
 * MAY throw on programmer error (malformed action shape) but MUST NOT
 * throw on adversarial input (handled internally with `compile`).
 */
export function applyAction(
  input: string,
  action: PipelineAction,
  ctx: ActionContext
): string {
  switch (action.action) {
    case 'strip_ansi':
      return stripAnsi(input)
    case 'keep_lines':
      return keepLines(input, action.pattern, action.flags)
    case 'remove_lines':
      return removeLines(input, action.pattern, action.flags)
    case 'truncate_lines':
      return truncateLines(input, action.max)
    case 'head':
      return head(input, action.n)
    case 'tail':
      return tail(input, action.n)
    case 'dedup':
      return dedup(input)
    case 'replace':
      return replace(input, action.pattern, action.flags, action.replacement)
    case 'aggregate':
      return aggregate(input, ctx, action.counters, action.totalAs)
    case 'format_template':
      return formatTemplate(input, ctx, action.template)
    case 'match_output':
      return matchOutput(input, action.pattern, action.flags, action.message)
    case 'on_empty':
      return onEmpty(input, action.message)
    default:
      // Unknown action tag — possible from a stale YAML filter or a
      // hand-built test fixture. Pass through rather than corrupting
      // the pipeline by returning undefined.
      return input
  }
}
