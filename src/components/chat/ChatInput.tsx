import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useSkillsStore } from '@/stores/skills-store'
import { useMcpStore } from '@/stores/mcp-store'
import { useUiStore } from '@/stores/ui-store'
import { toast } from '@/stores/toast-store'
import type { ProcessedFile } from '@/lib/types'
import addFileIconUrl from '@assets/Lamprey Add File Icon.png'
import sendIconUrl from '@assets/Lamprey Prompt Enter Icon.png'

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
  const activeModel = useChatStore((s) => s.activeModel)
  const activeSkillIds = useSkillsStore((s) => s.activeSkillIds)
  const mcpServers = useMcpStore((s) => s.servers)
  const composeSeedToken = useUiStore((s) => s.composeSeedToken)
  const consumeComposeDraft = useUiStore((s) => s.consumeComposeDraft)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [content])

  useEffect(() => {
    if (composeSeedToken === 0) return
    const seed = consumeComposeDraft()
    if (!seed) return
    setContent(seed)
    const ta = textareaRef.current
    if (ta) {
      ta.focus()
      // Place cursor at end so the user can keep typing.
      requestAnimationFrame(() => {
        const len = ta.value.length
        ta.setSelectionRange(len, len)
      })
    }
  }, [composeSeedToken, consumeComposeDraft])

  const modelLabel = activeModel === 'deepseek-reasoner' ? 'DeepSeek R1' : 'DeepSeek V3'
  const skillCount = activeSkillIds.length
  const connectedMcp = mcpServers.filter((s) => s.status === 'connected')

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
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-1 font-mono text-[10px] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1 rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[var(--text-secondary)]">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          {modelLabel}
        </span>
        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
          skillCount > 0
            ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
            : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
        }`}>
          {skillCount > 0
            ? `${skillCount} skill${skillCount === 1 ? '' : 's'} active`
            : 'No skills'}
        </span>
        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
          connectedMcp.length > 0
            ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
            : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
        }`}>
          {connectedMcp.length > 0
            ? connectedMcp.map((s) => s.name).join(' · ')
            : 'No MCP'}
        </span>
      </div>
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
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-40"
        >
          <img src={addFileIconUrl} alt="Attach" className="h-6 w-6 object-contain" />
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
            title="Send"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-transform hover:scale-105 disabled:opacity-30"
          >
            <img src={sendIconUrl} alt="Send" className="h-7 w-7 object-contain" />
          </button>
        )}
      </div>
    </div>
  )
}
