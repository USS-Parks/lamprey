import type { ReactElement } from 'react'
import type { SessionEntry } from '@/stores/sessions-store'

interface SessionDetailPaneProps {
  session: SessionEntry | null
  unreadCount: number
  onResume: (id: string) => void
  onDuplicate: (id: string) => void
  onArchive: (id: string, archived: boolean) => void
}

function fullWhen(ts: number): string {
  return new Date(ts).toLocaleString()
}

export function SessionDetailPane({
  session,
  unreadCount,
  onResume,
  onDuplicate,
  onArchive
}: SessionDetailPaneProps): ReactElement {
  if (!session) {
    return (
      <div className="border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
        No session selected.
      </div>
    )
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-primary)]/50 px-3 py-2" data-testid="session-detail-pane">
      <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">{session.title}</div>
      <div className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">
        {session.messageCount} messages · last active {fullWhen(session.updatedAt)}
      </div>
      {unreadCount > 0 && (
        <div className="mt-1 rounded bg-[var(--accent-dim)] px-2 py-1 font-mono text-[10px] text-[var(--accent)]">
          {unreadCount} unread agent result{unreadCount === 1 ? '' : 's'}
        </div>
      )}
      <div className="mt-2 grid grid-cols-3 gap-1">
        <button
          type="button"
          onClick={() => onResume(session.id)}
          className="rounded bg-[var(--accent)] px-2 py-1 text-[11px] text-[var(--bg-primary)]"
        >
          Resume
        </button>
        <button
          type="button"
          onClick={() => onDuplicate(session.id)}
          className="rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={() => onArchive(session.id, !session.archived)}
          className="rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          {session.archived ? 'Restore' : 'Archive'}
        </button>
      </div>
      {session.title.toLowerCase().includes('workflow') && (
        <button
          type="button"
          onClick={() => onResume(session.id)}
          className="mt-1 w-full rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          Resume workflow
        </button>
      )}
    </div>
  )
}
