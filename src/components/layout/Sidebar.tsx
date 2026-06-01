import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useUiStore, SIDEBAR_BOUNDS } from '@/stores/ui-store'
import type { ConvFilters } from '@/stores/ui-store'
import { toast } from '@/stores/toast-store'
import { useThemedIcon } from '@/lib/themed-icon'
import type { Conversation } from '@/lib/types'
import { SidebarFilterMenu } from './SidebarFilterMenu'

import newChatLight from '@assets/Lamprey New Chat Icon.png'
import newChatDark from '@assets/Lamprey New Chat Icon Dark View.png'
import searchLight from '@assets/Lamprey Searching Icon.png'
import searchDark from '@assets/Lamprey Search Icon Dark View.png'
import pluginsLight from '@assets/Lamprey Plugins Icon.png'
import pluginsDark from '@assets/Lamprey Plugins Icon Dark View.png'
import folderLight from '@assets/Lamprey Folder 1 Icon.png'
import folderDark from '@assets/Lamprey Folder 1 Dark View.png'
import workLight from '@assets/Lamprey Work Location Icon.png'
import workDark from '@assets/Lamprey Work Location Icon Dark View.png'
import settingsLight from '@assets/Lamprey Settings Icon.png'
import settingsDark from '@assets/Lamprey Settings Icon Dark View.png'

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(timestamp).toLocaleDateString()
}

interface ConversationGroup {
  label: string
  items: Conversation[]
}

function groupByDate(conversations: Conversation[]): ConversationGroup[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = today - 86400000
  const thisWeek = today - 7 * 86400000

  const groups: ConversationGroup[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This Week', items: [] },
    { label: 'Older', items: [] }
  ]

  for (const conv of conversations) {
    if (conv.updatedAt >= today) groups[0].items.push(conv)
    else if (conv.updatedAt >= yesterday) groups[1].items.push(conv)
    else if (conv.updatedAt >= thisWeek) groups[2].items.push(conv)
    else groups[3].items.push(conv)
  }

  return groups.filter((g) => g.items.length > 0)
}

function groupByModel(conversations: Conversation[]): ConversationGroup[] {
  const buckets = new Map<string, Conversation[]>()
  for (const c of conversations) {
    const key = c.model || '(no model)'
    const arr = buckets.get(key) ?? []
    arr.push(c)
    buckets.set(key, arr)
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, items]) => ({ label, items }))
}

function applyConvFilters(
  conversations: Conversation[],
  filters: ConvFilters
): { sorted: Conversation[]; groups: ConversationGroup[] } {
  // 1) Last-activity window filter
  const now = Date.now()
  const startOfToday = (() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  })()
  const windowMs: Record<typeof filters.lastActivity, number | null> = {
    all: null,
    today: now - startOfToday,
    week: 7 * 86400000,
    month: 30 * 86400000
  }
  const cutoff = windowMs[filters.lastActivity]
  let result = cutoff == null ? conversations : conversations.filter((c) => now - c.updatedAt <= cutoff)

  // 2) Sort
  result = [...result].sort((a, b) => {
    switch (filters.sortBy) {
      case 'recency':
        return b.updatedAt - a.updatedAt
      case 'created':
        return b.createdAt - a.createdAt
      case 'az':
        return (a.title || '').localeCompare(b.title || '')
      case 'za':
        return (b.title || '').localeCompare(a.title || '')
    }
  })

  // 3) Group
  let groups: ConversationGroup[]
  if (filters.groupBy === 'date') groups = groupByDate(result)
  else if (filters.groupBy === 'model') groups = groupByModel(result)
  else groups = [{ label: 'All', items: result }]

  return { sorted: result, groups }
}

interface NavRowProps {
  icon: string
  label: string
  shortcut?: string
  onClick: () => void
  active?: boolean
}

function NavRow({ icon, label, shortcut, onClick, active }: NavRowProps) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[15px] transition-colors ${
        active
          ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      <img src={icon} alt="" aria-hidden className="icon-asset h-[25px] w-[25px] shrink-0 object-contain" />
      <span className="flex-1 truncate">{label}</span>
      {shortcut && (
        <span className="font-mono text-[12px] text-[var(--text-muted)]">{shortcut}</span>
      )}
    </button>
  )
}

export function Sidebar() {
  const {
    conversations,
    activeConversationId,
    selectConversation,
    createConversation,
    deleteConversation
  } = useChatStore()
  const searchQuery = useUiStore((s) => s.searchQuery)
  const setSearchQuery = useUiStore((s) => s.setSearchQuery)
  const searchFocusToken = useUiStore((s) => s.searchFocusToken)
  const requestSearchFocus = useUiStore((s) => s.requestSearchFocus)
  const openSettings = useUiStore((s) => s.openSettings)
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const searchRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [filterVisible, setFilterVisible] = useState(false)

  const newChatIcon = useThemedIcon(newChatLight, newChatDark)
  const searchIcon = useThemedIcon(searchLight, searchDark)
  const pluginsIcon = useThemedIcon(pluginsLight, pluginsDark)
  const folderIcon = useThemedIcon(folderLight, folderDark)
  const workIcon = useThemedIcon(workLight, workDark)
  const settingsIconUrl = useThemedIcon(settingsLight, settingsDark)

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setDragging(true)
      const startX = e.clientX
      const startWidth = sidebarWidth
      const onMove = (me: MouseEvent) => {
        const delta = me.clientX - startX
        const next = Math.max(
          SIDEBAR_BOUNDS.min,
          Math.min(SIDEBAR_BOUNDS.max, startWidth + delta)
        )
        setSidebarWidth(next)
      }
      const onUp = () => {
        setDragging(false)
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
      }
      document.body.style.cursor = 'col-resize'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [sidebarWidth, setSidebarWidth]
  )

  // Ctrl+K (and the Search nav row) toggle the filter. If it's already
  // open AND the input has keyboard focus, the same chord dismisses it.
  // IMPORTANT: this effect must depend ONLY on searchFocusToken — if
  // filterVisible is in the deps, closing the filter re-runs the effect
  // and immediately re-opens it (infinite loop, UI feels frozen).
  const filterVisibleRef = useRef(filterVisible)
  filterVisibleRef.current = filterVisible
  useEffect(() => {
    if (searchFocusToken === 0) return
    const inputHasFocus = document.activeElement === searchRef.current
    if (filterVisibleRef.current && inputHasFocus) {
      setSearchQuery('')
      setFilterVisible(false)
      searchRef.current?.blur()
      return
    }
    setFilterVisible(true)
    requestAnimationFrame(() => {
      searchRef.current?.focus()
      searchRef.current?.select()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchFocusToken])

  // Click anywhere outside the filter input — including elsewhere in the
  // sidebar — closes it (and clears the query so it doesn't keep filtering
  // the list invisibly).
  useEffect(() => {
    if (!filterVisible) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (target && searchRef.current && searchRef.current.contains(target)) return
      // Don't dismiss when clicking the Search nav row itself — its handler
      // already manages the toggle.
      const navRow = (e.target as HTMLElement)?.closest('[data-sidebar-search-row]')
      if (navRow) return
      setSearchQuery('')
      setFilterVisible(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [filterVisible, setSearchQuery])

  const convFilters = useUiStore((s) => s.convFilters)

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => c.title?.toLowerCase().includes(q))
  }, [conversations, searchQuery])

  const { groups } = useMemo(
    () => applyConvFilters(filtered, convFilters),
    [filtered, convFilters]
  )

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete "${title || 'this conversation'}"?`)) return
    await deleteConversation(id)
    toast.success('Conversation deleted')
  }

  const handleSearchClick = () => {
    // Reuse the same path the Ctrl+K shortcut takes — both should toggle
    // the filter so it can be opened AND closed from the same affordance.
    requestSearchFocus()
  }

  if (sidebarCollapsed) {
    return (
      <div className="relative flex h-full w-12 flex-col items-center border-r border-[var(--border)] bg-[var(--bg-secondary)] py-3">
        <button
          onClick={() => setSidebarCollapsed(false)}
          title="Expand sidebar (Ctrl+B)"
          aria-label="Expand sidebar"
          className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button
          onClick={() => createConversation()}
          title="New chat (Ctrl+N)"
          aria-label="New chat"
          className="mt-2 rounded-md p-1.5 transition-colors hover:bg-[var(--bg-tertiary)]"
        >
          <img src={newChatIcon} alt="" aria-hidden className="icon-asset h-[30px] w-[30px] object-contain" />
        </button>
        <button
          onClick={handleSearchClick}
          title="Search (Ctrl+K)"
          aria-label="Search"
          className="mt-1 rounded-md p-1.5 transition-colors hover:bg-[var(--bg-tertiary)]"
        >
          <img src={searchIcon} alt="" aria-hidden className="icon-asset h-[30px] w-[30px] object-contain" />
        </button>
        <button
          onClick={openSettings}
          title="Plugins"
          aria-label="Plugins"
          className="mt-1 rounded-md p-1.5 transition-colors hover:bg-[var(--bg-tertiary)]"
        >
          <img src={pluginsIcon} alt="" aria-hidden className="icon-asset h-[30px] w-[30px] object-contain" />
        </button>
        <div className="flex-1" />
        <button
          onClick={openSettings}
          title="Settings (Ctrl+,)"
          aria-label="Settings"
          className="rounded-md p-1.5 transition-colors hover:bg-[var(--bg-tertiary)]"
        >
          <img src={settingsIconUrl} alt="" aria-hidden className="icon-asset h-[30px] w-[30px] object-contain" />
        </button>
      </div>
    )
  }

  return (
    <div
      className="relative flex h-full flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)]"
      style={{ width: sidebarWidth, minWidth: sidebarWidth }}
    >
      <div className="space-y-0.5 pl-[22px] pr-2 pt-3">
        <NavRow
          icon={newChatIcon}
          label="New chat"
          shortcut="Ctrl+N"
          onClick={() => createConversation()}
        />
        <div data-sidebar-search-row>
          <NavRow icon={searchIcon} label="Search" shortcut="Ctrl+K" onClick={handleSearchClick} />
        </div>
        <NavRow icon={pluginsIcon} label="Plugins" onClick={openSettings} />
      </div>

      {filterVisible && (
        <div className="pl-[28px] pr-3 pt-3">
          <div className="relative">
            <img
              src={searchIcon}
              alt=""
              aria-hidden
              className="icon-asset pointer-events-none absolute left-2 top-1/2 h-5 w-5 -translate-y-1/2 object-contain opacity-60"
            />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setSearchQuery('')
                  setFilterVisible(false)
                  searchRef.current?.blur()
                }
              }}
              onBlur={() => {
                // Empty input + blur = no filter active, so hide the row.
                // Keep it open when there's an active query so the user can
                // see what's filtering the list below.
                if (!searchQuery.trim()) setFilterVisible(false)
              }}
              placeholder="Filter conversations…"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 pl-7 text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between pl-[28px] pr-3">
        <span className="text-[13px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Projects
        </span>
        <button
          type="button"
          onClick={() => useUiStore.getState().openWorktreeModal()}
          className="rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          title="Manage git worktrees"
        >
          worktrees
        </button>
      </div>

      <div className="mx-[22px] my-3 border-t border-[var(--border)]" aria-hidden />

      <div className="flex items-center justify-between pl-[28px] pr-3">
        <span className="text-[13px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Session History
        </span>
        <SidebarFilterMenu />
      </div>

      <div className="scrollbar-visible mt-1 flex-1 overflow-y-auto pl-[22px] pr-1">
        {conversations.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-[var(--text-muted)]">
            Start your first conversation.
          </p>
        ) : groups.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-[var(--text-muted)]">
            No matches for "{searchQuery}".
          </p>
        ) : null}

        {groups.map((group) => (
          <div key={group.label} className="mb-2">
            <div className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[15px] text-[var(--text-secondary)]">
              <img
                src={folderIcon}
                alt=""
                aria-hidden
                className="icon-asset h-[25px] w-[25px] shrink-0 object-contain"
              />
              <span className="flex-1 truncate font-medium">{group.label}</span>
              <span className="font-mono text-[12px] text-[var(--text-muted)]">
                {group.items.length}
              </span>
            </div>
            <div className="ml-3">
              {group.items.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => selectConversation(conv.id)}
                  className={`group flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[14px] transition-colors ${
                    activeConversationId === conv.id
                      ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <img
                    src={workIcon}
                    alt=""
                    aria-hidden
                    className="icon-asset h-5 w-5 shrink-0 object-contain opacity-80"
                  />
                  {conv.kind && conv.kind !== 'local' && (
                    <span
                      className={`shrink-0 rounded px-1 py-0 text-[9px] font-mono uppercase tracking-wider ${
                        conv.kind === 'worktree'
                          ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                      }`}
                      title={conv.worktreePath ?? conv.kind}
                    >
                      {conv.kind === 'worktree' ? 'wt' : 'cl'}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{conv.title}</span>
                  <span className="font-mono text-[12px] text-[var(--text-muted)] group-hover:hidden">
                    {formatRelativeTime(conv.updatedAt)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(conv.id, conv.title)
                    }}
                    title="Delete conversation"
                    className="hidden rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--error)] group-hover:block"
                  >
                    ×
                  </button>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--border)] pb-2 pl-[22px] pr-2 pt-2">
        <NavRow
          icon={settingsIconUrl}
          label="Settings"
          shortcut="Ctrl+,"
          onClick={openSettings}
        />
      </div>

      <div
        onMouseDown={handleResizeStart}
        onDoubleClick={() => setSidebarWidth(SIDEBAR_BOUNDS.default)}
        title="Drag to resize · double-click to reset"
        role="separator"
        aria-orientation="vertical"
        className={`resize-handle-v resize-handle-v-right ${dragging ? 'dragging' : ''}`}
      />
    </div>
  )
}
