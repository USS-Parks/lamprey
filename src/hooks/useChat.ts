import { useEffect } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { usePlanStore } from '@/stores/plan-store'
import type { AgentRunPhase, PlanSnapshot } from '@/lib/types'

export function useChat(): void {
  useEffect(() => {
    if (!window.api) return

    // Chunks can arrive faster than React can render — every chunk re-renders
    // MessageList, reparses markdown, and reflows. That backs up the main
    // thread and starves click handlers (e.g. sidebar collapse goes
    // unresponsive). Coalesce all chunks that land within a single animation
    // frame into one store update so we re-render at most ~60×/sec.
    let pendingChunk = ''
    let pendingReasoning = ''
    let rafHandle: number | null = null

    const flushPending = () => {
      rafHandle = null
      if (pendingChunk) {
        const buf = pendingChunk
        pendingChunk = ''
        useChatStore.getState().appendStreamChunk(buf)
      }
      if (pendingReasoning) {
        const rbuf = pendingReasoning
        pendingReasoning = ''
        useChatStore.getState().appendReasoningChunk(rbuf)
      }
    }

    const scheduleFlush = () => {
      if (rafHandle === null) {
        rafHandle = requestAnimationFrame(flushPending)
      }
    }

    const queueChunk = (content: string) => {
      pendingChunk += content
      scheduleFlush()
    }

    const queueReasoning = (content: string) => {
      pendingReasoning += content
      scheduleFlush()
    }

    const flushNow = () => {
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle)
        rafHandle = null
      }
      if (pendingChunk) {
        const buf = pendingChunk
        pendingChunk = ''
        useChatStore.getState().appendStreamChunk(buf)
      }
      if (pendingReasoning) {
        const rbuf = pendingReasoning
        pendingReasoning = ''
        useChatStore.getState().appendReasoningChunk(rbuf)
      }
    }

    // Filter all incoming chat events by the active conversation so that
    // side-chat panels (which run their own conversation in parallel) don't
    // leak chunks into the main thread's UI state.
    const matchesActive = (e: { conversationId?: string }) =>
      e?.conversationId === useChatStore.getState().activeConversationId

    window.api.chat.onChunk((e) => {
      if (!matchesActive(e)) return
      queueChunk(e.content)
    })

    window.api.chat.onReasoning((e) => {
      if (!matchesActive(e)) return
      queueReasoning(e.content)
    })

    window.api.chat.onDone((e) => {
      if (!matchesActive(e as { conversationId?: string })) return
      flushNow()
      useChatStore.getState().finishStream(e.message as any)
    })

    window.api.chat.onError((e) => {
      if (!matchesActive(e)) return
      flushNow()
      useChatStore.getState().streamError(e.error)
    })

    window.api.chat.onToolCall((e) => {
      if (!matchesActive(e as { conversationId?: string })) return
      useChatStore.getState().addToolCall(e as any)
    })

    window.api.chat.onToolCallResult((e) => {
      if (!matchesActive(e as { conversationId?: string })) return
      useChatStore.getState().updateToolCall(e as any)
    })

    const onDocCreated = (window.api.chat as {
      onDocumentCreated?: (
        cb: (e: { conversationId: string; document: any }) => void
      ) => () => void
    }).onDocumentCreated
    const docUnsub = onDocCreated
      ? onDocCreated((e) => {
          if (!matchesActive(e)) return
          useChatStore.getState().appendStreamingDocument(e.document)
        })
      : undefined

    const onPhase = (window.api.chat as { onPhase?: (cb: (e: { conversationId: string; phase: string }) => void) => void }).onPhase
    if (onPhase) {
      onPhase((e) => {
        if (!matchesActive(e)) return
        const phase = e.phase as AgentRunPhase
        // Terminal phases retire the pill; transient phases drive it.
        if (phase === 'done' || phase === 'error') {
          useChatStore.getState().setRunPhase(null)
        } else {
          useChatStore.getState().setRunPhase(phase)
        }
      })
    }

    // T4 — streaming-vitals heartbeat. The provider fires ~every 2s while
    // a stream is active so the renderer can show "last chunk Ns ago / N
    // tokens" — lets the user distinguish a slow think from a dead socket.
    const onVitals = (window.api.chat as {
      onStreamingVitals?: (
        cb: (e: {
          conversationId: string
          lastChunkAt: number
          msSinceLastChunk: number
          chunkCount: number
          tokenEstimate: number
          attemptElapsedMs: number
        }) => void
      ) => () => void
    }).onStreamingVitals
    const vitalsUnsub = onVitals
      ? onVitals((e) => {
          if (!matchesActive(e)) return
          useChatStore.getState().setStreamingVitals({
            lastChunkAt: e.lastChunkAt,
            msSinceLastChunk: e.msSinceLastChunk,
            chunkCount: e.chunkCount,
            tokenEstimate: e.tokenEstimate,
            attemptElapsedMs: e.attemptElapsedMs
          })
        })
      : undefined

    // UB-6 (Unburdening Phase, 2026-06-10) — the agent:status +
    // planner-message listeners that lived here died with the pipeline.

    // Plan checklist live updates. The `plan:updated` event is broadcast
    // from chat.ts after every successful update_plan tool call; we drop
    // events for other conversations the same way matchesActive does for
    // chat events, then hand off to the plan store.
    const planNs = (window.api as { plan?: { onUpdated?: (cb: (e: { conversationId: string; snapshot: unknown }) => void) => () => void } }).plan
    const planUnsub = planNs?.onUpdated
      ? planNs.onUpdated((e) => {
          if (!matchesActive(e)) return
          usePlanStore.getState().applyUpdate(e.snapshot as PlanSnapshot)
        })
      : undefined

    return () => {
      if (rafHandle !== null) cancelAnimationFrame(rafHandle)
      window.api?.chat.offAll()
      planUnsub?.()
      docUnsub?.()
      vitalsUnsub?.()
    }
  }, [])
}
