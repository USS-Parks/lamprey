import { useEffect, useRef } from 'react'
import { useSessionsStore, type SessionsTab } from '@/stores/sessions-store'
import { useChatStore } from '@/stores/chat-store'
import { SessionSearchBar } from './SessionSearchBar'

// E3 — Sessions sidebar.
//
// Renders three tabs (Recent / Pinned / Archived) over an infinite-
// scrolling list. The store owns the IPC chatter; this component is
// purely presentational. Click an entry → load it as the active
// conversation through the existing chat-store selector.

const TABS: { key: SessionsTab; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'pinned', label: 'Pinned' },
  { key: 'archived', label: 'Archived' }
]

function formatWhen(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(ts).toLocaleDateString()
}

export function SessionsSidebar() {
  const tab = useSessionsStore((s) => s.tab)
  const setTab = useSessionsStore((s) => s.setTab)
  const entries = useSessionsStore((s) => s.entries)
  const hits = useSessionsStore((s) => s.hits)
  const query = useSessionsStore((s) => s.query)
  const loading = useSessionsStore((s) => s.loading)
  const hasMore = useSessionsStore((s) => s.hasMore)
  const loadFirstPage = useSessionsStore((s) => s.loadFirstPage)
  const loadMore = useSessionsStore((s) => s.loadMore)
  const archive = useSessionsStore((s) => s.archive)
  const setPinned = useSessionsStore((s) => s.setPinned)

  const selectConversation = useChatStore((s) => s.selectConversation)
  const activeId = useChatStore((s) => s.activeConversationId)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void loadFirstPage()
  }, [loadFirstPage])

  // Infinite scroll: when the scroll position approaches the bottom of
  // the list, ask the store for the next page. 240px lookahead keeps
  // the user from ever hitting an empty edge.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      if (loading || !hasMore) return
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
        void loadMore()
      }
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [loadMore, loading, hasMore])

  return (
    <div className="flex h-full w-full flex-col gap-2 border-r border-[var(--border)] bg-[var(--bg-secondary)] py-2 text-[12px] text-[var(--text-primary)]">
      <div className="flex items-center justify-between px-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Sessions
        </span>
      </div>

      <SessionSearchBar />

      <div className="flex items-center gap-1 overflow-x-auto px-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
              tab === t.key
                ? 'bg-[var(--accent)] text-[var(--bg-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* When the user types a query, show FTS hits with highlighted
          snippets above the bucket list. The hit row deep-links to the
          target conversation via the existing chat-store selector. */}
      {query.trim() && hits.length > 0 && (
        <div className="border-y border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
          <span className="px-1 text-[var(--text-muted)]">
            {hits.length} match{hits.length === 1 ? '' : 'es'}
          </span>
          <ul className="mt-1 flex flex-col gap-0.5">
            {hits.slice(0, 12).map((hit, i) => (
              <li key={`${hit.conversationId}-${hit.messageId ?? 'title'}-${i}`}>
                <button
                  type="button"
                  onClick={() => selectConversation(hit.conversationId)}
                  className="block w-full rounded px-2 py-1 text-left hover:bg-[var(--bg-tertiary)]"
                >
                  <span className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    {hit.source}
                  </span>
                  <span
                    className="block truncate text-[12px] text-[var(--text-primary)]"
                    dangerouslySetInnerHTML={{
                      __html: hit.snippet
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/&lt;&lt;/g, '<mark>')
                        .replace(/&gt;&gt;/g, '</mark>')
                    }}
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-1"
        role="listbox"
        aria-label={`${tab} sessions`}
      >
        {entries.length === 0 && !loading ? (
          <p className="px-3 py-4 text-[12px] text-[var(--text-muted)]">
            {tab === 'recent' && (query ? 'No matches.' : 'No conversations yet.')}
            {tab === 'pinned' && 'No pinned conversations.'}
            {tab === 'archived' && 'No archived conversations.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {entries.map((entry) => (
              <li key={entry.id}>
                <SessionRow
                  entry={entry}
                  active={entry.id === activeId}
                  onSelect={() => selectConversation(entry.id)}
                  onArchive={(archived) => archive(entry.id, archived)}
                  onPin={(pinned) => setPinned(entry.id, pinned)}
                />
              </li>
            ))}
            {loading && (
              <li className="px-3 py-2 text-[11px] text-[var(--text-muted)]">Loading…</li>
            )}
            {!hasMore && entries.length > 0 && (
              <li className="px-3 py-2 text-[11px] text-[var(--text-muted)]">— end —</li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

interface SessionRowProps {
  entry: {
    id: string
    title: string
    updatedAt: number
    messageCount: number
    archived?: boolean
    pinnedAt?: number | null
  }
  active: boolean
  onSelect: () => void
  onArchive: (archived: boolean) => void
  onPin: (pinned: boolean) => void
}

function SessionRow({ entry, active, onSelect, onArchive, onPin }: SessionRowProps) {
  const pinned = (entry.pinnedAt ?? null) !== null
  return (
    <div
      className={`group flex items-center gap-2 rounded px-2 py-1.5 ${
        active ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 text-left"
        title={entry.title}
      >
        <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">
          {entry.title}
        </span>
        <span className="block text-[10px] text-[var(--text-muted)]">
          {entry.messageCount} msg · {formatWhen(entry.updatedAt)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onPin(!pinned)}
        title={pinned ? 'Unpin' : 'Pin'}
        className={`rounded p-0.5 transition-colors ${
          pinned ? 'text-[var(--accent)]' : 'opacity-0 text-[var(--text-muted)] group-hover:opacity-100 hover:text-[var(--accent)]'
        }`}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
          <path d="M12 17v5M5 12l7-7 7 7-4 1-3 3-3-3-4-1z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onArchive(!entry.archived)}
        title={entry.archived ? 'Unarchive' : 'Archive'}
        className="rounded p-0.5 opacity-0 text-[var(--text-muted)] transition-colors hover:text-[var(--accent)] group-hover:opacity-100"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="3" width="20" height="5" rx="1" />
          <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M9 12h6" />
        </svg>
      </button>
    </div>
  )
}
