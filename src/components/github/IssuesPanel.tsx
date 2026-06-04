import { useEffect, useState } from 'react'
import { github as githubClient } from '@/lib/ipc-client'
import { useGitHubStore } from '@/stores/github-store'
import type { GitHubIssue } from '@/lib/github-types'

// F3 — minimal issues browse panel. Mirrors the PR panel layout
// (repo picker + state filter + list) but doesn't include the per-row
// expanding detail — issues open in github.com via the row's link.

interface RepoCoord {
  owner: string
  repo: string
}

export function IssuesPanel() {
  const repos = useGitHubStore((s) => s.repos)
  const status = useGitHubStore((s) => s.status)
  const [selectedRepo, setSelectedRepo] = useState<RepoCoord | null>(null)
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open')
  const [issues, setIssues] = useState<GitHubIssue[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedRepo && repos.length > 0) {
      setSelectedRepo({ owner: repos[0].owner, repo: repos[0].name })
    }
  }, [repos, selectedRepo])

  useEffect(() => {
    if (!selectedRepo) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void githubClient
      .listIssues(selectedRepo.owner, selectedRepo.repo, { state, per_page: 50 })
      .then((res) => {
        if (cancelled) return
        if (res.success) setIssues(res.data)
        else {
          setIssues([])
          setError(res.error)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedRepo, state])

  if (!status?.connected) {
    return (
      <div className="p-3 text-[12px] text-[var(--text-muted)]">
        Connect GitHub from Settings to browse issues.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Issues
        </span>
        <select
          value={selectedRepo ? `${selectedRepo.owner}/${selectedRepo.repo}` : ''}
          onChange={(e) => {
            const [owner, repo] = e.target.value.split('/')
            const found = repos.find((r) => r.owner === owner && r.name === repo)
            setSelectedRepo(found ? { owner: found.owner, repo: found.name } : null)
          }}
          className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
        >
          {repos.map((r) => (
            <option key={r.fullName} value={`${r.owner}/${r.name}`}>
              {r.fullName}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          {(['open', 'closed', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setState(s)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                state === s
                  ? 'bg-[var(--accent)] text-[var(--bg-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {error && <p className="text-[11px] text-[var(--error)]">{error}</p>}
        {loading && <p className="text-[11px] text-[var(--text-muted)]">Loading…</p>}
        {!loading && issues.length === 0 && !error && (
          <p className="text-[11px] text-[var(--text-muted)]">No issues match.</p>
        )}
        {issues.map((issue) => (
          <div
            key={issue.number}
            className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 hover:bg-[var(--bg-tertiary)]"
          >
            <span className="text-[11px] text-[var(--text-muted)]">#{issue.number}</span>
            <span className={`rounded border px-1 text-[10px] uppercase tracking-wider ${
              issue.state === 'open'
                ? 'border-emerald-900/50 text-emerald-300'
                : 'border-[var(--border)] text-[var(--text-muted)]'
            }`}>
              {issue.state}
            </span>
            <button
              type="button"
              onClick={() => githubClient.openInBrowser(issue.htmlUrl)}
              className="min-w-0 flex-1 truncate text-left font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
              title={issue.title}
            >
              {issue.title}
            </button>
            {issue.labels.length > 0 && (
              <div className="flex shrink-0 gap-1">
                {issue.labels.slice(0, 3).map((l) => (
                  <span
                    key={l.name}
                    className="rounded border border-[var(--border)] px-1 text-[10px] text-[var(--text-secondary)]"
                    style={{ borderColor: `#${l.color}50` }}
                    title={l.name}
                  >
                    {l.name}
                  </span>
                ))}
              </div>
            )}
            <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
              {issue.user.login}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
