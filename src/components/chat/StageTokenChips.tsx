import { useEffect, useState } from 'react'
import type { StageMetric, StageKey } from '@/lib/types'

interface StageTokenChipsProps {
  messageId: string
}

const STAGE_LABEL: Record<StageKey, string> = {
  planner: 'planner',
  coder: 'coder',
  reviewer: 'reviewer',
  single: 'turn'
}

function formatTokens(n: number | null): string {
  if (n == null) return '?'
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1)}k`
}

function formatDuration(ms: number | null): string | null {
  if (ms == null) return null
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const r = Math.round(s % 60)
  return `${m}m ${r}s`
}

/**
 * RT3 — per-stage token + duration chips for an assistant bubble. Fetches
 * metrics via `window.api.conversation.listStageMetrics` once on mount. When
 * the API is absent (browser dev mode) or returns no rows, renders nothing
 * so the bubble layout is unchanged.
 */
export function StageTokenChips({ messageId }: StageTokenChipsProps) {
  const [metrics, setMetrics] = useState<StageMetric[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const api = typeof window !== 'undefined' ? window.api : undefined
    if (!api?.conversation?.listStageMetrics) {
      setMetrics([])
      return
    }
    api.conversation
      .listStageMetrics(messageId)
      .then((res: { success: boolean; data?: StageMetric[]; error?: string }) => {
        if (cancelled) return
        if (res.success && Array.isArray(res.data)) setMetrics(res.data)
        else setMetrics([])
      })
      .catch(() => {
        if (!cancelled) setMetrics([])
      })
    return () => {
      cancelled = true
    }
  }, [messageId])

  if (!metrics || metrics.length === 0) return null

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-[var(--text-muted)]">
      {metrics.map((m) => {
        const dur = formatDuration(m.durationMs)
        const tokens = formatTokens(m.completionTokens)
        return (
          <span
            key={m.id}
            title={
              `${STAGE_LABEL[m.stage]} stage` +
              (m.model ? ` · ${m.model}` : '') +
              (m.completionTokens != null ? ` · ${m.completionTokens} tokens` : '') +
              (m.durationMs != null ? ` · ${m.durationMs}ms` : '')
            }
            className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-tertiary)]/60 px-1.5 py-0.5"
          >
            <span className="text-[var(--text-secondary)]">{STAGE_LABEL[m.stage]}</span>
            <span>{tokens}</span>
            {dur && <span aria-hidden>·</span>}
            {dur && <span>{dur}</span>}
          </span>
        )
      })}
    </div>
  )
}
