import { useEffect } from 'react'
import { useResearchRunsStore, type ResearchProgressSnapshot } from '@/stores/research-runs-store'

// Subscribes the renderer to the `research:progress` / `research:completed`
// / `research:failed` event streams (when available — i.e. running inside
// Electron) and feeds them into the research-runs store. Mount once at
// the root level (App.tsx) so banner subscribers can pull snapshots from
// the store rather than each component holding its own listener.

function isProgress(v: unknown): v is ResearchProgressSnapshot {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.runId === 'string' && typeof r.conversationId === 'string' && typeof r.stage === 'string'
}

interface CompletedEvent {
  runId: string
  conversationId: string
}

interface FailedEvent {
  runId: string
  conversationId: string
  error: string
}

export function useResearchProgressSubscription(): void {
  const ingest = useResearchRunsStore((s) => s.ingest)

  useEffect(() => {
    const w = window as unknown as {
      api?: {
        research?: {
          onProgress?: (cb: (e: unknown) => void) => () => void
          onCompleted?: (cb: (e: unknown) => void) => () => void
          onFailed?: (cb: (e: unknown) => void) => () => void
        }
      }
    }
    const api = w.api?.research
    if (!api?.onProgress) return

    const offProgress = api.onProgress?.((e) => {
      if (isProgress(e)) ingest(e)
    })
    const offCompleted = api.onCompleted?.((e) => {
      const ev = e as CompletedEvent
      if (!ev?.runId || !ev?.conversationId) return
      ingest({
        runId: ev.runId,
        conversationId: ev.conversationId,
        stage: 'done',
        sourcesFound: 0,
        sourcesFetched: 0,
        claimsExtracted: 0,
        claimsAccepted: 0,
        claimsDisputed: 0,
        elapsedMs: 0
      })
    })
    const offFailed = api.onFailed?.((e) => {
      const ev = e as FailedEvent
      if (!ev?.runId || !ev?.conversationId) return
      ingest({
        runId: ev.runId,
        conversationId: ev.conversationId,
        stage: 'failed',
        sourcesFound: 0,
        sourcesFetched: 0,
        claimsExtracted: 0,
        claimsAccepted: 0,
        claimsDisputed: 0,
        elapsedMs: 0,
        error: ev.error
      })
    })

    return () => {
      offProgress?.()
      offCompleted?.()
      offFailed?.()
    }
  }, [ingest])
}
