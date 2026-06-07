import { createHash } from 'crypto'
import { resolveCwdWithinWorkspace, executeShellCommand, type ShellArgs, type ShellResult } from './shell-tool'
import { getActiveChangeContract } from './change-contract-store'
import { createProofReceipt, type CreateProofReceiptInput } from './proof-receipts'
import { runGit } from './git-runner'
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
  receiptId?: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  ok: boolean
  error?: string
  stdoutPreview: string
  stderrPreview: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  parsedMetrics: Record<string, unknown>
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
type ReceiptWriter = (input: CreateProofReceiptInput) => { id: string }

export interface VerifyWorkspaceContext {
  conversationId?: string
  correlationId?: string
  toolCallId?: string
  createdBy?: 'agent' | 'system' | 'user' | 'ci'
  writeReceipt?: ReceiptWriter
}

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const DEFAULT_MAX_COMMANDS = 6
const MAX_COMMANDS = 8
const PREVIEW_CAP = 8_000

function preview(s: string): string {
  if (s.length <= PREVIEW_CAP) return s
  return s.slice(0, PREVIEW_CAP) + '\n... (truncated)'
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function getGitProofState(cwd: string): Promise<{
  gitHead?: string
  gitDirty: boolean
  diffHash?: string
}> {
  const head = await runGit(['rev-parse', 'HEAD'], cwd)
  const status = await runGit(['status', '--porcelain=v1'], cwd)
  const diff = await runGit(['diff', '--binary'], cwd)
  const staged = await runGit(['diff', '--cached', '--binary'], cwd)
  const diffBody = `${diff.code === 0 ? diff.stdout : ''}\n---staged---\n${staged.code === 0 ? staged.stdout : ''}`
  return {
    gitHead: head.code === 0 ? head.stdout.trim() || undefined : undefined,
    gitDirty: status.code === 0 ? status.stdout.trim().length > 0 : false,
    diffHash: diff.code === 0 || staged.code === 0 ? sha256(diffBody) : undefined
  }
}

export function parseVerificationMetrics(
  command: string,
  stdout: string,
  stderr: string,
  exitCode: number | null
): Record<string, unknown> {
  const combined = `${stdout}\n${stderr}`
  const metrics: Record<string, unknown> = {
    commandKind: commandKind(command),
    exitCode,
    metricsParseStatus: 'partial'
  }
  const vitest = combined.match(
    /Tests\s+(\d+)\s+passed(?:\s+\|\s+(\d+)\s+skipped)?(?:\s+\|\s+(\d+)\s+failed)?/i
  )
  if (vitest) {
    metrics.tests = {
      passed: Number(vitest[1] ?? 0),
      skipped: Number(vitest[2] ?? 0),
      failed: Number(vitest[3] ?? 0)
    }
    metrics.metricsParseStatus = 'ok'
  }
  const jest = combined.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+skipped,\s+)?(\d+)\s+passed/i)
  if (jest) {
    metrics.tests = {
      failed: Number(jest[1] ?? 0),
      skipped: Number(jest[2] ?? 0),
      passed: Number(jest[3] ?? 0)
    }
    metrics.metricsParseStatus = 'ok'
  }
  const eslint = combined.match(/(\d+)\s+problems?\s+\((\d+)\s+errors?,\s+(\d+)\s+warnings?\)/i)
  if (eslint) {
    metrics.eslint = {
      problems: Number(eslint[1]),
      errors: Number(eslint[2]),
      warnings: Number(eslint[3])
    }
    metrics.metricsParseStatus = 'ok'
  }
  const tsconfig = command.match(/-p\s+([^\s]+)/)
  if (/tsc/i.test(command)) {
    metrics.typescript = {
      project: tsconfig?.[1],
      ok: exitCode === 0
    }
    metrics.metricsParseStatus = 'ok'
  }
  if (/build/i.test(command)) {
    metrics.build = { ok: exitCode === 0 }
    metrics.metricsParseStatus = 'ok'
  }
  return metrics
}

function commandKind(command: string): string {
  if (/vitest|jest|\bnpm test\b|npm run test/i.test(command)) return 'test'
  if (/tsc|typecheck|type-check|type:check/i.test(command)) return 'typecheck'
  if (/eslint|lint/i.test(command)) return 'lint'
  if (/build/i.test(command)) return 'build'
  if (/smoke/i.test(command)) return 'smoke'
  return 'verify'
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
  runner: ShellRunner = executeShellCommand,
  context: VerifyWorkspaceContext = {}
): Promise<{ result: string; status: 'done' | 'error' }> {
  const startedAt = Date.now()
  const cwd = resolveCwdWithinWorkspace(workspaceRoot, args?.cwd)
  if (!cwd) {
    throw new Error(`verify_workspace: cwd "${args?.cwd}" resolves outside the workspace root.`)
  }

  const pkg = readPackageManifest(cwd)
  const inferredCommands = inferVerificationCommands(cwd, pkg)
  const selection = selectVerificationCommands(inferredCommands, args)
  const activeContract = context.conversationId
    ? getActiveChangeContract(context.conversationId)
    : null
  const writeReceipt = context.writeReceipt ?? createProofReceipt
  const proofState = await getGitProofState(cwd)

  if (selection.commands.length === 0) {
    const skippedReceiptIds: string[] = []
    for (const command of selection.skippedCommands) {
      skippedReceiptIds.push(
        writeReceipt({
          kind: commandKind(command),
          status: 'skipped',
          conversationId: context.conversationId,
          correlationId: context.correlationId,
          contractId: activeContract?.id,
          toolCallId: context.toolCallId,
          workspacePath: workspaceRoot,
          cwd,
          ...proofState,
          command,
          startedAt,
          finishedAt: Date.now(),
          stdout: '',
          stderr: '',
          parsedMetrics: { commandKind: commandKind(command), skipped: true },
          createdBy: context.createdBy ?? 'agent'
        }).id
      )
    }
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
        : selection.notes.concat(
            skippedReceiptIds.length > 0
              ? [`skipped proof receipts: ${skippedReceiptIds.join(', ')}`]
              : []
          )
    }
    return { result: JSON.stringify(report, null, 2), status: 'done' }
  }

  const timeoutMs =
    typeof args?.timeout_ms === 'number' && args.timeout_ms >= 0
      ? Math.min(args.timeout_ms, MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS

  const results: VerificationCommandResult[] = []
  const skippedReceiptIds: string[] = []
  for (const command of selection.skippedCommands) {
    skippedReceiptIds.push(
      writeReceipt({
        kind: commandKind(command),
        status: 'skipped',
        conversationId: context.conversationId,
        correlationId: context.correlationId,
        contractId: activeContract?.id,
        toolCallId: context.toolCallId,
        workspacePath: workspaceRoot,
        cwd,
        ...proofState,
        command,
        startedAt,
        finishedAt: Date.now(),
        stdout: '',
        stderr: '',
        parsedMetrics: { commandKind: commandKind(command), skipped: true },
        createdBy: context.createdBy ?? 'agent'
      }).id
    )
  }
  for (const command of selection.commands) {
    const commandStartedAt = Date.now()
    const shell = await runner({ command, cwd, timeout_ms: timeoutMs }, workspaceRoot)
    const ok = !shell.error && !shell.timedOut && shell.exitCode === 0
    const parsedMetrics = parseVerificationMetrics(command, shell.stdout, shell.stderr, shell.exitCode)
    const receipt = writeReceipt({
      kind: commandKind(command),
      status: ok ? 'passed' : 'failed',
      conversationId: context.conversationId,
      correlationId: context.correlationId,
      contractId: activeContract?.id,
      toolCallId: context.toolCallId,
      workspacePath: workspaceRoot,
      cwd: shell.cwd,
      ...proofState,
      command,
      startedAt: commandStartedAt,
      finishedAt: commandStartedAt + shell.durationMs,
      durationMs: shell.durationMs,
      exitCode: shell.exitCode ?? undefined,
      timedOut: shell.timedOut,
      stdout: shell.stdout,
      stderr: shell.stderr,
      parsedMetrics,
      createdBy: context.createdBy ?? 'agent'
    })
    results.push({
      command,
      cwd: shell.cwd,
      receiptId: receipt.id,
      exitCode: shell.exitCode,
      durationMs: shell.durationMs,
      timedOut: shell.timedOut,
      ok,
      error: shell.error,
      stdoutPreview: preview(shell.stdout),
      stderrPreview: preview(shell.stderr),
      stdoutTruncated: shell.stdoutTruncated || shell.stdout.length > PREVIEW_CAP,
      stderrTruncated: shell.stderrTruncated || shell.stderr.length > PREVIEW_CAP,
      parsedMetrics
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
    notes: selection.notes.concat(
      skippedReceiptIds.length > 0
        ? [`skipped proof receipts: ${skippedReceiptIds.join(', ')}`]
        : []
    )
  }

  return {
    result: JSON.stringify(report, null, 2),
    status: failed ? 'error' : 'done'
  }
}
