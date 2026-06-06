import { useEffect, useMemo, useRef, useState } from 'react'
import { useSessionsStore, type SessionEntry, type SessionsTab } from '@/stores/sessions-store'
import { useChatStore } from '@/stores/chat-store'
import { useProjectsStore } from '@/stores/projects-store'
import { SessionSearchBar } from './SessionSearchBar'
import { PopoverMenu } from '@/components/ui/PopoverMenu'
import { SessionDetailPane } from '@/components/sessions/SessionDetailPane'

const TABS: { key: SessionsTab; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'pinned', label: 'Pinned' },
  { key: 'archived', label: 'Archived' }
]

interface SessionsSidebarProps {
  embedded?: boolean
}

interface SessionGroup {
  id: string
  label: string
  entries: SessionEntry[]
}

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

export function SessionsSidebar({ embedded = false }: SessionsSidebarProps) {
  const tab = useSessionsStore((s) => s.tab)
  const setTab = useSessionsStore((s) => s.setTab)
  const entries = useSessionsStore((s) => s.entries)
  const hits = useSessionsStore((s) => s.hits)
  const query = useSessionsStore((s) => s.query)
  const loading = useSessionsStore((s) => s.loading)
  const hasMore = useSessionsStore((s) => s.hasMore)
  const unreadAgentResults = useSessionsStore((s) => s.unreadAgentResults)
  const loadFirstPage = useSessionsStore((s) => s.loadFirstPage)
  const loadMore = useSessionsStore((s) => s.loadMore)
  const archive = useSessionsStore((s) => s.archive)
  const setPinned = useSessionsStore((s) => s.setPinned)
  const duplicate = useSessionsStore((s) => s.duplicate)
  const deleteSession = useSessionsStore((s) => s.deleteSession)
  const markUnreadAgentResult = useSessionsStore((s) => s.markUnreadAgentResult)
  const clearUnread = useSessionsStore((s) => s.clearUnread)
  const reorderPinned = useSessionsStore((s) => s.reorderPinned)

  const selectConversation = useChatStore((s) => s.selectConversation)
  const activeId = useChatStore((s) => s.activeConversationId)
  const projects = useProjectsStore((s) => s.projects)
  const loadProjects = useProjectsStore((s) => s.loadProjects)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  useEffect(() => {
    void loadProjects()
    void loadFirstPage()
  }, [loadFirstPage, loadProjects])

  useEffect(() => {
    if (!window.api?.tasks?.onNotify) return
    return window.api.tasks.onNotify((event: unknown) => {
      const evt = event as { parentConvId?: unknown; status?: unknown }
      if (
        typeof evt.parentConvId === 'string' &&
        evt.parentConvId !== activeId &&
        (evt.status === 'done' || evt.status === 'error' || evt.status === 'aborted')
      ) {
        markUnreadAgentResult(evt.parentConvId)
      }
    })
  }, [activeId, markUnreadAgentResult])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      if (loading || !hasMore) return
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) void loadMore()
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [loadMore, loading, hasMore])

  const selected = useMemo(
    () => entries.find((entry) => entry.id === (selectedId ?? activeId)) ?? null,
    [activeId, entries, selectedId]
  )

  const groups = useMemo(() => {
    const projectNames = new Map(projects.map((project) => [project.id, project.name]))
    const grouped = new Map<string, SessionGroup>()
    for (const entry of entries) {
      const id = entry.projectId ?? '__unassigned__'
      const label = entry.projectId ? projectNames.get(entry.projectId) ?? 'Missing project' : 'Unassigned'
      const group = grouped.get(id) ?? { id, label, entries: [] }
      group.entries.push(entry)
      grouped.set(id, group)
    }
    return [...grouped.values()]
  }, [entries, projects])

  const select = async (id: string) => {
    setSelectedId(id)
    clearUnread(id)
    await selectConversation(id)
  }

  const movePinned = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return
    const ids = entries.map((entry) => entry.id)
    const from = ids.indexOf(draggingId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    reorderPinned(ids)
  }

  return (
    <div
      className={`flex h-full w-full flex-col gap-2 bg-[var(--bg-secondary)] py-2 text-[12px] text-[var(--text-primary)] ${
        embedded ? '' : 'border-r border-[var(--panel-border)]'
      }`}
      data-testid="sessions-sidebar"
    >
      <div className="flex items-center justify-between px-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Sessions
        </span>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">{entries.length}</span>
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

      {query.trim() && hits.length > 0 && (
        <SearchHits hits={hits} onSelect={(id) => void select(id)} />
      )}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-1"
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
          <div className="space-y-2">
            {groups.map((group) => (
              <div key={group.id}>
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  {group.label}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {group.entries.map((entry) => (
                    <li key={entry.id}>
                      <SessionRow
                        entry={entry}
                        active={entry.id === activeId}
                        unreadCount={unreadAgentResults[entry.id] ?? 0}
                        draggable={tab === 'pinned'}
                        dragging={draggingId === entry.id}
                        onDragStart={() => setDraggingId(entry.id)}
                        onDragOver={() => movePinned(entry.id)}
                        onDragEnd={() => setDraggingId(null)}
                        onSelect={() => void select(entry.id)}
                        onResume={() => void select(entry.id)}
                        onDuplicate={async () => {
                          const id = await duplicate(entry.id)
                          if (id) void select(id)
                        }}
                        onArchive={(archived) => archive(entry.id, archived)}
                        onDelete={() => {
                          if (confirm(`Delete "${entry.title || 'this session'}"?`)) void deleteSession(entry.id)
                        }}
                        onPin={(pinned) => setPinned(entry.id, pinned)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {loading && <div className="px-3 py-2 text-[11px] text-[var(--text-muted)]">Loading...</div>}
            {!hasMore && entries.length > 0 && (
              <div className="px-3 py-2 text-[11px] text-[var(--text-muted)]">End</div>
            )}
          </div>
        )}
      </div>

      <SessionDetailPane
        session={selected}
        unreadCount={selected ? unreadAgentResults[selected.id] ?? 0 : 0}
        onResume={(id) => void select(id)}
        onDuplicate={async (id) => {
          const next = await duplicate(id)
          if (next) void select(next)
        }}
        onArchive={(id, archived) => archive(id, archived)}
      />
    </div>
  )
}

function SearchHits({
  hits,
  onSelect
}: {
  hits: Array<{ conversationId: string; messageId: string | null; source: string; snippet: string }>
  onSelect: (id: string) => void
}) {
  return (
    <div className="border-y border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
      <span className="px-1 text-[var(--text-muted)]">
        {hits.length} match{hits.length === 1 ? '' : 'es'}
      </span>
      <ul className="mt-1 flex flex-col gap-0.5">
        {hits.slice(0, 12).map((hit, i) => (
          <li key={`${hit.conversationId}-${hit.messageId ?? 'title'}-${i}`}>
            <button
              type="button"
              onClick={() => onSelect(hit.conversationId)}
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
  )
}

interface SessionRowProps {
  entry: SessionEntry
  active: boolean
  unreadCount: number
  draggable: boolean
  dragging: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDragEnd: () => void
  onSelect: () => void
  onResume: () => void
  onDuplicate: () => void
  onArchive: (archived: boolean) => void
  onDelete: () => void
  onPin: (pinned: boolean) => void
}

function SessionRow({
  entry,
  active,
  unreadCount,
  draggable,
  dragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onSelect,
  onResume,
  onDuplicate,
  onArchive,
  onDelete,
  onPin
}: SessionRowProps) {
  const pinned = (entry.pinnedAt ?? null) !== null
  const [menuOpen, setMenuOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        if (!draggable) return
        e.preventDefault()
        onDragOver()
      }}
      onDragEnd={onDragEnd}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuOpen(true)
      }}
      className={`group flex items-center gap-2 rounded px-2 py-1.5 ${
        active
          ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
      } ${dragging ? 'opacity-50' : ''}`}
    >
      {draggable && (
        <span className="cursor-grab font-mono text-[10px] text-[var(--text-muted)]" aria-hidden>
          ::
        </span>
      )}
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left" title={entry.title}>
        <span className="flex items-center gap-1">
          <span className="truncate text-[12px] font-medium text-[var(--text-primary)]">{entry.title}</span>
          {unreadCount > 0 && (
            <span className="shrink-0 rounded-full bg-[var(--accent)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--bg-primary)]">
              {unreadCount}
            </span>
          )}
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
          pinned
            ? 'text-[var(--accent)]'
            : 'opacity-0 text-[var(--text-muted)] group-hover:opacity-100 hover:text-[var(--accent)]'
        }`}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M12 17v5M5 12l7-7 7 7-4 1-3 3-3-3-4-1z" />
        </svg>
      </button>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setMenuOpen(true)}
        title="Session actions"
        className="rounded p-0.5 opacity-0 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] group-hover:opacity-100"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      <PopoverMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={anchorRef}
        align="bottom-end"
        minWidth={160}
        ariaLabel="Session actions"
      >
        <MenuButton label="Resume here" onClick={onResume} onClose={() => setMenuOpen(false)} />
        <MenuButton label="Duplicate" onClick={onDuplicate} onClose={() => setMenuOpen(false)} />
        <MenuButton
          label={entry.archived ? 'Unarchive' : 'Archive'}
          onClick={() => onArchive(!entry.archived)}
          onClose={() => setMenuOpen(false)}
        />
        <MenuButton label="Delete" destructive onClick={onDelete} onClose={() => setMenuOpen(false)} />
      </PopoverMenu>
    </div>
  )
}

function MenuButton({
  label,
  destructive,
  onClick,
  onClose
}: {
  label: string
  destructive?: boolean
  onClick: () => void
  onClose: () => void
}) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={() => {
        onClose()
        onClick()
      }}
      className={`block w-full px-3 py-1.5 text-left text-[12px] transition-colors ${
        destructive
          ? 'text-[var(--error)] hover:bg-[var(--bg-tertiary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {label}
    </button>
  )
}
