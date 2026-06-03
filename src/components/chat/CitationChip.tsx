import type { CitationSource } from '@/lib/types'

interface CitationChipProps {
  ids: number[]
  raw: string
  sources?: CitationSource[]
  onOpen?: (source: CitationSource) => void
}

// Inline numbered citation chip. Hover → tooltip with displayName + locator.
// Click → opens the source preview pane via the supplied onOpen handler.

export function CitationChip({ ids, raw, sources, onOpen }: CitationChipProps) {
  const targets = ids
    .map((id) => sources?.find((s) => s.id === id))
    .filter((s): s is CitationSource => !!s)
  const label = targets.length > 0 ? targets.map((t) => t.displayName).join(', ') : raw
  return (
    <span className="inline-flex items-baseline gap-0.5">
      {ids.map((id, idx) => {
        const target = sources?.find((s) => s.id === id)
        return (
          <button
            key={`${id}-${idx}`}
            onClick={() => target && onOpen?.(target)}
            disabled={!target}
            title={
              target
                ? `${target.displayName}${target.locator ? ` · ${target.locator}` : ''}`
                : label
            }
            className="rounded-sm bg-[var(--bg-tertiary)] px-1 text-[10px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
          >
            {id}
          </button>
        )
      })}
    </span>
  )
}
