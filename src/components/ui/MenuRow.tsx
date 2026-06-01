import { forwardRef } from 'react'

interface MenuRowProps {
  label: string
  // Leading content: an icon or an <img>. Use null for unpadded text rows.
  leading?: React.ReactNode
  // Trailing slot: shortcut text, chevron, checkmark, count badge, etc.
  trailing?: React.ReactNode
  shortcut?: string
  selected?: boolean
  disabled?: boolean
  // Adds a right-chevron indicating a nested submenu. Overrides `trailing`
  // if both are set.
  hasSubmenu?: boolean
  // Adds an external-link glyph after the label.
  external?: boolean
  onSelect?: () => void
  role?: 'menuitem' | 'option'
  title?: string
}

function CheckGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ChevronRightGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
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
  )
}

function ExternalLinkGlyph(): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

export const MenuRow = forwardRef<HTMLButtonElement, MenuRowProps>(function MenuRow(
  {
    label,
    leading,
    trailing,
    shortcut,
    selected,
    disabled,
    hasSubmenu,
    external,
    onSelect,
    role = 'menuitem',
    title
  }: MenuRowProps,
  ref
) {
  const finalTrailing = hasSubmenu ? (
    <span className="text-[var(--text-muted)]">
      <ChevronRightGlyph />
    </span>
  ) : selected ? (
    <span className="text-[var(--text-secondary)]">
      <CheckGlyph />
    </span>
  ) : (
    trailing
  )

  return (
    <button
      ref={ref}
      type="button"
      role={role}
      aria-disabled={disabled || undefined}
      aria-selected={role === 'option' ? selected : undefined}
      disabled={disabled}
      onClick={() => {
        if (disabled) return
        onSelect?.()
      }}
      title={title}
      className={`flex w-full items-center gap-3 px-3 py-1.5 text-left text-[13px] transition-colors ${
        disabled
          ? 'cursor-not-allowed text-[var(--text-muted)] opacity-60'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] focus:bg-[var(--bg-tertiary)] focus:text-[var(--text-primary)] focus:outline-none'
      }`}
    >
      {leading !== undefined && (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-secondary)]">
          {leading}
        </span>
      )}
      <span className="flex-1 truncate">{label}</span>
      {external && (
        <span className="text-[var(--text-muted)]">
          <ExternalLinkGlyph />
        </span>
      )}
      {shortcut && (
        <span className="font-mono text-[11px] text-[var(--text-muted)]">{shortcut}</span>
      )}
      {finalTrailing}
    </button>
  )
})

export function MenuSeparator(): React.ReactElement {
  return <div className="my-1 border-t border-[var(--border)]" aria-hidden />
}

interface MenuSectionLabelProps {
  children: React.ReactNode
}

export function MenuSectionLabel({ children }: MenuSectionLabelProps): React.ReactElement {
  return (
    <div className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
      {children}
    </div>
  )
}
