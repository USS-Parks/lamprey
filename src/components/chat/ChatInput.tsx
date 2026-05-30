import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { toast } from '@/stores/toast-store'
import type { ProcessedFile } from '@/lib/types'

interface ChatInputProps {
  onSend: (content: string) => void
  onCancel: () => void
  isStreaming: boolean
  disabled?: boolean
}

const LONG_PASTE_THRESHOLD = 500

function looksLikeCode(text: string): boolean {
  if (text.length < LONG_PASTE_THRESHOLD) return false
  const lines = text.split(/\r?\n/)
  if (lines.length < 5) return false
  let signals = 0
  if (/[{};]\s*$/m.test(text)) signals++
  if (/^\s*(import|from|const|let|var|function|class|def|public|private)\b/m.test(text)) signals++
  if (/^\s*[{[]\s*$/m.test(text) && /^\s*[}\]]\s*$/m.test(text)) signals++
  if (/<\/?[a-zA-Z][^>]*>/.test(text)) signals++
  return signals >= 1
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

export function ChatInput({ onSend, onCancel, isStreaming, disabled }: ChatInputProps) {
  const [content, setContent] = useState('')
  const [pasteOffer, setPasteOffer] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const addAttachments = useChatStore((s) => s.addAttachments)
  const setProcessing = useChatStore((s) => s.setAttachmentsProcessing)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [content])

  const handleSubmit = () => {
    const trimmed = content.trim()
    if (!trimmed || isStreaming || disabled) return
    onSend(trimmed)
    setContent('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (pasteOffer) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handlePickerClick = async () => {
    if (!window.api) return
    setProcessing(true)
    try {
      const result = await window.api.files.openPicker()
      if (result.success) addAttachments(result.data as ProcessedFile[])
      else if (result.error) toast.error(`File picker failed: ${result.error}`)
    } finally {
      setProcessing(false)
    }
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (!blob) continue
          e.preventDefault()
          try {
            const dataUrl = await blobToDataURL(blob)
            const ext = (blob.type.split('/')[1] ?? 'png').replace('+xml', '')
            const stamp = new Date().toISOString().replace(/[:.]/g, '-')
            const attachment: ProcessedFile = {
              name: `pasted-${stamp}.${ext}`,
              kind: 'image',
              mimeType: blob.type,
              size: blob.size,
              content: dataUrl,
              previewText: `Pasted image (${Math.round(blob.size / 1024)} KB)`
            }
            addAttachments([attachment])
          } catch (err) {
            toast.error(`Could not paste image: ${(err as Error).message}`)
          }
          return
        }
      }
    }

    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (looksLikeCode(text)) {
      e.preventDefault()
      setPasteOffer(text)
    }
  }

  const handlePasteOfferAccept = () => {
    if (!pasteOffer) return
    const ext = /<\/?[a-zA-Z][^>]*>/.test(pasteOffer) ? 'html' : 'txt'
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const attachment: ProcessedFile = {
      name: `pasted-${stamp}.${ext}`,
      kind: 'text',
      mimeType: 'text/plain',
      size: new Blob([pasteOffer]).size,
      content: pasteOffer,
      previewText: `${pasteOffer.split(/\r?\n/).length} lines · pasted`
    }
    addAttachments([attachment])
    setPasteOffer(null)
  }

  const handlePasteOfferInline = () => {
    if (!pasteOffer) return
    const textarea = textareaRef.current
    if (textarea) {
      const start = textarea.selectionStart ?? content.length
      const end = textarea.selectionEnd ?? content.length
      setContent(content.slice(0, start) + pasteOffer + content.slice(end))
    } else {
      setContent(content + pasteOffer)
    }
    setPasteOffer(null)
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3">
      {pasteOffer && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-[var(--accent)] bg-[var(--accent-dim)] px-3 py-2 text-xs text-[var(--text-primary)]">
          <span className="flex-1">
            That looks like code ({pasteOffer.length.toLocaleString()} chars). Attach it as a file or
            paste inline?
          </span>
          <button
            onClick={handlePasteOfferAccept}
            className="rounded bg-[var(--accent)] px-2 py-1 text-[11px] font-medium text-white hover:opacity-90"
          >
            Paste as attachment
          </button>
          <button
            onClick={handlePasteOfferInline}
            className="rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            Paste inline
          </button>
          <button
            onClick={() => setPasteOffer(null)}
            className="rounded px-1.5 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <div className="flex items-end gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2">
        <button
          onClick={handlePickerClick}
          disabled={disabled || isStreaming}
          title="Attach files"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--accent)] disabled:opacity-40"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Send a message…"
          rows={1}
          disabled={disabled}
          className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
        {isStreaming ? (
          <button
            onClick={onCancel}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-[var(--error)] text-white transition-colors hover:opacity-80"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!content.trim() || disabled}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-[var(--accent)] text-white transition-colors hover:opacity-80 disabled:opacity-30"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
