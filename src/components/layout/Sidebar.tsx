import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useUiStore, SIDEBAR_BOUNDS } from '@/stores/ui-store'
import { useProjectsStore } from '@/stores/projects-store'
import { useSidebarStore, SIDEBAR_DEFAULT_LIMIT } from '@/stores/sidebar-store'
import { useNavHistoryStore } from '@/stores/nav-history-store'
import { toast } from '@/stores/toast-store'
import { useThemedIcon } from '@/lib/themed-icon'
import { useMediaQuery, NARROW_VIEWPORT_QUERY } from '@/hooks/useMediaQuery'
import type { Conversation, Project } from '@/lib/types'
import { PopoverMenu } from '@/components/ui/PopoverMenu'

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
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(timestamp).toLocaleDateString()
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
      : false
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    try {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    } catch {
      // Older browsers
      mq.addListener(onChange)
      return () => mq.removeListener(onChange)
    }
  }, [])
  return reduced
}

interface NavRowProps {
  icon?: string
  iconNode?: React.ReactNode
  label: string
  shortcut?: string
  onClick: () => void
  active?: boolean
  ariaLabel?: string
}

function NavRow({ icon, iconNode, label, shortcut, onClick, active, ariaLabel }: NavRowProps) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[15px] transition-colors ${
        active
          ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {icon ? (
        <img src={icon} alt="" aria-hidden className="icon-asset h-[25px] w-[25px] shrink-0 object-contain" />
      ) : (
        <span aria-hidden className="flex h-[25px] w-[25px] shrink-0 items-center justify-center">
          {iconNode}
        </span>
      )}
      <span className="flex-1 truncate">{label}</span>
      {shortcut && (
        <span className="font-mono text-[12px] text-[var(--text-muted)]">{shortcut}</span>
      )}
    </button>
  )
}

interface ChevronProps {
  direction: 'right' | 'down' | 'left'
  size?: number
}
function Chevron({ direction, size = 12 }: ChevronProps) {
  const points =
    direction === 'down' ? '6 9 12 15 18 9' : direction === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points={points} />
    </svg>
  )
}

function ClockIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  )
}

interface ProjectGroup {
  project: Project | null
  conversations: Conversation[]
}

interface OrphanGroup {
  label: string
  items: Conversation[]
}

function bucketConversations(
  conversations: Conversation[],
  projects: Project[]
): { groups: ProjectGroup[]; orphans: Conversation[] } {
  const byProject = new Map<string, Conversation[]>()
  const orphans: Conversation[] = []
  for (const c of conversations) {
    if (c.projectId) {
      const arr = byProject.get(c.projectId) ?? []
      arr.push(c)
      byProject.set(c.projectId, arr)
    } else {
      orphans.push(c)
    }
  }
  // Preserve the project sort order from projects-store (pinned first, then
  // by lastActivityAt) and append any conversations whose project has been
  // archived/deleted into the orphan bucket so they don't disappear.
  const groups: ProjectGroup[] = []
  const known = new Set(projects.map((p) => p.id))
  for (const p of projects) {
    const items = (byProject.get(p.id) ?? []).sort((a, b) => b.updatedAt - a.updatedAt)
    groups.push({ project: p, conversations: items })
  }
  for (const [pid, items] of byProject.entries()) {
    if (!known.has(pid)) orphans.push(...items)
  }
  orphans.sort((a, b) => b.updatedAt - a.updatedAt)
  return { groups, orphans }
}

function groupOrphansByDate(conversations: Conversation[]): OrphanGroup[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = today - 86400000
  const thisWeek = today - 7 * 86400000
  const groups: OrphanGroup[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This Week', items: [] },
    { label: 'Older', items: [] }
  ]
  for (const c of conversations) {
    if (c.updatedAt >= today) groups[0].items.push(c)
    else if (c.updatedAt >= yesterday) groups[1].items.push(c)
    else if (c.updatedAt >= thisWeek) groups[2].items.push(c)
    else groups[3].items.push(c)
  }
  return groups.filter((g) => g.items.length > 0)
}

interface ConversationRowProps {
  conv: Conversation
  active: boolean
  onSelect: () => void
  onDelete: () => void
  workIcon: string
}
function ConversationRow({ conv, active, onSelect, onDelete, workIcon }: ConversationRowProps) {
  return (
    <button
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      className={`group flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[14px] transition-colors ${
        active
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
          onDelete()
        }}
        title="Delete conversation"
        aria-label="Delete conversation"
        className="hidden rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--error)] group-hover:block"
      >
        ×
      </button>
    </button>
  )
}

interface ProjectMenuItem {
  label: string
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
}

interface ProjectMenuProps {
  open: boolean
  anchorRef: React.RefObject<HTMLButtonElement | null>
  items: ProjectMenuItem[]
  onClose: () => void
}
function ProjectMenu({ open, anchorRef, items, onClose }: ProjectMenuProps) {
  return (
    <PopoverMenu
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      align="bottom-start"
      role="menu"
      ariaLabel="Project actions"
      minWidth={180}
    >
      {items.map((item, i) => (
        <button
          key={i}
          role="menuitem"
          disabled={item.disabled}
          aria-disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return
            onClose()
            item.onSelect()
          }}
          className={`block w-full px-3 py-1.5 text-left text-[13px] transition-colors ${
            item.disabled
              ? 'cursor-not-allowed text-[var(--text-muted)] opacity-60'
              : item.destructive
                ? 'text-[var(--error)] hover:bg-[var(--bg-tertiary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {item.label}
        </button>
      ))}
    </PopoverMenu>
  )
}

interface ProjectSectionProps {
  group: ProjectGroup
  expanded: boolean
  onToggleExpanded: () => void
  visibleLimit: number
  onShowMore: () => void
  onShowLess: () => void
  activeConversationId: string | null
  onSelectConversation: (id: string) => void
  onDeleteConversation: (id: string, title: string) => void
  onRename: (p: Project) => void
  onTogglePin: (p: Project) => void
  onArchive: (p: Project) => void
  onOpenFolder: (p: Project) => void
  onCopyPath: (p: Project) => void
  onNewChatInProject: (p: Project) => void
  folderIcon: string
  workIcon: string
}
function ProjectSection({
  group,
  expanded,
  onToggleExpanded,
  visibleLimit,
  onShowMore,
  onShowLess,
  activeConversationId,
  onSelectConversation,
  onDeleteConversation,
  onRename,
  onTogglePin,
  onArchive,
  onOpenFolder,
  onCopyPath,
  onNewChatInProject,
  folderIcon,
  workIcon
}: ProjectSectionProps) {
  const project = group.project
  const conversations = group.conversations
  const hasMore = conversations.length > visibleLimit
  const visible = conversations.slice(0, visibleLimit)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuAnchorRef = useRef<HTMLButtonElement>(null)
  const rowId = project ? `project-row-${project.id}` : 'project-row-unassigned'

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!project) return
    e.preventDefault()
    setMenuOpen(true)
  }

  return (
    <div className="mb-2" data-project-id={project?.id}>
      <button
        ref={menuAnchorRef}
        id={rowId}
        onClick={onToggleExpanded}
        onContextMenu={handleContextMenu}
        aria-expanded={expanded}
        aria-controls={`${rowId}-list`}
        className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[15px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-muted)]">
          <Chevron direction={expanded ? 'down' : 'right'} />
        </span>
        <img
          src={folderIcon}
          alt=""
          aria-hidden
          className="icon-asset h-[22px] w-[22px] shrink-0 object-contain"
        />
        <span className="flex-1 truncate font-medium">{project?.name ?? 'Unassigned'}</span>
        {project?.pinned && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--accent)]">
            pin
          </span>
        )}
        {conversations.length > 0 && (
          <span className="font-mono text-[12px] text-[var(--text-muted)]">
            {conversations.length}
          </span>
        )}
        {project && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                setMenuOpen((v) => !v)
              }
            }}
            title="Project actions"
            aria-label="Project actions"
            className="hidden rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] group-hover:inline-flex"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </span>
        )}
      </button>

      {project && (
        <ProjectMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchorRef={menuAnchorRef}
          items={[
            { label: 'New chat in project', onSelect: () => onNewChatInProject(project) },
            { label: 'Rename…', onSelect: () => onRename(project) },
            {
              label: project.pinned ? 'Unpin project' : 'Pin project',
              onSelect: () => onTogglePin(project)
            },
            {
              label: 'Open folder',
              onSelect: () => onOpenFolder(project),
              disabled: !project.path
            },
            {
              label: 'Copy path',
              onSelect: () => onCopyPath(project),
              disabled: !project.path
            },
            { label: 'Archive', onSelect: () => onArchive(project), destructive: true }
          ]}
        />
      )}

      {expanded && (
        <div className="ml-4 mt-0.5" id={`${rowId}-list`} role="group">
          {visible.length === 0 ? (
            <p className="px-3 py-1.5 text-[12px] italic text-[var(--text-muted)]">
              No conversations yet.
            </p>
          ) : (
            visible.map((conv) => (
              <ConversationRow
                key={conv.id}
                conv={conv}
                active={activeConversationId === conv.id}
                onSelect={() => onSelectConversation(conv.id)}
                onDelete={() => onDeleteConversation(conv.id, conv.title)}
                workIcon={workIcon}
              />
            ))
          )}
          {hasMore && (
            <button
              onClick={onShowMore}
              className="block w-full px-3 py-1 text-left text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            >
              Show more ({conversations.length - visibleLimit})
            </button>
          )}
          {!hasMore && visibleLimit > SIDEBAR_DEFAULT_LIMIT && conversations.length > SIDEBAR_DEFAULT_LIMIT && (
            <button
              onClick={onShowLess}
              className="block w-full px-3 py-1 text-left text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
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

  const projects = useProjectsStore((s) => s.projects)
  const loadProjects = useProjectsStore((s) => s.loadProjects)
  const createProject = useProjectsStore((s) => s.createProject)
  const renameProject = useProjectsStore((s) => s.renameProject)
  const pinProject = useProjectsStore((s) => s.pinProject)
  const archiveProject = useProjectsStore((s) => s.archiveProject)
  const openFolder = useProjectsStore((s) => s.openFolder)
  const copyPath = useProjectsStore((s) => s.copyPath)
  const assignConversation = useProjectsStore((s) => s.assignConversation)

  const isProjectExpanded = useSidebarStore((s) => s.isProjectExpanded)
  const toggleProjectExpanded = useSidebarStore((s) => s.toggleProjectExpanded)
  const visibleLimitFor = useSidebarStore((s) => s.visibleLimitFor)
  const showMore = useSidebarStore((s) => s.showMore)
  const showLess = useSidebarStore((s) => s.showLess)

  const navStack = useNavHistoryStore((s) => s.stack)
  const navIndex = useNavHistoryStore((s) => s.index)
  const goBack = useNavHistoryStore((s) => s.goBack)
  const goForward = useNavHistoryStore((s) => s.goForward)
  const startReplay = useNavHistoryStore((s) => s.startReplay)
  const endReplay = useNavHistoryStore((s) => s.endReplay)

  const reduced = usePrefersReducedMotion()
  const isNarrow = useMediaQuery(NARROW_VIEWPORT_QUERY)

  const newChatIcon = useThemedIcon(newChatLight, newChatDark)
  const searchIcon = useThemedIcon(searchLight, searchDark)
  const pluginsIcon = useThemedIcon(pluginsLight, pluginsDark)
  const folderIcon = useThemedIcon(folderLight, folderDark)
  const workIcon = useThemedIcon(workLight, workDark)
  const settingsIconUrl = useThemedIcon(settingsLight, settingsDark)

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

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
  // IMPORTANT: this effect must depend ONLY on searchFocusToken — putting
  // filterVisible in the deps would loop (closing re-runs and re-opens).
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

  useEffect(() => {
    if (!filterVisible) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (target && searchRef.current && searchRef.current.contains(target)) return
      const navRow = (e.target as HTMLElement)?.closest('[data-sidebar-search-row]')
      if (navRow) return
      setSearchQuery('')
      setFilterVisible(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [filterVisible, setSearchQuery])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => c.title?.toLowerCase().includes(q))
  }, [conversations, searchQuery])

  const { groups, orphans } = useMemo(
    () => bucketConversations(filtered, projects),
    [filtered, projects]
  )
  const orphanGroups = useMemo(() => groupOrphansByDate(orphans), [orphans])

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete "${title || 'this conversation'}"?`)) return
    await deleteConversation(id)
    toast.success('Conversation deleted')
  }

  const handleSearchClick = () => {
    requestSearchFocus()
  }

  const handleNewChat = async () => {
    await createConversation()
  }

  const handleNewChatInProject = async (project: Project) => {
    const newId = await createConversation()
    if (newId) {
      await assignConversation(newId, project.id)
      // Reload so the new conversation reflects the projectId in the UI.
      await useChatStore.getState().loadConversations()
    }
  }

  const handleAddProject = async () => {
    const name = prompt('Project name')
    if (!name?.trim()) return
    await createProject(name.trim())
  }

  const handleRename = async (project: Project) => {
    const next = prompt('Rename project', project.name)
    if (!next?.trim() || next === project.name) return
    await renameProject(project.id, next.trim())
  }

  const handleTogglePin = async (project: Project) => {
    await pinProject(project.id, !project.pinned)
  }

  const handleArchive = async (project: Project) => {
    if (!confirm(`Archive "${project.name}"? Conversations stay; the project disappears from the list.`)) return
    await archiveProject(project.id, true)
  }

  const canGoBack = navIndex > 0
  const canGoForward = navIndex >= 0 && navIndex < navStack.length - 1

  const handleBack = useCallback(() => {
    startReplay()
    const id = goBack()
    if (id) {
      // selectConversation early-outs when id === active, so set null first.
      useChatStore.setState({ activeConversationId: null })
      void selectConversation(id).finally(() => endReplay())
    } else {
      endReplay()
    }
  }, [goBack, selectConversation, startReplay, endReplay])

  const handleForward = useCallback(() => {
    startReplay()
    const id = goForward()
    if (id) {
      useChatStore.setState({ activeConversationId: null })
      void selectConversation(id).finally(() => endReplay())
    } else {
      endReplay()
    }
  }, [goForward, selectConversation, startReplay, endReplay])

  const transitionStyle = reduced
    ? undefined
    : { transition: 'width 200ms ease-out, min-width 200ms ease-out' }

  // Drawer on narrow viewports — slide-over from the left when expanded.
  if (isNarrow && !sidebarCollapsed) {
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
          onClick={() => setSidebarCollapsed(true)}
          aria-hidden
        />
        <aside
          role="dialog"
          aria-label="Navigation"
          className="fixed bottom-0 left-0 top-0 z-50 flex flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl"
          style={{
            width: Math.min(sidebarWidth, window.innerWidth - 48),
            transform: 'translateX(0)',
            transition: reduced ? 'none' : 'transform 200ms ease-out'
          }}
        >
          <SidebarBody
            sidebarWidth={sidebarWidth}
            collapsed={false}
            setSidebarCollapsed={setSidebarCollapsed}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            handleBack={handleBack}
            handleForward={handleForward}
            handleNewChat={handleNewChat}
            handleSearchClick={handleSearchClick}
            openSettings={openSettings}
            filterVisible={filterVisible}
            setFilterVisible={setFilterVisible}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searchRef={searchRef}
            handleAddProject={handleAddProject}
            groups={groups}
            orphanGroups={orphanGroups}
            isProjectExpanded={isProjectExpanded}
            toggleProjectExpanded={toggleProjectExpanded}
            visibleLimitFor={visibleLimitFor}
            showMore={showMore}
            showLess={showLess}
            activeConversationId={activeConversationId}
            selectConversation={(id) => {
              void selectConversation(id)
              setSidebarCollapsed(true)
            }}
            handleDelete={handleDelete}
            handleRename={handleRename}
            handleTogglePin={handleTogglePin}
            handleArchive={handleArchive}
            openFolder={(p) => openFolder(p.id)}
            copyPath={(p) => copyPath(p.id)}
            handleNewChatInProject={handleNewChatInProject}
            folderIcon={folderIcon}
            workIcon={workIcon}
            newChatIcon={newChatIcon}
            searchIcon={searchIcon}
            pluginsIcon={pluginsIcon}
            settingsIconUrl={settingsIconUrl}
            conversationsCount={conversations.length}
          />
        </aside>
      </>
    )
  }

  if (sidebarCollapsed) {
    return (
      <div
        className="relative flex h-full w-12 flex-col items-center border-r border-[var(--border)] bg-[var(--bg-secondary)] py-3"
        style={transitionStyle}
      >
        <button
          onClick={() => setSidebarCollapsed(false)}
          title="Expand sidebar (Ctrl+B)"
          aria-label="Expand sidebar"
          className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <Chevron direction="right" size={14} />
        </button>
        <button
          onClick={handleNewChat}
          title="New chat (Ctrl+N)"
          aria-label="New chat"
          className="mt-2 rounded-md p-1.5 transition-colors hover:bg-[var(--bg-tertiary)]"
        >
          <img src={newChatIcon} alt="" aria-hidden className="icon-asset h-[28px] w-[28px] object-contain" />
        </button>
        <button
          onClick={handleSearchClick}
          title="Search (Ctrl+K)"
          aria-label="Search"
          className="mt-1 rounded-md p-1.5 transition-colors hover:bg-[var(--bg-tertiary)]"
        >
          <img src={searchIcon} alt="" aria-hidden className="icon-asset h-[28px] w-[28px] object-contain" />
        </button>
        <button
          onClick={() => openSettings('mcp')}
          title="Plugins"
          aria-label="Plugins"
          className="mt-1 rounded-md p-1.5 transition-colors hover:bg-[var(--bg-tertiary)]"
        >
          <img src={pluginsIcon} alt="" aria-hidden className="icon-asset h-[28px] w-[28px] object-contain" />
        </button>
        <button
          onClick={() => openSettings('automations')}
          title="Automations"
          aria-label="Automations"
          className="mt-1 rounded-md p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <ClockIcon size={22} />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => openSettings()}
          title="Settings (Ctrl+,)"
          aria-label="Settings"
          className="rounded-md p-1.5 transition-colors hover:bg-[var(--bg-tertiary)]"
        >
          <img src={settingsIconUrl} alt="" aria-hidden className="icon-asset h-[28px] w-[28px] object-contain" />
        </button>
      </div>
    )
  }

  return (
    <div
      className="relative flex h-full flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)]"
      style={{ width: sidebarWidth, minWidth: sidebarWidth, ...(transitionStyle ?? {}) }}
    >
      <SidebarBody
        sidebarWidth={sidebarWidth}
        collapsed={false}
        setSidebarCollapsed={setSidebarCollapsed}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        handleBack={handleBack}
        handleForward={handleForward}
        handleNewChat={handleNewChat}
        handleSearchClick={handleSearchClick}
        openSettings={openSettings}
        filterVisible={filterVisible}
        setFilterVisible={setFilterVisible}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchRef={searchRef}
        handleAddProject={handleAddProject}
        groups={groups}
        orphanGroups={orphanGroups}
        isProjectExpanded={isProjectExpanded}
        toggleProjectExpanded={toggleProjectExpanded}
        visibleLimitFor={visibleLimitFor}
        showMore={showMore}
        showLess={showLess}
        activeConversationId={activeConversationId}
        selectConversation={(id) => void selectConversation(id)}
        handleDelete={handleDelete}
        handleRename={handleRename}
        handleTogglePin={handleTogglePin}
        handleArchive={handleArchive}
        openFolder={(p) => openFolder(p.id)}
        copyPath={(p) => copyPath(p.id)}
        handleNewChatInProject={handleNewChatInProject}
        folderIcon={folderIcon}
        workIcon={workIcon}
        newChatIcon={newChatIcon}
        searchIcon={searchIcon}
        pluginsIcon={pluginsIcon}
        settingsIconUrl={settingsIconUrl}
        conversationsCount={conversations.length}
      />

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

interface SidebarBodyProps {
  sidebarWidth: number
  collapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  canGoBack: boolean
  canGoForward: boolean
  handleBack: () => void
  handleForward: () => void
  handleNewChat: () => Promise<void> | void
  handleSearchClick: () => void
  openSettings: (tab?: 'mcp' | 'automations') => void
  filterVisible: boolean
  setFilterVisible: (v: boolean) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  searchRef: React.RefObject<HTMLInputElement | null>
  handleAddProject: () => void
  groups: ProjectGroup[]
  orphanGroups: OrphanGroup[]
  isProjectExpanded: (id: string) => boolean
  toggleProjectExpanded: (id: string) => void
  visibleLimitFor: (id: string) => number
  showMore: (id: string) => void
  showLess: (id: string) => void
  activeConversationId: string | null
  selectConversation: (id: string) => void
  handleDelete: (id: string, title: string) => void
  handleRename: (p: Project) => void
  handleTogglePin: (p: Project) => void
  handleArchive: (p: Project) => void
  openFolder: (p: Project) => void
  copyPath: (p: Project) => void
  handleNewChatInProject: (p: Project) => void
  folderIcon: string
  workIcon: string
  newChatIcon: string
  searchIcon: string
  pluginsIcon: string
  settingsIconUrl: string
  conversationsCount: number
}
function SidebarBody(props: SidebarBodyProps) {
  const {
    setSidebarCollapsed,
    canGoBack,
    canGoForward,
    handleBack,
    handleForward,
    handleNewChat,
    handleSearchClick,
    openSettings,
    filterVisible,
    setFilterVisible,
    searchQuery,
    setSearchQuery,
    searchRef,
    handleAddProject,
    groups,
    orphanGroups,
    isProjectExpanded,
    toggleProjectExpanded,
    visibleLimitFor,
    showMore,
    showLess,
    activeConversationId,
    selectConversation,
    handleDelete,
    handleRename,
    handleTogglePin,
    handleArchive,
    openFolder,
    copyPath,
    handleNewChatInProject,
    folderIcon,
    workIcon,
    newChatIcon,
    searchIcon,
    pluginsIcon,
    settingsIconUrl,
    conversationsCount
  } = props

  return (
    <>
      {/* Top chrome row — collapse, back, forward. */}
      <div className="flex items-center gap-1 px-3 pt-3">
        <button
          onClick={() => setSidebarCollapsed(true)}
          title="Collapse sidebar (Ctrl+B)"
          aria-label="Collapse sidebar"
          className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <Chevron direction="left" size={14} />
        </button>
        <button
          onClick={handleBack}
          disabled={!canGoBack}
          title="Back"
          aria-label="Back"
          className="rounded p-1 text-[var(--text-muted)] transition-colors enabled:hover:bg-[var(--bg-tertiary)] enabled:hover:text-[var(--text-primary)] disabled:opacity-30"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          onClick={handleForward}
          disabled={!canGoForward}
          title="Forward"
          aria-label="Forward"
          className="rounded p-1 text-[var(--text-muted)] transition-colors enabled:hover:bg-[var(--bg-tertiary)] enabled:hover:text-[var(--text-primary)] disabled:opacity-30"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className="space-y-0.5 px-2 pt-2">
        <NavRow
          icon={newChatIcon}
          label="New chat"
          shortcut="Ctrl+N"
          onClick={() => void handleNewChat()}
        />
        <div data-sidebar-search-row>
          <NavRow icon={searchIcon} label="Search" shortcut="Ctrl+K" onClick={handleSearchClick} />
        </div>
        <NavRow
          icon={pluginsIcon}
          label="Plugins"
          onClick={() => openSettings('mcp')}
        />
        <NavRow
          iconNode={<ClockIcon size={22} />}
          label="Automations"
          onClick={() => openSettings('automations')}
        />
      </div>

      {filterVisible && (
        <div className="px-3 pt-3">
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
                if (!searchQuery.trim()) setFilterVisible(false)
              }}
              placeholder="Filter conversations…"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 pl-7 text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between px-3">
        <span className="text-[12px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Projects
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleAddProject}
            title="New project"
            aria-label="New project"
            className="rounded px-1 py-0.5 text-[14px] leading-none text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => useUiStore.getState().openWorktreeModal()}
            className="rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            title="Manage git worktrees"
          >
            worktrees
          </button>
        </div>
      </div>

      <div className="mx-3 mt-2 flex-1 overflow-y-auto pl-1 pr-1 scrollbar-visible">
        {groups.length === 0 && conversationsCount === 0 && (
          <p className="px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">
            No projects yet. Click + to create one.
          </p>
        )}

        {groups.map((group) =>
          group.project ? (
            <ProjectSection
              key={group.project.id}
              group={group}
              expanded={isProjectExpanded(group.project.id)}
              onToggleExpanded={() => toggleProjectExpanded(group.project!.id)}
              visibleLimit={visibleLimitFor(group.project.id)}
              onShowMore={() => showMore(group.project!.id)}
              onShowLess={() => showLess(group.project!.id)}
              activeConversationId={activeConversationId}
              onSelectConversation={selectConversation}
              onDeleteConversation={handleDelete}
              onRename={handleRename}
              onTogglePin={handleTogglePin}
              onArchive={handleArchive}
              onOpenFolder={openFolder}
              onCopyPath={copyPath}
              onNewChatInProject={handleNewChatInProject}
              folderIcon={folderIcon}
              workIcon={workIcon}
            />
          ) : null
        )}

        {orphanGroups.length > 0 && (
          <>
            <div className="mt-4 mb-1 flex items-center justify-between px-2">
              <span className="text-[12px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                Chats
              </span>
            </div>
            {orphanGroups.map((group) => (
              <div key={group.label} className="mb-1">
                <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  {group.label}
                </div>
                {group.items.map((conv) => (
                  <ConversationRow
                    key={conv.id}
                    conv={conv}
                    active={activeConversationId === conv.id}
                    onSelect={() => selectConversation(conv.id)}
                    onDelete={() => handleDelete(conv.id, conv.title)}
                    workIcon={workIcon}
                  />
                ))}
              </div>
            ))}
          </>
        )}

        {groups.length > 0 && orphanGroups.length === 0 && conversationsCount === 0 && (
          <p className="px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">
            Start your first conversation.
          </p>
        )}

        {searchQuery && groups.every((g) => g.conversations.length === 0) && orphanGroups.length === 0 && (
          <p className="px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">
            No matches for "{searchQuery}".
          </p>
        )}
      </div>

      <div className="border-t border-[var(--border)] px-2 pb-2 pt-2">
        <NavRow
          icon={settingsIconUrl}
          label="Settings"
          shortcut="Ctrl+,"
          onClick={() => openSettings()}
        />
      </div>
    </>
  )
}
