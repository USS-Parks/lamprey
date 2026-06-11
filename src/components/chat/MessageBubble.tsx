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
import { ForkDialog } from './ForkDialog'
import { PinDialog } from './PinDialog'
import { SeedContextChip, parseSeedContext } from './SeedContextChip'
import { useChatStore } from '@/stores/chat-store'
import { useModelStore } from '@/stores/model-store'
import { formatModelIdFallback } from '@/lib/model-label'

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
  const forkFromMessage = useChatStore((s) => s.forkFromMessage)
  // Model chip label: prefer the catalog display name (same source the
  // ModelSwitcher shows), fall back to a compacted form of the raw id for
  // legacy rows / removed custom models. Raw id stays in the hover tooltip.
  const models = useModelStore((s) => s.models)
  const modelLabel = message.model
    ? models.find((m) => m.id === message.model)?.name ?? formatModelIdFallback(message.model)
    : null
  const [saving, setSaving] = useState(false)
  const [forkOpen, setForkOpen] = useState(false)
  // PS21 — pin-as-memory dialog state. Sits next to the Fork dialog so the
  // adjacent MessageActions button isn't a "coming soon" stub anymore.
  const [pinOpen, setPinOpen] = useState(false)

  if (isTool) return null

  const wakeup = isUser && message.content.startsWith(WAKEUP_PREFIX)
  const wakeupParts = wakeup ? parseWakeupContent(message.content) : null
  const seed = isUser ? parseSeedContext(message.content) : null

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
  // UB-4 (Unburdening Phase, 2026-06-10) — the WC-5 proof-gate banner +
  // notice parsing that lived here is excised with the proof machinery.
  // Historical rows that carry a persisted notice render it as plain text.
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
        {isUser ? seed ? (
          <SeedContextChip seed={seed} />
        ) : (
          <div className="whitespace-pre-wrap break-words text-sm">{wakeupParts?.body ?? message.content}</div>
        ) : (
          <>
            {reasoning && <ReasoningBlock content={reasoning} />}
            <MarkdownRenderer content={body} sourceMessageId={message.id} />
          </>
        )}
        <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100">
          <span>{formatTime(message.timestamp)}</span>
          {message.model && (
            <span
              className="max-w-[160px] truncate rounded bg-[var(--bg-primary)] px-1"
              title={message.model}
            >
              {modelLabel}
            </span>
          )}
          {/* UB-6 (K3) — historical rows written by the excised multi-agent
              pipeline keep ONE neutral muted chip so the audit trail reads;
              new rows never carry these stages. */}
          {(message.stage === 'planner' ||
            message.stage === 'reviewer' ||
            message.stage === 'composer') && (
            <span
              className="rounded bg-[var(--bg-tertiary)]/60 px-1 text-[var(--text-muted)]"
              title="Written by the retired multi-agent pipeline (pre-v0.14)"
            >
              Pipeline (legacy)
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
      {!isUser && (
        <>
          <MessageActions
            content={body || message.content}
            onFork={() => setForkOpen(true)}
            onPin={() => setPinOpen(true)}
          />
          <ForkDialog
            open={forkOpen}
            onClose={() => setForkOpen(false)}
            onConfirm={async (opts) => {
              await forkFromMessage(message.id, opts)
            }}
          />
          <PinDialog
            open={pinOpen}
            onClose={() => setPinOpen(false)}
            onConfirm={async ({ title, summary }) => {
              // PS21 — invoke the existing chapters store via the IPC
              // bridge. emitChatEvent('chat:chapter-marked') fires
              // automatically from the main-process handler so any open
              // chapter sidebar refreshes without polling.
              if (!window.api?.session?.markChapter) {
                toast.error('Chapters IPC unavailable')
                return
              }
              const result = await window.api.session.markChapter({
                conversationId: message.conversationId,
                title,
                summary,
                anchorMessageId: message.id
              })
              if (result?.success) {
                toast.success(`Pinned chapter: ${title}`)
              } else {
                toast.error(result?.error ?? 'Pin failed')
              }
            }}
          />
        </>
      )}
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
