import { useEffect, useState } from 'react'
import { PopoverMenu } from '@/components/ui/PopoverMenu'
import { MenuSectionLabel } from '@/components/ui/MenuRow'
import { toast } from '@/stores/toast-store'
import { github as githubClient } from '@/lib/ipc-client'
import type { GitHubProjectRepoLink, GitHubPullRequest } from '@/lib/github-types'

interface PullRequestListPopoverProps {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
  repoLink: GitHubProjectRepoLink
}

export function PullRequestListPopover({
  open,
  onClose,
  anchorRef,
  repoLink
}: PullRequestListPopoverProps): React.ReactElement {
  const [prs, setPrs] = useState<GitHubPullRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>('open')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    void githubClient
      .pullRequests(repoLink.owner, repoLink.name, { state: filter, per_page: 30 })
      .then((res) => {
        setLoading(false)
        if (!res.success) {
          toast.error(`List PRs failed: ${res.error}`)
          return
        }
        setPrs(res.data)
      })
  }, [open, filter, repoLink])

  const handleOpen = (url: string) => {
    void githubClient.openInBrowser(url)
  }

  const handleCopy = async (url: string) => {
    try {
      await window.api?.clipboard?.writeText(url)
      toast.success('PR URL copied')
    } catch {
      toast.error('Copy failed')
    }
  }

  return (
    <PopoverMenu
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      align="bottom-start"
      width={420}
      role="dialog"
      ariaLabel="Pull requests"
      autoFocus={false}
    >
      <div className="flex items-center gap-1 border-b border-[var(--panel-border)] px-2 py-1.5">
        {(['open', 'closed', 'all'] as const).map((state) => (
          <button
            key={state}
            type="button"
            onClick={() => setFilter(state)}
            className={`rounded px-2 py-1 text-[11px] capitalize ${
              filter === state
                ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {state}
          </button>
        ))}
      </div>
      <MenuSectionLabel>{repoLink.fullName}</MenuSectionLabel>
      <div className="max-h-[320px] overflow-y-auto">
        {loading && (
          <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">Loading…</div>
        )}
        {!loading && prs.length === 0 && (
          <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">No PRs</div>
        )}
        {prs.map((pr) => {
          const status = pr.merged
            ? { label: 'merged', cls: 'bg-purple-500/15 text-purple-300' }
            : pr.state === 'closed'
              ? { label: 'closed', cls: 'bg-[var(--error)]/15 text-[var(--error)]' }
              : pr.draft
                ? { label: 'draft', cls: 'bg-[var(--text-muted)]/15 text-[var(--text-muted)]' }
                : { label: 'open', cls: 'bg-[var(--success)]/15 text-[var(--success)]' }
          return (
            <div
              key={pr.number}
              className="flex items-start gap-2 border-b border-[var(--panel-border)] px-3 py-2 hover:bg-[var(--bg-tertiary)]/50"
            >
              <span
                className={`mt-0.5 shrink-0 rounded px-1 py-0.5 font-mono text-[10px] uppercase ${status.cls}`}
              >
                {status.label}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-[var(--text-primary)]">
                  #{pr.number} {pr.title}
                </div>
                <div className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                  {pr.head.ref} → {pr.base.ref} · @{pr.user.login}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => handleOpen(pr.htmlUrl)}
                  className="rounded border border-[var(--panel-border)] bg-transparent px-2 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopy(pr.htmlUrl)}
                  className="rounded border border-[var(--panel-border)] bg-transparent px-2 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                >
                  Copy
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </PopoverMenu>
  )
}
