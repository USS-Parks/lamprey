import { useEffect, useMemo, useRef, useState } from 'react'
import { rankFiles } from '@/lib/file-rank'

// Fluidity J3: @file mention popover. Triggered by ChatInput whenever the
// caret sits inside an `@<token>` run (with the code-fence guard in
// `file-rank.detectAtMention`). The popover lists matching workspace
// files, ranked by name overlap, and emits the picked relative path on
// Tab/Enter or click.
//
// Lifecycle:
//   - ChatInput owns the workspace-file index (one walkProject() per
//     mount, cached) and passes `files` + `query` in.
//   - On selection, `onApply(relPath)` writes a token back into the
//     textarea — ChatInput is responsible for inserting "@<basename>"
//     and queuing the attachment via `addAttachments`.
//   - Esc closes; ArrowUp/Down walk; Enter/Tab apply the active row.

interface AtFileMentionProps {
  query: string
  files: readonly string[]
  loading: boolean
  onApply: (relPath: string) => void
  onClose: () => void
}

export function AtFileMention({
  query,
  files,
  loading,
  onApply,
  onClose
}: AtFileMentionProps) {
  const [activeIdx, setActiveIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const ranked = useMemo(() => rankFiles(query, files), [query, files])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    if (activeIdx >= ranked.length) setActiveIdx(0)
  }, [ranked, activeIdx])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (ranked.length === 0 && e.key !== 'Escape') return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => (i + 1) % Math.max(1, ranked.length))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => (i - 1 + ranked.length) % Math.max(1, ranked.length))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const picked = ranked[activeIdx]
        if (picked) {
          e.preventDefault()
          e.stopPropagation()
          onApply(picked)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    // capture: true beats ChatInput's own keydown so Tab/Enter resolve the
    // mention instead of submitting the prompt or cycling permissions.
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [ranked, activeIdx, onApply, onClose])

  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  return (
    <div className="pointer-events-auto absolute bottom-full left-0 mb-2 max-h-[260px] w-full max-w-md overflow-y-auto rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] shadow-md">
      {loading && (
        <p className="px-3 py-2 text-[11px] text-[var(--text-muted)]">
          Indexing workspace files…
        </p>
      )}
      {!loading && ranked.length === 0 && (
        <p className="px-3 py-2 text-[11px] text-[var(--text-muted)]">
          {query ? `No file matches “@${query}”.` : 'No files in workspace.'}
        </p>
      )}
      <div ref={listRef}>
        {ranked.map((rel, i) => {
          const sepIdx = Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('\\'))
          const dir = sepIdx >= 0 ? rel.slice(0, sepIdx) : ''
          const name = sepIdx >= 0 ? rel.slice(sepIdx + 1) : rel
          const active = i === activeIdx
          return (
            <button
              key={rel}
              data-idx={i}
              type="button"
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => onApply(rel)}
              className={
                'flex w-full items-baseline gap-2 border-b border-[var(--panel-border)] px-3 py-1.5 text-left text-[12px] transition-colors last:border-b-0 ' +
                (active
                  ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]')
              }
            >
              <span className="font-medium">{name}</span>
              {dir && (
                <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                  {dir}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="border-t border-[var(--panel-border)] px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
        ↑↓ pick · ⏎ insert · Esc cancel
      </div>
    </div>
  )
}
