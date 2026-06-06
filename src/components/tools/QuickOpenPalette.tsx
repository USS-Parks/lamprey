import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore } from '@/stores/ui-store'

interface FileIndex {
  root: string
  files: string[] // relative paths
  truncated: boolean
}

let CACHED: FileIndex | null = null

function score(query: string, candidate: string): number {
  // Lightweight subsequence scorer. Returns -Infinity if not a subsequence.
  // Otherwise smaller is better. Bonuses for prefix and basename matches.
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()
  let qi = 0
  let lastIdx = -1
  let gaps = 0
  for (let i = 0; i < c.length && qi < q.length; i++) {
    if (c[i] === q[qi]) {
      if (lastIdx >= 0) gaps += i - lastIdx - 1
      lastIdx = i
      qi++
    }
  }
  if (qi < q.length) return -Infinity
  let s = gaps + (c.length - q.length) * 0.1
  const base = candidate.slice(candidate.lastIndexOf('/') + 1).toLowerCase()
  const sep = candidate.lastIndexOf('\\')
  const baseWin = sep >= 0 ? candidate.slice(sep + 1).toLowerCase() : base
  if (baseWin.startsWith(q)) s -= 50
  else if (baseWin.includes(q)) s -= 20
  return -s
}

function rank(query: string, files: string[]): string[] {
  if (!query.trim()) return files.slice(0, 50)
  const scored: { f: string; s: number }[] = []
  for (const f of files) {
    const sc = score(query, f)
    if (sc !== -Infinity) scored.push({ f, s: sc })
  }
  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, 50).map((x) => x.f)
}

export function QuickOpenPalette() {
  const visible = useUiStore((s) => s.quickOpenVisible)
  const closeQuickOpen = useUiStore((s) => s.closeQuickOpen)
  const requestOpenFile = useUiStore((s) => s.requestOpenFile)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<FileIndex | null>(CACHED)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!visible) {
      setQuery('')
      setActiveIdx(0)
      return
    }
    setActiveIdx(0)
    requestAnimationFrame(() => inputRef.current?.focus())
    if (index || !window.api) return
    setLoading(true)
    setError(null)
    void (async () => {
      const wd = await window.api.files.getWorkdir()
      if (!wd.success || !wd.data) {
        setLoading(false)
        setError(wd.success ? 'No workspace.' : (wd.error ?? 'getWorkdir failed'))
        return
      }
      const root = wd.data.path
      const w = await window.api.files.walkProject(root)
      if (!w.success) {
        setLoading(false)
        setError(w.error ?? 'walkProject failed')
        return
      }
      const data = w.data as { files: string[]; truncated: boolean }
      const next: FileIndex = { root, files: data.files, truncated: data.truncated }
      CACHED = next
      setIndex(next)
      setLoading(false)
    })()
  }, [visible, index])

  const matches = useMemo(() => {
    if (!index) return [] as string[]
    return rank(query, index.files)
  }, [index, query])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeQuickOpen()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(matches.length - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        if (!index || !matches[activeIdx]) return
        e.preventDefault()
        const sep = index.root.includes('\\') ? '\\' : '/'
        const full = index.root + sep + matches[activeIdx]
        requestOpenFile(full)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, matches, activeIdx, index, closeQuickOpen, requestOpenFile])

  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 pt-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeQuickOpen()
      }}
    >
      <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--bg-primary)] shadow-xl">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={loading ? 'Indexing files…' : 'Type a filename…'}
          className="w-full bg-transparent px-4 py-3 text-[15px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <div className="border-t border-[var(--panel-border)]" />
        <div ref={listRef} className="max-h-[40vh] overflow-y-auto py-1">
          {error && (
            <p className="px-4 py-3 text-[13px] text-[var(--error)]">{error}</p>
          )}
          {!error && !loading && index && matches.length === 0 && (
            <p className="px-4 py-3 text-[13px] text-[var(--text-muted)]">
              {query ? 'No matches.' : 'No files in workspace.'}
            </p>
          )}
          {matches.map((rel, i) => {
            const sepIdx = Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('\\'))
            const dir = sepIdx >= 0 ? rel.slice(0, sepIdx) : ''
            const name = sepIdx >= 0 ? rel.slice(sepIdx + 1) : rel
            return (
              <button
                key={rel}
                data-idx={i}
                type="button"
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => {
                  if (!index) return
                  const sep = index.root.includes('\\') ? '\\' : '/'
                  requestOpenFile(index.root + sep + rel)
                }}
                className={`flex w-full items-baseline gap-2 px-4 py-1.5 text-left text-[13px] transition-colors ${
                  i === activeIdx
                    ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="font-medium">{name}</span>
                {dir && (
                  <span className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                    {dir}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {index?.truncated && (
          <div className="border-t border-[var(--panel-border)] px-4 py-1.5 text-[11px] text-[var(--text-muted)]">
            Index truncated at 5000 files.
          </div>
        )}
      </div>
    </div>
  )
}
