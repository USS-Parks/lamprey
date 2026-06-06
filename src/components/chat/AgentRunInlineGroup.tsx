import { useState } from 'react'
import { formatElapsed } from '@/lib/tool-card-helpers'

// Fluidity J7: in-transcript multi-agent run group. Renders a single
// "Multi-agent run" header chevron with N nested per-agent chevron rows.
// Each agent row expands to show its emitted text. Replaces the flat
// `MultiAgentRunCard` block + the in-turn `AgentRunBanner` pipeline so
// the transcript stays the single source of truth for what the model is
// doing.
//
// Background runs (`tasks:spawn` with `runInBackground:true`) keep using
// AgentRunBanner because they survive conversation switches and need a
// persistent surface.

export interface InlineAgentRow {
  id: string
  role: string
  model?: string
  status: 'pending' | 'running' | 'done' | 'error' | 'denied'
  elapsedMs?: number
  tokensEstimate?: number
  output?: string
  error?: string
}

interface AgentRunInlineGroupProps {
  headerLabel?: string
  totalElapsedMs?: number
  synthesisNotes?: string
  rows: InlineAgentRow[]
  isRunning?: boolean
}

function StatusDot({ status }: { status: InlineAgentRow['status'] }) {
  const cls =
    status === 'running' || status === 'pending'
      ? 'bg-[var(--accent)] animate-pulse'
      : status === 'done'
      ? 'bg-[var(--success)]'
      : status === 'error'
      ? 'bg-[var(--error)]'
      : 'bg-[var(--text-muted)]/40'
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} aria-hidden />
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span className="flex-none text-[12px] text-[var(--text-muted)]" aria-hidden>
      {open ? '▾' : '▸'}
    </span>
  )
}

function AgentRow({ row }: { row: InlineAgentRow }) {
  const erred = row.status === 'error' || !!row.error
  // Auto-expand failures so the user sees the error without clicking.
  // Successes mount collapsed; user toggle wins.
  const [userToggled, setUserToggled] = useState<boolean | null>(null)
  const open = userToggled !== null ? userToggled : erred

  return (
    <div
      className={
        'ml-5 rounded border ' +
        (erred ? 'border-[var(--error)]/40' : 'border-[var(--panel-border)]')
      }
    >
      <button
        type="button"
        onClick={() => setUserToggled(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-secondary)]"
      >
        <Chevron open={open} />
        <StatusDot status={row.status} />
        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-secondary)]">
          {row.role}
        </span>
        {row.model && (
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            · {row.model}
          </span>
        )}
        {typeof row.elapsedMs === 'number' && (
          <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)]">
            {formatElapsed(row.elapsedMs)}
          </span>
        )}
        {typeof row.tokensEstimate === 'number' && row.tokensEstimate > 0 && (
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            ≈{row.tokensEstimate}t
          </span>
        )}
      </button>
      {open && (row.output || row.error) && (
        <pre
          className={
            'max-h-40 overflow-auto whitespace-pre-wrap break-words border-t px-3 py-2 text-[12px] font-mono ' +
            (erred ? 'border-[var(--error)]/30 text-[var(--error)]' : 'border-[var(--panel-border)] text-[var(--text-secondary)]')
          }
        >
          {row.error ? row.error : row.output}
        </pre>
      )}
      {open && !row.output && !row.error && (
        <div className="border-t border-[var(--panel-border)] px-3 py-1 text-[11px] italic text-[var(--text-muted)]">
          (no output)
        </div>
      )}
    </div>
  )
}

export function AgentRunInlineGroup({
  headerLabel,
  totalElapsedMs,
  synthesisNotes,
  rows,
  isRunning
}: AgentRunInlineGroupProps) {
  const [headerOpen, setHeaderOpen] = useState(true)
  const label = headerLabel ?? 'Multi-agent run'
  const allDone = rows.every((r) => r.status === 'done')
  const anyErr = rows.some((r) => r.status === 'error' || !!r.error)
  const headerDot: InlineAgentRow['status'] = isRunning
    ? 'running'
    : anyErr
    ? 'error'
    : allDone
    ? 'done'
    : 'pending'

  return (
    <div className="my-2 mx-auto w-full max-w-[80%]">
      <button
        type="button"
        onClick={() => setHeaderOpen((v) => !v)}
        aria-expanded={headerOpen}
        className="flex w-full items-center gap-2 rounded-lg bg-[var(--bg-tertiary)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-secondary)]"
      >
        <Chevron open={headerOpen} />
        <StatusDot status={headerDot} />
        <span className="text-xs font-medium text-[var(--text-primary)]">{label}</span>
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          · {rows.length} agent{rows.length === 1 ? '' : 's'}
        </span>
        {typeof totalElapsedMs === 'number' && totalElapsedMs > 0 && (
          <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)]">
            {formatElapsed(totalElapsedMs)}
          </span>
        )}
      </button>
      {headerOpen && (
        <div className="mt-1 flex flex-col gap-1">
          {synthesisNotes && (
            <div className="ml-5 text-[11px] italic text-[var(--text-muted)]">
              {synthesisNotes}
            </div>
          )}
          {rows.map((r) => (
            <AgentRow key={r.id} row={r} />
          ))}
        </div>
      )}
    </div>
  )
}
