import { spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { relative, resolve } from 'path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const picomatch = require('picomatch') as (
  glob: string,
  opts?: { nocase?: boolean; dot?: boolean }
) => (path: string) => boolean

// Native glob_workspace — fast file discovery by pattern. Returns paths
// sorted by mtime descending (most recently modified first), matching
// Claude Code's Glob tool default. Reuses the bundled ripgrep binary in
// `--files --glob` mode so:
//   - .gitignore + .ignore files are respected automatically
//   - no second native dep ships in the bundle
//   - patterns get rg's regex/glob engine (faster than minimatch in JS)
//
// Output cap: 1000 paths (matches Claude Code). For repos larger than
// that, the model should add a narrower glob or use `path` to scope.

export interface GlobArgs {
  pattern: string
  path?: string
  case_sensitive?: boolean
  include_hidden?: boolean
  no_ignore?: boolean
}

export interface GlobResult {
  paths: string[]
  truncated: boolean
  totalMatched: number
}

const DEFAULT_LIMIT = 1000
const RG_TIMEOUT_MS = 30_000

// Build the rg argv for the file-listing step. We deliberately do NOT
// pass --glob here: rg's --glob flag "always overrides any other ignore
// logic" (per its docs), which means `--glob "*.ts"` would surface
// node_modules paths in any standard repo (the JS comment can't even
// quote the double-star pattern without becoming a comment-end token).
// Instead we use --files alone to get the gitignore-respecting list,
// then post-filter against the user's pattern with picomatch.
export function buildGlobArgs(args: GlobArgs): { argv: string[] } | string {
  if (typeof args.pattern !== 'string' || args.pattern.trim() === '') {
    return 'pattern is required'
  }
  const argv: string[] = ['--files']
  // --no-messages quiets "broken symlink" warnings that otherwise hit
  // stderr. We want zero stderr noise so the parse step can trust it.
  argv.push('--no-messages')
  // --no-require-git makes rg apply .gitignore/.ignore files in any
  // directory, not only inside a git repo. Lamprey's workspace might be
  // a checkout, a sandbox folder, or a worktree — all should respect
  // ignore files. The model can always pass no_ignore=true to override.
  if (!args.no_ignore) argv.push('--no-require-git')
  if (args.include_hidden) argv.push('--hidden')
  if (args.no_ignore) argv.push('--no-ignore')
  return { argv }
}

/**
 * Build a picomatch predicate that matches the user pattern against a
 * workspace-relative path. Posix separators are forced because picomatch
 * (like all glob libs) expects forward slashes regardless of platform.
 */
export function buildPatternPredicate(
  pattern: string,
  caseSensitive: boolean | undefined
): (relPath: string) => boolean {
  const matcher = picomatch(pattern, {
    nocase: caseSensitive ? false : true,
    dot: true
  })
  return (relPath: string) => matcher(relPath.replace(/\\/g, '/'))
}

/**
 * Sort the path list by file mtime descending. Stable on ties (lexicographic
 * fallback). Wrapped in a separate function so we can unit-test it without
 * spawning rg.
 */
export function sortPathsByMtime(paths: string[]): string[] {
  const annotated = paths.map((p) => {
    let mtime = 0
    try {
      mtime = statSync(p).mtimeMs
    } catch {
      // File vanished between rg listing and our stat — skip the timestamp
      // but keep the path; the model can still try to read it.
    }
    return { p, mtime }
  })
  annotated.sort((a, b) => {
    if (b.mtime !== a.mtime) return b.mtime - a.mtime
    return a.p.localeCompare(b.p)
  })
  return annotated.map((r) => r.p)
}

/**
 * Format the result for the model. One path per line, with a
 * truncation marker if we hit the cap.
 */
export function formatGlobResult(result: GlobResult): string {
  if (result.paths.length === 0) return '(no matches)'
  const body = result.paths.join('\n')
  if (result.truncated) {
    return (
      body +
      `\n[truncated: ${result.totalMatched} total matches, showing first ${result.paths.length} by mtime. Narrow with a more specific pattern or use \`path\`.]`
    )
  }
  return body
}

/**
 * Spawn rg --files. The bundled binary path is resolved lazily so
 * tests can inject a stub or skip when the platform-specific dep is
 * missing.
 */
export async function executeGlob(
  args: GlobArgs,
  workspaceRoot: string,
  rgPath?: string
): Promise<GlobResult> {
  const built = buildGlobArgs(args)
  if (typeof built === 'string') throw new Error(built)

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

  const searchRoot = args.path
    ? resolve(workspaceRoot, args.path)
    : workspaceRoot
  if (!searchRoot.startsWith(resolve(workspaceRoot))) {
    throw new Error(`search path "${args.path}" resolves outside the workspace root`)
  }

  const stdout = await new Promise<string>((resolvePromise, reject) => {
    const proc = spawn(resolvedRg!, [...built.argv, searchRoot], {
      cwd: workspaceRoot,
      windowsHide: true,
      shell: false
    })
    let buf = ''
    let bytesCapped = false
    let timedOut = false

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
      buf += b.toString('utf8')
      if (buf.length > 16 * 1024 * 1024) {
        bytesCapped = true
        try {
          proc.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`ripgrep spawn failed: ${err.message}`))
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new Error(`glob_workspace timed out after ${RG_TIMEOUT_MS / 1000}s`))
        return
      }
      // rg --files exits 0 with files, 1 if nothing matched, 2 on error.
      // We treat 1 as "no matches" (empty result), not an error.
      if (code === 2) {
        reject(new Error(`ripgrep --files exited with code 2`))
        return
      }
      resolvePromise(buf)
    })
  })

  const allFromRg = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    // rg --files emits forward slashes on Windows. resolve() normalizes
    // back to the platform's native separator AND collapses any
    // double-prefix when rg already returned an absolute path (which it
    // does when we pass searchRoot as an absolute argument).
    .map((p) => resolve(workspaceRoot, p))

  // Now filter against the user's pattern. The match path is relative
  // to the SEARCH root (the `path` arg if given, else workspace root) +
  // forward-slashed so cross-platform glob behaviour is consistent.
  // Matching against the search root (not always workspace root) means
  // `path: 'src', pattern: '*.ts'` finds files directly in src/, exactly
  // matching the model's intuition.
  const matches = buildPatternPredicate(args.pattern, args.case_sensitive)
  const matchRoot = resolve(searchRoot)
  const matched = allFromRg.filter((abs) => {
    const rel = relative(matchRoot, abs)
    return matches(rel)
  })

  const totalMatched = matched.length
  const truncated = totalMatched > DEFAULT_LIMIT
  const sorted = sortPathsByMtime(matched)
  const limited = sorted.slice(0, DEFAULT_LIMIT)

  return {
    paths: limited,
    truncated,
    totalMatched
  }
}
