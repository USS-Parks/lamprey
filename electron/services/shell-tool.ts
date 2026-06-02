import { spawn } from 'child_process'
import { resolve, relative, isAbsolute } from 'path'

// Native shell_command tool. One-shot command execution with cwd / timeout /
// env merge, captured stdout / stderr with caps, platform-appropriate shell
// wrapper. Pure module — no electron imports — so the executor itself is
// unit-testable. Descriptor and registry wiring live in tool-registry.ts;
// permission gating runs at the chat layer.

export interface ShellArgs {
  command: string
  cwd?: string
  timeout_ms?: number
  env?: Record<string, string>
}

export interface ShellResult {
  command: string
  cwd: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  durationMs: number
  timedOut: boolean
  error?: string
}

export const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_TIMEOUT_MS = 600_000
export const STDOUT_CAP = 30_000
export const STDERR_CAP = 30_000
const SIGKILL_GRACE_MS = 1000

/**
 * Confine a candidate cwd to the workspace root.
 *   - undefined / empty → root itself
 *   - absolute path equal to or under root → returned as-is
 *   - relative path → resolved against root
 *   - anything that escapes the tree (different drive on Windows, `..` above
 *     root) → null
 *
 * Pure, sync, no I/O — safe to call from anywhere.
 */
export function resolveCwdWithinWorkspace(
  workspaceRoot: string,
  candidate: string | undefined
): string | null {
  const root = resolve(workspaceRoot)
  if (!candidate || candidate.trim() === '') return root

  const target = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate)
  const rel = relative(root, target)

  // relative('') = '' means same dir; '..something' or absolute (different
  // drive on Windows) means outside.
  if (rel === '') return target
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return target
}

function buildShellInvocation(command: string): { cmd: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      cmd: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
    }
  }
  return {
    cmd: process.env.SHELL || '/bin/bash',
    args: ['-c', command]
  }
}

function appendCapped(
  current: string,
  chunk: string,
  cap: number
): { next: string; truncated: boolean } {
  if (current.length >= cap) return { next: current, truncated: true }
  if (current.length + chunk.length <= cap) return { next: current + chunk, truncated: false }
  const room = cap - current.length
  return { next: current + chunk.slice(0, room), truncated: true }
}

/**
 * Run a shell command. Pure function — caller must enforce permission
 * approval; only the workspace-root boundary is enforced here (so that
 * an absent gate still can't escape the tree).
 */
export function executeShellCommand(
  args: ShellArgs,
  workspaceRoot: string
): Promise<ShellResult> {
  return new Promise((resolveResult) => {
    const startedAt = Date.now()

    if (!args || typeof args.command !== 'string' || args.command.trim() === '') {
      resolveResult({
        command: args?.command ?? '',
        cwd: workspaceRoot,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 0,
        timedOut: false,
        error: 'command is required and must be a non-empty string'
      })
      return
    }

    const cwd = resolveCwdWithinWorkspace(workspaceRoot, args.cwd)
    if (cwd === null) {
      resolveResult({
        command: args.command,
        cwd: args.cwd ?? workspaceRoot,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 0,
        timedOut: false,
        error: `cwd "${args.cwd}" is outside the workspace root "${workspaceRoot}"`
      })
      return
    }

    const timeoutMs = Math.min(
      Math.max(0, args.timeout_ms ?? DEFAULT_TIMEOUT_MS),
      MAX_TIMEOUT_MS
    )
    const env: NodeJS.ProcessEnv = { ...process.env, ...(args.env || {}) }
    const { cmd, args: shellArgs } = buildShellInvocation(args.command)

    let proc: ReturnType<typeof spawn>
    try {
      proc = spawn(cmd, shellArgs, {
        cwd,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err: any) {
      resolveResult({
        command: args.command,
        cwd,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: Date.now() - startedAt,
        timedOut: false,
        error: err?.message ?? 'spawn failed'
      })
      return
    }

    let stdoutBuf = ''
    let stderrBuf = ''
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false
    let killGrace: NodeJS.Timeout | null = null

    proc.stdout?.on('data', (buf: Buffer) => {
      const r = appendCapped(stdoutBuf, buf.toString('utf8'), STDOUT_CAP)
      stdoutBuf = r.next
      stdoutTruncated = stdoutTruncated || r.truncated
    })
    proc.stderr?.on('data', (buf: Buffer) => {
      const r = appendCapped(stderrBuf, buf.toString('utf8'), STDERR_CAP)
      stderrBuf = r.next
      stderrTruncated = stderrTruncated || r.truncated
    })

    const timer = setTimeout(() => {
      timedOut = true
      try {
        proc.kill('SIGTERM')
      } catch {
        // already dead
      }
      killGrace = setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch {
          // already dead
        }
      }, SIGKILL_GRACE_MS)
    }, timeoutMs)

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null, err?: string) => {
      clearTimeout(timer)
      if (killGrace) clearTimeout(killGrace)
      resolveResult({
        command: args.command,
        cwd,
        exitCode,
        signal,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        stdoutTruncated,
        stderrTruncated,
        durationMs: Date.now() - startedAt,
        timedOut,
        error: err
      })
    }

    proc.on('error', (err: Error) => finish(null, null, err.message))
    proc.on('exit', (code, signal) => finish(code, signal ?? null))
  })
}

/**
 * Compact, model-facing rendering of a ShellResult. Header line first
 * (exit + duration + flags), then cwd, then bounded stdout / stderr blocks.
 */
export function formatShellResultForModel(r: ShellResult): string {
  if (r.error && r.exitCode === null && !r.stdout && !r.stderr && !r.timedOut) {
    return `Shell error: ${r.error}`
  }
  const parts: string[] = []
  const exitLabel = r.exitCode === null ? '(none)' : String(r.exitCode)
  const sigLabel = r.signal ? ` (signal ${r.signal})` : ''
  const timedOutLabel = r.timedOut ? ' · TIMED OUT' : ''
  parts.push(`Exit: ${exitLabel}${sigLabel} · Duration: ${r.durationMs}ms${timedOutLabel}`)
  parts.push(`cwd: ${r.cwd}`)
  parts.push('--- stdout ---')
  parts.push(r.stdout.length > 0 ? r.stdout : '(empty)')
  if (r.stdoutTruncated) parts.push(`[stdout truncated at ${STDOUT_CAP} chars]`)
  parts.push('--- stderr ---')
  parts.push(r.stderr.length > 0 ? r.stderr : '(empty)')
  if (r.stderrTruncated) parts.push(`[stderr truncated at ${STDERR_CAP} chars]`)
  if (r.error) parts.push(`Error: ${r.error}`)
  return parts.join('\n')
}
