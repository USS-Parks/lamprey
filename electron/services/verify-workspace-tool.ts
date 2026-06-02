import { resolveCwdWithinWorkspace, executeShellCommand, type ShellArgs, type ShellResult } from './shell-tool'
import { inferVerificationCommands, readPackageManifest } from './workspace-context-tool'

export interface VerifyWorkspaceArgs {
  cwd?: string
  commands?: string[]
  timeout_ms?: number
  max_commands?: number
  include_format?: boolean
}

export interface VerificationCommandResult {
  command: string
  cwd: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  ok: boolean
  error?: string
  stdoutPreview: string
  stderrPreview: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

export interface VerificationReport {
  status: 'passed' | 'failed' | 'skipped'
  cwd: string
  inferredCommands: string[]
  skippedCommands: string[]
  commandsRun: string[]
  results: VerificationCommandResult[]
  totalDurationMs: number
  notes: string[]
}

type ShellRunner = (args: ShellArgs, workspaceRoot: string) => Promise<ShellResult>

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const DEFAULT_MAX_COMMANDS = 6
const MAX_COMMANDS = 8
const PREVIEW_CAP = 8_000

function preview(s: string): string {
  if (s.length <= PREVIEW_CAP) return s
  return s.slice(0, PREVIEW_CAP) + '\n... (truncated)'
}

export function isFormatCommand(command: string): boolean {
  return /^npm run [^\s]*format(?::|\s|$)/i.test(command) || /^npm run format(?::|\s|$)/i.test(command)
}

export function selectVerificationCommands(
  inferredCommands: string[],
  args: VerifyWorkspaceArgs | undefined
): { commands: string[]; skippedCommands: string[]; notes: string[] } {
  const includeFormat = args?.include_format === true
  const maxCommands =
    typeof args?.max_commands === 'number' && args.max_commands > 0
      ? Math.min(Math.floor(args.max_commands), MAX_COMMANDS)
      : DEFAULT_MAX_COMMANDS

  const allowed = new Set(inferredCommands)
  const requested = Array.isArray(args?.commands)
    ? args.commands.map((c) => (typeof c === 'string' ? c.trim() : '')).filter(Boolean)
    : null

  const base = requested ?? inferredCommands
  const skippedCommands: string[] = []
  const notes: string[] = []
  const selected: string[] = []

  for (const command of base) {
    if (!allowed.has(command)) {
      throw new Error(`verify_workspace: command is not one of the inferred verification commands: ${command}`)
    }
    if (!includeFormat && isFormatCommand(command)) {
      skippedCommands.push(command)
      continue
    }
    if (!selected.includes(command)) selected.push(command)
  }

  if (selected.length > maxCommands) {
    notes.push(`commands capped at ${maxCommands} of ${selected.length}`)
  }
  if (skippedCommands.length > 0) {
    notes.push('format commands skipped by default; pass include_format=true to run them')
  }

  return {
    commands: selected.slice(0, maxCommands),
    skippedCommands,
    notes
  }
}

export async function executeVerifyWorkspace(
  args: VerifyWorkspaceArgs | undefined,
  workspaceRoot: string,
  runner: ShellRunner = executeShellCommand
): Promise<{ result: string; status: 'done' | 'error' }> {
  const startedAt = Date.now()
  const cwd = resolveCwdWithinWorkspace(workspaceRoot, args?.cwd)
  if (!cwd) {
    throw new Error(`verify_workspace: cwd "${args?.cwd}" resolves outside the workspace root.`)
  }

  const pkg = readPackageManifest(cwd)
  const inferredCommands = inferVerificationCommands(cwd, pkg)
  const selection = selectVerificationCommands(inferredCommands, args)

  if (selection.commands.length === 0) {
    const report: VerificationReport = {
      status: 'skipped',
      cwd,
      inferredCommands,
      skippedCommands: selection.skippedCommands,
      commandsRun: [],
      results: [],
      totalDurationMs: Date.now() - startedAt,
      notes: inferredCommands.length === 0
        ? ['No verification commands were inferred for this workspace.']
        : selection.notes
    }
    return { result: JSON.stringify(report, null, 2), status: 'done' }
  }

  const timeoutMs =
    typeof args?.timeout_ms === 'number' && args.timeout_ms >= 0
      ? Math.min(args.timeout_ms, MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS

  const results: VerificationCommandResult[] = []
  for (const command of selection.commands) {
    const shell = await runner({ command, cwd, timeout_ms: timeoutMs }, workspaceRoot)
    const ok = !shell.error && !shell.timedOut && shell.exitCode === 0
    results.push({
      command,
      cwd: shell.cwd,
      exitCode: shell.exitCode,
      durationMs: shell.durationMs,
      timedOut: shell.timedOut,
      ok,
      error: shell.error,
      stdoutPreview: preview(shell.stdout),
      stderrPreview: preview(shell.stderr),
      stdoutTruncated: shell.stdoutTruncated || shell.stdout.length > PREVIEW_CAP,
      stderrTruncated: shell.stderrTruncated || shell.stderr.length > PREVIEW_CAP
    })
  }

  const failed = results.some((r) => !r.ok)
  const report: VerificationReport = {
    status: failed ? 'failed' : 'passed',
    cwd,
    inferredCommands,
    skippedCommands: selection.skippedCommands,
    commandsRun: selection.commands,
    results,
    totalDurationMs: Date.now() - startedAt,
    notes: selection.notes
  }

  return {
    result: JSON.stringify(report, null, 2),
    status: failed ? 'error' : 'done'
  }
}
