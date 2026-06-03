import { useEffect, useMemo, useState } from 'react'
import { toast } from '@/stores/toast-store'
import { useGitHubStore } from '@/stores/github-store'
import { github as githubClient } from '@/lib/ipc-client'
import type { GitHubRepository } from '@/lib/github-types'

interface RepositoryPickerDialogProps {
  open: boolean
  onClose: () => void
  /** When provided, the chosen repo is associated with this project. */
  projectId?: string | null
  /** Notified after a successful clone/open with the repo + chosen local path. */
  onSelected?: (info: { repo: GitHubRepository; localPath: string }) => void
}

export function RepositoryPickerDialog({
  open,
  onClose,
  projectId,
  onSelected
}: RepositoryPickerDialogProps): React.ReactElement | null {
  const { status, repos, loadingRepos, reposError, refreshStatus, refreshRepos } = useGitHubStore()
  const [filter, setFilter] = useState('')
  const [ownerFilter, setOwnerFilter] = useState<string>('all')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void refreshStatus().then(() => {
      const s = useGitHubStore.getState().status
      if (s?.connected) void refreshRepos()
    })
  }, [open, refreshStatus, refreshRepos])

  const owners = useMemo(() => {
    const set = new Set<string>()
    for (const r of repos) set.add(r.owner)
    return Array.from(set).sort()
  }, [repos])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return repos.filter((r) => {
      if (ownerFilter !== 'all' && r.owner !== ownerFilter) return false
      if (!q) return true
      return (
        r.fullName.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q)
      )
    })
  }, [repos, filter, ownerFilter])

  if (!open) return null

  const handleClone = async (repo: GitHubRepository) => {
    const dirRes = await githubClient.pickCloneDir()
    if (!dirRes.success || !dirRes.data) {
      // User cancelled (data=null) or error — only toast on error.
      if (!dirRes.success) toast.error(`Folder pick failed: ${dirRes.error}`)
      return
    }
    const baseDir = dirRes.data
    // Phase 3d: main-side path resolution (Node path.join) instead of
    // sniffing the separator from the chosen baseDir. Removes the
    // platform-guessing branch that broke on UNC paths.
    const targetRes = await githubClient.resolveCloneTarget(baseDir, repo.name)
    if (!targetRes.success) {
      toast.error(`Could not resolve clone target: ${targetRes.error}`)
      return
    }
    const targetDir = targetRes.data.targetPath
    setBusy(repo.fullName)
    try {
      toast.info(`Cloning ${repo.fullName}…`)
      const cloneRes = await githubClient.clone(repo.owner, repo.name, targetDir)
      if (!cloneRes.success) {
        toast.error(`Clone failed: ${cloneRes.error}`)
        return
      }
      toast.success(`Cloned to ${cloneRes.data.localPath}`)
      if (projectId) {
        const link = await githubClient.assignRepoToProject(
          projectId,
          repo.owner,
          repo.name,
          cloneRes.data.localPath
        )
        if (!link.success) {
          toast.warning(`Cloned, but could not link to project: ${link.error}`)
        }
      }
      // Phase 2c: switch the active workspace to the clone path so the next
      // local git operation (status, branch picker, diff) targets the
      // freshly-cloned repo, not whatever cwd the user had before. The
      // confirm dialog keeps it opt-in; without it we'd surprise users
      // who cloned a repo but wanted to keep their current workspace.
      if (window.api?.files?.setWorkdir) {
        const ok = window.confirm(
          `Switch workspace to ${cloneRes.data.localPath}? Local git operations will target the cloned repo.`
        )
        if (ok) {
          const setRes = await window.api.files.setWorkdir(cloneRes.data.localPath)
          if (!setRes?.success) {
            toast.warning(`Workspace switch failed: ${setRes?.error ?? 'unknown'}`)
          }
        }
      }
      onSelected?.({ repo, localPath: cloneRes.data.localPath })
      onClose()
    } finally {
      setBusy(null)
    }
  }

  const handleOpenExisting = async (repo: GitHubRepository) => {
    if (!repo.localPath) return
    if (projectId) {
      setBusy(repo.fullName)
      const link = await githubClient.assignRepoToProject(
        projectId,
        repo.owner,
        repo.name,
        repo.localPath
      )
      setBusy(null)
      if (!link.success) {
        toast.error(`Link failed: ${link.error}`)
        return
      }
    }
    onSelected?.({ repo, localPath: repo.localPath })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[560px] w-[640px] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl"
      >
        <div className="flex h-10 items-center justify-between border-b border-[var(--border)] px-4">
          <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
            Choose a GitHub repository
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!status?.connected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <span className="font-mono text-[12px] text-[var(--text-muted)]">
              GitHub is not connected.
            </span>
            <span className="max-w-md text-[12px] text-[var(--text-muted)]">
              Open Settings → GitHub to connect via OAuth or use the local `gh` CLI.
              {status?.reason ? ` (${status.reason})` : ''}
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search repos by name or description"
                autoFocus
                className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              >
                <option value="all">All owners</option>
                {owners.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void refreshRepos()}
                disabled={loadingRepos}
                className="rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
              >
                {loadingRepos ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {reposError && (
                <div className="px-3 py-2 text-[12px] text-[var(--error)]">{reposError}</div>
              )}
              {!reposError && !loadingRepos && filtered.length === 0 && (
                <div className="px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">
                  {repos.length === 0 ? 'No repositories visible to this token.' : 'No matches.'}
                </div>
              )}
              {filtered.map((repo) => (
                <RepoRow
                  key={repo.id}
                  repo={repo}
                  busy={busy === repo.fullName}
                  onClone={() => void handleClone(repo)}
                  onOpen={() => void handleOpenExisting(repo)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

interface RepoRowProps {
  repo: GitHubRepository
  busy: boolean
  onClone: () => void
  onOpen: () => void
}

function RepoRow({ repo, busy, onClone, onOpen }: RepoRowProps): React.ReactElement {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] px-3 py-2 hover:bg-[var(--bg-tertiary)]/50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-[12px] text-[var(--text-primary)]">
            {repo.fullName}
          </span>
          <span
            className={`rounded px-1 py-0.5 font-mono text-[10px] uppercase ${
              repo.private
                ? 'bg-[var(--warning)]/15 text-[var(--warning)]'
                : 'bg-[var(--text-muted)]/15 text-[var(--text-muted)]'
            }`}
          >
            {repo.private ? 'private' : 'public'}
          </span>
          {repo.localPath && (
            <span className="rounded bg-[var(--success)]/15 px-1 py-0.5 font-mono text-[10px] uppercase text-[var(--success)]">
              cloned
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
          {repo.description ?? '—'} <span className="ml-2 font-mono">default: {repo.defaultBranch}</span>
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        {repo.localPath && (
          <button
            type="button"
            onClick={onOpen}
            disabled={busy}
            className="rounded border border-[var(--border)] bg-transparent px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            Open
          </button>
        )}
        <button
          type="button"
          onClick={onClone}
          disabled={busy}
          className="rounded bg-[var(--accent)] px-2 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Working…' : repo.localPath ? 'Clone again' : 'Clone'}
        </button>
      </div>
    </div>
  )
}
