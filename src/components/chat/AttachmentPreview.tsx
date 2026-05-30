import type { ProcessedFile } from '@/lib/types'
import { useChatStore } from '@/stores/chat-store'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function kindIcon(file: ProcessedFile) {
  if (file.kind === 'image') return '🖼'
  if (file.kind === 'pdf') return '📄'
  if (file.kind === 'binary') return '📦'
  return '📝'
}

function Tile({ file, index }: { file: ProcessedFile; index: number }) {
  const removeAttachment = useChatStore((s) => s.removeAttachment)
  const isImage = file.kind === 'image' && !!file.content && !file.error

  return (
    <div
      className={`group flex items-center gap-2 rounded border bg-[var(--bg-primary)] px-2 py-1.5 text-[11px] ${
        file.error
          ? 'border-[var(--error)] text-[var(--error)]'
          : 'border-[var(--border)] text-[var(--text-secondary)]'
      }`}
    >
      {isImage ? (
        <img
          src={file.content}
          alt={file.name}
          className="h-8 w-8 flex-shrink-0 rounded object-cover"
        />
      ) : (
        <span aria-hidden className="text-base leading-none">
          {kindIcon(file)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs text-[var(--text-primary)]">{file.name}</div>
        <div className="truncate text-[10px] text-[var(--text-muted)]">
          {formatSize(file.size)}
          {file.previewText && ` · ${file.previewText}`}
        </div>
      </div>
      <button
        onClick={() => removeAttachment(index)}
        title="Remove attachment"
        className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--error)]"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

export function AttachmentPreview() {
  const attachments = useChatStore((s) => s.pendingAttachments)
  const processing = useChatStore((s) => s.attachmentsProcessing)

  if (attachments.length === 0 && !processing) return null

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2">
      {processing && (
        <div className="mb-1 text-[10px] text-[var(--text-muted)]">Processing attachments…</div>
      )}
      <div className="flex flex-wrap gap-2">
        {attachments.map((file, idx) => (
          <Tile key={`${file.name}-${idx}`} file={file} index={idx} />
        ))}
      </div>
    </div>
  )
}
