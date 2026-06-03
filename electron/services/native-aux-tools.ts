import { statSync } from 'fs'
import { extname, isAbsolute, resolve, relative } from 'path'
import { execFileSync } from 'child_process'
import { app } from 'electron'
import { randomUUID } from 'crypto'

import { permissionsService } from './permissions-store'
import { ptyGetBuffer, ptyListSessions, PTY_READ_CAP } from './pty-manager'
import { resolveWorkspaceRelative } from './path-utils'
import type { ToolExecutionContext } from './tool-registry'
import type { ToolRisk } from './tool-registry'

// Executors for the auxiliary native tools:
//   - view_image
//   - read_thread_terminal
//   - load_workspace_dependencies
//   - request_permissions
//
// Registry registration lives in native-dev-tool-pack.ts so these executors
// stay testable without booting the registry/MCP layers.

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
