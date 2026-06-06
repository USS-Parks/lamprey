import { useState } from 'react'
import { useRagStore } from '@/stores/rag-store'

export function CollectionList() {
  const collections = useRagStore((s) => s.collections)
  const activeId = useRagStore((s) => s.activeCollectionId)
  const documents = useRagStore((s) => s.documents)
  const selectCollection = useRagStore((s) => s.selectCollection)
  const renameCollection = useRagStore((s) => s.renameCollection)
  const deleteCollection = useRagStore((s) => s.deleteCollection)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  return (
    <div className="flex flex-col gap-0.5">
      {collections.map((c) => {
        const docCount = documents.get(c.id)?.length ?? 0
        const isActive = activeId === c.id
        const isRenaming = renamingId === c.id
        return (
          <div
            key={c.id}
            className={`group flex flex-col gap-0.5 rounded px-2 py-1.5 ${
              isActive
                ? 'bg-[var(--bg-tertiary)]'
                : 'hover:bg-[var(--bg-secondary)]'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              {isRenaming ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={async () => {
                    if (renameValue.trim() && renameValue.trim() !== c.name) {
                      await renameCollection(c.id, renameValue.trim())
                    }
                    setRenamingId(null)
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      await renameCollection(c.id, renameValue.trim())
                      setRenamingId(null)
                    }
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  className="flex-1 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-1 font-mono text-[11px] text-[var(--text-primary)]"
                />
              ) : (
                <button
                  onClick={() => selectCollection(c.id)}
                  onDoubleClick={() => {
                    setRenamingId(c.id)
                    setRenameValue(c.name)
                  }}
                  className="flex-1 truncate text-left font-mono text-[12px] text-[var(--text-primary)]"
                  title={c.name}
                >
                  {c.name}
                </button>
              )}
              <button
                onClick={async () => {
                  if (confirm(`Delete collection "${c.name}" and all its documents?`)) {
                    await deleteCollection(c.id)
                  }
                }}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Delete collection"
                title="Delete"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-[var(--text-muted)] hover:text-red-400"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              {docCount} {docCount === 1 ? 'doc' : 'docs'} · {c.embedderId}
            </span>
          </div>
        )
      })}
    </div>
  )
}
