import { useEffect, useMemo, useRef, useState } from 'react'
import { useChaptersStore, type Chapter } from '@/stores/chapters-store'

// Track 2 / E2 — Ctrl+G chapter quick-jumper modal. Filters chapters
// by typed substring (title + summary) and scrolls to the picked one on
// Enter. Esc dismisses. Behaviour modelled on the VS Code Go-to-symbol
// palette.

interface ChapterQuickJumperProps {
  conversationId: string | null
}

function scrollToChapter(chapterId: string): void {
  const el = document.querySelector(`[data-chapter-id="${chapterId}"]`)
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function matchScore(c: Chapter, q: string): number {
  if (!q) return 1
  const ql = q.toLowerCase()
  const t = c.title.toLowerCase()
  if (t === ql) return 100
  if (t.startsWith(ql)) return 50
  if (t.includes(ql)) return 10
  if ((c.summary ?? '').toLowerCase().includes(ql)) return 1
  return 0
}

export function ChapterQuickJumper({ conversationId }: ChapterQuickJumperProps) {
  const chapters = useChaptersStore((s) => s.chapters)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault()
        if (!conversationId || chapters.length === 0) return
        setOpen(true)
        setQuery('')
        setActiveIdx(0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [conversationId, chapters.length])

  useEffect(() => {
    if (open) {
      // Focus the input after the modal mounts so type-to-filter starts
      // immediately.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const ranked = useMemo(() => {
    const scored = chapters
      .map((c) => ({ c, s: matchScore(c, query) }))
      .filter((x) => x.s > 0)
    scored.sort((a, b) => b.s - a.s || a.c.createdAt - b.c.createdAt)
    return scored.map((x) => x.c)
  }, [chapters, query])

  if (!open) return null

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'Enter') {
      const picked = ranked[activeIdx]
      if (picked) scrollToChapter(picked.id)
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (ranked.length) setActiveIdx((i) => (i + 1) % ranked.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (ranked.length) setActiveIdx((i) => (i - 1 + ranked.length) % ranked.length)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Jump to chapter"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] shadow-xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIdx(0)
          }}
          onKeyDown={handleKey}
          placeholder="Jump to chapter…"
          className="w-full rounded-t-md bg-transparent px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none"
        />
        <div className="max-h-[280px] overflow-y-auto border-t border-[var(--panel-border)]">
          {ranked.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">No matches.</div>
          )}
          {ranked.map((c, i) => {
            const active = i === activeIdx
            return (
              <button
                key={c.id}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => {
                  scrollToChapter(c.id)
                  setOpen(false)
                }}
                className={
                  'flex w-full items-start gap-2 border-b border-[var(--panel-border)] px-3 py-1.5 text-left last:border-b-0 ' +
                  (active ? 'bg-[var(--bg-secondary)]' : 'hover:bg-[var(--bg-secondary)]')
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-[var(--text-primary)]">{c.title}</div>
                  {c.summary && (
                    <div className="truncate text-[11px] text-[var(--text-muted)]">
                      {c.summary}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        <div className="border-t border-[var(--panel-border)] px-3 py-1 text-[10px] text-[var(--text-muted)]">
          ↑ ↓ navigate · Enter jump · Esc close
        </div>
      </div>
    </div>
  )
}
