import { useEffect, useState } from 'react'
import { useChatStore } from '../../stores/chat-store'
import { useAgentStore } from '../../stores/agent-store'

interface StreamStatusLineProps {
  startedAt: number | null
  content: string
  reasoning?: string | null
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}m ${r}s`
}

function estimateTokens(text: string): number {
  // Cheap estimate: ~4 chars per token across most tokenizers. Close enough
  // for a live status line; exact counts come from the backend on finish.
  if (!text) return 0
  return Math.max(1, Math.round(text.length / 4))
}

export function StreamStatusLine({ startedAt, content, reasoning }: StreamStatusLineProps) {
  const [now, setNow] = useState(() => Date.now())
  // T4 — pick up the provider-side vitals heartbeat so we can show the
  // "last chunk Ns ago" line. Falls back gracefully when no heartbeat
  // has arrived (e.g. the very first second of a stream).
  const vitals = useChatStore((s) => s.streamingVitals)
  // RT3 — when multi-agent mode is active, show which stage is currently
  // running. This is the live counterpart to the persistent StageTokenChips
  // on the assistant bubble.
  const agentMode = useAgentStore((s) => s.mode)
  const activeRun = useAgentStore((s) => s.activeRun)

  useEffect(() => {
    if (!startedAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])

  if (!startedAt) return null

  const elapsed = formatElapsed(now - startedAt)
  const outputTokens = estimateTokens(content) + estimateTokens(reasoning ?? '')
  const phase = reasoning && !content ? 'thinking' : 'streaming'

  // Compute "Ns since last chunk" live from the local clock against the
  // vitals' lastChunkAt — keeps the indicator ticking between 2s heartbeats.
  // When lastChunkAt is 0 (no chunks yet) we fall back to attempt-elapsed
  // so the indicator never shows a stale "0s ago".
  let sinceLastChunkLabel: string | null = null
  let staleness: 'fresh' | 'warm' | 'stale' = 'fresh'
  if (vitals && vitals.lastChunkAt > 0) {
    const msSince = Math.max(0, now - vitals.lastChunkAt)
    sinceLastChunkLabel = `${Math.floor(msSince / 1000)}s since last chunk`
    if (msSince > 30_000) staleness = 'stale'
    else if (msSince > 10_000) staleness = 'warm'
  } else if (vitals && vitals.lastChunkAt === 0 && vitals.attemptElapsedMs > 5_000) {
    sinceLastChunkLabel = `waiting for first chunk (${Math.floor(vitals.attemptElapsedMs / 1000)}s)`
    if (vitals.attemptElapsedMs > 20_000) staleness = 'stale'
    else if (vitals.attemptElapsedMs > 10_000) staleness = 'warm'
  }

  const stalenessClass =
    staleness === 'stale'
      ? 'text-[var(--danger,#ef4444)]'
      : staleness === 'warm'
        ? 'text-[var(--warning,#eab308)]'
        : ''

  const runningStage =
    agentMode === 'multi' ? activeRun.find((r) => r.state === 'running')?.role : undefined

  return (
    <div className="mt-2 flex items-center gap-2 font-mono text-[11px] text-[var(--text-muted)]">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
      <span>{elapsed}</span>
      <span aria-hidden>·</span>
      <span>{phase}</span>
      {runningStage && (
        <>
          <span aria-hidden>·</span>
          <span className="text-[var(--accent)]">stage:{runningStage}</span>
        </>
      )}
      <span aria-hidden>·</span>
      <span>~{outputTokens.toLocaleString()} tokens</span>
      {sinceLastChunkLabel && (
        <>
          <span aria-hidden>·</span>
          <span className={stalenessClass}>{sinceLastChunkLabel}</span>
        </>
      )}
    </div>
  )
}
