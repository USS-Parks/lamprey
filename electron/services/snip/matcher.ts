// Command-line parser + filter selector. Pure module — no fs, no
// electron. K1 + this file together are the entire "decide which
// filter to apply" path; the loader (K3), tracking (K8), and interpose
// (K9) wrap around them but never reach inside.
//
// Scope of the parser: just enough to make match decisions. We need
// the head ("git"), an optional subcommand ("log"), and the literal
// flags ("--oneline", "-n", "--pretty"). We do NOT need to interpret
// I/O redirection, command substitution, parameter expansion, or
// process substitution — those are shell-level concerns the filter
// shouldn't touch. We DO detect chain operators (`&&`, `||`, `;`, `|`)
// so we can opt out of filtering entirely when the command's output
// is the product of a multi-stage pipeline (too risky to guess which
// stage's text we're keeping).

import type { Filter } from './types'

export interface ParsedCommand {
  /** First token after stripping leading env-var assignments. */
  head: string
  /** Second token, when present. */
  sub?: string
  /**
   * Remaining tokens, in order, preserving original quoting state.
   * Used by `excludeFlags` matching and (eventually) by the K12
   * discover heuristic.
   */
  flags: string[]
  /**
   * True when the command line contains an unquoted shell chain
   * operator (`&&`, `||`, `;`, `|`). Chained commands bypass filtering.
   */
  isChain: boolean
}

/**
 * Lex a command line into argv-style tokens. Handles single quotes,
 * double quotes, and backslash escapes outside quotes. Inside single
 * quotes, everything is literal. Inside double quotes, backslash
 * escapes `"`, `\`, and `$`; other backslashes are literal.
 *
 * Returns `[tokens, isChain]`. `isChain` is true if an UNQUOTED chain
 * operator was encountered at the top level.
 */
function lex(command: string): { tokens: string[]; isChain: boolean } {
  const tokens: string[] = []
  let buf = ''
  let inSingle = false
  let inDouble = false
  let isChain = false
  let i = 0

  const push = (): void => {
    if (buf.length > 0) {
      tokens.push(buf)
      buf = ''
    }
  }

  while (i < command.length) {
    const c = command[i]
    if (inSingle) {
      if (c === "'") {
        inSingle = false
      } else {
        buf += c
      }
      i++
      continue
    }
    if (inDouble) {
      if (c === '\\' && i + 1 < command.length) {
        const next = command[i + 1]
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          buf += next
          i += 2
          continue
        }
        buf += c
        i++
        continue
      }
      if (c === '"') {
        inDouble = false
        i++
        continue
      }
      buf += c
      i++
      continue
    }
    // Unquoted state.
    if (c === "'") {
      inSingle = true
      i++
      continue
    }
    if (c === '"') {
      inDouble = true
      i++
      continue
    }
    if (c === '\\' && i + 1 < command.length) {
      buf += command[i + 1]
      i += 2
      continue
    }
    if (c === ' ' || c === '\t' || c === '\n') {
      push()
      i++
      continue
    }
    // Chain operators. Two-char first (so `&&` doesn't read as `&` + `&`).
    if ((c === '&' && command[i + 1] === '&') || (c === '|' && command[i + 1] === '|')) {
      isChain = true
      push()
      i += 2
      continue
    }
    if (c === ';' || c === '|') {
      isChain = true
      push()
      i++
      continue
    }
    buf += c
    i++
  }
  push()
  return { tokens, isChain }
}

const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=.*$/

/**
 * Parse a command line into `{ head, sub, flags, isChain }`.
 *
 * Strips leading env-variable assignments (`FOO=bar baz arg`) so the
 * head is `baz`, not `FOO=bar`. This matches snip's behaviour and is
 * how real shells dispatch.
 */
export function parseCommand(command: string): ParsedCommand {
  const { tokens, isChain } = lex(command)
  // Strip leading env assignments.
  let start = 0
  while (start < tokens.length && ENV_ASSIGN_RE.test(tokens[start])) {
    start++
  }
  const rest = tokens.slice(start)
  if (rest.length === 0) {
    return { head: '', flags: [], isChain }
  }
  const head = rest[0]
  // Subcommand: the next non-flag token (doesn't start with `-`).
  let sub: string | undefined
  let flagsStart = 1
  if (rest.length >= 2 && !rest[1].startsWith('-')) {
    sub = rest[1]
    flagsStart = 2
  }
  const flags = rest.slice(flagsStart)
  return { head, sub, flags, isChain }
}

/**
 * Does this parsed command have any of the listed flags?
 *
 * Prefix-aware: `--pretty` matches `--pretty=oneline`. Short flags
 * are exact-match (`-n` does NOT match `-nope`) because shells parse
 * them that way (or you'd need a separate `-nope` flag in the spec).
 */
function hasAnyFlag(parsed: ParsedCommand, list: string[]): boolean {
  if (list.length === 0) return false
  for (const want of list) {
    for (const have of parsed.flags) {
      if (want.startsWith('--')) {
        // Long flag — prefix or exact.
        if (have === want || have.startsWith(want + '=')) return true
      } else {
        // Short flag — exact only.
        if (have === want) return true
      }
    }
  }
  return false
}

/**
 * Pick the first filter from `filters` whose `match` accepts `parsed`.
 * Returns null on no match, or when the command is a chain (we never
 * filter chains because we'd be guessing which stage's stdout we're
 * holding).
 *
 * Match rules:
 *   • exit-code gate is NOT applied here — that's K9's job because
 *     this function runs before the command runs in some paths
 *     (`isChain` would be one such call site). Selection is purely
 *     about the command line.
 *   • `match.command` always required, exact-string compare on `head`.
 *   • `match.subcommand` required when set; exact compare on `sub`.
 *   • `match.viaNpx: true` flips behaviour: a filter with
 *     command="tsc" will also match a parsed command whose head is
 *     "npx" / "pnpm dlx" / "yarn dlx" and whose sub is "tsc". In that
 *     case `match.subcommand` (if set) is matched against the token
 *     AFTER the wrapped binary (rare, but supported for forms like
 *     `npx vitest run`).
 *   • `excludeFlags` short-circuits — a single matching flag rejects.
 */
export function selectFilter(parsed: ParsedCommand, filters: Filter[]): Filter | null {
  if (parsed.isChain) return null
  if (parsed.head === '') return null

  for (const f of filters) {
    const match = f.match

    // Direct command-head match.
    if (parsed.head === match.command) {
      if (match.subcommand !== undefined && parsed.sub !== match.subcommand) continue
      if (hasAnyFlag(parsed, match.excludeFlags ?? [])) continue
      return f
    }

    // Wrapped-via-npx match. Heuristic supports `npx`, `pnpm dlx`,
    // `yarn dlx`. The wrapped binary lives at sub; the wrapped
    // subcommand (if any) is the first flag-less token after sub.
    if (match.viaNpx === true) {
      const isWrapper =
        parsed.head === 'npx' ||
        (parsed.head === 'pnpm' && parsed.sub === 'dlx') ||
        (parsed.head === 'yarn' && parsed.sub === 'dlx')
      if (!isWrapper) continue

      // For npx, the wrapped bin is at parsed.sub. For `pnpm dlx tsc`
      // / `yarn dlx tsc`, the wrapped bin is the FIRST flag in the
      // flags array (since our parser put `dlx` in `sub`).
      let wrappedBin: string | undefined
      let restFlags: string[]
      if (parsed.head === 'npx') {
        wrappedBin = parsed.sub
        restFlags = parsed.flags
      } else {
        wrappedBin = parsed.flags[0]
        restFlags = parsed.flags.slice(1)
      }

      if (wrappedBin !== match.command) continue

      if (match.subcommand !== undefined) {
        const wrappedSub = restFlags.find((t) => !t.startsWith('-'))
        if (wrappedSub !== match.subcommand) continue
      }

      // Synthesise a flags-only ParsedCommand for the exclude check.
      const syntheticFlags = restFlags.filter((t) => t.startsWith('-'))
      if (hasAnyFlag({ ...parsed, flags: syntheticFlags }, match.excludeFlags ?? [])) {
        continue
      }
      return f
    }
  }
  return null
}
