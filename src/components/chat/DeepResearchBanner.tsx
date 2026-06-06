import { useEffect, useState } from 'react'
import { useResearchRunsStore, type ResearchStage } from '@/stores/research-runs-store'

// Sticky banner pinned above MessageList while a research run is active
// in the current conversation. Subscribes to the runs store fed by
// `useResearchProgressSubscription` (mounted at the App root) so every
// conversation pane that mounts this component gets the same live view.
//
// Three states:
//   * Active   — shows the current stage label + progress counts + cancel.
//   * Cancelled / failed — shows a brief terminal state then auto-dismisses.
//   * Done — fades out and unmounts so the assistant message takes over.

interface DeepResearchBannerProps {
  conversationId: string
}

const STAGE_LABELS: Record<ResearchStage, string> = {
  planning: 'Planning queries…',
  searching: 'Searching the web',
  reading: 'Reading sources',
  'extracting-claims': 'Extracting claims',
  corroborating: 'Corroborating across sources',
  synthesizing: 'Synthesizing report',
  'writing-artifact': 'Writing report file',
  done: 'Research complete',
  cancelled: 'Cancelled — partial results discarded',
  failed: 'Research failed'
}

const TERMINAL_DISPLAY_MS = 3000

function fmtCount(n: number): string {
  return n > 0 ? String(n) : '—'
}

function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${s % 60}s`
}

export function DeepResearchBanner({ conversationId }: DeepResearchBannerProps) {
  const record = useResearchRunsStore((s) => s.byConversation[conversationId])
  const clearForConversation = useResearchRunsStore((s) => s.clearForConversation)
  const [busy, setBusy] = useState(false)

  // Auto-dismiss terminal states after a short delay.
  useEffect(() => {
    if (!record?.terminalAt) return
    const t = setTimeout(() => clearForConversation(conversationId), TERMINAL_DISPLAY_MS)
    return () => clearTimeout(t)
  }, [record?.terminalAt, conversationId, clearForConversation])

  if (!record) return null
  const { snapshot } = record

  const handleCancel = async () => {
    const w = window as unknown as {
      api?: { research?: { cancel?: (runId: string) => Promise<{ success: boolean; error?: string }> } }
    }
    const fn = w.api?.research?.cancel
    if (!fn) return
    setBusy(true)
    try {
      await fn(snapshot.runId)
    } finally {
      setBusy(false)
    }
  }

  const isTerminal = snapshot.stage === 'done' || snapshot.stage === 'cancelled' || snapshot.stage === 'failed'
  const isError = snapshot.stage === 'failed' || snapshot.stage === 'cancelled'

  return (
    <div
      data-testid="deep-research-banner"
      className={`sticky top-0 z-10 flex items-center gap-3 rounded-md px-4 py-2 text-[13px] ${
        isError ? 'bg-[var(--error)]/10' : 'bg-[var(--bg-tertiary)]'
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-2 w-2 rounded-full ${
          isTerminal ? (isError ? 'bg-[var(--error)]' : 'bg-[var(--success)]') : 'animate-pulse bg-[var(--accent)]'
        }`}
      />
      <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
          {STAGE_LABELS[snapshot.stage]}
        </span>
        {snapshot.stage === 'searching' && (
          <span className="font-mono text-[12px] text-[var(--text-muted)]">
            {fmtCount(snapshot.sourcesFound)} sources
          </span>
        )}
        {(snapshot.stage === 'reading' || snapshot.stage === 'extracting-claims') && (
          <span className="font-mono text-[12px] text-[var(--text-muted)]">
            {fmtCount(snapshot.sourcesFetched)}/{fmtCount(snapshot.sourcesFound)} read
            {snapshot.claimsExtracted > 0 ? ` · ${snapshot.claimsExtracted} claims` : ''}
          </span>
        )}
        {snapshot.stage === 'corroborating' && (
          <span className="font-mono text-[12px] text-[var(--text-muted)]">
            {fmtCount(snapshot.claimsAccepted)} accepted · {fmtCount(snapshot.claimsDisputed)} disputed
          </span>
        )}
        {snapshot.error && (
          <span className="font-mono text-[12px] text-[var(--error)]">{snapshot.error}</span>
        )}
        <span className="ml-auto font-mono text-[12px] text-[var(--text-muted)]">
          {fmtElapsed(snapshot.elapsedMs)}
        </span>
      </div>
      {!isTerminal && (
        <button
          onClick={handleCancel}
          disabled={busy}
          className="rounded border border-[var(--panel-border)] bg-transparent px-2.5 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
        >
          {busy ? 'Cancelling…' : 'Cancel'}
        </button>
      )}
    </div>
  )
}
