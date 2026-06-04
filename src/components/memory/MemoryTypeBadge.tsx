import type { MemoryType } from '@/lib/types'

// Small typography-only chip rendered next to a memory entry's title.
// Each type gets a distinct accent so the list scans by category at a
// glance without the user having to read the label every time.

const STYLES: Record<MemoryType, { label: string; classes: string }> = {
  user: {
    label: 'user',
    classes: 'bg-[var(--bg-tertiary)] text-blue-300 border-blue-900/50'
  },
  feedback: {
    label: 'feedback',
    classes: 'bg-[var(--bg-tertiary)] text-amber-300 border-amber-900/50'
  },
  project: {
    label: 'project',
    classes: 'bg-[var(--bg-tertiary)] text-emerald-300 border-emerald-900/50'
  },
  reference: {
    label: 'reference',
    classes: 'bg-[var(--bg-tertiary)] text-violet-300 border-violet-900/50'
  }
}

export function MemoryTypeBadge({ type, compact = false }: { type: MemoryType; compact?: boolean }) {
  const style = STYLES[type]
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 ${compact ? 'py-0' : 'py-0.5'} text-[10px] font-medium uppercase tracking-wider ${style.classes}`}
    >
      {style.label}
    </span>
  )
}

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference'
}
