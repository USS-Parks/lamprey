import type { ProcessedFile } from '@/lib/types'
import { useChatStore } from '@/stores/chat-store'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function kindLabel(file: ProcessedFile): string {
  if (file.kind === 'image') return 'Image'
  if (file.kind === 'pdf') return 'PDF document'
  if (file.kind === 'binary') return 'Binary file'
  if (file.kind === 'text') return 'Text file'
  if (file.kind === 'rag-pending') return 'Large file'
  return 'File'
}

function kindBadge(file: ProcessedFile) {
  if (file.kind === 'image') return 'IMG'
  if (file.kind === 'pdf') return 'PDF'
  if (file.kind === 'binary') return 'BIN'
  if (file.kind === 'rag-pending') return 'RAG'
  return 'TXT'
}

function ragPhaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'queued':
      return 'Queued for indexing…'
    case 'loading':
      return 'Loading…'
    case 'chunking':
      return 'Chunking…'
    case 'embedding':
      return 'Embedding…'
    case 'ready':
      return 'Indexed'
    case 'error':
      return 'Indexing failed'
    default:
      return 'Indexing…'
  }
}

function ragDescription(file: ProcessedFile): string {
  if (file.error) return file.error
  const phase = file.ragPhase ?? 'queued'
  const size = formatSize(file.size)
  if (phase === 'ready') {
    const chunks = file.ragChunkCount ?? 0
    return `Indexed · ${chunks} chunk${chunks === 1 ? '' : 's'} · ${size}`
  }
  if (phase === 'error') {
    return `Indexing failed · ${size}`
  }
  const pct = Math.round((file.ragProgress ?? 0) * 100)
  return `${ragPhaseLabel(phase)} ${pct}% · ${size}`
}

function Tile({ file, index }: { file: ProcessedFile; index: number }) {
  const removeAttachment = useChatStore((s) => s.removeAttachment)
  const isImage = file.kind === 'image' && !!file.content && !file.error
  const isRagPending = file.kind === 'rag-pending'
  const ragErrored = isRagPending && file.ragPhase === 'error'
  const ragReady = isRagPending && file.ragPhase === 'ready'
  const showError = !!file.error || ragErrored

  // Show kind + size — never the raw previewText. PDF/text extraction
  // routinely produces character-spaced or whitespace-noisy output
  // ("V C O D E A N A L Y S I S R E P O R T") that's unreadable in a chip.
  // The actual content still ships to the model on send (or via retrieval
  // for rag-pending kinds); the chip is just a "here's what's attached"
  // affordance.
  const description = isRagPending
    ? ragDescription(file)
    : file.error
      ? file.error
      : `${kindLabel(file)} · ${formatSize(file.size)}`

  const borderClass = showError
    ? 'border-[var(--error)] text-[var(--error)]'
    : ragReady
      ? 'border-[var(--accent)] text-[var(--text-secondary)]'
      : isRagPending
        ? 'border-[var(--border)] text-[var(--text-secondary)]'
        : 'border-[var(--border)] text-[var(--text-secondary)]'

  // Progress bar for rag-pending files mid-ingest. Sits as a thin strip
  // under the chip; clears when phase is ready or error (the description
  // text reflects terminal state instead).
  const showProgressBar = isRagPending && !ragReady && !ragErrored

  return (
    <div
      className={`group flex flex-col gap-1.5 rounded-2xl border bg-[var(--bg-primary)] px-3 py-2 text-[13px] shadow-sm ${borderClass}`}
    >
      <div className="flex items-center gap-3">
        {isImage ? (
          <img
            src={file.content}
            alt={file.name}
            className="h-9 w-9 flex-shrink-0 rounded-lg object-cover"
          />
        ) : (
          <span
            aria-hidden
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg font-mono text-[10px] tracking-wider ${
              ragReady
                ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
            }`}
          >
            {kindBadge(file)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-xs text-[var(--text-primary)]">{file.name}</div>
          <div className="truncate text-[12px] text-[var(--text-muted)]">{description}</div>
        </div>
        <button
          onClick={() => removeAttachment(index)}
          title="Remove attachment"
          className="rounded-full p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--error)]"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      {showProgressBar && (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]"
          aria-label="ingest progress"
        >
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200 ease-out"
            style={{ width: `${Math.round((file.ragProgress ?? 0) * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}

export function AttachmentPreview() {
  const attachments = useChatStore((s) => s.pendingAttachments)
  const processing = useChatStore((s) => s.attachmentsProcessing)

  if (attachments.length === 0 && !processing) return null

  return (
    <div className="mx-4 mb-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2.5 shadow-sm">
      {processing && (
        <div className="mb-1 text-[12px] text-[var(--text-muted)]">Processing attachments…</div>
      )}
      <div className="flex flex-wrap gap-2">
        {attachments.map((file, idx) => (
          <Tile key={`${file.name}-${idx}`} file={file} index={idx} />
        ))}
      </div>
    </div>
  )
}
