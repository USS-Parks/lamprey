import { join, isAbsolute } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { runGit as defaultRunGit, type GitResult } from './git-runner'

// Per-subagent worktree manager. forkAgent calls `create(runId)` before the
// runner is invoked; the resulting `WorktreeContext.path` is passed to the
// runner so shell/edit tools can scope to the isolated tree. After the
// runner settles (success, error, or abort), forkAgent calls `finalize(ctx)`.
// Finalize is policy: if `git status --porcelain` is empty, the worktree is
// removed and the dedicated branch deleted; if anything changed, the
// worktree is preserved and `{ keep: true, path, branch }` is returned so
// the agent_runs row carries the artifact forward.

export interface WorktreeContext {
  /** Absolute path to the created worktree. */
  path: string
  /** Branch name created for this run. */
  branch: string
}

export interface FinalizeResult {
  keep: boolean
  hasChanges: boolean
  path: string
  branch: string
  /** When `keep === false`, set only if the remove succeeded. */
  removed: boolean
  /** Non-fatal error from a failed remove/branch-delete (we still return successfully). */
  warning?: string
}

export interface WorktreeManager {
  create(runId: string): Promise<WorktreeContext>
  finalize(ctx: WorktreeContext): Promise<FinalizeResult>
}

export interface AgentWorktreeManagerOptions {
  /** Repo to fork the worktree FROM. Required. */
  baseCwd: string
  /** Filesystem dir to spawn worktrees under. Required. */
  workspacesRoot: string
  /** Optional ref to base each worktree on. Defaults to HEAD. */
  baseRef?: string
  /** Test seam — defaults to git-runner.runGit. */
  runGit?: typeof defaultRunGit
}

// ---------------------------------------------------------------------------
// Pure helpers (tested directly)
// ---------------------------------------------------------------------------

/**
 * Branch name for a given run. Conservative grammar so it survives every
 * git ref-name check in the codebase (see `isValidRefName` in worktree.ts).
 */
export function branchNameForRun(runId: string): string {
  // Strip any character that isn't allowed in refnames; runId is a UUID so
  // this is a no-op in practice but is a belt-and-braces guard.
  const safe = runId.replace(/[^A-Za-z0-9._-]/g, '')
  return `lamprey-agent/${safe}`
}

/**
 * Default worktree path for a given run. Always returned as an absolute
 * path under the manager's workspacesRoot.
 */
export function worktreePathForRun(workspacesRoot: string, runId: string): string {
  const safe = runId.replace(/[^A-Za-z0-9._-]/g, '')
  return join(workspacesRoot, safe)
}

/**
 * `true` when `git status --porcelain` output indicates ANY change (modified,
 * added, deleted, untracked). Empty stdout → no changes. Whitespace-only is
 * treated as no changes (e.g. trailing newline from git).
 */
export function hasUncommittedChanges(porcelainStdout: string): boolean {
  return porcelainStdout.trim().length > 0
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAgentWorktreeManager(opts: AgentWorktreeManagerOptions): WorktreeManager {
  const runGit = opts.runGit ?? defaultRunGit
  const baseCwd = opts.baseCwd
  const workspacesRoot = opts.workspacesRoot
  const baseRef = opts.baseRef
  if (!baseCwd) throw new Error('createAgentWorktreeManager: baseCwd is required')
  if (!workspacesRoot) throw new Error('createAgentWorktreeManager: workspacesRoot is required')
  if (!isAbsolute(workspacesRoot)) {
    throw new Error('createAgentWorktreeManager: workspacesRoot must be absolute')
  }

  // Ensure the workspaces dir exists. Best-effort — git worktree add will
  // create the per-run dir itself; we just need the parent.
  try {
    if (!existsSync(workspacesRoot)) mkdirSync(workspacesRoot, { recursive: true })
  } catch (err) {
    console.warn('[worktree-runner] failed to pre-create workspacesRoot (continuing):', err)
  }

  async function create(runId: string): Promise<WorktreeContext> {
    if (!runId) throw new Error('worktree create: runId required')
    const branch = branchNameForRun(runId)
    const path = worktreePathForRun(workspacesRoot, runId)
    // `--` ends option parsing so a hostile path can't smuggle a flag.
    const args = ['worktree', 'add', '-b', branch, '--', path]
    if (baseRef) args.push(baseRef)
    const res = await runGit(args, baseCwd)
    if (res.code !== 0) {
      throw new Error(
        `worktree create failed (code ${res.code}): ${res.stderr.trim() || res.stdout.trim() || 'unknown error'}`
      )
    }
    return { path, branch }
  }

  async function finalize(ctx: WorktreeContext): Promise<FinalizeResult> {
    const status = await runGit(['status', '--porcelain'], ctx.path).catch(
      (err): GitResult => ({
        stdout: '',
        stderr: String(err),
        code: -1
      })
    )
    if (status.code !== 0) {
      // Couldn't inspect the worktree — preserve it. The user can decide
      // what to do; we surface the stderr as a warning.
      return {
        keep: true,
        hasChanges: false,
        path: ctx.path,
        branch: ctx.branch,
        removed: false,
        warning: `git status failed (code ${status.code}): ${status.stderr.trim()}`
      }
    }
    const changed = hasUncommittedChanges(status.stdout)
    if (changed) {
      return {
        keep: true,
        hasChanges: true,
        path: ctx.path,
        branch: ctx.branch,
        removed: false
      }
    }
    // No changes — remove worktree + dedicated branch.
    const removeRes = await runGit(['worktree', 'remove', '--force', '--', ctx.path], baseCwd)
    if (removeRes.code !== 0) {
      return {
        keep: true,
        hasChanges: false,
        path: ctx.path,
        branch: ctx.branch,
        removed: false,
        warning: `worktree remove failed (code ${removeRes.code}): ${removeRes.stderr.trim()}`
      }
    }
    const branchDel = await runGit(['branch', '-D', '--', ctx.branch], baseCwd)
    if (branchDel.code !== 0) {
      // Worktree gone but branch lingered — non-fatal. Return as removed
      // since the workspace IS gone; surface the branch-leak via warning.
      return {
        keep: false,
        hasChanges: false,
        path: ctx.path,
        branch: ctx.branch,
        removed: true,
        warning: `branch delete failed (code ${branchDel.code}): ${branchDel.stderr.trim()}`
      }
    }
    return {
      keep: false,
      hasChanges: false,
      path: ctx.path,
      branch: ctx.branch,
      removed: true
    }
  }

  return { create, finalize }
}
