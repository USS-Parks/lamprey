import { statSync } from 'fs'
import { extname, isAbsolute, resolve, relative } from 'path'
import { execFileSync } from 'child_process'
import { app } from 'electron'
import { randomUUID } from 'crypto'

import { permissionsService } from './permissions-store'
import { ptyGetBuffer, ptyListSessions, PTY_READ_CAP } from './pty-manager'
import { resolveWorkspaceRelative } from './path-utils'
import {
  startMonitor,
  readMonitor,
  listMonitors,
  type MonitorHandle
} from './monitor-service'
import {
  getBackgroundShell,
  killBackgroundShell,
  listBackgroundShells,
  STDOUT_CAP,
  STDERR_CAP,
  type ShellBackgroundHandle
} from './shell-tool'
import type { ToolExecutionContext } from './tool-registry'
import type { ToolRisk } from './tool-registry'

// Executors for the auxiliary native tools:
//   - view_image
//   - read_thread_terminal
//   - load_workspace_dependencies
//   - request_permissions
//   - shell_monitor / shell_list / shell_stop / shell_output (S8)
//
// Registry registration lives in native-dev-tool-pack.ts (view_image,
// read_thread_terminal, load_workspace_dependencies, request_permissions)
// and tool-registry.ts (the shell_* aux tools, registered next to
// shell_command). These executors stay testable without booting the
// registry/MCP layers.

// ──────────────────────────── view_image ────────────────────────────

export interface ViewImageArgs {
  path: string
  description?: string
}

const ALLOWED_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const MAX_IMAGE_BYTES = 20 * 1024 * 1024 // 20 MB

function safeUserDataArtifactsDir(): string | null {
  try {
    return resolve(app.getPath('userData'), 'artifacts')
  } catch {
    // app not ready or running outside electron — caller will fall back
    // to the workspace-only boundary.
    return null
  }
}

function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target)
  if (rel === '') return true
  if (rel.startsWith('..')) return false
  if (isAbsolute(rel)) return false
  return true
}

export function executeViewImage(args: ViewImageArgs, workspaceRoot: string): string {
  if (!args || typeof args.path !== 'string' || args.path.trim() === '') {
    throw new Error('view_image: "path" is required and must be a non-empty string.')
  }

  const absolute = resolveWorkspaceRelative(args.path, workspaceRoot)
  const ext = extname(absolute).toLowerCase()
  if (!ALLOWED_IMAGE_EXTS.has(ext)) {
    throw new Error(
      `view_image: extension "${ext || '(none)'}" is not a supported image format. Allowed: ${Array.from(ALLOWED_IMAGE_EXTS).join(', ')}.`
    )
  }

  const workspaceAbs = resolve(workspaceRoot)
  const artifactsDir = safeUserDataArtifactsDir()
  const inWorkspace = isInsideRoot(workspaceAbs, absolute)
  const inArtifacts = artifactsDir ? isInsideRoot(artifactsDir, absolute) : false
  if (!inWorkspace && !inArtifacts) {
    throw new Error(
      `view_image: path "${absolute}" is outside the workspace and the userData artifacts directory.`
    )
  }

  let stat
  try {
    stat = statSync(absolute)
  } catch (err: any) {
    throw new Error(`view_image: cannot stat "${absolute}": ${err?.message ?? 'unknown error'}.`, {
      cause: err
    })
  }
  if (!stat.isFile()) {
    throw new Error(`view_image: "${absolute}" is not a regular file.`)
  }
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `view_image: file is ${stat.size} bytes (>${MAX_IMAGE_BYTES}). Refusing to register oversized image.`
    )
  }

  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.gif'
          ? 'image/gif'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.bmp'
              ? 'image/bmp'
              : 'application/octet-stream'

  const desc = args.description ? ` ${args.description.trim()}` : ''
  return `Image at ${absolute} (${stat.size} bytes, ${mime}).${desc}`
}

// ──────────────────────── read_thread_terminal ──────────────────────

export interface ReadThreadTerminalArgs {
  terminal_id?: string
}

export function executeReadThreadTerminal(args: ReadThreadTerminalArgs): string {
  const ids = ptyListSessions()
  if (ids.length === 0) return 'read_thread_terminal: no active terminal sessions.'

  let targetId = args?.terminal_id
  if (!targetId) targetId = ids[0]

  const buffer = ptyGetBuffer(targetId)
  if (buffer === null) {
    return `read_thread_terminal: no terminal session with id "${targetId}". Active sessions: ${ids.join(', ')}`
  }

  const tail = buffer.length > PTY_READ_CAP ? buffer.slice(buffer.length - PTY_READ_CAP) : buffer
  const truncated = buffer.length > PTY_READ_CAP
  const header = `terminal_id: ${targetId} · buffered: ${buffer.length} bytes${truncated ? ` (returning last ${PTY_READ_CAP})` : ''}`
  if (tail.length === 0) return `${header}\n(empty)`
  return `${header}\n--- output ---\n${tail}`
}

// ────────────────── load_workspace_dependencies ─────────────────────

interface ProbeResult {
  path: string
  version: string
}

function probeNode(): ProbeResult {
  // Electron's process.execPath is the Electron binary, not a usable node
  // CLI. The node version is still well-defined (process.version), so we
  // report that and surface the Electron exec path as the runtime host.
  return {
    path: process.execPath,
    version: process.version
  }
}

function probePython(): ProbeResult | null {
  const candidates = process.platform === 'win32' ? ['python.exe', 'python3.exe', 'py.exe'] : ['python3', 'python']
  for (const cmd of candidates) {
    try {
      const out = execFileSync(cmd, ['--version'], {
        encoding: 'utf8',
        timeout: 2000,
        windowsHide: true
      }).trim()
      return { path: cmd, version: out }
    } catch {
      // try next
    }
  }
  return null
}

export function executeLoadWorkspaceDependencies(): string {
  const node = probeNode()
  const python = probePython()
  const summary = {
    node,
    python,
    helpers: [] as Array<{ name: string; path: string }>,
    notes: [] as string[]
  }
  if (summary.helpers.length === 0) {
    summary.notes.push('no bundled helpers yet (presentations/docs/sheets scripts not packaged in this build)')
  }
  if (python === null) {
    summary.notes.push('python not found on PATH; Python-based helpers unavailable')
  }
  return JSON.stringify(summary, null, 2)
}

// ──────────────────────── request_permissions ───────────────────────

export type PermissionScope =
  | 'shell'
  | 'network'
  | 'write_workspace'
  | 'destructive_fs'
  | 'browser_destructive'
  | 'secret_access'
  | 'read_workspace'
  | 'write_path'
  | 'read_path'

export interface RequestPermissionsArgs {
  scope: PermissionScope
  reason: string
  path?: string
}

const SCOPE_RISKS: Record<PermissionScope, ToolRisk[]> = {
  shell: ['write', 'network'],
  network: ['network'],
  write_workspace: ['write'],
  destructive_fs: ['destructive', 'write'],
  browser_destructive: ['destructive', 'network'],
  secret_access: ['secret', 'read'],
  read_workspace: ['read'],
  write_path: ['write'],
  read_path: ['read']
}

export async function executeRequestPermissions(
  args: RequestPermissionsArgs,
  ctx: ToolExecutionContext
): Promise<string> {
  if (!args || typeof args.scope !== 'string' || !(args.scope in SCOPE_RISKS)) {
    throw new Error(
      `request_permissions: scope must be one of ${Object.keys(SCOPE_RISKS).join(', ')}.`
    )
  }
  if (typeof args.reason !== 'string' || args.reason.trim() === '') {
    throw new Error('request_permissions: "reason" is required and must be a non-empty string.')
  }

  const risks = SCOPE_RISKS[args.scope]
  const callId = `request_permissions:${randomUUID()}`
  const decision = await permissionsService.requestApproval({
    callId,
    toolId: `request_permissions:${args.scope}`,
    name: 'request_permissions',
    serverId: 'internal',
    providerKind: 'native',
    risks,
    args: { scope: args.scope, reason: args.reason, path: args.path },
    conversationId: ctx.conversationId
  })

  // On grant, propagate the decision to per-RISK policies so subsequent calls
  // to OTHER tools that carry these risks (e.g. shell_command for the 'shell'
  // scope, web_open / image_generate for the 'network' scope) do not re-prompt.
  // Scope defaults to 'conversation' when we have a conversation id; falls
  // back to 'always' only for headless / no-conversation calls. The modal's
  // own scope (once/conversation/always) is captured separately on the
  // synthetic toolId; this just makes the grant useful across tools.
  if (decision === 'allow') {
    const policyScope: 'conversation' | 'always' = ctx.conversationId
      ? 'conversation'
      : 'always'
    for (const risk of risks) {
      permissionsService.setRiskPolicy(risk, policyScope, 'allow', ctx.conversationId)
    }
  }

  return decision === 'allow' ? `Approved (scope=${args.scope})` : `Denied (scope=${args.scope})`
}

// ─────────────────────── shell_monitor / shell_list ─────────────────────
// ─────────────────────── shell_stop  / shell_output ─────────────────────
//
// S8 — model-facing wrappers around monitor-service.ts and the background
// shell registry. These pair with `shell_command` when a future call adds
// `run_in_background: true`; today they let the model inspect / stop any
// background shell already started by the dev-server, monitor service,
// verify-workspace, or workspace-bootstrap subsystems.
//
// All four are thin formatters. The underlying state lives in
// monitor-service.ts and shell-tool.ts; this module only renders the
// model-facing string.

export interface ShellMonitorArgs {
  processId?: string
  untilPattern?: string
}

function formatMonitorHandle(h: MonitorHandle): string {
  return [
    `Monitor: ${h.id}`,
    `Process: ${h.processId}`,
    `Status: ${h.status}`,
    `Until: ${h.untilPattern ?? '(none)'}`,
    `Lines buffered: ${h.lineCount}`,
    `Bytes captured: ${h.bytesWritten}`,
    `Matched line: ${h.matchedLine ?? '(none)'}`,
    `Started: ${new Date(h.startedAt).toISOString()}`,
    h.finishedAt ? `Finished: ${new Date(h.finishedAt).toISOString()}` : 'Finished: (still active)'
  ].join('\n')
}

export function executeShellMonitor(args: ShellMonitorArgs): string {
  if (!args || typeof args.processId !== 'string' || args.processId.trim() === '') {
    return 'shell_monitor: "processId" is required and must be a non-empty string.'
  }
  // Verify the background shell exists before starting a monitor — the
  // monitor would otherwise sit dormant waiting for a process that never
  // emits anything, which is a confusing UX for the model.
  const shell = getBackgroundShell(args.processId)
  if (!shell) {
    return `shell_monitor: no background shell with processId "${args.processId}". Call shell_list to see active ids.`
  }
  if (args.untilPattern !== undefined && typeof args.untilPattern !== 'string') {
    return 'shell_monitor: "untilPattern" must be a string (regex source) when provided.'
  }
  try {
    const handle = startMonitor({
      processId: args.processId,
      untilPattern: args.untilPattern
    })
    return formatMonitorHandle(handle)
  } catch (err: any) {
    return `shell_monitor: ${err?.message ?? 'failed to start monitor'}`
  }
}

// ────────────────────────────── shell_list ──────────────────────────────

function summarizeBgShell(s: ShellBackgroundHandle): {
  id: string
  command: string
  status: string
  exitCode: number | null
  durationMs: number
  pid: number | null
} {
  return {
    id: s.id,
    command: s.command,
    status: s.status,
    exitCode: s.exitCode,
    durationMs: Date.now() - s.startedAt,
    pid: s.pid
  }
}

export function executeShellList(): string {
  const shells = listBackgroundShells()
  const monitors = listMonitors()
  if (shells.length === 0 && monitors.length === 0) {
    return 'shell_list: no background shells or monitors active.'
  }
  const body = {
    shells: shells.map(summarizeBgShell),
    monitors: monitors.map((m) => ({
      id: m.id,
      processId: m.processId,
      status: m.status,
      lineCount: m.lineCount,
      untilPattern: m.untilPattern
    }))
  }
  return JSON.stringify(body, null, 2)
}

// ────────────────────────────── shell_stop ──────────────────────────────

export interface ShellStopArgs {
  processId?: string
  signal?: 'SIGTERM' | 'SIGKILL'
}

export function executeShellStop(args: ShellStopArgs): string {
  if (!args || typeof args.processId !== 'string' || args.processId.trim() === '') {
    return JSON.stringify({
      stopped: false,
      processId: args?.processId ?? null,
      error: '"processId" is required and must be a non-empty string'
    })
  }
  const shell = getBackgroundShell(args.processId)
  if (!shell) {
    return JSON.stringify({
      stopped: false,
      processId: args.processId,
      error: `no background shell with processId "${args.processId}"`
    })
  }
  if (shell.status !== 'running') {
    return JSON.stringify({
      stopped: false,
      processId: args.processId,
      status: shell.status,
      error: `shell is already ${shell.status}; nothing to stop`
    })
  }
  const sig: NodeJS.Signals = args.signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM'
  const ok = killBackgroundShell(args.processId, sig)
  return JSON.stringify({
    stopped: ok,
    processId: args.processId,
    signal: sig
  })
}

// ────────────────────────────── shell_output ────────────────────────────

export interface ShellOutputArgs {
  processId?: string
  since?: number
}

function formatBgHeader(s: ShellBackgroundHandle): string {
  const statusLabel =
    s.status === 'running'
      ? 'running'
      : s.exitCode === null
        ? `${s.status}${s.signal ? ` (signal ${s.signal})` : ''}`
        : `${s.status} (exit ${s.exitCode})`
  return [
    `Process: ${s.id}`,
    `Command: ${s.command}`,
    `Cwd: ${s.cwd}`,
    `Status: ${statusLabel}`,
    `Duration: ${Date.now() - s.startedAt}ms`,
    `Bytes captured: ${s.bytesWritten}`
  ].join('\n')
}

export function executeShellOutput(args: ShellOutputArgs): string {
  if (!args || typeof args.processId !== 'string' || args.processId.trim() === '') {
    return 'shell_output: "processId" is required and must be a non-empty string.'
  }
  const shell = getBackgroundShell(args.processId)
  if (!shell) {
    return `shell_output: no background shell with processId "${args.processId}". Call shell_list to see active ids.`
  }

  // If a `since` cursor + an active monitor for this processId, drain the
  // monitor's incremental buffer — gives the model the chunk of new lines
  // since its last read instead of the full bounded stdout copy.
  if (typeof args.since === 'number') {
    const monitors = listMonitors().filter((m) => m.processId === args.processId)
    if (monitors.length > 0) {
      const monitor = monitors[monitors.length - 1] // most recent
      try {
        const out = readMonitor(monitor.id, args.since)
        const lines = out.lines
          .map((l) => `[${l.stream}] ${l.line}`)
          .join('\n')
        const header = `${formatBgHeader(shell)}\nMonitor: ${out.handle.id} · status ${out.handle.status} · cursor ${out.cursor}`
        return `${header}\n--- new lines (since=${args.since}) ---\n${lines.length > 0 ? lines : '(no new lines)'}`
      } catch (err: any) {
        return `shell_output: monitor read failed: ${err?.message ?? 'unknown error'}`
      }
    }
    // fall through to the full-buffer view when no monitor is attached
  }

  const parts: string[] = [formatBgHeader(shell)]
  parts.push('--- stdout ---')
  parts.push(shell.stdout.length > 0 ? shell.stdout : '(empty)')
  if (shell.bytesWritten > STDOUT_CAP) parts.push(`[stdout truncated at ${STDOUT_CAP} chars]`)
  parts.push('--- stderr ---')
  parts.push(shell.stderr.length > 0 ? shell.stderr : '(empty)')
  if (shell.bytesWritten > STDERR_CAP) parts.push(`[stderr truncated at ${STDERR_CAP} chars]`)
  return parts.join('\n')
}
