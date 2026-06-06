import { useEffect, useState } from 'react'
import { github as githubClient } from '@/lib/ipc-client'
import type { PullRequestStatusSummary } from '@/lib/github-types'

const STATE_TONES: Record<string, string> = {
  success: 'text-emerald-300 border-emerald-900/50',
  pending: 'text-amber-300 border-amber-900/50',
  failure: 'text-red-300 border-red-900/50',
  error: 'text-red-300 border-red-900/50',
  timed_out: 'text-red-300 border-red-900/50',
  action_required: 'text-amber-300 border-amber-900/50',
  neutral: 'text-[var(--text-muted)] border-[var(--panel-border)]',
  skipped: 'text-[var(--text-muted)] border-[var(--panel-border)]',
  cancelled: 'text-[var(--text-muted)] border-[var(--panel-border)]'
}

// F3 — status checks rollup for a PR. Auto-refreshes every 15s while
// the panel is mounted so the user sees green ticks land as CI
// finishes. Backs onto github:getPullRequestStatus which fans the
// legacy commit-status + modern check-runs APIs into one shape.

interface Props {
  owner: string
  repo: string
  number: number
}

export function PRStatusChecks({ owner, repo, number }: Props) {
  const [summary, setSummary] = useState<PullRequestStatusSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: number | null = null

    const refresh = async () => {
      setLoading(true)
      const res = await githubClient.getPullRequestStatus(owner, repo, number)
      if (cancelled) return
      if (res.success) {
        setSummary(res.data)
        setError(null)
      } else {
        setError(res.error)
      }
      setLoading(false)
    }

    void refresh()
    timer = window.setInterval(refresh, 15_000)
    return () => {
      cancelled = true
      if (timer !== null) window.clearInterval(timer)
    }
  }, [owner, repo, number])

  if (error) {
    return <p className="px-2 py-1 text-[11px] text-[var(--error)]">{error}</p>
  }
  if (!summary) {
    return <p className="px-2 py-1 text-[11px] text-[var(--text-muted)]">Loading checks…</p>
  }
  if (summary.checks.length === 0) {
    return <p className="px-2 py-1 text-[11px] text-[var(--text-muted)]">No status checks yet.</p>
  }

  return (
    <div className="flex flex-col gap-1 px-2 py-1">
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
        <span className="uppercase tracking-wider">Overall</span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATE_TONES[summary.overall] ?? STATE_TONES.neutral}`}>
          {summary.overall}
        </span>
        {loading && <span className="text-[10px]">refreshing…</span>}
      </div>
      <ul className="flex flex-col gap-0.5">
        {summary.checks.map((c) => (
          <li
            key={`${c.source}:${c.context}`}
            className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-[var(--bg-tertiary)]"
          >
            <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]" title={c.description ?? c.context}>
              {c.context}
            </span>
            <span className={`shrink-0 rounded border px-1 text-[10px] uppercase tracking-wider ${STATE_TONES[c.state] ?? STATE_TONES.neutral}`}>
              {c.state}
            </span>
            {c.targetUrl && (
              <button
                type="button"
                onClick={() => githubClient.openInBrowser(c.targetUrl ?? '')}
                className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--accent)]"
                title="Open check details"
              >
                ↗
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
