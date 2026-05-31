import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useModelStore } from '@/stores/model-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useAgentStore } from '@/stores/agent-store'
import { useUiStore, type PermissionsMode } from '@/stores/ui-store'
import { toast } from '@/stores/toast-store'
import { useThemedIcon } from '@/lib/themed-icon'
import type { ModelInfo, ProcessedFile } from '@/lib/types'

import defaultAccessLight from '@assets/Lamprey Default Access Icon.png'
import defaultAccessDark from '@assets/Lamprey Default Acces Icon Dark View.png'
import autoReviewLight from '@assets/Lamprey Auto-Review Icon.png'
import autoReviewDark from '@assets/Lamprey Auto-Review Icon Dark View.png'
import fullAccessLight from '@assets/Lamprey Full Access Icon.png'
import fullAccessDark from '@assets/Lamprey Full Access Icon Dark View.png'
import micLight from '@assets/Lamprey Microphone Icon.png'
import micDark from '@assets/Lamprey Microphone Icon Dark View.png'
import sendLight from '@assets/Lamprey Prompt Enter Icon.png'
import sendDark from '@assets/Lamprey Send Prompt Icon Dark View.png'

interface ChatInputProps {
  onSend: (content: string) => void
  onCancel: () => void
  isStreaming: boolean
  disabled?: boolean
}

const LONG_PASTE_THRESHOLD = 500

interface PermissionOption {
  id: PermissionsMode
  label: string
  light: string
  dark: string
}

const PERMISSION_OPTIONS: PermissionOption[] = [
  { id: 'default', label: 'Default permissions', light: defaultAccessLight, dark: defaultAccessDark },
  { id: 'auto-review', label: 'Auto Review', light: autoReviewLight, dark: autoReviewDark },
  { id: 'full', label: 'Full Access', light: fullAccessLight, dark: fullAccessDark }
]

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

function ChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

interface DropdownButtonProps {
  open: boolean
  onToggle: () => void
  children: React.ReactNode
  title?: string
}

function DropdownButton({ open, onToggle, children, title }: DropdownButtonProps) {
  return (
    <button
      onClick={onToggle}
      title={title}
      aria-expanded={open}
      className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
    >
      {children}
      <ChevronDown />
    </button>
  )
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [active, onOutside, ref])
}

function PermissionsDropdown() {
  const mode = useUiStore((s) => s.permissionsMode)
  const setMode = useUiStore((s) => s.setPermissionsMode)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const themeMode = useSettingsStore((s) => s.settings.themeMode)
  useClickOutside(wrapRef, () => setOpen(false), open)

  const active = PERMISSION_OPTIONS.find((o) => o.id === mode) ?? PERMISSION_OPTIONS[0]
  const activeIcon = themeMode === 'dark' ? active.dark : active.light

  return (
    <div ref={wrapRef} className="relative">
      <DropdownButton open={open} onToggle={() => setOpen((v) => !v)} title="Permissions mode">
        <img src={activeIcon} alt="" aria-hidden className="icon-asset h-[25px] w-[25px] object-contain" />
        <span>{active.label}</span>
      </DropdownButton>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-52 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-xl">
          {PERMISSION_OPTIONS.map((opt) => {
            const icon = themeMode === 'dark' ? opt.dark : opt.light
            return (
              <button
                key={opt.id}
                onClick={() => {
                  setMode(opt.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                  opt.id === mode
                    ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <img src={icon} alt="" aria-hidden className="icon-asset h-[25px] w-[25px] object-contain" />
                <span>{opt.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AgentModeToggle() {
  const mode = useAgentStore((s) => s.mode)
  const setMode = useAgentStore((s) => s.setMode)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const handleToggle = async () => {
    const next = mode === 'multi' ? 'single' : 'multi'
    setMode(next)
    await updateSettings({ agentMode: next })
    toast.info(next === 'multi' ? 'Multi-agent ON · Planner→Coder→Reviewer' : 'Single-model mode')
  }

  return (
    <button
      onClick={handleToggle}
      title={
        mode === 'multi'
          ? 'Multi-agent pipeline active. Click to switch to single-model.'
          : 'Single-model. Click to enable Planner→Coder→Reviewer pipeline.'
      }
      className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition-colors ${
        mode === 'multi'
          ? 'bg-[var(--accent-dim)] text-[var(--accent)] hover:opacity-90'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="12" cy="18" r="2.5" />
        <path d="M6 8.5l5.2 8M18 8.5l-5.2 8M8 6h8" />
      </svg>
      <span className="font-medium">{mode === 'multi' ? 'Multi-agent' : 'Single model'}</span>
    </button>
  )
}

function ModelDropdown() {
  const activeModel = useChatStore((s) => s.activeModel)
  const setModel = useChatStore((s) => s.setModel)
  const allModels = useModelStore((s) => s.models)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useClickOutside(wrapRef, () => setOpen(false), open)

  const fallback: ModelInfo[] = [
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', contextWindow: 131072, supportsTools: true, supportsVision: false },
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', contextWindow: 131072, supportsTools: true, supportsVision: false },
    { id: 'gemma-3-27b-it', name: 'Gemma 3 27B', provider: 'google', contextWindow: 131072, supportsTools: true, supportsVision: true },
    { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', provider: 'dashscope', contextWindow: 1000000, supportsTools: true, supportsVision: false }
  ]
  const models = allModels.length > 0 ? allModels : fallback
  const active = models.find((m) => m.id === activeModel) ?? models[0]

  return (
    <div ref={wrapRef} className="relative">
      <DropdownButton open={open} onToggle={() => setOpen((v) => !v)} title="Switch model">
        <span className="font-medium">{active.name}</span>
      </DropdownButton>
      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-1 w-60 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-xl">
          {models.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setOpen(false)
                void setModel(m.id)
              }}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors ${
                m.id === activeModel
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span className="font-medium">{m.name}</span>
              {m.id === activeModel && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent)]" aria-hidden>
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ChatInput({ onSend, onCancel, isStreaming, disabled }: ChatInputProps) {
  const [content, setContent] = useState('')
  const [pasteOffer, setPasteOffer] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const addAttachments = useChatStore((s) => s.addAttachments)
  const setProcessing = useChatStore((s) => s.setAttachmentsProcessing)
  const composeSeedToken = useUiStore((s) => s.composeSeedToken)
  const consumeComposeDraft = useUiStore((s) => s.consumeComposeDraft)

  const micIcon = useThemedIcon(micLight, micDark)
  const sendIcon = useThemedIcon(sendLight, sendDark)

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
      requestAnimationFrame(() => {
        const len = ta.value.length
        ta.setSelectionRange(len, len)
      })
    }
  }, [composeSeedToken, consumeComposeDraft])

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

  const canSend = content.trim().length > 0 && !disabled && !isStreaming

  return (
    <div className="w-full">
      {pasteOffer && (
        <div className="mb-2 flex w-full flex-wrap items-center gap-2 rounded-2xl border border-[var(--accent)] bg-[var(--accent-dim)] px-3 py-2 text-xs text-[var(--text-primary)]">
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

      <div className="flex w-full flex-col gap-2 rounded-3xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 pt-3 pb-2 shadow-lg backdrop-blur-sm">
        <textarea
          ref={textareaRef}
          data-chat-input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder=""
          rows={1}
          disabled={disabled}
          className="max-h-[200px] min-h-[28px] w-full resize-none bg-transparent text-sm leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />

        <div className="flex items-center gap-1">
          <button
            onClick={handlePickerClick}
            disabled={disabled || isStreaming}
            title="Attach file"
            aria-label="Attach file"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          <PermissionsDropdown />

          <AgentModeToggle />

          <div className="flex-1" />

          <ModelDropdown />

          <button
            onClick={() => toast.info('Voice input coming soon')}
            title="Voice input"
            aria-label="Voice input"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <img src={micIcon} alt="" aria-hidden className="icon-asset h-[25px] w-[25px] object-contain" />
          </button>

          {isStreaming ? (
            <button
              onClick={onCancel}
              title="Stop streaming"
              aria-label="Stop streaming"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--error)] text-white transition-colors hover:opacity-80"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canSend}
              title="Send (Enter)"
              aria-label="Send"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg-tertiary)] transition-all hover:scale-105 hover:bg-[var(--accent)] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:bg-[var(--bg-tertiary)]"
            >
              <img src={sendIcon} alt="" aria-hidden className="icon-asset h-[30px] w-[30px] object-contain" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
