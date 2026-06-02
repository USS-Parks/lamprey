// Shell-mode "PTY" using child_process. Not a real PTY — pipes only — so
// full-screen TUIs (vim, top, htop) won't render, but most everyday commands
// (git, npm, ls, node, python) work fine. Chosen over real node-pty because
// the project path contains a space, which breaks node-pty's node-gyp build
// chain on Windows; pivoting to pipes keeps install/build reliable.

import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import type { BrowserWindow } from 'electron'

interface PtySession {
  id: string
  proc: ChildProcessWithoutNullStreams
  win: BrowserWindow
  cwd: string
  buffer: string
  lastActivity: number
}

const sessions = new Map<string, PtySession>()

// Rolling buffer cap. The model receives ~50 KB; we keep 200 KB so the
// user can also scroll back without exhausting memory if many sessions
// are open.
const PTY_BUFFER_CAP = 200_000
// The read_thread_terminal native tool returns at most this many bytes
// (tail end of the buffer) to the model.
export const PTY_READ_CAP = 50_000

function appendToBuffer(session: PtySession, chunk: string): void {
  if (!chunk) return
  const next = session.buffer + chunk
  session.buffer = next.length > PTY_BUFFER_CAP ? next.slice(next.length - PTY_BUFFER_CAP) : next
  session.lastActivity = Date.now()
}

export type ShellKind = 'powershell' | 'cmd' | 'git-bash' | 'wsl'

// Common Git Bash install locations (64-bit and 32-bit), Scoop, and PATH.
const GIT_BASH_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  'C:\\Users\\Public\\scoop\\apps\\git\\current\\bin\\bash.exe'
]

function resolveGitBash(): string | null {
  // Synchronous existence check; falling back to PATH name lets `spawn`
  // surface ENOENT to the renderer which is fine for our error UX.
  for (const p of GIT_BASH_CANDIDATES) {
    try {
      if (existsSync(p)) return p
    } catch {
      // ignore individual probe failures
    }
  }
  return null
}

function shellForKind(kind: ShellKind | undefined): { cmd: string; args: string[] } {
  if (process.platform === 'win32') {
    switch (kind) {
      case 'powershell':
        return { cmd: 'powershell.exe', args: ['-NoLogo'] }
      case 'cmd':
        return { cmd: process.env.COMSPEC || 'cmd.exe', args: [] }
      case 'git-bash': {
        const bash = resolveGitBash() ?? 'bash.exe'
        return { cmd: bash, args: ['--login', '-i'] }
      }
      case 'wsl':
        return { cmd: 'wsl.exe', args: [] }
      default:
        // PowerShell is the modern Windows default and matches what the
        // Codex tool launcher offers as the unlabeled "Terminal" entry.
        return { cmd: 'powershell.exe', args: ['-NoLogo'] }
    }
  }
  return { cmd: process.env.SHELL || '/bin/bash', args: ['-i'] }
}

export interface SpawnOptions {
  cwd?: string
  shellKind?: ShellKind
}

export function ptySpawn(
  id: string,
  win: BrowserWindow,
  opts: SpawnOptions = {}
): { cwd: string; shell: string; shellKind: ShellKind | null } {
  if (sessions.has(id)) {
    throw new Error(`PTY session ${id} already exists`)
  }
  const cwd = opts.cwd || process.cwd()
  const { cmd, args } = shellForKind(opts.shellKind)

  const proc = spawn(cmd, args, {
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  }) as ChildProcessWithoutNullStreams

  const session: PtySession = { id, proc, win, cwd, buffer: '', lastActivity: Date.now() }
  sessions.set(id, session)

  const send = (channel: string, payload: unknown) => {
    try {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    } catch {
      // window may have closed
    }
  }

  proc.stdout.on('data', (buf: Buffer) => {
    const chunk = buf.toString('utf8')
    appendToBuffer(session, chunk)
    send('terminal:data', { id, chunk })
  })
  proc.stderr.on('data', (buf: Buffer) => {
    const chunk = buf.toString('utf8')
    appendToBuffer(session, chunk)
    send('terminal:data', { id, chunk })
  })
  proc.on('exit', (code, signal) => {
    sessions.delete(id)
    send('terminal:exit', { id, code, signal: signal ?? null })
  })
  proc.on('error', (err) => {
    send('terminal:data', { id, chunk: `\r\n[terminal error: ${err.message}]\r\n` })
  })

  return { cwd, shell: cmd, shellKind: opts.shellKind ?? null }
}

export function ptyWrite(id: string, data: string): boolean {
  const s = sessions.get(id)
  if (!s) return false
  try {
    s.proc.stdin.write(data)
    return true
  } catch {
    return false
  }
}

// No-op for shell-mode (no PTY to resize). Kept for API parity with future
// real-PTY swap; returns false so callers can detect.
export function ptyResize(_id: string, _cols: number, _rows: number): boolean {
  return false
}

export function ptyKill(id: string): boolean {
  const s = sessions.get(id)
  if (!s) return false
  try {
    s.proc.kill()
  } catch {
    // already dead
  }
  sessions.delete(id)
  return true
}

export function ptyKillAll(): void {
  for (const id of Array.from(sessions.keys())) {
    ptyKill(id)
  }
}

/**
 * Return the rolling stdout/stderr buffer for a session, or null if none.
 * Used by the read_thread_terminal native tool to surface recent output
 * to the model. Returned text is the raw captured bytes (already capped at
 * PTY_BUFFER_CAP); callers should slice the tail before showing.
 */
export function ptyGetBuffer(id: string): string | null {
  const s = sessions.get(id)
  if (!s) return null
  return s.buffer
}

/**
 * Return all currently active PTY session ids, most-recently-active first.
 * Used by read_thread_terminal so the model can call it without knowing
 * a specific id (the most-recent session is picked by default).
 */
export function ptyListSessions(): string[] {
  return Array.from(sessions.values())
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .map((s) => s.id)
}
