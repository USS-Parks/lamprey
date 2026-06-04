import { useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '@/stores/sessions-store'

// E3 — search input for the Sessions sidebar.
//
// Debounces typing to 200ms so a busy keystroke doesn't fan out an FTS
// query per character. The sessions-store owns the actual scan; we just
// drive `setQuery`.

interface Props {
  placeholder?: string
}

export function SessionSearchBar({ placeholder = 'Search sessions…' }: Props) {
  const setQuery = useSessionsStore((s) => s.setQuery)
  const liveQuery = useSessionsStore((s) => s.query)
  const loading = useSessionsStore((s) => s.loading)
  const [value, setValue] = useState(liveQuery)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  const onChange = (next: string) => {
    setValue(next)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setQuery(next), 200)
  }

  const clear = () => {
    setValue('')
    setQuery('')
  }

  return (
    <div className="relative px-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 pr-8 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        type="search"
        aria-label="Search sessions"
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          title="Clear"
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          ×
        </button>
      )}
      {loading && (
        <span className="absolute right-7 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
          …
        </span>
      )}
    </div>
  )
}
