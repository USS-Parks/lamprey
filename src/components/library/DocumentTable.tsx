import { useRagStore } from '@/stores/rag-store'
import type { RagDocument, RagDocumentStatus } from '@/lib/types'

const STATUS_STYLES: Record<RagDocumentStatus, { dot: string; label: string }> = {
  queued: { dot: 'bg-[var(--text-muted)]', label: 'queued' },
  loading: { dot: 'bg-amber-500', label: 'loading' },
  chunking: { dot: 'bg-amber-500', label: 'chunking' },
  embedding: { dot: 'bg-amber-500', label: 'embedding' },
  ready: { dot: 'bg-green-500', label: 'ready' },
  error: { dot: 'bg-red-500', label: 'error' },
  stale: { dot: 'bg-[var(--text-muted)]', label: 'stale' }
}

export function DocumentTable({ collectionId }: { collectionId: string }) {
  const documents = useRagStore((s) => s.documents.get(collectionId) ?? [])
  const loading = useRagStore((s) => s.documentsLoading.has(collectionId))
  const reingest = useRagStore((s) => s.reingestDocument)
  const remove = useRagStore((s) => s.deleteDocument)

  if (loading && documents.length === 0) {
    return (
      <p className="font-mono text-[11px] text-[var(--text-muted)]">
        Loading documents…
      </p>
    )
  }
  if (documents.length === 0) {
    return (
      <p className="font-mono text-[11px] text-[var(--text-muted)]">
        Drop files into the dropzone above to start indexing.
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded border border-[var(--border)]">
      <table className="w-full font-mono text-[11px]">
        <thead className="sticky top-0 bg-[var(--bg-secondary)]">
          <tr className="text-left text-[var(--text-muted)]">
            <th className="px-2 py-1">Name</th>
            <th className="px-2 py-1">Status</th>
            <th className="px-2 py-1">Chunks</th>
            <th className="px-2 py-1">Ingested</th>
            <th className="px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              onReingest={() => reingest(doc.id)}
              onDelete={() => {
                if (confirm(`Delete "${doc.displayName}"?`)) remove(doc.id)
              }}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DocumentRow({
  doc,
  onReingest,
  onDelete
}: {
  doc: RagDocument
  onReingest: () => void
  onDelete: () => void
}) {
  const style = STATUS_STYLES[doc.status]
  return (
    <tr className="border-t border-[var(--border)]/50">
      <td className="truncate px-2 py-1 text-[var(--text-primary)]" title={doc.sourcePath ?? doc.displayName}>
        {doc.displayName}
      </td>
      <td className="px-2 py-1">
        <span className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${style.dot}`}
            aria-hidden
          />
          <span className="text-[var(--text-secondary)]">{style.label}</span>
          {doc.status === 'error' && doc.statusDetail && (
            <span
              className="ml-1 truncate text-red-400"
              title={doc.statusDetail}
            >
              · {doc.statusDetail}
            </span>
          )}
        </span>
      </td>
      <td className="px-2 py-1 text-[var(--text-secondary)]">{doc.chunkCount}</td>
      <td className="px-2 py-1 text-[var(--text-muted)]">
        {doc.ingestedAt
          ? new Date(doc.ingestedAt).toLocaleString()
          : '—'}
      </td>
      <td className="px-2 py-1 text-right">
        {doc.sourcePath && (
          <button
            onClick={onReingest}
            className="mr-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="Reindex from source"
          >
            ↻
          </button>
        )}
        <button
          onClick={onDelete}
          className="text-[var(--text-muted)] hover:text-red-400"
          title="Delete"
          aria-label="Delete document"
        >
          ×
        </button>
      </td>
    </tr>
  )
}
