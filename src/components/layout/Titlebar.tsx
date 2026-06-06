import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { useUiStore, type ToolId } from '@/stores/ui-store'
import { useChatStore } from '@/stores/chat-store'
import { toast } from '@/stores/toast-store'
import { THEME_PRESETS, getActiveTokens, getPreset } from '@/styles/theme-presets'
import { ToolLauncherPopover } from '@/components/workspace/ToolLauncherPopover'
import settingsIconUrl from '@assets/Lamprey Settings Icon.png'
import lampreyLogo from '@assets/Lamprey Desktop Icon-1.png'

const TOOL_TITLES: Record<ToolId, string> = {
  files: 'Open file',
  sidechat: 'Side chat',
  browser: 'Browser',
  review: 'Review',
  terminal: 'Terminal',
  environment: 'Environment',
  sources: 'Sources',
  artifacts: 'Artifacts',
  plan: 'Plan',
  background: 'Background tasks'
}

interface TitlebarProps {
  onSettingsClick: () => void
}

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties

interface MenuItem {
  label?: string
  shortcut?: string
  onSelect?: () => void
  separator?: boolean
  disabled?: boolean
}

function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  onOutside: () => void,
  active: boolean
) {
  useEffect(() => {
    if (!active) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [active, onOutside, ref])
}

interface MenuButtonProps {
  label: string
  items: MenuItem[]
  open: boolean
  onToggle: () => void
  onClose: () => void
  onHover: () => void
}

function MenuButton({ label, items, open, onToggle, onClose, onHover }: MenuButtonProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  useClickOutside(wrapRef, onClose, open)
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        onMouseEnter={onHover}
        className={`rounded px-2 py-1 text-[13px] transition-colors ${
          open
            ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-[220px] overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--bg-secondary)] py-1 shadow-xl"
        >
          {items.map((item, i) =>
            item.separator ? (
              <div
                key={`sep-${i}`}
                className="my-1 border-t border-[var(--panel-border)]"
                aria-hidden
              />
            ) : (
              <button
                key={item.label}
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  onClose()
                  item.onSelect?.()
                }}
                className={`flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-[13px] transition-colors ${
                  item.disabled
                    ? 'cursor-not-allowed text-[var(--text-muted)] opacity-60'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">
                    {item.shortcut}
                  </span>
                )}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

// Collapsed-rail widths must match Sidebar's `w-12` (48px) and App's `w-8`
// (32px) — kept in sync manually so the centered logo never misaligns.
const SIDEBAR_COLLAPSED_PX = 48
const RIGHT_COLLAPSED_PX = 32

export function Titlebar({ onSettingsClick }: TitlebarProps) {
  const settings = useSettingsStore((s) => s.settings)
  const toggleThemeMode = useSettingsStore((s) => s.toggleThemeMode)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const rightPanelCollapsed = useUiStore((s) => s.rightPanelCollapsed)
  const rightPanelWidth = useUiStore((s) => s.rightPanelWidth)
  const requestSearchFocus = useUiStore((s) => s.requestSearchFocus)
  const createConversation = useChatStore((s) => s.createConversation)
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const selectConversation = useChatStore((s) => s.selectConversation)

  // Index into the conversation list (sorted as the store returns them).
  // null when nothing is selected yet — back goes to the first, forward to
  // the most recent.
  const activeIdx = conversations.findIndex((c) => c.id === activeConversationId)
  const canGoBack = conversations.length > 0 && activeIdx !== 0
  const canGoForward =
    conversations.length > 0 && activeIdx !== -1 && activeIdx < conversations.length - 1

  const goBack = () => {
    if (!conversations.length) return
    const next = activeIdx <= 0 ? 0 : activeIdx - 1
    void selectConversation(conversations[next].id)
  }
  const goForward = () => {
    if (!conversations.length) return
    if (activeIdx === -1) {
      void selectConversation(conversations[conversations.length - 1].id)
      return
    }
    const next = Math.min(conversations.length - 1, activeIdx + 1)
    void selectConversation(conversations[next].id)
  }
  const isDark = settings.themeMode === 'dark'

  const [isMaximized, setIsMaximized] = useState(false)
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  const effectiveSidebar = sidebarCollapsed ? SIDEBAR_COLLAPSED_PX : sidebarWidth
  const effectiveRight = rightPanelCollapsed ? RIGHT_COLLAPSED_PX : rightPanelWidth

  useEffect(() => {
    if (!window.api?.window) return
    window.api.window.isMaximized().then((r) => {
      if (r.success) setIsMaximized(Boolean(r.data))
    })
    return window.api.window.onMaximizedChanged((m) => setIsMaximized(m))
  }, [])

  const handleMinimize = () => window.api?.window?.minimize()
  const handleMaximize = () => window.api?.window?.maximizeToggle()
  const handleClose = () => window.api?.window?.close()
  const handleReload = () => window.api?.window?.reload?.()
  const handleDevTools = () => window.api?.window?.toggleDevTools?.()
  const handlePickFolder = async () => {
    try {
      const res = await window.api?.files?.pickWorkdir?.()
      if (res?.success && res.data) {
        toast.success(`Working folder set: ${res.data.name}`)
      }
    } catch {
      toast.error('Could not open folder picker')
    }
  }

  const fileMenu: MenuItem[] = [
    { label: 'New chat', shortcut: 'Ctrl+N', onSelect: () => createConversation() },
    { label: 'Search conversations', shortcut: 'Ctrl+K', onSelect: requestSearchFocus },
    { separator: true },
    { label: 'Open folder…', onSelect: handlePickFolder },
    { separator: true },
    { label: 'Exit Lamprey', onSelect: handleClose }
  ]

  const editMenu: MenuItem[] = [
    { label: 'Undo', shortcut: 'Ctrl+Z', onSelect: () => document.execCommand('undo') },
    { label: 'Redo', shortcut: 'Ctrl+Shift+Z', onSelect: () => document.execCommand('redo') },
    { separator: true },
    { label: 'Cut', shortcut: 'Ctrl+X', onSelect: () => document.execCommand('cut') },
    { label: 'Copy', shortcut: 'Ctrl+C', onSelect: () => document.execCommand('copy') },
    { label: 'Paste', shortcut: 'Ctrl+V', onSelect: () => document.execCommand('paste') },
    { separator: true },
    { label: 'Select all', shortcut: 'Ctrl+A', onSelect: () => document.execCommand('selectAll') }
  ]

  const viewMenu: MenuItem[] = [
    { label: 'Toggle sidebar', shortcut: 'Ctrl+B', onSelect: toggleSidebar },
    {
      label: rightPanelCollapsed ? 'Show artifacts panel' : 'Hide artifacts panel',
      onSelect: toggleRightPanel
    },
    { separator: true },
    {
      label: isDark ? 'Switch to light mode' : 'Switch to dark mode',
      onSelect: toggleThemeMode
    },
    { label: 'Settings', shortcut: 'Ctrl+,', onSelect: onSettingsClick }
  ]

  const windowMenu: MenuItem[] = [
    { label: 'Minimize', onSelect: handleMinimize },
    {
      label: isMaximized ? 'Restore' : 'Maximize',
      onSelect: handleMaximize
    },
    { separator: true },
    { label: 'Reload', shortcut: 'Ctrl+R', onSelect: handleReload },
    { label: 'Toggle DevTools', shortcut: 'Ctrl+Shift+I', onSelect: handleDevTools }
  ]

  const helpMenu: MenuItem[] = [
    {
      label: 'About Lamprey',
      onSelect: () => toast.info('Lamprey — multi-agent coding harness')
    },
    {
      label: 'View on GitHub',
      onSelect: () => toast.info('https://github.com/USS-Parks/lamprey')
    },
    {
      label: 'Report an issue',
      onSelect: () => toast.info('Open the GitHub repo and file an issue')
    }
  ]

  const menus: Array<{ label: string; items: MenuItem[] }> = [
    { label: 'File', items: fileMenu },
    { label: 'Edit', items: editMenu },
    { label: 'View', items: viewMenu },
    { label: 'Window', items: windowMenu },
    { label: 'Help', items: helpMenu }
  ]

  return (
    <div
      className="flex flex-col bg-transparent"
      style={DRAG}
    >
      {/* ─── Row 1 ─── nav + menus (left) · centered logo (over chat column) · window controls (right) */}
      <div className="relative flex h-9 items-stretch">
        <div className="flex items-center gap-3 pl-3" style={NO_DRAG}>
          <NavIconButton
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
            ariaLabel="Toggle sidebar"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line x1="9" y1="4" x2="9" y2="20" />
            </svg>
          </NavIconButton>
          <NavIconButton
            onClick={goBack}
            disabled={!canGoBack}
            title="Previous conversation"
            ariaLabel="Previous conversation"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </NavIconButton>
          <NavIconButton
            onClick={goForward}
            disabled={!canGoForward}
            title="Next conversation"
            ariaLabel="Next conversation"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </NavIconButton>
          <span className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden />
          {menus.map((m) => (
            <MenuButton
              key={m.label}
              label={m.label}
              items={m.items}
              open={openMenu === m.label}
              onToggle={() => setOpenMenu(openMenu === m.label ? null : m.label)}
              onClose={() => setOpenMenu(null)}
              onHover={() => {
                if (openMenu !== null) setOpenMenu(m.label)
              }}
            />
          ))}
        </div>

        {/* Centered logo — tracks the chat column as sidebar/right-panel resize. */}
        <div
          className="pointer-events-none absolute inset-y-0 flex items-center justify-center"
          style={{ left: effectiveSidebar, right: effectiveRight }}
          aria-hidden
        >
          <span className="flex items-center gap-2 font-mono text-[13px] font-semibold text-[var(--text-primary)]">
            <img
              src={lampreyLogo}
              alt=""
              aria-hidden
              className="h-6 w-6 object-contain"
            />
            <span className="tracking-wide">Lamprey</span>
          </span>
        </div>

        <div className="flex-1" />

        <div className="flex" style={NO_DRAG}>
          <WindowControlButton
            onClick={handleMinimize}
            title="Minimize"
            aria-label="Minimize"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </WindowControlButton>
          <WindowControlButton
            onClick={handleMaximize}
            title={isMaximized ? 'Restore' : 'Maximize'}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <rect
                  x="3.5"
                  y="1.5"
                  width="7"
                  height="7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
                <rect
                  x="1.5"
                  y="3.5"
                  width="7"
                  height="7"
                  fill="var(--bg-secondary)"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <rect
                  x="2"
                  y="2"
                  width="8"
                  height="8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            )}
          </WindowControlButton>
          <WindowControlButton
            onClick={handleClose}
            title="Close"
            aria-label="Close"
            variant="close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
              <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </WindowControlButton>
        </div>
      </div>

    </div>
  )
}

interface SecondaryToolbarProps {
  onSettingsClick: () => void
}

// Row 2 — extracted so it can render to the right of the sidebar instead of
// spanning the full window width. This lets the sidebar reach up flush with
// Row 1 of the Titlebar, with no gap.
export function SecondaryToolbar({ onSettingsClick }: SecondaryToolbarProps) {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const toggleThemeMode = useSettingsStore((s) => s.toggleThemeMode)
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
  const rightPanelCollapsed = useUiStore((s) => s.rightPanelCollapsed)
  const activeTool = useUiStore((s) => s.activeTool)
  const closeActiveTool = useUiStore((s) => s.closeActiveTool)

  const activePreset = getPreset(settings.themePreset)
  const activeTokens = getActiveTokens(activePreset, settings.themeMode)
  const isDark = settings.themeMode === 'dark'

  const launcherRef = useRef<HTMLButtonElement>(null)
  const [launcherOpen, setLauncherOpen] = useState(false)

  return (
    <div
      className="flex h-9 items-center gap-2 bg-[var(--bg-tertiary)] px-3"
      style={NO_DRAG}
    >
      {/* Tool launcher button: opens the Codex-style VS Code / File Explorer
          / Terminal / Git Bash / WSL popover. The mode label sits next to it
          so the active tool is always identified on the toolbar. */}
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setLauncherOpen((v) => !v)}
        title="Open tool"
        aria-haspopup="menu"
        aria-expanded={launcherOpen}
        className="flex items-center gap-1 rounded p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M16 4l4 2v12l-4 2-9-7 9-9z" />
          <path d="M16 4L4 12l12 8" />
        </svg>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {activeTool && (
        <button
          type="button"
          onClick={closeActiveTool}
          title={`Close ${TOOL_TITLES[activeTool]}`}
          className="flex items-center gap-1.5 rounded border border-[var(--panel-border)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
        >
          {TOOL_TITLES[activeTool]}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
      <ToolLauncherPopover
        open={launcherOpen}
        onClose={() => setLauncherOpen(false)}
        anchorRef={launcherRef}
      />
      <div className="flex-1" />

      <label
        className="relative flex cursor-pointer items-center gap-1.5 rounded border border-[var(--panel-border)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        title="Switch theme preset"
      >
        <span
          aria-hidden
          className="block h-2.5 w-2.5 rounded-full border border-black/40"
          style={{ backgroundColor: activeTokens.accent }}
        />
        <span className="max-w-[110px] truncate">{activePreset.name}</span>
        <select
          value={settings.themePreset}
          onChange={(e) =>
            updateSettings({ themePreset: e.target.value as typeof settings.themePreset })
          }
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Theme preset"
        >
          {THEME_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <button
        onClick={toggleThemeMode}
        className="rounded p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label="Toggle theme mode"
      >
        {isDark ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>

      <button
        onClick={onSettingsClick}
        className="rounded p-1 transition-colors hover:bg-[var(--bg-tertiary)]"
        title="Settings (Ctrl+,)"
      >
        <img
          src={settingsIconUrl}
          alt="Settings"
          className="icon-asset h-7 w-7 object-contain"
        />
      </button>

      <button
        onClick={toggleRightPanel}
        title={rightPanelCollapsed ? 'Show right panel' : 'Hide right panel'}
        aria-label="Toggle right panel"
        className="rounded p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="15" y1="4" x2="15" y2="20" />
        </svg>
      </button>
    </div>
  )
}

interface WindowControlButtonProps {
  onClick: () => void
  title: string
  'aria-label': string
  variant?: 'default' | 'close'
  children: React.ReactNode
}

interface NavIconButtonProps {
  onClick: () => void
  title: string
  ariaLabel: string
  disabled?: boolean
  children: React.ReactNode
}

function NavIconButton({
  onClick,
  title,
  ariaLabel,
  disabled,
  children
}: NavIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
        disabled
          ? 'cursor-not-allowed text-[var(--text-muted)] opacity-40'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  )
}

function WindowControlButton({
  onClick,
  title,
  'aria-label': ariaLabel,
  variant = 'default',
  children
}: WindowControlButtonProps) {
  const baseClass =
    'flex h-9 w-11 items-center justify-center text-[var(--text-secondary)] transition-colors'
  const hoverClass =
    variant === 'close'
      ? 'hover:bg-[var(--error)] hover:text-white'
      : 'hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={`${baseClass} ${hoverClass}`}
    >
      {children}
    </button>
  )
}
