import { useEffect, useState } from 'react'
import type { CitationSource, RagChunk } from '@/lib/types'

interface SourcePreviewPaneProps {
  source: CitationSource | null
  onClose: () => void
}

// Slide-in right pane that shows the chunk text behind a citation. Reads
// the chunk via the new rag:chunk:get IPC. Wraps content in a styled card
// matching the rest of the right-rail surfaces.

export function SourcePreviewPane({ source, onClose }: SourcePreviewPaneProps) {
  const [chunk, setChunk] = useState<RagChunk | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!source) {
      setChunk(null)
      return
    }
    setLoading(true)
    setError(null)
    const fetchChunk = async (): Promise<void> => {
      if (!window.api?.rag?.chunk) {
        setError('chunk lookup unavailable')
        setLoading(false)
        return
      }
      const res = await window.api.rag.chunk.get(source.chunkId)
      if (res?.success) setChunk(res.data as RagChunk)
      else setError(res?.error ?? 'chunk lookup failed')
      setLoading(false)
    }
    void fetchChunk()
  }, [source])

  if (!source) return null

  return (
    <div className="flex h-full w-[360px] flex-col border-l border-[var(--border)] bg-[var(--bg-secondary)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <div className="flex flex-col">
          <span className="truncate font-mono text-[12px] text-[var(--text-primary)]" title={source.displayName}>
            {source.displayName}
          </span>
          {source.locator && (
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              {source.locator}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading && (
          <p className="font-mono text-[11px] text-[var(--text-muted)]">Loading…</p>
        )}
        {error && (
          <p className="font-mono text-[11px] text-red-400">{error}</p>
        )}
        {chunk && (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--text-primary)]">
            {chunk.text}
          </pre>
        )}
      </div>
    </div>
  )
}
