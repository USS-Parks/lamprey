// Snip-style declarative filter layer. Filters intercept the shell tool's
// stdout/stderr AFTER it ran and AFTER Lamprey's own length caps, run the
// text through a small pipeline of transforms (keep_lines, dedup,
// format_template, etc.), then return the compressed body to the formatter
// before the model sees it. Same concept the user already runs via rtk
// (Rust Token Killer) around Claude Code; snip (Go) added YAML extensibility
// on top. This module is the pure-TS engine — no fs, no electron, no spawn.
//
// Side-effects (DB writes, YAML loading, IPC) live elsewhere in
// electron/services/snip/. Keep this file pure so it stays trivially
// unit-testable on plain Node.

/**
 * Match spec — the head of every filter. Decides whether the filter's
 * pipeline is even considered for a given shell command. Pure data:
 * `parseCommand` + `selectFilter` (K2) consume this without I/O.
 */
export interface MatchSpec {
  /** First token of the command (e.g. "git", "npm", "tsc"). Case-sensitive. */
  command: string
  /**
   * Optional second token. When set, both must match. For "git log",
   * subcommand="log".
   */
  subcommand?: string
  /**
   * Match through a wrapper. `viaNpx: true` accepts both `tsc` and
   * `npx tsc`, treating the wrapped binary as the command head.
   */
  viaNpx?: boolean
  /**
   * Skip the filter when ANY of these flags are present. Used so the
   * filter steps back when the user (or the model) already asked for a
   * compact form (e.g. `git log --oneline` — don't touch it). Match is
   * literal, prefix-aware: `"--pretty"` matches `--pretty=oneline`.
   */
  excludeFlags?: string[]
  /**
   * Only apply when the exit code is in this set. Default: `[0]`. Failure
   * pass-through is an architectural invariant (model needs raw error
   * text); aggregator filters opt back in by setting this to include
   * non-zero codes.
   */
  exitCodes?: number[]
}

/**
 * One step in a filter pipeline. Each variant is a tagged union — the
 * engine in engine.ts dispatches on `.action` and invokes the matching
 * implementation in actions.ts.
 */
export type PipelineAction =
  | { action: 'strip_ansi' }
  | { action: 'keep_lines'; pattern: string; flags?: string }
  | { action: 'remove_lines'; pattern: string; flags?: string }
  | { action: 'truncate_lines'; max: number }
  | { action: 'head'; n: number }
  | { action: 'tail'; n: number }
  | { action: 'dedup' }
  | { action: 'replace'; pattern: string; flags?: string; replacement: string }
  | {
      action: 'aggregate'
      /** Each entry counts pattern hits across all lines. */
      counters: Array<{ name: string; pattern: string; flags?: string }>
      /** Optional total-lines counter under this name. */
      totalAs?: string
    }
  | {
      action: 'format_template'
      /**
       * Template string with mustache-style substitutions:
       *   {{.lines}}      — joined remaining lines
       *   {{.count}}      — line count
       *   {{.bytes}}      — character length of joined output
       *   {{counter:NAME}} — value from a preceding `aggregate` counter
       */
      template: string
    }
  | {
      action: 'match_output'
      /** When pattern matches anywhere in the input, return `message` as the sole body. */
      pattern: string
      flags?: string
      message: string
    }
  | { action: 'on_empty'; message: string }

/**
 * A complete filter definition. Loaded from YAML in K3 or constructed in
 * tests. The engine never sees YAML — it sees these objects.
 */
export interface Filter {
  /** Stable id used in the SQLite event log and the dashboard. */
  name: string
  /** One-line description shown in the filter list UI. */
  description: string
  match: MatchSpec
  /** Run the pipeline against stdout. */
  pipeline: PipelineAction[]
  /**
   * Optional pipeline for stderr. When omitted, stderr is left untouched.
   * Useful for tools that put their interesting output on stderr (tsc).
   */
  stderrPipeline?: PipelineAction[]
  /**
   * What to do when a pipeline step throws. `'passthrough'` (default)
   * returns whatever the previous step produced; `'error'` would surface
   * the failure but is reserved for v2 — MVP never throws to the caller.
   */
  onError?: 'passthrough' | 'error'
}

/**
 * One filter-application event, written to `snip_events` in K8.
 * `bytesBefore` / `bytesAfter` are the literal char-counts of the joined
 * stdout (+ stderr if filtered) before vs. after; `tokens*` are the
 * estimator's read of the same.
 */
export interface SnipEvent {
  filter: string
  command: string
  bytesBefore: number
  bytesAfter: number
  tokensBefore: number
  tokensAfter: number
  durationMs: number
  ts: number
  conversationId?: string
}

/**
 * Aggregated dashboard payload — produced by K8's tracking module,
 * consumed by K11's `SnipSettings` tab.
 */
export interface SnipStats {
  enabled: boolean
  totalEvents: number
  totalBytesBefore: number
  totalBytesAfter: number
  totalTokensBefore: number
  totalTokensAfter: number
  /** Average savings ratio across all events (0..1). */
  avgSavings: number
  topByTokens: Array<{
    filter: string
    runs: number
    tokensSaved: number
    savingsRatio: number
  }>
  /** Last 14 days of saved-tokens-per-day, newest last; zero-fill on quiet days. */
  sparkline: number[]
}

/**
 * Recent-activity row for the dashboard's "Recent activity" list.
 */
export interface SnipRecentRow {
  ts: number
  filter: string
  command: string
  tokensBefore: number
  tokensAfter: number
  durationMs: number
}

/**
 * One row in the K12 Discover panel — an unfiltered command pattern that
 * snip noticed costs tokens but has no matching filter. Sorted by
 * `runs * estimatedTokens` descending.
 */
export interface SnipDiscoverSuggestion {
  /** Normalised command pattern (e.g. "git log", "find .") — strips literal paths/args. */
  commandPattern: string
  /** How many times we saw this pattern in the scan window. */
  runs: number
  /** Total tokens this pattern has consumed across all runs. */
  estimatedTokens: number
  /**
   * Suggested filter category (`git`, `js`, `system`, …) for the YAML
   * draft. Heuristic from the head of the command.
   */
  suggestedCategory: string
}
