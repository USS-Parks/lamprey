import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/stores/toast-store'
import { useUiStore } from '@/stores/ui-store'
import { github as githubClient } from '@/lib/ipc-client'
import type {
  GitHubCompareSummary,
  GitHubProjectRepoLink,
  GitHubPullRequest
} from '@/lib/github-types'

/** Phase 3c: pure helper. Does the push-failure hint match the auth-error
 * shape we want to offer a Reconnect button for? */
function looksLikeAuthFailure(hint: string | undefined): boolean {
  if (!hint) return false
  return /credentials|reconnect|authentication|403|401/i.test(hint)
}

interface PullRequestDialogProps {
  open: boolean
  onClose: () => void
  /** Repo association — required. Caller should not open this without one. */
  repoLink: GitHubProjectRepoLink
  /** Current local branch — used as the PR head. */
  headBranch: string
  /** Local cwd to push from. Required when the local branch isn't on origin yet. */
  cwd: string
  /** Optional conversation id to link the PR to. */
  conversationId?: string
  /** Called with the created PR after success so callers can react. */
  onCreated?: (pr: GitHubPullRequest) => void
}

export function PullRequestDialog({
  open,
  onClose,
  repoLink,
  headBranch,
  cwd,
  conversationId,
  onCreated
}: PullRequestDialogProps): React.ReactElement | null {
  const [base, setBase] = useState(repoLink.defaultBranch)
  const [title, setTitle] = useState(headBranch)
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)
  const [compare, setCompare] = useState<GitHubCompareSummary | null>(null)
  const [comparing, setComparing] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)

  const runCompare = useCallback(
    async (baseRef: string) => {
      setComparing(true)
      setCompareError(null)
      try {
        const res = await githubClient.compare(repoLink.owner, repoLink.name, baseRef, headBranch)
        if (!res.success) {
          setCompareError(res.error)
          setCompare(null)
          return
        }
        setCompare(res.data)
      } finally {
        setComparing(false)
      }
    },
    [repoLink.owner, repoLink.name, headBranch]
  )

  useEffect(() => {
    if (!open) return
    setBase(repoLink.defaultBranch)
    setTitle(headBranch)
    setBody('')
    setDraft(false)
    setCompare(null)
    setCompareError(null)
    void runCompare(repoLink.defaultBranch)
  }, [open, repoLink, headBranch, runCompare])

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.warning('PR title is required.')
      return
    }
    if (!base.trim()) {
      toast.warning('Base branch is required.')
      return
    }
    setSubmitting(true)
    setPushError(null)
    try {
      // Push the branch first. If origin/<branch> already exists and is in
      // sync, the push is a no-op; otherwise it's an upstream creation. The
      // service handles both cases.
      const push = await githubClient.pushBranch({
        cwd,
        branch: headBranch,
        owner: repoLink.owner,
        repo: repoLink.name,
        setUpstream: true
      })
      if (!push.success) {
        setPushError(push.error)
        return
      }
      if (!push.data.pushed) {
        setPushError(
          push.data.authHint ?? 'Push did not complete — see Settings → GitHub for credential status.'
        )
        return
      }

      const created = await githubClient.createPullRequest({
        owner: repoLink.owner,
        repo: repoLink.name,
        title: title.trim(),
        body: body.trim() || undefined,
        head: headBranch,
        base: base.trim(),
        draft,
        conversationId
      })
      if (!created.success) {
        toast.error(`PR creation failed: ${created.error}`)
        return
      }
      toast.success(`PR #${created.data.number} created`)
      onCreated?.(created.data)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const handleOpenInBrowser = (url: string) => {
    void githubClient.openInBrowser(url)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[600px] w-[640px] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl"
      >
        <div className="flex h-10 items-center justify-between border-b border-[var(--border)] px-4">
          <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
            New pull request — {repoLink.fullName}
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

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                Base
              </label>
              <input
                type="text"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                onBlur={() => void runCompare(base)}
                className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label className="block font-mono text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                Head
              </label>
              <input
                type="text"
                value={headBranch}
                readOnly
                className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-muted)]"
              />
            </div>
          </div>

          <CompareSummary compare={compare} loading={comparing} error={compareError} />

          <div>
            <label className="block font-mono text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div>
            <label className="block font-mono text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              Body (markdown)
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </div>

          <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={draft}
              onChange={(e) => setDraft(e.target.checked)}
            />
            Open as draft
          </label>
        </div>

        {pushError && (
          <div className="border-t border-[var(--error)]/40 bg-[var(--error)]/10 px-4 py-2 text-[12px] text-[var(--error)]">
            <div className="flex items-start gap-3">
              <div className="flex-1">{pushError}</div>
              {looksLikeAuthFailure(pushError) && (
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    useUiStore.getState().openSettings('github')
                  }}
                  className="shrink-0 rounded border border-[var(--error)]/40 bg-[var(--bg-secondary)] px-2 py-1 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                >
                  Reconnect GitHub
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2">
          <button
            type="button"
            onClick={() => handleOpenInBrowser(repoLink.htmlUrl)}
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Open repo in browser →
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || !title.trim()}
              className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {submitting ? 'Creating…' : draft ? 'Push & open draft PR' : 'Push & open PR'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface CompareSummaryProps {
  compare: GitHubCompareSummary | null
  loading: boolean
  error: string | null
}

function CompareSummary({ compare, loading, error }: CompareSummaryProps): React.ReactElement {
  if (loading) {
    return (
      <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-2 text-[12px] text-[var(--text-muted)]">
        Comparing…
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-2 text-[12px] text-[var(--warning)]">
        Compare failed: {error}
      </div>
    )
  }
  if (!compare) return <></>
  const totals = compare.files.reduce(
    (acc, f) => ({ a: acc.a + f.additions, d: acc.d + f.deletions }),
    { a: 0, d: 0 }
  )
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-2 text-[12px]">
      <div className="flex items-center gap-3 font-mono">
        <span className="text-[var(--text-secondary)]">{compare.status}</span>
        <span className="text-[var(--text-muted)]">
          ↑{compare.aheadBy} ↓{compare.behindBy}
        </span>
        <span className="text-[var(--text-muted)]">
          {compare.files.length} files
        </span>
        <span>
          <span className="text-green-500">+{totals.a}</span>{' '}
          <span className="text-red-500">-{totals.d}</span>
        </span>
      </div>
    </div>
  )
}
