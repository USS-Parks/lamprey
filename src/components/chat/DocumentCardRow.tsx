import { useEffect, useRef, useState } from 'react'
import type { DocumentAttachment } from '@/lib/types'
import { toast } from '@/stores/toast-store'

interface DocumentCardRowProps {
  documents: DocumentAttachment[]
}

// Spans the full assistant column. The parent (MessageBubble assistant
// branch + the streaming bubble in MessageList) is already a `w-full`
// plain-text container with no padding — these cards provide their own
// border / radius / background so they read as discrete deliverables
// against the chat surface.
export function DocumentCardRow({ documents }: DocumentCardRowProps) {
  if (!documents || documents.length === 0) return null
  return (
    <div className="mt-3 flex w-full flex-col gap-2">
      {documents.map((doc) => (
        <DocumentCard key={doc.id} doc={doc} />
      ))}
    </div>
  )
}

function DocumentCard({ doc }: { doc: DocumentAttachment }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const artifactType = routeArtifactType(doc.mimeType, doc.name)

  const openInArtifact = () => {
    if (!artifactType || !window.api?.artifact?.openInWindow) {
      toast.warning('Artifact panel can only render markdown / HTML / SVG documents.')
      return
    }
    void window.api.artifact.openInWindow(artifactType, doc.content)
    setMenuOpen(false)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(doc.content)
      toast.success(`Copied ${doc.name}`)
    } catch {
      toast.error('Could not copy to clipboard')
    }
    setMenuOpen(false)
  }

  const download = () => {
    try {
      const blob = new Blob([doc.content], { type: doc.mimeType || 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.href = url
      a.download = doc.name
      window.document.body.appendChild(a)
      a.click()
      window.document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Could not download document')
    }
    setMenuOpen(false)
  }

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-3 py-2.5 transition-colors hover:border-[var(--accent)]"
      data-document-id={doc.id}
    >
      <DocumentGlyph mimeType={doc.mimeType} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-[var(--text-primary)]">{doc.name}</div>
        <div className="truncate text-[12px] text-[var(--text-muted)]">
          {kindLabel(doc.mimeType)} · {extensionLabel(doc.name, doc.mimeType)} · {formatSize(doc.sizeBytes)}
        </div>
      </div>
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-1 rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2.5 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          Open in
          <span aria-hidden className="text-[10px]">{menuOpen ? '▴' : '▾'}</span>
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-md border border-[var(--panel-border)] bg-[var(--bg-secondary)] shadow-lg"
          >
            <MenuItem
              label="Artifact panel"
              hint={artifactType ? undefined : 'Markdown / HTML / SVG only'}
              disabled={!artifactType}
              onClick={openInArtifact}
            />
            <MenuItem label="Copy contents" onClick={copy} />
            <MenuItem label="Download…" onClick={download} />
          </div>
        )}
      </div>
    </div>
  )
}

function MenuItem({
  label,
  hint,
  disabled,
  onClick
}: {
  label: string
  hint?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[var(--accent-dim)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span>{label}</span>
      {hint && <span className="ml-2 text-[11px] text-[var(--text-muted)]">{hint}</span>}
    </button>
  )
}

function DocumentGlyph({ mimeType }: { mimeType: string }) {
  const accent = mimeType.startsWith('text/markdown')
    ? 'var(--accent)'
    : mimeType.includes('javascript') || mimeType.includes('typescript')
      ? '#3178c6'
      : mimeType.includes('python')
        ? '#3776ab'
        : mimeType.includes('html') || mimeType.includes('svg')
          ? '#e34c26'
          : mimeType.includes('json')
            ? '#888'
            : 'var(--text-secondary)'
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}
      aria-hidden
    >
      <svg width="18" height="20" viewBox="0 0 18 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M2 1.5C2 0.671573 2.67157 0 3.5 0H11L17 6V18.5C17 19.3284 16.3284 20 15.5 20H3.5C2.67157 20 2 19.3284 2 18.5V1.5Z"
          fill={accent}
          opacity="0.18"
        />
        <path
          d="M11 0V5C11 5.55228 11.4477 6 12 6H17"
          stroke={accent}
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M2 1.5C2 0.671573 2.67157 0 3.5 0H11L17 6V18.5C17 19.3284 16.3284 20 15.5 20H3.5C2.67157 20 2 19.3284 2 18.5V1.5Z"
          stroke={accent}
          strokeWidth="1.2"
        />
      </svg>
    </div>
  )
}

function routeArtifactType(mimeType: string, name: string): string | null {
  const lower = (mimeType || '').toLowerCase()
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (lower.startsWith('text/markdown') || ext === 'md' || ext === 'markdown') return 'markdown'
  if (lower.includes('html') || ext === 'html' || ext === 'htm') return 'html'
  if (lower.includes('svg') || ext === 'svg') return 'svg'
  return null
}

function kindLabel(mimeType: string): string {
  const lower = (mimeType || '').toLowerCase()
  if (lower.startsWith('text/markdown')) return 'Document'
  if (lower.includes('html')) return 'Web page'
  if (lower.includes('svg')) return 'Vector image'
  if (lower.includes('json')) return 'Data file'
  if (lower.includes('csv')) return 'Spreadsheet'
  if (lower.startsWith('text/')) return 'Text file'
  return 'File'
}

function extensionLabel(name: string, mimeType: string): string {
  const ext = (name.split('.').pop() || '').toUpperCase()
  if (ext && ext !== name.toUpperCase()) return ext
  if (mimeType.includes('markdown')) return 'MD'
  if (mimeType.includes('typescript')) return 'TS'
  if (mimeType.includes('javascript')) return 'JS'
  if (mimeType.includes('python')) return 'PY'
  if (mimeType.includes('json')) return 'JSON'
  return mimeType.split('/').pop()?.toUpperCase() || 'FILE'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
