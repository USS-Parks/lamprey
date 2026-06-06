import { useEffect, useMemo, useState } from 'react'
import { useRagStore } from '@/stores/rag-store'
import { CollectionList } from './CollectionList'
import { DocumentTable } from './DocumentTable'
import { IngestDropzone } from './IngestDropzone'
import { IngestProgressCard } from './IngestProgressCard'

// Library — RAG collections + documents browser. Embedded as a Settings tab
// (no full-page route in v1) so it inherits the existing dialog chrome.
// Two-pane layout: collections on the left, document table on the right.

export function LibraryView() {
  const collections = useRagStore((s) => s.collections)
  const activeId = useRagStore((s) => s.activeCollectionId)
  const embedders = useRagStore((s) => s.embedders)
  const activeEmbedderId = useRagStore((s) => s.activeEmbedderId)
  const loadCollections = useRagStore((s) => s.loadCollections)
  const loadEmbedders = useRagStore((s) => s.loadEmbedders)
  const createCollection = useRagStore((s) => s.createCollection)
  const setActiveEmbedder = useRagStore((s) => s.setActiveEmbedder)
  const bindProgress = useRagStore((s) => s.bindProgress)
  const unbindProgress = useRagStore((s) => s.unbindProgress)
  const ingestProgress = useRagStore((s) => s.ingestProgress)

  const [newName, setNewName] = useState('')

  useEffect(() => {
    void loadCollections()
    void loadEmbedders()
    bindProgress()
    return () => unbindProgress()
  }, [loadCollections, loadEmbedders, bindProgress, unbindProgress])

  const activeJobs = useMemo(
    () =>
      [...ingestProgress.values()].filter(
        (e) => e.phase !== 'ready' && e.phase !== 'error'
      ),
    [ingestProgress]
  )

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <h2 className="text-[14px] font-medium text-[var(--text-primary)]">Library</h2>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          Index local documents into collections. Embeddings, vectors, and search
          all run on-device — nothing leaves the machine.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New collection name…"
          className="flex-1 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-[12px] text-[var(--text-primary)] placeholder-[var(--text-muted)]"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName.trim()) {
              void createCollection({ name: newName.trim() })
              setNewName('')
            }
          }}
        />
        <button
          disabled={!newName.trim()}
          onClick={async () => {
            await createCollection({ name: newName.trim() })
            setNewName('')
          }}
          className="rounded border border-[var(--panel-border)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
        >
          + Collection
        </button>
        <select
          value={activeEmbedderId ?? ''}
          onChange={(e) => void setActiveEmbedder(e.target.value)}
          className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]"
        >
          {embedders.length === 0 && <option value="">Loading…</option>}
          {embedders.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="w-48 overflow-y-auto">
          <CollectionList />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {collections.length === 0 ? (
            <EmptyCollections />
          ) : activeId ? (
            <>
              <IngestDropzone collectionId={activeId} />
              {activeJobs.length > 0 && (
                <div className="flex flex-col gap-1">
                  {activeJobs.map((j) => (
                    <IngestProgressCard key={j.jobId + j.documentId} progress={j} />
                  ))}
                </div>
              )}
              <DocumentTable collectionId={activeId} />
            </>
          ) : (
            <p className="font-mono text-[11px] text-[var(--text-muted)]">
              Select a collection from the left.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyCollections() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded border border-dashed border-[var(--panel-border)] p-6 text-center">
      <p className="font-mono text-[12px] text-[var(--text-primary)]">
        No collections yet.
      </p>
      <p className="font-mono text-[11px] text-[var(--text-muted)]">
        Create one above to start indexing your files.
      </p>
    </div>
  )
}
