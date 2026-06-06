import { useEffect, useRef, useState } from 'react'
import { useUiStore, type ToolId } from '@/stores/ui-store'
import addFileIcon from '@assets/Lamprey Add File Icon.png'
import autoReviewIcon from '@assets/Lamprey Auto-Review Icon.png'
import chatWindowIcon from '@assets/Lamprey Chat Window Icon.png'

interface ToolMenuItem {
  id: ToolId
  label: string
  shortcut?: string
  iconUrl?: string
  iconLightUrl?: string
  iconDarkUrl?: string
  Svg?: () => React.ReactElement
}

function BrowserGlyph(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M12 3a14 14 0 0 1 0 18" />
      <path d="M12 3a14 14 0 0 0 0 18" />
    </svg>
  )
}

function TerminalGlyph(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <polyline points="7 9 10 12 7 15" />
      <line x1="13" y1="16" x2="17" y2="16" />
    </svg>
  )
}

function PlusGlyph({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

interface AddToolMenuProps {
  variant?: 'expanded' | 'collapsed' | 'panel'
}

export function AddToolMenu({ variant = 'expanded' }: AddToolMenuProps) {
  const [open, setOpen] = useState(false)
  const setActiveTool = useUiStore((s) => s.setActiveTool)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const items: ToolMenuItem[] = [
    { id: 'files', label: 'Files', shortcut: 'Ctrl+P', iconUrl: addFileIcon },
    { id: 'sidechat', label: 'Side chat', iconUrl: chatWindowIcon },
    { id: 'browser', label: 'Browser', shortcut: 'Ctrl+T', Svg: BrowserGlyph },
    { id: 'review', label: 'Review', shortcut: 'Ctrl+Shift+G', iconUrl: autoReviewIcon },
    { id: 'terminal', label: 'Terminal', shortcut: 'Ctrl+`', Svg: TerminalGlyph }
  ]

  // Dismiss on outside click and Esc.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (target && wrapperRef.current && !wrapperRef.current.contains(target)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handlePick = (id: ToolId) => {
    setActiveTool(id)
    setOpen(false)
  }

  const buttonClass =
    variant === 'collapsed'
      ? 'rounded-md p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      : variant === 'panel'
      ? 'flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--panel-border)] bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-all hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      : 'flex h-7 w-7 items-center justify-center rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Open tool"
        aria-label="Open tool"
        aria-haspopup="menu"
        aria-expanded={open}
        className={buttonClass}
      >
        <PlusGlyph size={variant === 'panel' ? 32 : 16} />
      </button>

      {open && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="absolute left-0 top-[calc(100%+4px)] z-50 min-w-[220px] overflow-hidden rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.id}
              role="menuitem"
              type="button"
              onClick={() => handlePick(item.id)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--text-secondary)]">
                {item.iconUrl ? (
                  <img src={item.iconUrl} alt="" aria-hidden className="icon-asset themed-variant-light h-5 w-5 object-contain" />
                ) : item.Svg ? (
                  <item.Svg />
                ) : null}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.shortcut && (
                <span className="ml-auto shrink-0 font-mono text-[12px] text-[var(--text-muted)]">
                  {item.shortcut}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
