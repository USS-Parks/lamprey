import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'

// Native grep_workspace — structured ripgrep with the same flag surface
// the model already learned from Claude Code's Grep tool. Returns JSON
// objects (one per match for content mode, one per file for
// files_with_matches/count) rather than raw stdout, so the model doesn't
// have to regex its own tool output.
//
// Why bundle ripgrep instead of shelling out to a system `rg`:
//   - PATH isn't reliable on Windows (mingw shells, MSYS, no rg by default)
//   - Bypasses the shell_command approval modal — every grep is otherwise
//     a permission prompt, which kills the agentic-search loop
//   - Gives us a stable JSON output contract regardless of the user's rg
//     version
//
// Binary resolution: @vscode/ripgrep ships per-platform optional deps.
// In dev, `rgPath` from the package resolves correctly. In packaged
// builds, electron-builder.yml must include the platform-specific
// binary in `asarUnpack` so spawn can execute it (Windows refuses to
// execve a file inside an asar archive).

export interface GrepArgs {
  pattern: string
  path?: string
  glob?: string
  type?: string
  output_mode?: 'content' | 'files_with_matches' | 'count'
  head_limit?: number
  case_insensitive?: boolean
  line_numbers?: boolean
  context_before?: number
  context_after?: number
  context?: number
  multiline?: boolean
  include_hidden?: boolean
  no_ignore?: boolean
}

export interface GrepMatch {
  file: string
  line?: number
  text?: string
  matchCount?: number
}

export interface GrepResult {
  mode: 'content' | 'files_with_matches' | 'count'
  matches: GrepMatch[]
  totalMatches: number
  truncated: boolean
}

const DEFAULT_HEAD_LIMIT = 250
const HARD_HEAD_LIMIT = 5000
const OUTPUT_BYTE_CAP = 250 * 1024
const RG_TIMEOUT_MS = 30_000

/**
 * Build ripgrep argv from the structured args. Validates against shell
 * injection by treating every value as a discrete argv element — none
 * of these strings ever reach a shell parser. Returns null if the args
 * are invalid (caller should reject before spawning).
 */
export function buildRgArgs(args: GrepArgs): { argv: string[]; mode: GrepResult['mode'] } | string {
  if (typeof args.pattern !== 'string' || args.pattern === '') {
    return 'pattern is required'
  }
  const mode: GrepResult['mode'] = args.output_mode ?? 'files_with_matches'
  const argv: string[] = []

  // Output mode → ripgrep JSON. We always use --json so the parser can
  // walk the stream deterministically; the `mode` shapes our output
  // post-processing, not rg's invocation.
  argv.push('--json')

  // --no-require-git: apply .gitignore even when the workspace isn't a
  // git checkout (sandbox folders, worktrees with .git as a file, etc.).
  // Skipped if the caller explicitly opts out via no_ignore.
  if (!args.no_ignore) argv.push('--no-require-git')

  // Case insensitivity
  if (args.case_insensitive) argv.push('--ignore-case')

  // File-type filter (rg's built-in registry: ts, py, rust, go, etc.)
  if (args.type) {
    if (!/^[a-zA-Z0-9_+-]+$/.test(args.type)) return `invalid type "${args.type}"`
    argv.push('--type', args.type)
  }

  // Glob filter
  if (args.glob) {
    argv.push('--glob', args.glob)
  }

  // Context lines (mutually-exclusive: context overrides before/after)
  if (typeof args.context === 'number' && args.context > 0) {
    argv.push('--context', String(Math.floor(args.context)))
  } else {
    if (typeof args.context_before === 'number' && args.context_before > 0) {
      argv.push('--before-context', String(Math.floor(args.context_before)))
    }
    if (typeof args.context_after === 'number' && args.context_after > 0) {
      argv.push('--after-context', String(Math.floor(args.context_after)))
    }
  }

  // Multiline (rg flag is --multiline, defaults to . NOT matching newlines
  // unless --multiline-dotall is added on top)
  if (args.multiline) {
    argv.push('--multiline', '--multiline-dotall')
  }

  // Hidden files / ignore-file respect
  if (args.include_hidden) argv.push('--hidden')
  if (args.no_ignore) argv.push('--no-ignore')

  // Use the pattern with -e so a leading `-` in the pattern isn't
  // misinterpreted as a flag (search for "-x" works correctly).
  argv.push('-e', args.pattern)

  return { argv, mode }
}

/**
 * Parse rg's --json stream output. Each line is a JSON object with a
 * `type` discriminator: `begin`, `match`, `context`, `end`, `summary`.
 * We only care about `match` and `end` (for per-file match counts) here.
 */
export function parseRgJsonStream(
  stdout: string,
  mode: GrepResult['mode'],
  headLimit: number
): { matches: GrepMatch[]; totalMatches: number; truncated: boolean } {
  const matches: GrepMatch[] = []
  let totalMatches = 0
  let truncated = false

  // file → match count, only used by `count` mode
  const fileCounts = new Map<string, number>()
  // Track distinct files for `files_with_matches` mode
  const seenFiles = new Set<string>()

  const lines = stdout.split('\n')
  for (const rawLine of lines) {
    if (!rawLine) continue
    let evt: unknown
    try {
      evt = JSON.parse(rawLine)
    } catch {
      continue
    }
    if (!evt || typeof evt !== 'object') continue
    const e = evt as { type?: string; data?: Record<string, unknown> }
    if (e.type === 'match' && e.data) {
      totalMatches++
      const data = e.data as {
        path?: { text?: string }
        line_number?: number
        lines?: { text?: string }
      }
      const file = data.path?.text ?? ''
      const line = typeof data.line_number === 'number' ? data.line_number : undefined
      const text = (data.lines?.text ?? '').replace(/\n$/, '')
      if (mode === 'content') {
        if (matches.length < headLimit) {
          matches.push({ file, line, text })
        } else {
          truncated = true
        }
      } else if (mode === 'files_with_matches') {
        if (!seenFiles.has(file)) {
          seenFiles.add(file)
          if (matches.length < headLimit) {
            matches.push({ file })
          } else {
            truncated = true
          }
        }
      } else if (mode === 'count') {
        fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1)
      }
    } else if (e.type === 'end' && e.data && mode === 'count') {
      const data = e.data as { path?: { text?: string } }
      const file = data.path?.text ?? ''
      const count = fileCounts.get(file) ?? 0
      if (count > 0) {
        if (matches.length < headLimit) {
          matches.push({ file, matchCount: count })
        } else {
          truncated = true
        }
      }
    }
  }

  return { matches, totalMatches, truncated }
}

/**
 * Format the structured result for the model. Compact and grep-able;
 * the model can parse it back without regex. Per-mode shape:
 *   - files_with_matches: one path per line
 *   - count: "<path>:<count>" per line
 *   - content: "<path>:<line>:<text>" per line (matches grep -n format
 *     so the model's pretrained intuitions transfer)
 */
export function formatGrepResult(result: GrepResult): string {
  const lines: string[] = []
  if (result.mode === 'files_with_matches') {
    for (const m of result.matches) lines.push(m.file)
  } else if (result.mode === 'count') {
    for (const m of result.matches) lines.push(`${m.file}:${m.matchCount ?? 0}`)
  } else {
    for (const m of result.matches) {
      lines.push(`${m.file}:${m.line ?? '?'}:${m.text ?? ''}`)
    }
  }
  let body = lines.join('\n')
  if (result.truncated) {
    body += `\n[truncated: ${result.totalMatches} total matches, showing first ${result.matches.length}. Tighten the pattern or raise head_limit.]`
  }
  // Final byte-cap pass — even structured output can blow up on
  // megabyte-class match snippets (minified bundles, JSON dumps).
  if (Buffer.byteLength(body, 'utf8') > OUTPUT_BYTE_CAP) {
    const cap = OUTPUT_BYTE_CAP - 200 // leave room for the marker
    const slice = body.slice(0, cap)
    body = slice + `\n[output capped at ${OUTPUT_BYTE_CAP / 1024} KB; tighten filters]`
  }
  return body || '(no matches)'
}

/**
 * Spawn ripgrep and resolve with the parsed output. Lazy-resolves the
 * binary path so a missing optional-dep on this platform throws at call
 * time (with a clear error) instead of import time. Workspace path is
 * the search root; rg recursively walks from there.
 */
export async function executeGrep(
  args: GrepArgs,
  workspaceRoot: string,
  rgPath?: string
): Promise<GrepResult> {
  const built = buildRgArgs(args)
  if (typeof built === 'string') throw new Error(built)

  let headLimit =
    typeof args.head_limit === 'number' && args.head_limit > 0
      ? Math.floor(args.head_limit)
      : DEFAULT_HEAD_LIMIT
  if (headLimit > HARD_HEAD_LIMIT) headLimit = HARD_HEAD_LIMIT

  // Resolve the binary. In production-packaged context, electron-vite
  // bundles main as a single file, so the dynamic require has to be
  // tolerated by the bundler — we go through eval-string to keep
  // electron-vite from inlining it. The path arg lets tests inject a
  // fake binary or skip the spawn entirely.
  let resolvedRg = rgPath
  if (!resolvedRg) {
    try {
      const { rgPath: pkgRg } = (await import('@vscode/ripgrep')) as { rgPath: string }
      resolvedRg = pkgRg
    } catch (err) {
      throw new Error(
        `bundled ripgrep is unavailable: ${(err as Error)?.message ?? 'unknown'}. Reinstall dependencies.`,
        { cause: err }
      )
    }
  }
  if (!existsSync(resolvedRg)) {
    throw new Error(
      `ripgrep binary missing at ${resolvedRg}. The optional platform dependency for ${process.platform}-${process.arch} did not install.`
    )
  }

  // Search root: explicit `path` (workspace-bounded) or the workspace root.
  const searchRoot = args.path
    ? resolve(workspaceRoot, args.path)
    : workspaceRoot
  if (!searchRoot.startsWith(resolve(workspaceRoot))) {
    throw new Error(`search path "${args.path}" resolves outside the workspace root`)
  }

  return new Promise<GrepResult>((resolvePromise, reject) => {
    const proc = spawn(resolvedRg!, [...built.argv, searchRoot], {
      cwd: workspaceRoot,
      windowsHide: true,
      shell: false
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let bytesCapped = false

    const timer = setTimeout(() => {
      timedOut = true
      try {
        proc.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, RG_TIMEOUT_MS)

    proc.stdout?.on('data', (b: Buffer) => {
      if (bytesCapped) return
      stdout += b.toString('utf8')
      // Conservative early-stop: rg can emit gigabytes of JSON for
      // pathological patterns. Cap at 16 MB of accumulated stdout.
      if (stdout.length > 16 * 1024 * 1024) {
        bytesCapped = true
        try {
          proc.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }
    })
    proc.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8')
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`ripgrep spawn failed: ${err.message}`))
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(
          new Error(
            `ripgrep timed out after ${RG_TIMEOUT_MS / 1000}s. Tighten the pattern or use a more specific glob.`
          )
        )
        return
      }
      // rg exits 0 with matches, 1 with no matches, 2 on error.
      if (code === 2) {
        reject(new Error(`ripgrep error: ${stderr.trim() || 'unknown'}`))
        return
      }
      const { matches, totalMatches, truncated } = parseRgJsonStream(
        stdout,
        built.mode,
        headLimit
      )
      resolvePromise({
        mode: built.mode,
        matches,
        totalMatches: bytesCapped ? Math.max(totalMatches, matches.length) : totalMatches,
        truncated: truncated || bytesCapped
      })
    })
  })
}
