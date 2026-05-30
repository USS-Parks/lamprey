import { useState } from 'react'
import type { Message } from '@/lib/types'
import { MarkdownRenderer } from '@/components/artifacts/MarkdownRenderer'
import { useMemoryStore } from '@/stores/memory-store'
import { toast } from '@/stores/toast-store'
import { parseReasoning } from '@/lib/reasoning'
import { ReasoningBlock } from './ReasoningBlock'

interface MessageBubbleProps {
  message: Message
}

const REMEMBER_MAX = 280

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function truncateForMemory(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length <= REMEMBER_MAX) return trimmed
  return trimmed.slice(0, REMEMBER_MAX).trimEnd() + '…'
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'
  const addMemory = useMemoryStore((s) => s.addMemory)
  const [saving, setSaving] = useState(false)

  if (isTool) return null

  const isReasoner = message.model === 'deepseek-reasoner'
  const { reasoning, body } = isReasoner && !isUser
    ? parseReasoning(message.content)
    : { reasoning: null as string | null, body: message.content }

  const handleRemember = async () => {
    if (saving) return
    const text = truncateForMemory(message.content)
    if (!text) return
    setSaving(true)
    const result = await addMemory(text)
    setSaving(false)
    if (result) {
      toast.success('Saved to memory')
    } else {
      toast.error('Could not save to memory')
    }
  }

  return (
    <div className={`group flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-[var(--accent-dim)] text-[var(--text-primary)]'
            : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words text-sm">{message.content}</div>
        ) : (
          <>
            {reasoning && <ReasoningBlock content={reasoning} />}
            <MarkdownRenderer content={body} />
          </>
        )}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100">
          <span>{formatTime(message.timestamp)}</span>
          {message.model && (
            <span className="rounded bg-[var(--bg-primary)] px-1">
              {message.model === 'deepseek-reasoner' ? 'R1' : 'V3'}
            </span>
          )}
          <button
            onClick={handleRemember}
            disabled={saving}
            title="Save to memory"
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--accent)] disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Remember this'}
          </button>
        </div>
      </div>
    </div>
  )
}
