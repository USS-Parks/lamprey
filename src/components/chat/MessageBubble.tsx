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
import { ProofGateBanner } from './ProofGateBanner'
import { parseProofGateNotice } from './proof-gate-notice'
import { computeProofBannerState } from './proof-banner-state'

interface MessageBubbleProps {
  message: Message
  /** Reasoning Audit Phase R7 — Planner audit row attached to this
   *  bubble per Invariant §2.9. When supplied, the bubble grows a
   *  "Show pipeline trace ▾" toggle that reveals the attached
   *  Planner's reasoning + plan text inline below the body. Coder /
   *  Composer / single-agent bubbles can carry one; Reviewer +
   *  user/system/tool bubbles never do. */
  attachedPlanner?: Message
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

export function MessageBubble({ message, attachedPlanner }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'
  const addMemory = useMemoryStore((s) => s.addMemory)
  const forkFromMessage = useChatStore((s) => s.forkFromMessage)
  const [saving, setSaving] = useState(false)
  const [forkOpen, setForkOpen] = useState(false)
  // PS21 — pin-as-memory dialog state. Sits next to the Fork dialog so the
  // adjacent MessageActions button isn't a "coming soon" stub anymore.
  const [pinOpen, setPinOpen] = useState(false)
  // R7 — collapsed by default. Click "Show pipeline trace ▾" to expand
  // the inline panel showing the attached Planner row's reasoning + plan.
  const [traceOpen, setTraceOpen] = useState(false)

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
  const proofGate = !isUser ? parseProofGateNotice(body) : null
  if (proofGate) body = proofGate.body
  // WC-5 — the proof gate banner is driven by the persisted
  // `messages.proof_status` column (WC-4). See `computeProofBannerState`
  // for the precedence rules; the helper is unit-tested in
  // `proof-banner-state.test.ts`.
  const proofBannerState = !isUser
    ? computeProofBannerState(message.proofStatus, proofGate !== null)
    : null

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
            {proofBannerState && (
              <ProofGateBanner
                notice={
                  proofGate ?? {
                    body,
                    reason:
                      proofBannerState === 'blocked'
                        ? 'Strict proof policy blocked this completion.'
                        : 'Proof was required but no trusted verification was found.',
                    failedReceiptIds: [],
                    skippedReceiptIds: []
                  }
                }
                state={proofBannerState}
                messageId={message.id}
              />
            )}
            {/* R7 — "Show pipeline trace ▾" toggle. Reveals the attached
                Planner row (stage='planner', hidden in the main thread per
                Invariant §2.9) as an inline collapsed panel with its own
                ReasoningBlock + plan text. Renders ONLY when a Planner
                row is attached to this bubble. */}
            {attachedPlanner && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setTraceOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
                  title={traceOpen ? 'Hide planner trace' : 'Show planner trace'}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                    {traceOpen ? <path d="M6 9l6 6 6-6" /> : <path d="M9 6l6 6-6 6" />}
                  </svg>
                  <span>{traceOpen ? 'Hide' : 'Show'} pipeline trace</span>
                  {attachedPlanner.model && (
                    <span className="ml-1 rounded bg-[var(--bg-tertiary)]/60 px-1 py-0.5 text-[10px] normal-case tracking-normal text-[var(--text-muted)]">
                      planner · {attachedPlanner.model}
                    </span>
                  )}
                </button>
                {traceOpen && (
                  <div className="mt-2 rounded-lg bg-[var(--bg-tertiary)]/40 p-3">
                    {attachedPlanner.reasoning && (
                      <ReasoningBlock content={attachedPlanner.reasoning} />
                    )}
                    <div className="mt-1 text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
                      Plan
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-[13px] text-[var(--text-secondary)]">
                      {attachedPlanner.content}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100">
          <span>{formatTime(message.timestamp)}</span>
          {message.model && (
            <span className="rounded bg-[var(--bg-primary)] px-1">
              {message.model === 'deepseek-reasoner' ? 'R1' : 'V3'}
            </span>
          )}
          {/* R7 — stage chip. Reviewer rows get a small purple "Reviewer"
              chip; Composer rows get a muted "Composer" chip. Coder /
              single-agent rows render no chip (default). Orphan Planner
              rows that fell through to standalone render get a blue
              "Planner" chip so the audit trail is never lost. */}
          {message.stage === 'reviewer' && (
            <span className="rounded bg-purple-500/15 px-1 text-purple-400 dark:text-purple-300">
              Reviewer
            </span>
          )}
          {message.stage === 'composer' && (
            <span className="rounded bg-[var(--bg-tertiary)]/60 px-1 text-[var(--text-muted)]">
              Composer
            </span>
          )}
          {message.stage === 'planner' && (
            <span className="rounded bg-sky-500/15 px-1 text-sky-400 dark:text-sky-300">
              Planner (orphan)
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
