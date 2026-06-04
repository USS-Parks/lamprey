import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { resolve, relative, isAbsolute } from 'path'
import { resolveWorkspaceRelative } from './path-utils'

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

  const target = resolveWorkspaceRelative(candidate, root)
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

// ────────────────────────────────────────────────────────────────────────
// F4 — Background shell + event bus
//
// `executeShellCommandInBackground` is the "fire and forget" cousin of
// `executeShellCommand`: it returns a handle synchronously and emits
// `bg-line` / `bg-exit` events on `shellBackgroundBus` instead of
// resolving a Promise. The monitor-service.ts module subscribes to the
// bus to feed line-by-line output into its rolling buffers.
//
// Output buffering is bounded the same way the foreground path is
// (STDOUT_CAP / STDERR_CAP) so a runaway dev server can't OOM the
// main process even if no monitor is attached.
// ────────────────────────────────────────────────────────────────────────

export type ShellBackgroundStatus = 'running' | 'exited' | 'failed'

export interface ShellBackgroundHandle {
  id: string
  command: string
  cwd: string
  pid: number | null
  startedAt: number
  status: ShellBackgroundStatus
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  bytesWritten: number
}

interface BackgroundSession {
  id: string
  command: string
  cwd: string
  proc: ChildProcessWithoutNullStreams | null
  pid: number | null
  startedAt: number
  status: ShellBackgroundStatus
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  bytesWritten: number
  stdoutLineBuf: string
  stderrLineBuf: string
}

export interface ShellBackgroundLineEvent {
  processId: string
  stream: 'stdout' | 'stderr'
  line: string
  at: number
}

export interface ShellBackgroundExitEvent {
  processId: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  durationMs: number
}

const bgSessions = new Map<string, BackgroundSession>()
export const shellBackgroundBus = new EventEmitter()
shellBackgroundBus.setMaxListeners(50)

function snapshotBg(session: BackgroundSession): ShellBackgroundHandle {
  return {
    id: session.id,
    command: session.command,
    cwd: session.cwd,
    pid: session.pid,
    startedAt: session.startedAt,
    status: session.status,
    exitCode: session.exitCode,
    signal: session.signal,
    stdout: session.stdout,
    stderr: session.stderr,
    bytesWritten: session.bytesWritten
  }
}

function flushLines(
  session: BackgroundSession,
  stream: 'stdout' | 'stderr',
  chunk: string
): void {
  const bufKey = stream === 'stdout' ? 'stdoutLineBuf' : 'stderrLineBuf'
  const combined = session[bufKey] + chunk
  const lines = combined.split(/\r?\n/)
  const tail = lines.pop() ?? ''
  session[bufKey] = tail
  for (const line of lines) {
    const evt: ShellBackgroundLineEvent = {
      processId: session.id,
      stream,
      line,
      at: Date.now()
    }
    shellBackgroundBus.emit('bg-line', evt)
  }
}

export interface SpawnBackgroundOptions extends ShellArgs {
  /** When true, lines arrive on the bus as they come in. Default true. */
  emitLines?: boolean
}

export function executeShellCommandInBackground(
  args: SpawnBackgroundOptions,
  workspaceRoot: string
): ShellBackgroundHandle {
  const id = randomUUID()
  const startedAt = Date.now()

  if (!args || typeof args.command !== 'string' || args.command.trim() === '') {
    const session: BackgroundSession = {
      id,
      command: args?.command ?? '',
      cwd: workspaceRoot,
      proc: null,
      pid: null,
      startedAt,
      status: 'failed',
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: 'command is required and must be a non-empty string',
      bytesWritten: 0,
      stdoutLineBuf: '',
      stderrLineBuf: ''
    }
    bgSessions.set(id, session)
    return snapshotBg(session)
  }

  const cwd = resolveCwdWithinWorkspace(workspaceRoot, args.cwd)
  if (cwd === null) {
    const session: BackgroundSession = {
      id,
      command: args.command,
      cwd: args.cwd ?? workspaceRoot,
      proc: null,
      pid: null,
      startedAt,
      status: 'failed',
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: `cwd "${args.cwd}" is outside the workspace root "${workspaceRoot}"`,
      bytesWritten: 0,
      stdoutLineBuf: '',
      stderrLineBuf: ''
    }
    bgSessions.set(id, session)
    return snapshotBg(session)
  }

  const env: NodeJS.ProcessEnv = { ...process.env, ...(args.env || {}) }
  const { cmd, args: shellArgs } = buildShellInvocation(args.command)

  // We force `stdio: ['ignore', 'pipe', 'pipe']` so stdin is null but
  // both stdout + stderr are real Readable streams. The narrower
  // ChildProcessWithoutNullStreams type *requires* a stdin Writable,
  // so cast through `unknown` to acknowledge the shape mismatch.
  let proc: ChildProcessWithoutNullStreams
  try {
    proc = (spawn(cmd, shellArgs, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }) as unknown) as ChildProcessWithoutNullStreams
  } catch (err: any) {
    const session: BackgroundSession = {
      id,
      command: args.command,
      cwd,
      proc: null,
      pid: null,
      startedAt,
      status: 'failed',
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: err?.message ?? 'spawn failed',
      bytesWritten: 0,
      stdoutLineBuf: '',
      stderrLineBuf: ''
    }
    bgSessions.set(id, session)
    return snapshotBg(session)
  }

  const session: BackgroundSession = {
    id,
    command: args.command,
    cwd,
    proc,
    pid: proc.pid ?? null,
    startedAt,
    status: 'running',
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    bytesWritten: 0,
    stdoutLineBuf: '',
    stderrLineBuf: ''
  }
  bgSessions.set(id, session)

  const emit = args.emitLines !== false

  proc.stdout?.on('data', (buf: Buffer) => {
    const chunk = buf.toString('utf8')
    session.bytesWritten += chunk.length
    const r = appendCapped(session.stdout, chunk, STDOUT_CAP)
    session.stdout = r.next
    if (emit) flushLines(session, 'stdout', chunk)
  })
  proc.stderr?.on('data', (buf: Buffer) => {
    const chunk = buf.toString('utf8')
    session.bytesWritten += chunk.length
    const r = appendCapped(session.stderr, chunk, STDERR_CAP)
    session.stderr = r.next
    if (emit) flushLines(session, 'stderr', chunk)
  })
  proc.on('error', (err: Error) => {
    session.status = 'failed'
    session.stderr = (session.stderr + '\n' + err.message).slice(-STDERR_CAP)
  })
  proc.on('exit', (code, signal) => {
    // Drain any trailing partial line so a `printf "no-trailing-newline"`
    // doesn't get swallowed.
    if (session.stdoutLineBuf) {
      const tail = session.stdoutLineBuf
      session.stdoutLineBuf = ''
      if (emit) {
        shellBackgroundBus.emit('bg-line', {
          processId: session.id,
          stream: 'stdout',
          line: tail,
          at: Date.now()
        } satisfies ShellBackgroundLineEvent)
      }
    }
    if (session.stderrLineBuf) {
      const tail = session.stderrLineBuf
      session.stderrLineBuf = ''
      if (emit) {
        shellBackgroundBus.emit('bg-line', {
          processId: session.id,
          stream: 'stderr',
          line: tail,
          at: Date.now()
        } satisfies ShellBackgroundLineEvent)
      }
    }
    session.exitCode = code
    session.signal = signal as NodeJS.Signals | null
    session.status = code === 0 || code === null ? 'exited' : 'failed'
    const evt: ShellBackgroundExitEvent = {
      processId: session.id,
      exitCode: code,
      signal: session.signal,
      durationMs: Date.now() - session.startedAt
    }
    shellBackgroundBus.emit('bg-exit', evt)
  })

  return snapshotBg(session)
}

export function getBackgroundShell(id: string): ShellBackgroundHandle | null {
  const s = bgSessions.get(id)
  return s ? snapshotBg(s) : null
}

export function listBackgroundShells(): ShellBackgroundHandle[] {
  return Array.from(bgSessions.values()).map(snapshotBg)
}

export function killBackgroundShell(id: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  const s = bgSessions.get(id)
  if (!s || !s.proc || s.status !== 'running') return false
  try {
    s.proc.kill(signal)
  } catch (err) {
    console.error('[shell-bg] kill failed:', (err as Error).message)
    return false
  }
  return true
}

export function destroyBackgroundShell(id: string): void {
  killBackgroundShell(id, 'SIGKILL')
  bgSessions.delete(id)
}

export function destroyAllBackgroundShells(): void {
  for (const id of [...bgSessions.keys()]) destroyBackgroundShell(id)
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
