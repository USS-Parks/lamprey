import { useEffect, useMemo, useState } from 'react'
import { useActivityStore } from '@/stores/activity-store'
import { useChatStore, type ToolCallState } from '@/stores/chat-store'
import { toast } from '@/stores/toast-store'
import {
  collapsedSummary,
  formatElapsed
} from '@/lib/tool-card-helpers'

// Docked right-sidebar view that consolidates everything happening in
// the background — live agent runs, in-flight tool calls, scheduled
// automations, and pending wakeup loops — into one inspectable list.
//
// Scope on first pass:
// - read-only for tool calls (no cancel API exists yet)
// - stop for agent runs (activity-store.stopAgent)
// - cancel for wakeups (activity-store.cancelWakeup)
// - automations are listed for visibility; create/edit/toggle still
//   live in Settings > Automations
//
// SpawnTaskTray (the floating top-right tray) keeps its own surface for
// now; consolidating it here is a follow-up.

function formatRelative(ts: number | null): string {
  if (!ts) return ''
  const delta = ts - Date.now()
  const abs = Math.abs(delta)
  const seconds = Math.round(abs / 1000)
  if (seconds < 60) return delta < 0 ? `${seconds}s ago` : `in ${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return delta < 0 ? `${minutes}m ago` : `in ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return delta < 0 ? `${hours}h ago` : `in ${hours}h`
  const days = Math.round(hours / 24)
  return delta < 0 ? `${days}d ago` : `in ${days}d`
}

function StatusDot({ status }: { status: string }) {
  const tone =
    status === 'running' || status === 'pending'
      ? 'bg-[var(--accent)]'
      : status === 'done' || status === 'success'
        ? 'bg-[var(--success)]'
        : status === 'error'
          ? 'bg-[var(--error)]'
          : 'bg-[var(--text-muted)]'
  return <span className={`inline-block h-2 w-2 rounded-full ${tone}`} aria-hidden />
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-3 pb-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
      <span className="rounded border border-[var(--border)] px-1.5 py-0 font-mono text-[10px] text-[var(--text-muted)]">
        {count}
      </span>
    </div>
  )
}

function ToolCallRow({ call }: { call: ToolCallState }) {
  // Permanent, always-accessible per-session tool log lives here. The row
  // collapses to a one-liner (label + arg summary + status + elapsed) and
  // expands to show full JSON args + raw result on click. This is the
  // single anchor the user can open at any time to recover every call the
  // model made in the session — paths, file contents, results.
  const [expanded, setExpanded] = useState(false)

  const elapsedLabel = (() => {
    if (typeof call.duration === 'number') return formatElapsed(call.duration)
    if (!call.startedAt) return call.status
    const secs = Math.max(0, Math.round((Date.now() - call.startedAt) / 1000))
    return `${secs}s`
  })()

  const isError = call.status === 'error'
  const isDenied = call.status === 'denied'

  const argsJson = (() => {
    try {
      return JSON.stringify(call.args ?? {}, null, 2)
    } catch {
      return String(call.args ?? '')
    }
  })()

  const argsSummary = collapsedSummary(call.args)

  return (
    <li
      className={`rounded-md border bg-[var(--bg-primary)] text-[12px] ${
        isError ? 'border-[var(--error)]/40' : 'border-[var(--border)]'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-[var(--bg-secondary)]"
      >
        <StatusDot status={call.status} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[var(--text-primary)]">
            {call.title ?? call.toolName}
          </span>
          <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">
            {argsSummary}
          </span>
        </span>
        <span className="flex-none font-mono text-[10px] text-[var(--text-muted)]">
          {elapsedLabel}
        </span>
        <span className="flex-none text-[10px] text-[var(--text-muted)]" aria-hidden>
          {expanded ? '▲' : '▼'}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-[var(--border)] px-2 py-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Arguments
          </div>
          <pre className="mb-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg-secondary)] px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)]">
            {argsJson}
          </pre>
          {(call.result || isError || isDenied) && (
            <>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Result
              </div>
              <pre
                className={`max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg-secondary)] px-2 py-1 font-mono text-[11px] ${
                  isError
                    ? 'text-[var(--error)]'
                    : isDenied
                      ? 'italic text-[var(--text-muted)]'
                      : 'text-[var(--text-secondary)]'
                }`}
              >
                {call.result || (isDenied ? 'Denied by user.' : '')}
              </pre>
            </>
          )}
        </div>
      )}
    </li>
  )
}

export function BackgroundTasksPanel(): React.ReactElement {
  const agentRuns = useActivityStore((s) => s.agentRuns)
  const automations = useActivityStore((s) => s.automations)
  const wakeups = useActivityStore((s) => s.wakeups)
  const refresh = useActivityStore((s) => s.refresh)
  const stopAgent = useActivityStore((s) => s.stopAgent)
  const cancelWakeup = useActivityStore((s) => s.cancelWakeup)
  const toolCalls = useChatStore((s) => s.toolCalls)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Tool calls render in full — every call the model has made this
  // session, not just the in-flight ones. The user explicitly wants this
  // as the permanent, openable session log so they can recover paths,
  // args, and results at any time after the work has happened. The
  // transcriptHidden filter mirrors what ToolActivityChip hides (UX-shim
  // tools whose effect is shown elsewhere in the UI). Newest-first.
  const allTools = useMemo(
    () =>
      [...toolCalls]
        .filter((c) => !c.transcriptHidden)
        .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)),
    [toolCalls]
  )
  const liveToolCount = useMemo(
    () => allTools.filter((c) => c.status === 'pending' || c.status === 'running').length,
    [allTools]
  )
  const liveAgents = useMemo(
    () => agentRuns.filter((a) => a.status === 'running'),
    [agentRuns]
  )
  const pendingWakeups = useMemo(
    () => wakeups.filter((w) => w.status === 'pending').sort((a, b) => a.fireAt - b.fireAt),
    [wakeups]
  )

  const totalLive = liveToolCount + liveAgents.length + pendingWakeups.length

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const onStopAgent = async (id: string) => {
    setBusyId(id)
    try {
      const ok = await stopAgent(id)
      if (!ok) toast.error('Could not stop agent run')
      else toast.success('Agent stop requested')
    } finally {
      setBusyId(null)
    }
  }

  const onCancelWakeup = async (id: string) => {
    setBusyId(id)
    try {
      const ok = await cancelWakeup(id)
      if (!ok) toast.error('Could not cancel wakeup')
      else toast.success('Wakeup cancelled')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Subheader: total live count + refresh */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-[12px]">
        <span className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
          {totalLive} live
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="ml-auto rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] disabled:opacity-50"
          title="Refresh agent runs + wakeups + automations"
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto pb-2">
        {totalLive === 0 && automations.length === 0 && allTools.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-[12px] text-[var(--text-muted)]">
            <span className="font-mono uppercase tracking-wider text-[11px] mb-1">
              All clear
            </span>
            <span>
              No agent runs, tool calls, wakeups, or scheduled tasks are active.
            </span>
          </div>
        )}

        {/* Tool calls — full session history, expandable. Sits at the top
            so the permanent log is the first thing the user sees when
            they open the panel. */}
        {allTools.length > 0 && (
          <>
            <SectionHeader label="Tool calls" count={allTools.length} />
            <ul className="space-y-1 px-3">
              {allTools.map((call) => (
                <ToolCallRow key={call.callId} call={call} />
              ))}
            </ul>
          </>
        )}

        {liveAgents.length > 0 && (
          <>
            <SectionHeader label="Agents" count={liveAgents.length} />
            <ul className="space-y-1 px-3">
              {liveAgents.map((run) => (
                <li
                  key={run.id}
                  className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px]"
                >
                  <StatusDot status={run.status} />
                  <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">
                    {run.label || run.agentType}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--text-muted)]">
                    {formatRelative(run.startedAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void onStopAgent(run.id)}
                    disabled={busyId === run.id}
                    className="rounded border border-[var(--error)] px-1.5 py-0.5 text-[10px] text-[var(--error)] hover:bg-[var(--error)] hover:text-white disabled:opacity-50"
                  >
                    {busyId === run.id ? '...' : 'Stop'}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {pendingWakeups.length > 0 && (
          <>
            <SectionHeader label="Wakeups" count={pendingWakeups.length} />
            <ul className="space-y-1 px-3">
              {pendingWakeups.map((wakeup) => (
                <li
                  key={wakeup.id}
                  className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px]"
                >
                  <StatusDot status={wakeup.status} />
                  <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">
                    {wakeup.reason ?? wakeup.prompt.slice(0, 80)}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--text-muted)]">
                    {formatRelative(wakeup.fireAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void onCancelWakeup(wakeup.id)}
                    disabled={busyId === wakeup.id}
                    className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:border-[var(--error)] hover:text-[var(--error)] disabled:opacity-50"
                  >
                    {busyId === wakeup.id ? '...' : 'Cancel'}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {automations.length > 0 && (
          <>
            <SectionHeader label="Scheduled" count={automations.length} />
            <ul className="space-y-1 px-3">
              {automations.map((auto) => (
                <li
                  key={auto.id}
                  className={`flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px] ${
                    auto.enabled ? '' : 'opacity-50'
                  }`}
                >
                  <StatusDot status={auto.enabled ? 'pending' : 'idle'} />
                  <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">
                    {auto.label}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--text-muted)]">
                    {auto.cron}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
