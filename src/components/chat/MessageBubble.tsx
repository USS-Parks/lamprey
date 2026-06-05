import { useState } from 'react'
import type { Message } from '@/lib/types'
import { MarkdownRenderer } from '@/components/artifacts/MarkdownRenderer'
import { useMemoryStore } from '@/stores/memory-store'
import { toast } from '@/stores/toast-store'
import { parseReasoning } from '@/lib/reasoning'
import { ReasoningBlock } from './ReasoningBlock'
import { MessageActions } from './MessageActions'
import { WakeupPill } from './WakeupPill'
import { DocumentCardRow } from './DocumentCardRow'

interface MessageBubbleProps {
  message: Message
}

const REMEMBER_MAX = 280
const WAKEUP_PREFIX = '[scheduled wake-up]'

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

  const wakeup = isUser && message.content.startsWith(WAKEUP_PREFIX)
  const wakeupParts = wakeup ? parseWakeupContent(message.content) : null

  // Reasoning comes from one of two places (in priority order):
  // 1) The `reasoning` column — persisted from the provider's
  //    `delta.reasoning_content` channel OR from the save-time
  //    splitInlineReasoning helper that strips the <think>…</think>
  //    block out of inline content for models without a native channel.
  // 2) Inline <think>…</think> tags still present in the body — covers
  //    any historical row written before splitInlineReasoning landed.
  //    Runs for EVERY model now, not just deepseek-reasoner, because
  //    the contract forces every model to lead with <think> and we
  //    want to render that block as the Reasoning panel regardless of
  //    provider.
  let reasoning: string | null = null
  let body: string = wakeupParts?.body ?? message.content
  if (!isUser) {
    if (message.reasoning && message.reasoning.length > 0) {
      reasoning = message.reasoning
    } else {
      const parsed = parseReasoning(body)
      if (parsed.reasoning) {
        reasoning = parsed.reasoning
        body = parsed.body
      }
    }
  }

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
    <div className={`group flex flex-col ${isUser ? 'items-end' : 'items-stretch'} mb-8`}>
      <div
        className={
          // Claude.ai pattern: only the USER prompt sits in a bubble — the
          // assistant response flows as plain text on the chat background,
          // which makes the back-and-forth feel like a transcript rather
          // than a chain of equal-weight cards. User keeps the 80% cap +
          // accent-dim fill + padding so it stays narrow + visibly right-
          // aligned with the input pill's right edge. Assistant gets no
          // background, no border, no padding — just the column-wide text
          // surface so reasoning card, body, pipeline pill, and input pill
          // share the same edges. ReasoningBlock keeps its own card inside
          // the unstyled assistant container because it IS a distinct
          // surface (collapsible thinking trace, not the answer body).
          isUser
            ? 'max-w-[80%] rounded-lg bg-[var(--accent-dim)] px-4 py-3 text-[var(--text-primary)]'
            : 'w-full text-[var(--text-primary)]'
        }
      >
        {wakeupParts && <WakeupPill reason={wakeupParts.reason} />}
        {isUser ? (
          <div className="whitespace-pre-wrap break-words text-sm">{wakeupParts?.body ?? message.content}</div>
        ) : (
          <>
            {reasoning && <ReasoningBlock content={reasoning} />}
            <MarkdownRenderer content={body} />
          </>
        )}
        <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100">
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
            className="ml-auto rounded px-1.5 py-0.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--accent)] disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Remember this'}
          </button>
        </div>
      </div>
      {!isUser && message.documents && message.documents.length > 0 && (
        <DocumentCardRow documents={message.documents} />
      )}
      {!isUser && <MessageActions content={body || message.content} />}
    </div>
  )
}

function parseWakeupContent(content: string): { reason?: string; body: string } {
  const [firstLine, ...rest] = content.split('\n')
  const reason = firstLine.slice(WAKEUP_PREFIX.length).trim()
  return {
    reason: reason || undefined,
    body: rest.join('\n').trimStart()
  }
}
