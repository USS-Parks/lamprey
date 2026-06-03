import { ipcMain } from 'electron'
import * as path from 'path'
import { runGit } from '../services/git-runner'
import { boundedJsonPreview, recordEvent } from '../services/event-log'

interface WorktreeEntry {
  path: string
  branch: string | null
  head: string | null
}

function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = []
  let cur: Partial<WorktreeEntry> = {}
  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      if (cur.path) out.push({ path: cur.path, branch: cur.branch ?? null, head: cur.head ?? null })
      cur = {}
      continue
    }
    if (line.startsWith('worktree ')) cur.path = line.slice(9)
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5)
    else if (line.startsWith('branch ')) {
      const ref = line.slice(7)
      cur.branch = ref.replace(/^refs\/heads\//, '')
    }
  }
  if (cur.path) out.push({ path: cur.path, branch: cur.branch ?? null, head: cur.head ?? null })
  return out
}

// Branch / ref name validator. `runGit` already invokes git with argv-form
// spawn (no shell), so this is not about command injection — it's about
// argument injection: a branch like `-x` lets the model smuggle a flag past
// the verb. `--` separators below close the same gap for positionals. The
// regex matches a conservative subset of git's allowed refname grammar so a
// future refactor that drops the separator still rejects the dangerous shapes.
const BRANCH_NAME_RE = /^[A-Za-z0-9._/-]+$/

export function isValidRefName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  if (name.length === 0 || name.length > 200) return false
  if (name.startsWith('-')) return false
  if (name.includes('..')) return false
  return BRANCH_NAME_RE.test(name)
}

export interface WorktreeCreateInput {
  cwd?: string
  path: string
  branch: string
  baseRef?: string
}

export interface WorktreeRemoveInput {
  cwd?: string
  path: string
  force?: boolean
}

export interface ResolvedCreate {
  cwd: string
  wtPath: string
  gitArgs: string[]
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

// Pure: turn an IPC `worktree:create` payload into the resolved cwd + the
// argv for `git`. Returns a typed error envelope rather than throwing so the
// handler can surface the rejection reason straight back to the renderer.
export function planWorktreeCreate(input: WorktreeCreateInput): ValidationResult<ResolvedCreate> {
  if (!input || typeof input.path !== 'string' || !input.path) {
    return { ok: false, error: 'path is required' }
  }
  if (!isValidRefName(input.branch)) {
    return {
      ok: false,
      error: `branch name rejected: must match ${BRANCH_NAME_RE.source}, no leading "-", no ".." sequence`
    }
  }
  if (input.baseRef !== undefined && !isValidRefName(input.baseRef)) {
    return {
      ok: false,
      error: `baseRef rejected: must match ${BRANCH_NAME_RE.source}, no leading "-"`
    }
  }
  const cwd = input.cwd || process.cwd()
  const wtPath = path.isAbsolute(input.path)
    ? input.path
    : path.resolve(cwd, '..', input.path)
  // `--` ends option parsing so a worktree path that happens to start with a
  // dash (e.g. landed via path.resolve oddities or a hostile cwd) can't smuggle
  // a flag into the git invocation.
  const gitArgs = ['worktree', 'add', '-b', input.branch, '--', wtPath]
  if (input.baseRef) gitArgs.push(input.baseRef)
  return { ok: true, value: { cwd, wtPath, gitArgs } }
}

export interface ResolvedRemove {
  cwd: string
  gitArgs: string[]
}

// Pure: turn an IPC `worktree:remove` payload into the resolved cwd + the
// argv for `git`. The path is validated as absolute so the model cannot
// trick the user-driven flow into removing an arbitrary repo-relative tree.
export function planWorktreeRemove(input: WorktreeRemoveInput): ValidationResult<ResolvedRemove> {
  if (!input || typeof input.path !== 'string' || !input.path) {
    return { ok: false, error: 'path is required' }
  }
  if (!path.isAbsolute(input.path)) {
    return { ok: false, error: 'path must be absolute' }
  }
  if (input.path.startsWith('-')) {
    // Belt and braces; `--` below would block this anyway but the explicit
    // reject keeps the error message readable.
    return { ok: false, error: 'path must not begin with "-"' }
  }
  const cwd = input.cwd || process.cwd()
  const gitArgs = ['worktree', 'remove']
  if (input.force) gitArgs.push('--force')
  gitArgs.push('--', input.path)
  return { ok: true, value: { cwd, gitArgs } }
}

export function registerWorktreeHandlers(): void {
  ipcMain.handle('worktree:list', async (_e, args: { cwd?: string }) => {
    try {
      const cwd = args?.cwd || process.cwd()
      const res = await runGit(['worktree', 'list', '--porcelain'], cwd)
      if (res.code !== 0) return { success: false, error: res.stderr.trim() }
      return { success: true, data: parseWorktreeList(res.stdout) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'list failed' }
    }
  })

  ipcMain.handle(
    'worktree:create',
    async (_e, args: WorktreeCreateInput) => {
      const startedAt = Date.now()
      try {
        const plan = planWorktreeCreate(args)
        if (!plan.ok) {
          emitWorktreeEvent('worktree.created', {
            ok: false,
            path: typeof args?.path === 'string' ? args.path : undefined,
            branch: typeof args?.branch === 'string' ? args.branch : undefined,
            cwd: typeof args?.cwd === 'string' ? args.cwd : undefined,
            error: plan.error,
            durationMs: Date.now() - startedAt,
            rejectedAt: 'plan'
          })
          return { success: false, error: plan.error }
        }
        const res = await runGit(plan.value.gitArgs, plan.value.cwd)
        if (res.code !== 0) {
          const errText = res.stderr.trim()
          emitWorktreeEvent('worktree.created', {
            ok: false,
            path: plan.value.wtPath,
            branch: args.branch,
            cwd: plan.value.cwd,
            gitCode: res.code,
            error: errText,
            durationMs: Date.now() - startedAt
          })
          return { success: false, error: errText }
        }
        emitWorktreeEvent('worktree.created', {
          ok: true,
          path: plan.value.wtPath,
          branch: args.branch,
          cwd: plan.value.cwd,
          durationMs: Date.now() - startedAt
        })
        return { success: true, data: { path: plan.value.wtPath, branch: args.branch } }
      } catch (err: any) {
        emitWorktreeEvent('worktree.created', {
          ok: false,
          path: typeof args?.path === 'string' ? args.path : undefined,
          branch: typeof args?.branch === 'string' ? args.branch : undefined,
          cwd: typeof args?.cwd === 'string' ? args.cwd : undefined,
          error: err?.message ?? 'create failed',
          durationMs: Date.now() - startedAt,
          rejectedAt: 'throw'
        })
        return { success: false, error: err?.message ?? 'create failed' }
      }
    }
  )

  ipcMain.handle(
    'worktree:remove',
    async (_e, args: WorktreeRemoveInput) => {
      const startedAt = Date.now()
      try {
        const plan = planWorktreeRemove(args)
        if (!plan.ok) {
          emitWorktreeEvent('worktree.removed', {
            ok: false,
            path: typeof args?.path === 'string' ? args.path : undefined,
            cwd: typeof args?.cwd === 'string' ? args.cwd : undefined,
            force: !!args?.force,
            error: plan.error,
            durationMs: Date.now() - startedAt,
            rejectedAt: 'plan'
          })
          return { success: false, error: plan.error }
        }
        const res = await runGit(plan.value.gitArgs, plan.value.cwd)
        if (res.code !== 0) {
          const errText = res.stderr.trim()
          emitWorktreeEvent('worktree.removed', {
            ok: false,
            path: args.path,
            cwd: plan.value.cwd,
            force: !!args.force,
            gitCode: res.code,
            error: errText,
            durationMs: Date.now() - startedAt
          })
          return { success: false, error: errText }
        }
        emitWorktreeEvent('worktree.removed', {
          ok: true,
          path: args.path,
          cwd: plan.value.cwd,
          force: !!args.force,
          durationMs: Date.now() - startedAt
        })
        return { success: true, data: true }
      } catch (err: any) {
        emitWorktreeEvent('worktree.removed', {
          ok: false,
          path: typeof args?.path === 'string' ? args.path : undefined,
          cwd: typeof args?.cwd === 'string' ? args.cwd : undefined,
          force: !!args?.force,
          error: err?.message ?? 'remove failed',
          durationMs: Date.now() - startedAt,
          rejectedAt: 'throw'
        })
        return { success: false, error: err?.message ?? 'remove failed' }
      }
    }
  )
}

interface WorktreeEventDetail {
  ok: boolean
  path: string | undefined
  branch?: string
  cwd: string | undefined
  force?: boolean
  gitCode?: number
  error?: string
  durationMs: number
  rejectedAt?: 'plan' | 'throw'
}

function emitWorktreeEvent(
  type: 'worktree.created' | 'worktree.removed',
  detail: WorktreeEventDetail
): void {
  try {
    recordEvent({
      type,
      actorKind: 'user',
      severity: detail.ok ? 'info' : 'error',
      workspacePath: detail.cwd,
      entityKind: 'worktree',
      entityId: detail.path,
      payload: {
        ok: detail.ok,
        path: detail.path,
        branch: detail.branch,
        cwd: detail.cwd,
        force: detail.force,
        gitCode: detail.gitCode,
        durationMs: detail.durationMs,
        rejectedAt: detail.rejectedAt,
        errorPreview: boundedJsonPreview(detail.error)
      }
    })
  } catch (err) {
    console.error(`[worktree] ${type} event failed:`, err)
  }
}
