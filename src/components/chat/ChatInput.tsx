import { useState, useRef, useEffect } from 'react'

interface ChatInputProps {
  onSend: (content: string) => void
  onCancel: () => void
  isStreaming: boolean
  disabled?: boolean
}

export function ChatInput({ onSend, onCancel, isStreaming, disabled }: ChatInputProps) {
  const [content, setContent] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3">
      <div className="flex items-end gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
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
