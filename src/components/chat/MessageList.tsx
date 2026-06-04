import { useEffect, useMemo, useRef } from 'react'
import type { Message } from '@/lib/types'
import { parseReasoning } from '@/lib/reasoning'
import { useThemedIcon } from '@/lib/themed-icon'
import { MessageBubble } from './MessageBubble'
import { StreamingText } from './StreamingText'
import { StreamStatusLine } from './StreamStatusLine'
import { InlineApprovalChip } from './InlineApprovalChip'
import { useInlineApprovalsStore } from '@/stores/inline-approvals-store'
import { TranscriptNotice } from './TranscriptNotice'
import { useInlineNoticesStore } from '@/stores/inline-notices-store'
import { useChatStore } from '@/stores/chat-store'
import { CHAT_COLUMN_CLASS } from './ChatView'
import { ChapterDivider } from './ChapterDivider'
import { useChaptersStore, type Chapter } from '@/stores/chapters-store'
import {
  CompressedRegionPill,
  isCompressedSummaryMessage
} from './CompressedRegionPill'
import thinkingLight from '@assets/Lamprey Thinking Icon.png'
import thinkingDark from '@assets/Lamprey Thinking Icon Dark View.png'

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  streamingContent: string
  streamStartedAt: number | null
  activeModel: string
}

// Pixels from the bottom of the scroll container that still count as "near
// the bottom". If the user is within this, auto-scroll follows new content;
// if they've scrolled further up, we leave them alone.
const STICK_THRESHOLD_PX = 120

function InlineApprovalQueue() {
  const queue = useInlineApprovalsStore((s) => s.queue)
  const dismiss = useInlineApprovalsStore((s) => s.dismiss)
  if (queue.length === 0) return null
  return (
    <>
      {queue.map((req, i) => (
        <InlineApprovalChip
          key={req.callId}
          request={req}
          // Only the first chip claims global keystrokes — successive chips
          // wait their turn. Once the leader resolves, the next becomes
          // active via this index check on next render.
          autoFocus={i === 0}
          onResolved={() => dismiss(req.callId)}
        />
      ))}
    </>
  )
}

function SystemMarker({ content }: { content: string }) {
  return (
    <div
      role="separator"
      className="my-3 flex items-center gap-3 px-2 text-[12px] uppercase tracking-wider text-[var(--text-muted)]"
    >
      <span className="h-px flex-1 bg-[var(--border)]" />
      <span>{content}</span>
      <span className="h-px flex-1 bg-[var(--border)]" />
    </div>
  )
}

export function MessageList({
  messages,
  isStreaming,
  streamingContent,
  streamStartedAt,
  activeModel
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // Mutable flag we update on user scroll — avoids a React state round-trip
  // (which would re-render the message list on every wheel tick).
  const stuckToBottomRef = useRef(true)

  // Track whether the user is currently anchored at/near the bottom. We
  // use this to decide whether new chunks should drag the viewport down.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      stuckToBottomRef.current = distanceFromBottom <= STICK_THRESHOLD_PX
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    // Prime with current position.
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Auto-scroll new content into view, but ONLY if the user is still
  // anchored at the bottom. Scrolled-up readers stay where they are even
  // while output streams in.
  useEffect(() => {
    if (!stuckToBottomRef.current) return
    const el = scrollRef.current
    if (!el) return
    // Use scrollTop = scrollHeight directly so we don't trigger a smooth
    // animation that lags behind the stream.
    el.scrollTop = el.scrollHeight
  }, [messages, streamingContent, isStreaming])

  const thinkingIconUrl = useThemedIcon(thinkingLight, thinkingDark)
  const isReasoner = activeModel === 'deepseek-reasoner'
  const parsed = isReasoner
    ? parseReasoning(streamingContent)
    : { reasoning: null as string | null, body: streamingContent, isThinking: false }

  // Track 2 / E2 — chapters are anchored to a timestamp, not directly
  // to a message id. Build a map from "before message at index i" → list
  // of chapter rows whose createdAt fits between messages[i-1] and
  // messages[i]. Late-arriving chapters (after the last message) land
  // in the "afterAll" bucket and render at the bottom.
  const chapters = useChaptersStore((s) => s.chapters)
  const { byBefore, afterAll } = useMemo(() => {
    const byBefore: Record<number, Chapter[]> = {}
    const afterAll: Chapter[] = []
    if (chapters.length === 0) return { byBefore, afterAll }
    const sorted = [...chapters].sort((a, b) => a.createdAt - b.createdAt)
    for (const c of sorted) {
      const idx = messages.findIndex((m) => m.timestamp >= c.createdAt)
      if (idx === -1) afterAll.push(c)
      else (byBefore[idx] ??= []).push(c)
    }
    return { byBefore, afterAll }
  }, [chapters, messages])

  // Fluidity J9: interleave inline notices (async events) with messages
  // by timestamp. Same bucket pattern chapters use, so the render loop
  // only needs to know about per-index buckets.
  const activeConvId = useChatStore((s) => s.activeConversationId)
  const allNotices = useInlineNoticesStore((s) => s.byConv)
  const dismissNotice = useInlineNoticesStore((s) => s.dismiss)
  const { noticesByBefore, noticesAfterAll } = useMemo(() => {
    const byBefore: Record<number, ReturnType<typeof useInlineNoticesStore.getState>['byConv'][string]> = {}
    const afterAll: typeof byBefore[number] = []
    if (!activeConvId) return { noticesByBefore: byBefore, noticesAfterAll: afterAll }
    const notices = allNotices[activeConvId] ?? []
    if (notices.length === 0) return { noticesByBefore: byBefore, noticesAfterAll: afterAll }
    const sorted = [...notices].sort((a, b) => a.ts - b.ts)
    for (const n of sorted) {
      const idx = messages.findIndex((m) => m.timestamp > n.ts)
      if (idx === -1) afterAll.push(n)
      else (byBefore[idx] ??= []).push(n)
    }
    return { noticesByBefore: byBefore, noticesAfterAll: afterAll }
  }, [allNotices, activeConvId, messages])

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto py-4">
      {/* Belt-and-suspenders centering: flex wrapper guarantees horizontal
          centering even if Tailwind's mx-auto can't compute against the
          parent's flex context. */}
      <div className="flex w-full justify-center">
        <div className={CHAT_COLUMN_CLASS}>
          {messages.map((msg, i) => {
            // Track 2 / E5 — messages that were folded into a summary
            // by the compressor are not rendered here (the summary
            // message replaces them). The renderer's effective view
            // SHOULD already filter, but we double-guard to keep the
            // pill from showing alongside its originals if the chat
            // store ever ships the raw view.
            if (msg.compressedInto) return null
            const compressed = isCompressedSummaryMessage(msg)
            return (
              <div key={msg.id} data-message-id={msg.id}>
                {byBefore[i]?.map((c) => (
                  <ChapterDivider key={c.id} chapter={c} />
                ))}
                {noticesByBefore[i]?.map((n) => (
                  <TranscriptNotice
                    key={n.id}
                    notice={n}
                    onDismiss={() => dismissNotice(n.conversationId, n.id)}
                  />
                ))}
                {compressed ? (
                  <CompressedRegionPill message={msg} />
                ) : msg.role === 'system' ? (
                  <SystemMarker content={msg.content} />
                ) : (
                  <MessageBubble message={msg} />
                )}
              </div>
            )
          })}
          {afterAll.map((c) => (
            <ChapterDivider key={c.id} chapter={c} />
          ))}
          {noticesAfterAll.map((n) => (
            <TranscriptNotice
              key={n.id}
              notice={n}
              onDismiss={() => dismissNotice(n.conversationId, n.id)}
            />
          ))}
          {/* Tool-call cards do NOT render inside the transcript anymore —
              they live behind the ToolActivityChip in the input pill row.
              The chat panel stays clean during exploration bursts; the
              chip materializes when work is happening and disappears
              when there is none. InlineApprovalQueue below still renders
              inline because approval chips are user-actionable, not
              historical noise. */}
          {/* Fluidity J5 — inline approval chips for previously-approved,
              non-destructive (server, tool) pairs. The first chip in the
              queue auto-focuses so 1/2/3 keystrokes land without a click. */}
          <InlineApprovalQueue />

          {isStreaming && (streamingContent || streamStartedAt) && (
            <div className="mb-3 flex justify-start">
              <div className="max-w-[80%] rounded-lg bg-[var(--bg-secondary)] px-4 py-3">
                {streamingContent ? (
                  <StreamingText content={streamingContent} model={activeModel} />
                ) : (
                  <div className="flex items-center text-[var(--text-muted)]">
                    <img
                      src={thinkingIconUrl}
                      alt="Thinking"
                      className="icon-asset h-[31px] w-[31px] animate-pulse object-contain"
                    />
                  </div>
                )}
                <StreamStatusLine
                  startedAt={streamStartedAt}
                  content={parsed.body}
                  reasoning={parsed.reasoning}
                />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}
