import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useUiStore, SIDEBAR_BOUNDS } from '@/stores/ui-store'
import { toast } from '@/stores/toast-store'
import { useThemedIcon } from '@/lib/themed-icon'
import type { Conversation } from '@/lib/types'

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

function groupConversations(conversations: Conversation[]): ConversationGroup[] {
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
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
        active
          ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      <img src={icon} alt="" aria-hidden className="icon-asset h-[25px] w-[25px] shrink-0 object-contain" />
      <span className="flex-1 truncate">{label}</span>
      {shortcut && (
        <span className="font-mono text-[10px] text-[var(--text-muted)]">{shortcut}</span>
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
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
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

  useEffect(() => {
    if (searchFocusToken === 0) return
    setFilterVisible(true)
    requestAnimationFrame(() => {
      searchRef.current?.focus()
      searchRef.current?.select()
    })
  }, [searchFocusToken])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => c.title?.toLowerCase().includes(q))
  }, [conversations, searchQuery])

  const groups = groupConversations(filtered)

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete "${title || 'this conversation'}"?`)) return
    await deleteConversation(id)
    toast.success('Conversation deleted')
  }

  const handleSearchClick = () => {
    setFilterVisible(true)
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
      <div className="flex items-center justify-between pl-[28px] pr-3 pt-3">
        <button
          onClick={toggleSidebar}
          title="Click to collapse · Ctrl+B"
          aria-label="Collapse sidebar"
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="w-5" aria-hidden />
      </div>

      <div className="space-y-0.5 pl-[22px] pr-2 pt-2">
        <NavRow
          icon={newChatIcon}
          label="New chat"
          shortcut="Ctrl+N"
          onClick={() => createConversation()}
        />
        <NavRow icon={searchIcon} label="Search" shortcut="Ctrl+K" onClick={handleSearchClick} />
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
              placeholder="Filter conversations…"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 pl-7 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
          </div>
        </div>
      )}

      <div className="mt-4 pl-[28px] pr-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Projects
        </span>
      </div>

      <div className="mx-[22px] my-3 border-t border-[var(--border)]" aria-hidden />

      <div className="pl-[28px] pr-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Session History
        </span>
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
            <div className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] text-[var(--text-secondary)]">
              <img
                src={folderIcon}
                alt=""
                aria-hidden
                className="icon-asset h-[25px] w-[25px] shrink-0 object-contain"
              />
              <span className="flex-1 truncate font-medium">{group.label}</span>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {group.items.length}
              </span>
            </div>
            <div className="ml-3">
              {group.items.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => selectConversation(conv.id)}
                  className={`group flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[12px] transition-colors ${
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
                  <span className="min-w-0 flex-1 truncate">{conv.title}</span>
                  <span className="font-mono text-[10px] text-[var(--text-muted)] group-hover:hidden">
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
