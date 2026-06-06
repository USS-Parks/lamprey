import { useEffect, useMemo, useState } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { ReasoningBlock } from '@/components/chat/ReasoningBlock'
import type { Message, StageMetric, StageKey } from '@/lib/types'

// RT5 + RT6 — Reasoning-Trace Viewer panel. Lists every assistant turn in
// the active conversation with its model + total tokens + stage count;
// clicking a row expands a per-stage view that reuses ReasoningBlock for
// each stage's reasoning text. RT6 adds the debounced search filter and
// the stage-filter chip cluster (All / Planner / Coder / Reviewer / Single).
// Data sources: `conversation:getMessages` + per-message `conversation:
// listStageMetrics`. Browser-dev guard: empty-state hint if `window.api`
// is absent.

interface TurnRow {
  message: Message
  metrics: StageMetric[]
}

type StageFilter = 'all' | StageKey
const STAGE_FILTERS: Array<{ key: StageFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'planner', label: 'Planner' },
  { key: 'coder', label: 'Coder' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'single', label: 'Single' }
]

const STAGE_NOTE: Partial<Record<StageKey, string>> = {
  planner:
    '(Planner output is folded into the Coder user message; the planner stage produces no separately-persisted reasoning. The metric row shows token + duration cost only.)',
  reviewer:
    '(Reviewer reasoning is not separately persisted on this turn — only the verdict body.)'
}

function formatTokens(n: number | null | undefined): string {
  if (n == null) return '–'
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1)}k`
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function ReasoningTracePanel(): React.ReactElement {
  const conversationId = useChatStore((s) => s.activeConversationId)
  const [rows, setRows] = useState<TurnRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [stageFilter, setStageFilter] = useState<StageFilter>('all')

  // RT6 — debounce the search term so rapid typing doesn't flash the list.
  useEffect(() => {
    const id = window.setTimeout(() => setSearchTerm(searchInput.trim().toLowerCase()), 250)
    return () => window.clearTimeout(id)
  }, [searchInput])

  useEffect(() => {
    if (!conversationId) {
      setRows([])
      return
    }
    const api = typeof window !== 'undefined' ? window.api : undefined
    if (!api?.conversation?.getMessages) {
      setRows([])
      setError('window.api unavailable')
      return
    }
    let cancelled = false
    async function load(): Promise<void> {
      const msgRes = await api!.conversation.getMessages(conversationId!)
      if (cancelled) return
      if (!msgRes?.success || !Array.isArray(msgRes.data)) {
        setError(msgRes?.error ?? 'Failed to load messages')
        setRows([])
        return
      }
      const messages = msgRes.data as Message[]
      const assistantMessages = messages.filter((m) => m.role === 'assistant')
      const enriched: TurnRow[] = []
      for (const m of assistantMessages) {
        let metrics: StageMetric[] = []
        const metricsRes = await api!.conversation.listStageMetrics(m.id)
        if (metricsRes?.success && Array.isArray(metricsRes.data)) {
          metrics = metricsRes.data as StageMetric[]
        }
        enriched.push({ message: m, metrics })
      }
      if (!cancelled) setRows(enriched)
    }
    void load().catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : String(err))
        setRows([])
      }
    })
    return () => {
      cancelled = true
    }
  }, [conversationId])

  const filteredRows = useMemo(() => {
    if (!rows) return [] as TurnRow[]
    return rows.filter((row) => {
      if (stageFilter !== 'all') {
        const hasStage = row.metrics.some((m) => m.stage === stageFilter)
        if (!hasStage) return false
      }
      if (searchTerm) {
        const haystack = (
          (row.message.content ?? '') +
          ' ' +
          (row.message.reasoning ?? '')
        ).toLowerCase()
        if (!haystack.includes(searchTerm)) return false
      }
      return true
    })
  }, [rows, stageFilter, searchTerm])

  if (!conversationId) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-[12px] text-[var(--text-muted)]">
        Open a conversation to see its reasoning trace.
      </div>
    )
  }

  if (rows === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-[12px] text-[var(--text-muted)]">
        Loading reasoning trace…
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-[var(--text-muted)]">
        No reasoning yet — start a conversation to populate this view.
        {error && (
          <div className="mt-2 text-[11px] text-[var(--danger,#ef4444)]">{error}</div>
        )}
      </div>
    )
  }

  const handleExport = async (format: 'md' | 'csv'): Promise<void> => {
    const api = typeof window !== 'undefined' ? window.api : undefined
    if (!api?.reasoningTrace?.export || !conversationId) return
    try {
      const res = await api.reasoningTrace.export({ conversationId, format })
      if (res?.success && res.data?.path) {
        // Best-effort confirmation; toast utility is available elsewhere in
        // the app but importing it here would couple this panel to that
        // store — a console log + alert is sufficient for the audit use-case.
        // The user picked the destination so they know where the file went.
        console.info(`[reasoning-trace] exported to ${res.data.path}`)
      } else if (res?.error && res.error !== 'cancelled') {
        console.warn('[reasoning-trace] export failed:', res.error)
      }
    } catch (err) {
      console.warn('[reasoning-trace] export threw:', err)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-[var(--panel-border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search reasoning + body…"
            aria-label="Search reasoning trace"
            className="flex-1 rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            {filteredRows.length}/{rows.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-[var(--text-muted)]">Export:</span>
          <button
            type="button"
            onClick={() => void handleExport('md')}
            className="rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
            title="Save full audit trail as Markdown"
          >
            .md
          </button>
          <button
            type="button"
            onClick={() => void handleExport('csv')}
            className="rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
            title="Save full audit trail as CSV (one row per turn × stage)"
          >
            .csv
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {STAGE_FILTERS.map((f) => {
            const active = stageFilter === f.key
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setStageFilter(f.key)}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
                    : 'border-[var(--panel-border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]'
                }`}
              >
                {f.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2.5">
        {filteredRows.length === 0 ? (
          <div className="p-4 text-center text-[12px] text-[var(--text-muted)]">
            No turns match the current filters.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {filteredRows.map((row) => {
              const turnIndex = rows.indexOf(row)
              const totalTokens = row.metrics.reduce(
                (n, m) => n + (m.completionTokens ?? 0),
                0
              )
              const stageCount = row.metrics.length
              const isSelected = selectedId === row.message.id
              const stagesToShow =
                stageFilter === 'all'
                  ? row.metrics
                  : row.metrics.filter((m) => m.stage === stageFilter)
              return (
                <li key={row.message.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedId(isSelected ? null : row.message.id)
                    }
                    className={`w-full rounded-lg border border-[var(--panel-border)] bg-[var(--bg-primary)] p-2.5 text-left transition-all hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)] ${
                      isSelected ? 'ring-1 ring-[var(--accent)]' : ''
                    }`}
                    aria-label={`Turn ${turnIndex + 1}`}
                    aria-expanded={isSelected}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-[var(--text-muted)]">
                        #{turnIndex + 1}
                      </span>
                      <span className="text-[12px] text-[var(--text-primary)]">
                        {row.message.model ?? 'unknown'}
                      </span>
                      <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)]">
                        {formatTime(row.message.timestamp)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                      <span>{stageCount} stage{stageCount === 1 ? '' : 's'}</span>
                      <span aria-hidden>·</span>
                      <span>~{formatTokens(totalTokens)} tokens</span>
                    </div>
                  </button>
                  {isSelected && (
                    <div className="mt-1.5 space-y-1.5 rounded-lg border border-[var(--panel-border)] bg-[var(--bg-tertiary)]/40 p-2">
                      {stagesToShow.length === 0 ? (
                        <div className="text-[11px] text-[var(--text-muted)]">
                          No matching stages for this turn.
                        </div>
                      ) : (
                        stagesToShow.map((m) => (
                          <div key={m.id} className="space-y-1">
                            <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                              <span className="font-mono uppercase tracking-wider">
                                {m.stage}
                              </span>
                              {m.model && (
                                <span className="text-[var(--text-muted)]">{m.model}</span>
                              )}
                              <span className="ml-auto font-mono text-[var(--text-muted)]">
                                {m.completionTokens != null
                                  ? `${formatTokens(m.completionTokens)} tokens`
                                  : ''}
                                {m.durationMs != null && (
                                  <>
                                    {m.completionTokens != null && ' · '}
                                    {m.durationMs}ms
                                  </>
                                )}
                              </span>
                            </div>
                            {/* Show reasoning + body for the message that owns this stage.
                                For multi-agent planner riding on the coder message, the planner
                                has no separate body — show the STAGE_NOTE explanation instead. */}
                            {m.stage === 'planner' && row.message.model !== m.model ? (
                              <div className="px-2 text-[11px] italic text-[var(--text-muted)]">
                                {STAGE_NOTE.planner}
                              </div>
                            ) : m.stage === 'reviewer' && !row.message.reasoning ? (
                              <div className="px-2 text-[11px] italic text-[var(--text-muted)]">
                                {STAGE_NOTE.reviewer}
                              </div>
                            ) : (
                              row.message.reasoning && (
                                <ReasoningBlock content={row.message.reasoning} />
                              )
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
