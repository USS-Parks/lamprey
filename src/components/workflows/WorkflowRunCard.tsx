import type { ReactElement } from 'react'
import { PhaseGroup } from './PhaseGroup'
import { useWorkflowsStore, type WorkflowRunState } from '@/stores/workflows-store'

interface Props {
  run: WorkflowRunState
}

const STATUS_BADGE: Record<WorkflowRunState['status'], string> = {
  running: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  errored: 'bg-red-500/15 text-red-700 dark:text-red-300',
  aborted: 'bg-gray-500/15 text-gray-700 dark:text-gray-300'
}

function elapsed(run: WorkflowRunState): string {
  if (!run.startedAt) return ''
  const end = run.finishedAt ?? Date.now()
  const ms = Math.max(0, end - run.startedAt)
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m${s.toString().padStart(2, '0')}s`
}

export function WorkflowRunCard({ run }: Props): ReactElement {
  const stopRun = useWorkflowsStore((s) => s.stopRun)
  const badge = STATUS_BADGE[run.status]
  return (
    <div
      data-testid="workflow-run-card"
      data-run-id={run.runId}
      data-status={run.status}
      className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[var(--text)]">{run.name}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${badge}`}>
            {run.status}
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">{elapsed(run)}</span>
        </div>
        {run.status === 'running' && (
          <button
            data-testid="workflow-stop"
            onClick={() => stopRun(run.runId)}
            className="rounded px-2 py-0.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-red-600"
          >
            Stop
          </button>
        )}
      </div>
      {run.error && (
        <div className="mt-2 rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-700 dark:text-red-300">
          {run.error}
        </div>
      )}
      <div className="mt-2">
        {run.phases.length === 0 ? (
          <div className="text-[11px] italic text-[var(--text-muted)]">no phases yet</div>
        ) : (
          run.phases.map((g) => <PhaseGroup key={g.title} group={g} />)
        )}
      </div>
      {run.log.length > 0 && (
        <div className="mt-3 border-t border-[var(--border)] pt-2">
          {run.log.map((line) => (
            <div
              key={line.id}
              data-testid="narrator-line"
              className="text-[11px] text-[var(--text-secondary)]"
            >
              <span className="opacity-60">▸</span> {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
