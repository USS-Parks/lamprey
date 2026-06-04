import { useEffect, useState } from 'react'
import { github as githubClient } from '@/lib/ipc-client'
import type { GitHubCompareSummary, GitHubPullRequest } from '@/lib/github-types'

// F3 — minimal PR diff view: file list with +/− counts + commit summary.
// Reuses the existing `compare(owner, repo, base, head)` IPC instead of
// fetching `/pulls/{n}/files` so we don't widen the API surface. The
// commit list doubles as the PR summary header.

interface Props {
  owner: string
  repo: string
  pr: GitHubPullRequest
}

export function PRDiffView({ owner, repo, pr }: Props) {
  const [data, setData] = useState<GitHubCompareSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    // PR head label is `owner:branch`; compare expects bare base/head SHA or branch.
    const head = pr.head.ref
    const base = pr.base.ref
    void githubClient.compare(owner, repo, base, head).then((res) => {
      if (cancelled) return
      if (res.success) setData(res.data)
      else setError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [owner, repo, pr.head.ref, pr.base.ref])

  if (error) return <p className="px-2 py-2 text-[11px] text-[var(--error)]">{error}</p>
  if (!data) return <p className="px-2 py-2 text-[11px] text-[var(--text-muted)]">Loading diff…</p>

  return (
    <div className="flex flex-col gap-2 px-2 py-2 text-[11px]">
      <div className="flex items-center gap-2 text-[var(--text-muted)]">
        <span className="uppercase tracking-wider">{data.status}</span>
        <span>
          {data.aheadBy} ahead · {data.behindBy} behind
        </span>
      </div>

      <div>
        <span className="block uppercase tracking-wider text-[var(--text-muted)]">
          Commits ({data.commits.length})
        </span>
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {data.commits.slice(0, 20).map((c) => (
            <li key={c.sha} className="truncate text-[var(--text-secondary)]" title={c.message}>
              <code className="mr-1 font-mono text-[var(--text-muted)]">{c.sha.slice(0, 7)}</code>
              {c.message.split('\n')[0]}
              {c.author && (
                <span className="ml-1 text-[var(--text-muted)]"> — {c.author}</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <span className="block uppercase tracking-wider text-[var(--text-muted)]">
          Files ({data.files.length})
        </span>
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {data.files.map((f) => (
            <li
              key={f.filename}
              className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-[var(--bg-tertiary)]"
            >
              <span className="rounded bg-[var(--bg-tertiary)] px-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                {f.status}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[var(--text-primary)]" title={f.filename}>
                {f.filename}
              </span>
              <span className="shrink-0 text-emerald-300">+{f.additions}</span>
              <span className="shrink-0 text-red-300">−{f.deletions}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
