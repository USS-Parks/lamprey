// Dev-server manager (parity Track 3, prompt F1).
//
// Spawns long-running dev-server processes (Vite, Next, Astro, etc.) so
// the preview_* tool family has something to point at. Each session
// owns a child_process, a rolling output buffer, and a `waitForPattern`
// promise the preview_start helper uses to detect the printed URL.
//
// Intentionally narrow: this is the "boot a dev server, wait for it to
// say 'Local: http://localhost:5173', stop it later" surface. It is NOT
// a generic shell — for that, use the existing `shell_command` tool.

import { ChildProcess, spawn } from 'child_process'
import { randomUUID } from 'crypto'

export interface DevServerSpawnOptions {
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  shell?: boolean
}

export interface DevServerHandle {
  id: string
  command: string
  args: string[]
  cwd: string
  pid: number | null
  startedAt: number
  status: 'running' | 'exited' | 'failed'
  exitCode: number | null
  exitSignal: NodeJS.Signals | null
  /** Snapshot of the rolling stdout+stderr buffer. */
  output: string
  /** Number of bytes ever written (so callers can use this as a cursor). */
  bytesWritten: number
}

interface InternalSession {
  id: string
  proc: ChildProcess
  command: string
  args: string[]
  cwd: string
  startedAt: number
  exitCode: number | null
  exitSignal: NodeJS.Signals | null
  status: 'running' | 'exited' | 'failed'
  buffer: string
  bytesWritten: number
  patternWaiters: Array<{
    pattern: RegExp
    resolve: (match: string) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout> | null
  }>
}

const sessions = new Map<string, InternalSession>()
const BUFFER_CAP = 200_000

function appendToBuffer(session: InternalSession, chunk: string): void {
  session.bytesWritten += chunk.length
  const next = session.buffer + chunk
  session.buffer = next.length > BUFFER_CAP ? next.slice(next.length - BUFFER_CAP) : next

  // Resolve any pattern-waiters whose regex now matches.
  const stillWaiting: typeof session.patternWaiters = []
  for (const waiter of session.patternWaiters) {
    const m = waiter.pattern.exec(session.buffer)
    if (m) {
      if (waiter.timer) clearTimeout(waiter.timer)
      waiter.resolve(m[0])
    } else {
      stillWaiting.push(waiter)
    }
  }
  session.patternWaiters = stillWaiting
}

function snapshot(session: InternalSession): DevServerHandle {
  return {
    id: session.id,
    command: session.command,
    args: [...session.args],
    cwd: session.cwd,
    pid: session.proc.pid ?? null,
    startedAt: session.startedAt,
    status: session.status,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    output: session.buffer,
    bytesWritten: session.bytesWritten
  }
}

export function spawnDevServer(opts: DevServerSpawnOptions): DevServerHandle {
  if (!opts?.command || !opts.command.trim()) {
    throw new Error('spawnDevServer: command is required')
  }
  const id = randomUUID()
  const cwd = opts.cwd?.trim() || process.cwd()
  const args = Array.isArray(opts.args) ? opts.args : []
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: '0', // strip ANSI so regex `Local:.*localhost` matches reliably
    NO_COLOR: '1',
    ...opts.env
  }

  // `shell: true` lets npm/npx/yarn-style commands resolve through the
  // platform shell — Windows users in particular need this for `.cmd`
  // shims. Pass an explicit `false` to skip when the caller already has
  // an absolute path + raw args.
  const useShell = opts.shell !== false

  let proc: ChildProcess
  try {
    proc = spawn(opts.command, args, { cwd, env, shell: useShell })
  } catch (err) {
    const session: InternalSession = {
      id,
      // Already-failed proc isn't useful but we still hold a row so
      // callers can read the error via the handle.
      proc: null as unknown as ChildProcess,
      command: opts.command,
      args,
      cwd,
      startedAt: Date.now(),
      exitCode: -1,
      exitSignal: null,
      status: 'failed',
      buffer: `[spawn failed] ${(err as Error).message}\n`,
      bytesWritten: 0,
      patternWaiters: []
    }
    sessions.set(id, session)
    return snapshot(session)
  }

  const session: InternalSession = {
    id,
    proc,
    command: opts.command,
    args,
    cwd,
    startedAt: Date.now(),
    exitCode: null,
    exitSignal: null,
    status: 'running',
    buffer: '',
    bytesWritten: 0,
    patternWaiters: []
  }
  sessions.set(id, session)

  proc.stdout?.setEncoding('utf-8')
  proc.stderr?.setEncoding('utf-8')
  proc.stdout?.on('data', (chunk: string) => appendToBuffer(session, chunk))
  proc.stderr?.on('data', (chunk: string) => appendToBuffer(session, chunk))
  proc.on('exit', (code, signal) => {
    session.exitCode = code
    session.exitSignal = signal as NodeJS.Signals | null
    session.status = code === 0 || code === null ? 'exited' : 'failed'
    // Reject any pending waiters so callers don't hang forever.
    for (const w of session.patternWaiters) {
      if (w.timer) clearTimeout(w.timer)
      w.reject(new Error(`dev server exited (code=${code}, signal=${signal}) before pattern matched`))
    }
    session.patternWaiters = []
  })
  proc.on('error', (err) => {
    appendToBuffer(session, `[proc error] ${err.message}\n`)
    session.status = 'failed'
  })

  return snapshot(session)
}

/**
 * Resolve when the cumulative dev-server output matches `pattern`, or
 * reject after `timeoutMs`. Returns the first matched substring so the
 * caller can extract a URL with one regex.
 */
export function waitForOutput(
  id: string,
  pattern: RegExp,
  timeoutMs = 30_000
): Promise<string> {
  const session = sessions.get(id)
  if (!session) return Promise.reject(new Error(`waitForOutput: unknown session ${id}`))
  // Already matched?
  const existing = pattern.exec(session.buffer)
  if (existing) return Promise.resolve(existing[0])
  if (session.status !== 'running') {
    return Promise.reject(new Error(`dev server is ${session.status} — cannot wait for pattern`))
  }
  return new Promise<string>((resolveOuter, rejectOuter) => {
    const waiter = {
      pattern,
      resolve: resolveOuter,
      reject: rejectOuter,
      timer: setTimeout(() => {
        const idx = session.patternWaiters.indexOf(waiter)
        if (idx >= 0) session.patternWaiters.splice(idx, 1)
        rejectOuter(new Error(`timeout (${timeoutMs}ms) waiting for ${pattern}`))
      }, timeoutMs)
    }
    session.patternWaiters.push(waiter)
  })
}

export function getDevServer(id: string): DevServerHandle | null {
  const s = sessions.get(id)
  return s ? snapshot(s) : null
}

export function listDevServers(): DevServerHandle[] {
  return Array.from(sessions.values()).map(snapshot)
}

export function stopDevServer(id: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  const session = sessions.get(id)
  if (!session) return false
  if (session.status !== 'running') return true
  try {
    // Detached: best effort, the actual descendant tree may not die on
    // Windows. Vite/Next don't typically spawn long-lived children
    // beyond worker processes so SIGTERM is usually enough.
    session.proc.kill(signal)
  } catch (err) {
    console.error('[dev-server] kill failed:', (err as Error).message)
    return false
  }
  return true
}

export function destroyDevServer(id: string): void {
  stopDevServer(id, 'SIGKILL')
  sessions.delete(id)
}

export function destroyAllDevServers(): void {
  for (const id of [...sessions.keys()]) destroyDevServer(id)
}

// Common URL extractors so the preview_* helpers don't all carry the
// same regex. Vite emits "Local:   http://localhost:5173/"; Next.js
// emits "Local:    http://localhost:3000" or "started server on 0.0.0.0:3000".
export const URL_PATTERNS = {
  vite: /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s]*)?/,
  generic: /https?:\/\/[^\s)]+/
}
