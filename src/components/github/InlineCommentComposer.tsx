import { useState } from 'react'
import { github as githubClient } from '@/lib/ipc-client'
import { toast } from '@/stores/toast-store'

// F3 — minimal "post a review with inline comments" composer.
//
// One body field for the overall review, plus a draggable list of
// inline comment rows (path / line / body). Submit calls F2's
// createPullRequestReview with the configured `event` (APPROVE,
// REQUEST_CHANGES, COMMENT). On success the composer collapses; the
// parent panel re-fetches review comments to surface the new ones.

interface Props {
  owner: string
  repo: string
  number: number
  onPosted?: () => void
}

interface DraftComment {
  id: string
  path: string
  line: string
  body: string
}

let _seq = 1
const nextDraftId = (): string => `draft-${_seq++}`

const EVENT_OPTIONS: Array<{ key: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; label: string }> = [
  { key: 'COMMENT', label: 'Comment' },
  { key: 'APPROVE', label: 'Approve' },
  { key: 'REQUEST_CHANGES', label: 'Request changes' }
]

export function InlineCommentComposer({ owner, repo, number, onPosted }: Props) {
  const [body, setBody] = useState('')
  const [event, setEvent] = useState<'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'>('COMMENT')
  const [comments, setComments] = useState<DraftComment[]>([])
  const [posting, setPosting] = useState(false)

  const addRow = () => {
    setComments((prev) => [...prev, { id: nextDraftId(), path: '', line: '', body: '' }])
  }

  const removeRow = (id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id))
  }

  const update = (id: string, patch: Partial<DraftComment>) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const canPost = body.trim().length > 0 || comments.some((c) => c.body.trim() && c.path.trim())

  const handlePost = async () => {
    if (!canPost) return
    setPosting(true)
    const payload = {
      owner,
      repo,
      number,
      body: body.trim() || undefined,
      event,
      comments: comments
        .filter((c) => c.body.trim() && c.path.trim())
        .map((c) => ({
          path: c.path.trim(),
          body: c.body.trim(),
          line: c.line.trim() ? Math.max(1, parseInt(c.line, 10)) : undefined
        }))
    }
    const res = await githubClient.createPullRequestReview(payload)
    setPosting(false)
    if (!res.success) {
      toast.error(`Post review failed: ${res.error}`)
      return
    }
    toast.success('Review posted.')
    setBody('')
    setComments([])
    onPosted?.()
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-[var(--panel-border)] bg-[var(--bg-tertiary)] p-2 text-[12px]">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          New review
        </span>
        <select
          value={event}
          onChange={(e) => setEvent(e.target.value as typeof event)}
          className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
        >
          {EVENT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Overall review summary (optional)"
        className="resize-none rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      />

      {comments.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {comments.map((c) => (
            <li key={c.id} className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-1.5">
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={c.path}
                  onChange={(e) => update(c.id, { path: e.target.value })}
                  placeholder="path/to/file.ts"
                  className="flex-1 rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-primary)]"
                />
                <input
                  type="text"
                  value={c.line}
                  onChange={(e) => update(c.id, { line: e.target.value })}
                  placeholder="line"
                  className="w-16 rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={() => removeRow(c.id)}
                  className="rounded px-1 text-[var(--text-muted)] hover:text-[var(--error)]"
                  title="Remove"
                >
                  ×
                </button>
              </div>
              <textarea
                value={c.body}
                onChange={(e) => update(c.id, { body: e.target.value })}
                rows={2}
                placeholder="Inline comment body"
                className="mt-1 w-full resize-none rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addRow}
          className="rounded px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--accent)]"
        >
          + Inline comment
        </button>
        <button
          type="button"
          onClick={handlePost}
          disabled={!canPost || posting}
          className="rounded bg-[var(--accent)] px-3 py-1 text-[11px] font-medium text-[var(--bg-primary)] disabled:opacity-50"
        >
          {posting ? 'Posting…' : 'Post review'}
        </button>
      </div>
    </div>
  )
}
