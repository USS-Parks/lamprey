import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '@/stores/ui-store'
import type {
  ConvFilters,
  ConvGroupBy,
  ConvLastActivity,
  ConvSortBy,
  ConvStatus
} from '@/stores/ui-store'

interface Option<T extends string> {
  value: T
  label: string
  description?: string
}

const STATUS_OPTIONS: Option<ConvStatus>[] = [
  { value: 'active', label: 'Active', description: 'Conversations in active rotation' },
  { value: 'all', label: 'All', description: 'Include archived conversations' }
]

const LAST_ACTIVITY_OPTIONS: Option<ConvLastActivity>[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' }
]

const GROUP_BY_OPTIONS: Option<ConvGroupBy>[] = [
  { value: 'date', label: 'Date', description: 'Today / Yesterday / This Week / Older' },
  { value: 'model', label: 'Model', description: 'Group by model used' },
  { value: 'none', label: 'None', description: 'Flat list' }
]

const SORT_BY_OPTIONS: Option<ConvSortBy>[] = [
  { value: 'recency', label: 'Recency', description: 'Most recently active first' },
  { value: 'created', label: 'Created', description: 'Newest created first' },
  { value: 'az', label: 'Title A–Z' },
  { value: 'za', label: 'Title Z–A' }
]

function labelFor<T extends string>(opts: Option<T>[], val: T): string {
  return opts.find((o) => o.value === val)?.label ?? String(val)
}

function ChevronRight() {
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
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function FiltersIcon() {
  return (
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
      <line x1="4" y1="6" x2="14" y2="6" />
      <line x1="4" y1="12" x2="10" y2="12" />
      <line x1="4" y1="18" x2="18" y2="18" />
      <circle cx="17" cy="6" r="2" />
      <circle cx="13" cy="12" r="2" />
      <circle cx="7" cy="18" r="2" />
    </svg>
  )
}

interface RowProps {
  label: string
  value: string
  muted?: boolean
  active: boolean
  onHover: () => void
  onClick: () => void
}

function Row({ label, value, muted, active, onHover, onClick }: RowProps) {
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-[13px] transition-colors ${
        active
          ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <span
          className={`text-[12px] ${muted ? 'text-[var(--text-muted)]' : 'text-[var(--accent)]'}`}
        >
          {value}
        </span>
        <ChevronRight />
      </span>
    </button>
  )
}

interface SubmenuProps<T extends string> {
  title: string
  options: Option<T>[]
  current: T
  disabled?: boolean
  disabledNote?: string
  onSelect: (v: T) => void
}

function Submenu<T extends string>({
  title,
  options,
  current,
  disabled,
  disabledNote,
  onSelect
}: SubmenuProps<T>) {
  return (
    <div className="min-w-[220px] overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--bg-secondary)] py-1 shadow-xl">
      <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
        {title}
      </div>
      {disabled && disabledNote && (
        <div className="px-3 pb-2 text-[11px] italic text-[var(--text-muted)]">{disabledNote}</div>
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled && o.value !== current}
          onClick={() => onSelect(o.value)}
          className={`flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-[13px] transition-colors ${
            o.value === current
              ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
              : disabled
              ? 'cursor-not-allowed text-[var(--text-muted)] opacity-50'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <span className="font-medium">{o.label}</span>
          {o.description && (
            <span className="text-[11px] text-[var(--text-muted)]">{o.description}</span>
          )}
        </button>
      ))}
    </div>
  )
}

type ActiveSub = 'status' | 'project' | 'environment' | 'lastActivity' | 'groupBy' | 'sortBy' | null

export function SidebarFilterMenu() {
  const filters = useUiStore((s) => s.convFilters)
  const setConvFilters = useUiStore((s) => s.setConvFilters)
  const resetConvFilters = useUiStore((s) => s.resetConvFilters)
  const [open, setOpen] = useState(false)
  const [activeSub, setActiveSub] = useState<ActiveSub>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setActiveSub(null)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const update = <K extends keyof ConvFilters>(key: K, value: ConvFilters[K]) => {
    setConvFilters({ [key]: value } as Partial<ConvFilters>)
    setActiveSub(null)
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          setActiveSub(null)
        }}
        title="Filter & sort conversations"
        aria-label="Filter & sort conversations"
        aria-expanded={open}
        className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
          open
            ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
        }`}
      >
        <FiltersIcon />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 flex items-start gap-1">
          <div className="min-w-[240px] overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--bg-secondary)] py-1 shadow-xl">
            <Row
              label="Status"
              value={labelFor(STATUS_OPTIONS, filters.status)}
              active={activeSub === 'status'}
              onHover={() => setActiveSub('status')}
              onClick={() => setActiveSub('status')}
            />
            <Row
              label="Project"
              value="All"
              muted
              active={activeSub === 'project'}
              onHover={() => setActiveSub('project')}
              onClick={() => setActiveSub('project')}
            />
            <Row
              label="Environment"
              value="All"
              muted
              active={activeSub === 'environment'}
              onHover={() => setActiveSub('environment')}
              onClick={() => setActiveSub('environment')}
            />
            <Row
              label="Last activity"
              value={labelFor(LAST_ACTIVITY_OPTIONS, filters.lastActivity)}
              active={activeSub === 'lastActivity'}
              onHover={() => setActiveSub('lastActivity')}
              onClick={() => setActiveSub('lastActivity')}
            />
            <div className="my-1 border-t border-[var(--panel-border)]" aria-hidden />
            <Row
              label="Group by"
              value={labelFor(GROUP_BY_OPTIONS, filters.groupBy)}
              active={activeSub === 'groupBy'}
              onHover={() => setActiveSub('groupBy')}
              onClick={() => setActiveSub('groupBy')}
            />
            <Row
              label="Sort by"
              value={labelFor(SORT_BY_OPTIONS, filters.sortBy)}
              active={activeSub === 'sortBy'}
              onHover={() => setActiveSub('sortBy')}
              onClick={() => setActiveSub('sortBy')}
            />
            <div className="my-1 border-t border-[var(--panel-border)]" aria-hidden />
            <button
              type="button"
              onClick={() => {
                resetConvFilters()
                setActiveSub(null)
              }}
              className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            >
              Reset to defaults
            </button>
          </div>

          {/* Submenu column — rendered to the LEFT of the main menu so it
              stays inside the sidebar instead of clipping off-screen on
              narrow windows. */}
          {activeSub && (
            <div className="-order-1">
              {activeSub === 'status' && (
                <Submenu
                  title="Status"
                  options={STATUS_OPTIONS}
                  current={filters.status}
                  onSelect={(v) => update('status', v)}
                />
              )}
              {activeSub === 'project' && (
                <Submenu
                  title="Project"
                  options={[{ value: 'all', label: 'All' }]}
                  current={filters.project}
                  disabled
                  disabledNote="Projects not configured for this workspace yet."
                  onSelect={() => {}}
                />
              )}
              {activeSub === 'environment' && (
                <Submenu
                  title="Environment"
                  options={[{ value: 'all', label: 'All' }]}
                  current={filters.environment}
                  disabled
                  disabledNote="Environments not configured for this workspace yet."
                  onSelect={() => {}}
                />
              )}
              {activeSub === 'lastActivity' && (
                <Submenu
                  title="Last activity"
                  options={LAST_ACTIVITY_OPTIONS}
                  current={filters.lastActivity}
                  onSelect={(v) => update('lastActivity', v)}
                />
              )}
              {activeSub === 'groupBy' && (
                <Submenu
                  title="Group by"
                  options={GROUP_BY_OPTIONS}
                  current={filters.groupBy}
                  onSelect={(v) => update('groupBy', v)}
                />
              )}
              {activeSub === 'sortBy' && (
                <Submenu
                  title="Sort by"
                  options={SORT_BY_OPTIONS}
                  current={filters.sortBy}
                  onSelect={(v) => update('sortBy', v)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
