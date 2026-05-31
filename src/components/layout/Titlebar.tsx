import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { useUiStore } from '@/stores/ui-store'
import { useThemedIcon } from '@/lib/themed-icon'
import { THEME_PRESETS, getActiveTokens, getPreset } from '@/styles/theme-presets'
import workLight from '@assets/Lamprey Work Location Icon.png'
import workDark from '@assets/Lamprey Work Location Icon Dark View.png'
import settingsLight from '@assets/Lamprey Settings Icon.png'
import settingsDark from '@assets/Lamprey Settings Icon Dark View.png'

interface TitlebarProps {
  onSettingsClick: () => void
}

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties

export function Titlebar({ onSettingsClick }: TitlebarProps) {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const toggleThemeMode = useSettingsStore((s) => s.toggleThemeMode)
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
  const rightPanelCollapsed = useUiStore((s) => s.rightPanelCollapsed)
  const activePreset = getPreset(settings.themePreset)
  const activeTokens = getActiveTokens(activePreset, settings.themeMode)
  const isDark = settings.themeMode === 'dark'
  const settingsIconUrl = useThemedIcon(settingsLight, settingsDark)
  const workIconUrl = useThemedIcon(workLight, workDark)

  const [isMaximized, setIsMaximized] = useState(false)
  const [folderName, setFolderName] = useState('')

  useEffect(() => {
    if (!window.api?.window) return
    window.api.window.isMaximized().then((r) => {
      if (r.success) setIsMaximized(Boolean(r.data))
    })
    return window.api.window.onMaximizedChanged((m) => setIsMaximized(m))
  }, [])

  useEffect(() => {
    if (!window.api?.app?.getWorkingFolder) return
    window.api.app.getWorkingFolder().then((r) => {
      if (r.success && r.data?.name) setFolderName(r.data.name)
    })
  }, [])

  const handleMinimize = () => window.api?.window?.minimize()
  const handleMaximize = () => window.api?.window?.maximizeToggle()
  const handleClose = () => window.api?.window?.close()

  return (
    <div
      className="flex h-16 items-stretch border-b border-[var(--border)] bg-[var(--bg-secondary)]"
      style={DRAG}
    >
      <div className="flex flex-1 items-center gap-4 pl-4">
        <span
          className="flex items-center gap-2 font-mono text-sm font-semibold tracking-wide text-[var(--text-primary)]"
          title={folderName ? `Working folder: ${folderName}` : 'Working folder'}
        >
          <img
            src={workIconUrl}
            alt=""
            aria-hidden
            className="icon-asset h-[45px] w-[45px] object-contain"
          />
          <span className="max-w-[260px] truncate">{folderName || 'Lamprey'}</span>
        </span>
      </div>

      <div className="flex items-center gap-2 px-3" style={NO_DRAG}>
        <label
          className="relative flex cursor-pointer items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
            onChange={(e) => updateSettings({ themePreset: e.target.value as typeof settings.themePreset })}
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        <button
          onClick={onSettingsClick}
          className="rounded p-1 transition-colors hover:bg-[var(--bg-tertiary)]"
          title="Settings (Ctrl+,)"
        >
          <img src={settingsIconUrl} alt="Settings" className="icon-asset h-9 w-9 object-contain" />
        </button>
      </div>

      <div className="flex flex-col" style={NO_DRAG}>
        <div className="flex">
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
                <rect x="3.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
                <rect x="1.5" y="3.5" width="7" height="7" fill="var(--bg-secondary)" stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
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
        <div className="flex flex-1 items-center justify-end pr-1.5">
          <button
            onClick={toggleRightPanel}
            title={rightPanelCollapsed ? 'Show right panel' : 'Hide right panel'}
            aria-label="Toggle right panel"
            className="rounded p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line x1="15" y1="4" x2="15" y2="20" />
            </svg>
          </button>
        </div>
      </div>
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
    <button onClick={onClick} title={title} aria-label={ariaLabel} className={`${baseClass} ${hoverClass}`}>
      {children}
    </button>
  )
}
