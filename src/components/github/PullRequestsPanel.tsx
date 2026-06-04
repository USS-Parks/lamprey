import { useEffect, useMemo, useState } from 'react'
import { github as githubClient } from '@/lib/ipc-client'
import { useGitHubStore } from '@/stores/github-store'
import type { GitHubPullRequest, PullRequestReviewComment } from '@/lib/github-types'
import { PRDiffView } from './PRDiffView'
import { PRStatusChecks } from './PRStatusChecks'
import { InlineCommentComposer } from './InlineCommentComposer'

type Filter = 'open' | 'drafts' | 'mine' | 'all'
const FILTERS: Filter[] = ['open', 'drafts', 'mine', 'all']

// F3 — PR browse + actions panel.
//
// Top: filter tabs (Open / Drafts / Mine / All) + repo picker.
// Body: PR list. Click a PR → expands to a detail strip showing
// diff summary, status checks (live-refresh every 15s), review
// comments, and the inline comment composer.

interface RepoCoord {
  owner: string
  repo: string
  defaultBranch?: string
}

export function PullRequestsPanel() {
  const repos = useGitHubStore((s) => s.repos)
  const refreshRepos = useGitHubStore((s) => s.refreshRepos)
  const status = useGitHubStore((s) => s.status)
  const [selectedRepo, setSelectedRepo] = useState<RepoCoord | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [prs, setPrs] = useState<GitHubPullRequest[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [openNumber, setOpenNumber] = useState<number | null>(null)
  const [comments, setComments] = useState<PullRequestReviewComment[]>([])

  // Load repos once on mount.
  useEffect(() => {
    void refreshRepos()
  }, [refreshRepos])

  // Default-select the first repo whenever the list loads.
  useEffect(() => {
    if (!selectedRepo && repos.length > 0) {
      setSelectedRepo({ owner: repos[0].owner, repo: repos[0].name, defaultBranch: repos[0].defaultBranch })
    }
  }, [repos, selectedRepo])

  // (Re)fetch PR list when repo or filter changes.
  useEffect(() => {
    if (!selectedRepo) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const state = filter === 'all' ? 'all' : 'open'
    void githubClient
      .pullRequests(selectedRepo.owner, selectedRepo.repo, { state, per_page: 50 })
      .then((res) => {
        if (cancelled) return
        if (!res.success) {
          setPrs([])
          setError(res.error)
          return
        }
        let next = res.data
        if (filter === 'drafts') next = next.filter((p) => p.draft)
        if (filter === 'mine' && status?.login) {
          next = next.filter((p) => p.user.login === status.login)
        }
        setPrs(next)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedRepo, filter, status?.login])

  // Load review comments when a PR is opened in the detail strip.
  useEffect(() => {
    if (!selectedRepo || openNumber === null) {
      setComments([])
      return
    }
    let cancelled = false
    void githubClient
      .listPullRequestReviewComments(selectedRepo.owner, selectedRepo.repo, openNumber)
      .then((res) => {
        if (cancelled) return
        if (res.success) setComments(res.data)
      })
    return () => {
      cancelled = true
    }
  }, [selectedRepo, openNumber])

  const openPr = useMemo(() => prs.find((p) => p.number === openNumber) ?? null, [prs, openNumber])

  if (!status?.connected) {
    return (
      <div className="p-3 text-[12px] text-[var(--text-muted)]">
        Connect GitHub from Settings to browse pull requests.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2 text-[12px] text-[var(--text-primary)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Pull requests
        </span>
        <select
          value={selectedRepo ? `${selectedRepo.owner}/${selectedRepo.repo}` : ''}
          onChange={(e) => {
            const [owner, repo] = e.target.value.split('/')
            const found = repos.find((r) => r.owner === owner && r.name === repo)
            setSelectedRepo(found ? { owner: found.owner, repo: found.name, defaultBranch: found.defaultBranch } : null)
            setOpenNumber(null)
          }}
          className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
        >
          {repos.map((r) => (
            <option key={r.fullName} value={`${r.owner}/${r.name}`}>
              {r.fullName}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                filter === f
                  ? 'bg-[var(--accent)] text-[var(--bg-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {error && <p className="text-[11px] text-[var(--error)]">{error}</p>}
        {loading && <p className="text-[11px] text-[var(--text-muted)]">Loading…</p>}
        {!loading && prs.length === 0 && !error && (
          <p className="text-[11px] text-[var(--text-muted)]">No PRs match this filter.</p>
        )}
        {prs.map((pr) => (
          <div
            key={pr.number}
            className="rounded border border-[var(--border)] bg-[var(--bg-secondary)]"
          >
            <button
              type="button"
              onClick={() => setOpenNumber((curr) => (curr === pr.number ? null : pr.number))}
              className="block w-full px-2 py-1.5 text-left hover:bg-[var(--bg-tertiary)]"
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--text-muted)]">#{pr.number}</span>
                {pr.draft && (
                  <span className="rounded border border-[var(--border)] bg-[var(--bg-tertiary)] px-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    draft
                  </span>
                )}
                {pr.merged && (
                  <span className="rounded border border-violet-900/50 px-1 text-[10px] uppercase tracking-wider text-violet-300">
                    merged
                  </span>
                )}
                {!pr.merged && pr.state === 'closed' && (
                  <span className="rounded border border-red-900/50 px-1 text-[10px] uppercase tracking-wider text-red-300">
                    closed
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-primary)]" title={pr.title}>
                  {pr.title}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">{pr.user.login}</span>
              </div>
            </button>

            {openNumber === pr.number && selectedRepo && (
              <div className="border-t border-[var(--border)] bg-[var(--bg-primary)]">
                <div className="flex items-center justify-between border-b border-[var(--border)] px-2 py-1">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    Detail
                  </span>
                  <button
                    type="button"
                    onClick={() => githubClient.openInBrowser(pr.htmlUrl)}
                    className="rounded px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--accent)]"
                  >
                    Browse on GitHub ↗
                  </button>
                </div>
                <PRStatusChecks owner={selectedRepo.owner} repo={selectedRepo.repo} number={pr.number} />
                <PRDiffView owner={selectedRepo.owner} repo={selectedRepo.repo} pr={pr} />
                {comments.length > 0 && (
                  <div className="px-2 py-2 text-[11px]">
                    <span className="block uppercase tracking-wider text-[var(--text-muted)]">
                      Review comments ({comments.length})
                    </span>
                    <ul className="mt-1 flex flex-col gap-1">
                      {comments.map((c) => (
                        <li
                          key={c.id}
                          className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] p-1.5"
                        >
                          <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                            <span className="font-mono">
                              {c.path}
                              {c.line ? `:${c.line}` : ''}
                            </span>
                            <span>· {c.user.login}</span>
                            {c.inReplyToId && <span>· reply</span>}
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-[12px] text-[var(--text-primary)]">{c.body}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="border-t border-[var(--border)] px-2 py-2">
                  <InlineCommentComposer
                    owner={selectedRepo.owner}
                    repo={selectedRepo.repo}
                    number={pr.number}
                    onPosted={() => {
                      void githubClient
                        .listPullRequestReviewComments(selectedRepo.owner, selectedRepo.repo, pr.number)
                        .then((res) => {
                          if (res.success) setComments(res.data)
                        })
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
