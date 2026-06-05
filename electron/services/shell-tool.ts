import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { existsSync, statSync } from 'fs'
import { delimiter, resolve, relative, isAbsolute } from 'path'
import { resolveWorkspaceRelative } from './path-utils'
import { applyProfile, type SandboxTier } from './sandbox'

// Native shell_command tool. One-shot command execution with cwd / timeout /
// env merge, captured stdout / stderr with caps, platform-appropriate shell
// wrapper. Pure module — no electron imports — so the executor itself is
// unit-testable. Descriptor and registry wiring live in tool-registry.ts;
// permission gating runs at the chat layer.

export type ShellSelector = 'auto' | 'bash' | 'powershell'

export interface ShellArgs {
  command: string
  cwd?: string
  timeout_ms?: number
  env?: Record<string, string>
  /**
   * Pick an explicit shell flavour. Default `'auto'` keeps the legacy
   * behaviour (PowerShell on win32, `$SHELL || /bin/bash` elsewhere).
   * `'bash'` on win32 resolves to Git Bash → WSL → clean error.
   * `'powershell'` on POSIX resolves to `pwsh` if available, else error.
   */
  shell?: ShellSelector
  /**
   * Opt out of the sandbox wrapper for this single call (S7). When `true`:
   *   • the platform `applyProfile` wrap is skipped
   *   • the result reports `sandboxTier: 'bypassed'`
   *   • the chat dispatcher escalates the approval flow (no
   *     "always allow" policy applies; the modal pops every call)
   * Use only when the sandbox demonstrably blocks legitimate work
   * (e.g. a darwin build that needs to write outside the workspace).
   */
  dangerously_disable_sandbox?: boolean
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
  /**
   * Which sandbox tier wrapped this call. `'darwin-sbx'` / `'linux-bwrap'`
   * are kernel-level; `'none'` means the call ran on the host with no
   * isolation (Windows hosts; macOS/Linux hosts missing the required
   * binary). `'bypassed'` is reserved for explicit
   * `dangerously_disable_sandbox: true` calls (S7).
   */
  sandboxTier?: SandboxTier
  /** Human-readable note that pairs with `sandboxTier` (e.g. "bwrap missing"). */
  sandboxNote?: string
}

// S10 — match Claude Code's default Bash-tool timeout (2 minutes). Long
// commands (`npm install`, builds, large repos) used to time out at the
// old 30 s default and force the model to pass `timeout_ms` explicitly.
export const DEFAULT_TIMEOUT_MS = 120_000
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

// ────────────────────────────────────────────────────────────────────────
// S1 — Per-conversation cwd persistence
//
// Claude Code's Bash tool persists the working directory across calls in a
// session — `cd sub` followed by `pwd` reports `<workspace>/sub`. Our
// foreground executor is one-shot, so each call would otherwise re-anchor
// at the workspace root.
//
// `cwdSessions` keeps the last validated cwd per `conversationId`. The
// executor reads it as the default candidate when `args.cwd` is absent,
// and updates it after a clean (exit 0) run that contained a `cd …` /
// `Set-Location …` prefix. The workspace boundary is re-checked on every
// transition — a `cd /tmp` runs in the spawned shell but does NOT pollute
// the session cwd because the validation rejects it.
// ────────────────────────────────────────────────────────────────────────

const cwdSessions = new Map<string, string>()

export function getSessionCwd(conversationId: string): string | null {
  return cwdSessions.get(conversationId) ?? null
}

export function clearSessionCwd(conversationId: string): void {
  cwdSessions.delete(conversationId)
}

export function clearAllSessionCwds(): void {
  cwdSessions.clear()
}

// POSIX: a leading `cd` followed by a target (optionally quoted). Token
// terminates at whitespace or shell operators `&;|`.
const POSIX_CD_RE = /^\s*cd\s+(?:(['"])([^'"]+)\1|([^\s&;|]+))/
// PowerShell: `cd`, `Set-Location`, or `sl` (alias). Case-insensitive.
const PS_CD_RE = /^\s*(?:cd|set-location|sl)\s+(?:(['"])([^'"]+)\1|([^\s&;|]+))/i

export function extractCdTarget(
  command: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  const re = platform === 'win32' ? PS_CD_RE : POSIX_CD_RE
  const m = command.match(re)
  if (!m) return null
  const target = (m[2] ?? m[3] ?? '').trim()
  return target.length > 0 ? target : null
}

// ────────────────────────────────────────────────────────────────────────
// S11 — Anti-polling sleep guard.
//
// Claude Code blocks long leading `sleep` calls because they tend to be
// "sleep until I check next turn" rather than legitimate waits — they
// burn a context-window cache for nothing and the next round-trip just
// repeats. The remediation is to use the `shell_monitor` aux tool
// (an event-driven `until-pattern` wait) or to wrap the sleep in a real
// polling loop (`until <cond>; do sleep 2; done`) so the wait ends when
// the condition is met, not on a fixed timer.
//
// The heuristic accepts:
//   • short sleeps (<= 30 s),
//   • any sleep that appears after a `while`/`until`/`for`/`do` keyword
//     (the loop signals real polling intent),
//   • any call with `dangerously_disable_sandbox: true` (caller has
//     opted into manual oversight).
// ────────────────────────────────────────────────────────────────────────

const POSIX_LONG_SLEEP_RE = /\bsleep\s+(\d+(?:\.\d+)?)/
const PS_LONG_SLEEP_RE = /\bStart-Sleep\s+(?:-Seconds\s+|-s\s+)?(\d+(?:\.\d+)?)/i
const LOOP_RE = /\b(while|until|for|do)\b/i

export const LONG_SLEEP_THRESHOLD_SECONDS = 30

export function screenLongSleep(
  command: string,
  platform: NodeJS.Platform = process.platform
): { reason: string } | null {
  // Try the platform's native form first, then the other — a model
  // sometimes emits POSIX-style sleep on Windows via Git Bash.
  const primary = platform === 'win32' ? PS_LONG_SLEEP_RE : POSIX_LONG_SLEEP_RE
  const secondary = platform === 'win32' ? POSIX_LONG_SLEEP_RE : PS_LONG_SLEEP_RE
  const match = command.match(primary) ?? command.match(secondary)
  if (!match) return null

  const seconds = parseFloat(match[1])
  if (!Number.isFinite(seconds) || seconds <= LONG_SLEEP_THRESHOLD_SECONDS) return null

  // Loop keyword anywhere before the sleep → accept as a polling pattern.
  const before = command.slice(0, match.index ?? 0)
  if (LOOP_RE.test(before)) return null

  return {
    reason: `Long solo sleep (${seconds}s) rejected — use a polling loop (\`until <cond>; do sleep 2; done\`) or the \`shell_monitor\` aux tool with an \`untilPattern\`. To override, set \`dangerously_disable_sandbox: true\` on this call.`
  }
}

/**
 * Look for an executable along `PATH`. Returns the absolute path of the
 * first hit, or `null` when nothing matches. Used so `buildShellInvocation`
 * can give a structured "bash unavailable" / "pwsh unavailable" result
 * instead of spawning something that fails with ENOENT.
 */
export function findOnPath(
  binary: string,
  pathEnv: string | undefined = process.env.PATH,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (!pathEnv) return null
  const exts =
    platform === 'win32' ? (process.env.PATHEXT?.split(';') ?? ['.exe', '.cmd', '.bat']) : ['']
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = resolve(dir, binary + ext)
      try {
        if (existsSync(candidate)) return candidate
      } catch {
        // skip unreadable entries
      }
    }
  }
  return null
}

/**
 * Resolve a `ShellSelector` to a concrete `{ cmd, args }` invocation, or
 * a structured error string when the requested shell isn't available on
 * this host. `'auto'` always succeeds (PowerShell on win32, $SHELL on
 * POSIX); the cross-platform overrides may fail with a clean message.
 */
export function buildShellInvocation(
  command: string,
  selector: ShellSelector = 'auto',
  platform: NodeJS.Platform = process.platform,
  pathEnv: string | undefined = process.env.PATH
): { cmd: string; args: string[] } | { error: string } {
  if (selector === 'auto') {
    if (platform === 'win32') {
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

  if (selector === 'bash') {
    // POSIX: prefer $SHELL when it's bash, otherwise the canonical path.
    if (platform !== 'win32') {
      const shellEnv = process.env.SHELL
      const cmd = shellEnv && /bash$/i.test(shellEnv) ? shellEnv : findOnPath('bash', pathEnv, platform) ?? '/bin/bash'
      return { cmd, args: ['-c', command] }
    }
    // win32: walk Git Bash → WSL fallback list.
    const candidates = [
      findOnPath('bash', pathEnv, platform),
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Windows\\System32\\bash.exe' // WSL launcher
    ]
    for (const candidate of candidates) {
      if (!candidate) continue
      try {
        if (existsSync(candidate)) return { cmd: candidate, args: ['-c', command] }
      } catch {
        // continue
      }
    }
    return {
      error:
        "shell: 'bash' requested but neither Git Bash nor WSL bash.exe was found on PATH or in standard install locations"
    }
  }

  // selector === 'powershell'
  if (platform === 'win32') {
    return {
      cmd: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
    }
  }
  // POSIX: PowerShell Core ships as `pwsh`.
  const pwsh = findOnPath('pwsh', pathEnv, platform)
  if (!pwsh) {
    return {
      error: "shell: 'powershell' requested but `pwsh` (PowerShell Core) is not installed on PATH"
    }
  }
  return {
    cmd: pwsh,
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
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
 *
 * When `conversationId` is supplied, the executor reads/writes a
 * persisted session cwd so `cd sub` carries forward to the next call.
 */
export function executeShellCommand(
  args: ShellArgs,
  workspaceRoot: string,
  conversationId?: string
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

    // S11 — reject long solo sleeps unless the caller explicitly bypasses.
    if (args.dangerously_disable_sandbox !== true) {
      const sleepGuard = screenLongSleep(args.command)
      if (sleepGuard) {
        resolveResult({
          command: args.command,
          cwd: workspaceRoot,
          exitCode: null,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 0,
          timedOut: false,
          error: sleepGuard.reason
        })
        return
      }
    }

    // Resolve cwd: explicit args.cwd → persisted session cwd → root.
    const sessionCwd = conversationId ? cwdSessions.get(conversationId) ?? null : null
    const cwdCandidate = args.cwd ?? sessionCwd ?? undefined
    const cwd = resolveCwdWithinWorkspace(workspaceRoot, cwdCandidate)
    if (cwd === null) {
      resolveResult({
        command: args.command,
        cwd: args.cwd ?? sessionCwd ?? workspaceRoot,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 0,
        timedOut: false,
        error: `cwd "${args.cwd ?? sessionCwd}" is outside the workspace root "${workspaceRoot}"`
      })
      return
    }

    const timeoutMs = Math.min(
      Math.max(0, args.timeout_ms ?? DEFAULT_TIMEOUT_MS),
      MAX_TIMEOUT_MS
    )
    const env: NodeJS.ProcessEnv = { ...process.env, ...(args.env || {}) }
    const invocation = buildShellInvocation(args.command, args.shell ?? 'auto')
    if ('error' in invocation) {
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
        error: invocation.error,
        sandboxTier: 'none'
      })
      return
    }

    // Wrap the shell invocation in a sandbox profile (S3 abstraction).
    // On Windows this is a pass-through that surfaces tier 'none'; on
    // darwin/linux it produces a sandbox-exec / bwrap wrapper around the
    // shell. Always succeeds — the dispatcher falls back to pass-through
    // when no per-platform impl is available.
    // S7: when the caller passed `dangerously_disable_sandbox: true`,
    // skip the wrap entirely and report tier `'bypassed'`. The chat
    // dispatcher is responsible for ensuring the user explicitly
    // approved the bypass before we ever reach this line.
    let cmd: string
    let shellArgs: string[]
    let sandboxTier: SandboxTier | undefined
    let sandboxNote: string | undefined
    if (args.dangerously_disable_sandbox === true) {
      cmd = invocation.cmd
      shellArgs = invocation.args
      sandboxTier = 'bypassed'
      sandboxNote = 'sandbox bypass approved by user (dangerously_disable_sandbox)'
    } else {
      const wrapped = applyProfile({
        spawnCmd: invocation.cmd,
        spawnArgs: invocation.args,
        cwd,
        opts: { workspaceRoot }
      })
      cmd = wrapped.cmd
      shellArgs = wrapped.args
      sandboxTier = wrapped.sandboxTier
      sandboxNote = wrapped.note
    }

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
        error: err?.message ?? 'spawn failed',
        sandboxTier,
        sandboxNote
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

      // Persist session cwd on a clean exit with a recognisable `cd`
      // prefix. Heuristic — complex chains like `cd a && cd b` only
      // capture the first hop. Anything that escapes the workspace,
      // doesn't exist, or isn't a directory does NOT update the
      // session; the in-shell `cd` still ran but is forgotten.
      if (
        exitCode === 0 &&
        !timedOut &&
        !err &&
        conversationId &&
        cwd
      ) {
        const target = extractCdTarget(args.command, process.platform)
        if (target) {
          const newCandidate = resolve(cwd, target)
          const validated = resolveCwdWithinWorkspace(workspaceRoot, newCandidate)
          if (validated !== null) {
            try {
              if (statSync(validated).isDirectory()) {
                cwdSessions.set(conversationId, validated)
              }
            } catch {
              // Path doesn't exist or stat threw — don't persist.
            }
          }
        }
      }

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
        error: err,
        sandboxTier,
        sandboxNote
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

  // S11 — anti-polling guard applies to background shells too.
  if (args.dangerously_disable_sandbox !== true) {
    const sleepGuard = screenLongSleep(args.command)
    if (sleepGuard) {
      const session: BackgroundSession = {
        id,
        command: args.command,
        cwd: workspaceRoot,
        proc: null,
        pid: null,
        startedAt,
        status: 'failed',
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: sleepGuard.reason,
        bytesWritten: 0,
        stdoutLineBuf: '',
        stderrLineBuf: ''
      }
      bgSessions.set(id, session)
      return snapshotBg(session)
    }
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
  const invocation = buildShellInvocation(args.command, args.shell ?? 'auto')
  if ('error' in invocation) {
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
      stderr: invocation.error,
      bytesWritten: 0,
      stdoutLineBuf: '',
      stderrLineBuf: ''
    }
    bgSessions.set(id, session)
    return snapshotBg(session)
  }
  // Wrap with the platform sandbox profile (S3). Pass-through on Windows.
  // S7: bypass when the caller asked for it.
  let cmd: string
  let shellArgs: string[]
  if (args.dangerously_disable_sandbox === true) {
    cmd = invocation.cmd
    shellArgs = invocation.args
  } else {
    const wrapped = applyProfile({
      spawnCmd: invocation.cmd,
      spawnArgs: invocation.args,
      cwd,
      opts: { workspaceRoot }
    })
    cmd = wrapped.cmd
    shellArgs = wrapped.args
  }

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
  if (r.sandboxTier) {
    const tierLabel = r.sandboxNote ? `${r.sandboxTier} — ${r.sandboxNote}` : r.sandboxTier
    parts.push(`Sandbox: ${tierLabel}`)
  }
  parts.push('--- stdout ---')
  parts.push(r.stdout.length > 0 ? r.stdout : '(empty)')
  if (r.stdoutTruncated) parts.push(`[stdout truncated at ${STDOUT_CAP} chars]`)
  parts.push('--- stderr ---')
  parts.push(r.stderr.length > 0 ? r.stderr : '(empty)')
  if (r.stderrTruncated) parts.push(`[stderr truncated at ${STDERR_CAP} chars]`)
  if (r.error) parts.push(`Error: ${r.error}`)
  return parts.join('\n')
}
