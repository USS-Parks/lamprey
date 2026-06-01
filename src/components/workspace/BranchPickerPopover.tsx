import { useEffect, useState } from 'react'
import { PopoverMenu } from '@/components/ui/PopoverMenu'
import { MenuRow, MenuSeparator, MenuSectionLabel } from '@/components/ui/MenuRow'
import { toast } from '@/stores/toast-store'
import type { BranchItem } from '@/lib/types'

interface BranchPickerPopoverProps {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
  onChanged?: () => void
}

function BranchGlyph(): React.ReactElement {
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
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

function PlusGlyph(): React.ReactElement {
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function BranchPickerPopover({
  open,
  onClose,
  anchorRef,
  onChanged
}: BranchPickerPopoverProps): React.ReactElement {
  const [branches, setBranches] = useState<BranchItem[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  useEffect(() => {
    if (!open) {
      setFilter('')
      setCreating(false)
      setNewName('')
      return
    }
    if (!window.api?.review?.branches) return
    setLoading(true)
    void window.api.review.branches().then((res) => {
      setLoading(false)
      if (!res.success) {
        toast.error(res.error ?? 'Could not list branches')
        return
      }
      const data = res.data as { branches: BranchItem[] }
      setBranches(data.branches ?? [])
    })
  }, [open])

  const filtered = branches.filter((b) =>
    filter ? b.name.toLowerCase().includes(filter.toLowerCase()) : true
  )

  const handleCheckout = async (name: string) => {
    if (!window.api?.review?.checkout) return
    const res = await window.api.review.checkout({ name })
    if (!res.success) {
      toast.error(res.error ?? `Checkout ${name} failed`)
      return
    }
    toast.success(`Switched to ${name}`)
    onClose()
    onChanged?.()
  }

  const handleCreate = async () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    if (!window.api?.review?.createBranch) return
    const res = await window.api.review.createBranch({ name: trimmed })
    if (!res.success) {
      toast.error(res.error ?? 'Create branch failed')
      return
    }
    toast.success(`Created and checked out ${trimmed}`)
    onClose()
    onChanged?.()
  }

  return (
    <PopoverMenu
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      align="bottom-start"
      width={380}
      role="dialog"
      ariaLabel="Branches"
      autoFocus={false}
    >
      <div className="px-2 py-1.5">
        <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5">
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
            className="text-[var(--text-muted)]"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search branches"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            className="flex-1 bg-transparent text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
        </div>
      </div>

      <MenuSectionLabel>Branches</MenuSectionLabel>

      <div className="max-h-[260px] overflow-y-auto">
        {loading && (
          <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">Loading…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">
            {filter ? 'No matches' : 'No branches'}
          </div>
        )}
        {filtered.map((b) => (
          <MenuRow
            key={b.name}
            label={b.name}
            leading={<BranchGlyph />}
            selected={b.current}
            onSelect={() => void handleCheckout(b.name)}
            title={b.upstream ? `Tracks ${b.upstream}` : undefined}
          />
        ))}
      </div>

      <MenuSeparator />

      {creating ? (
        <div className="flex items-center gap-1 px-2 py-1.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleCreate()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setCreating(false)
                setNewName('')
              }
            }}
            placeholder="branch-name"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!newName.trim()}
            className="rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 py-1 text-[11px] text-[var(--text-primary)] disabled:opacity-50"
          >
            Create
          </button>
        </div>
      ) : (
        <MenuRow
          label="Create and checkout new branch…"
          leading={<PlusGlyph />}
          onSelect={() => setCreating(true)}
        />
      )}
    </PopoverMenu>
  )
}
