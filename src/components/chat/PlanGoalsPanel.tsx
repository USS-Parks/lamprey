import { useEffect, useState } from 'react'
import { toast } from '@/stores/toast-store'
import { usePlanStore } from '@/stores/plan-store'
import type { PlanStep, PlanStepStatus } from '@/lib/types'

const STATUS_LABELS: Record<PlanStepStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  done: 'Done'
}

function statusTone(status: PlanStepStatus): string {
  if (status === 'done') return 'border-[var(--success)] text-[var(--success)]'
  if (status === 'in_progress') return 'border-[var(--accent)] text-[var(--accent)]'
  return 'border-[var(--border)] text-[var(--text-muted)]'
}

interface PlanGoalsPanelProps {
  conversationId: string | null
}

export function PlanGoalsPanel({ conversationId }: PlanGoalsPanelProps) {
  const snapshot = usePlanStore((s) => s.snapshot)
  const planModeActive = usePlanStore((s) => s.planModeActive)
  const updatePlan = usePlanStore((s) => s.updatePlan)
  const setAllStatuses = usePlanStore((s) => s.setAllStatuses)
  const exitPlanMode = usePlanStore((s) => s.exitPlanMode)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busyAction, setBusyAction] = useState<'approve' | 'reject' | null>(null)

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const step of snapshot?.steps ?? []) next[step.id] = step.text
    setDrafts(next)
  }, [snapshot?.conversationId, snapshot?.steps])

  if (!conversationId || !snapshot || snapshot.steps.length === 0) return null

  const persistStep = async (step: PlanStep, patch: Partial<PlanStep>) => {
    const ok = await updatePlan(conversationId, [{ ...step, ...patch }])
    if (!ok) toast.error('Failed to update plan')
  }

  const approveAll = async () => {
    setBusyAction('approve')
    try {
      const marked = await setAllStatuses(conversationId, 'done')
      const exited = await exitPlanMode(conversationId)
      if (!marked || !exited) toast.error('Could not approve the full plan')
      else toast.success('Plan approved')
    } finally {
      setBusyAction(null)
    }
  }

  const rejectPlan = async () => {
    setBusyAction('reject')
    try {
      const ok = await updatePlan(conversationId, [], true)
      if (!ok) toast.error('Could not reject plan')
      else toast.success('Plan rejected')
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div
      className="pointer-events-auto mb-2 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-[12px] shadow-sm transition-all duration-200"
      role="region"
      aria-label="Plan goals"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          Plan goals
        </span>
        <span className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
          {snapshot.totals.done}/{snapshot.totals.total}
        </span>
        {planModeActive && (
          <span className="rounded border border-[var(--warning)] bg-[var(--warning)]/10 px-1.5 py-0.5 text-[10px] text-[var(--warning)]">
            gated
          </span>
        )}
        <div className="ml-auto flex gap-1">
          <button
            onClick={approveAll}
            disabled={busyAction !== null}
            className="rounded border border-[var(--success)] bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] text-[var(--success)] hover:bg-[var(--success)] hover:text-[var(--bg-primary)] disabled:opacity-50"
          >
            {busyAction === 'approve' ? 'Approving...' : 'Approve all'}
          </button>
          <button
            onClick={rejectPlan}
            disabled={busyAction !== null}
            className="rounded border border-[var(--error)] bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] text-[var(--error)] hover:bg-[var(--error)] hover:text-white disabled:opacity-50"
          >
            {busyAction === 'reject' ? 'Rejecting...' : 'Reject'}
          </button>
        </div>
      </div>

      <ul className="space-y-1.5">
        {snapshot.steps.map((step) => (
          <li key={step.id} className="grid grid-cols-[104px_1fr] gap-2">
            <select
              value={step.status}
              onChange={(event) =>
                void persistStep(step, { status: event.target.value as PlanStepStatus })
              }
              className={`h-7 rounded border bg-[var(--bg-primary)] px-1.5 text-[11px] outline-none focus:border-[var(--accent)] ${statusTone(step.status)}`}
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <textarea
              value={drafts[step.id] ?? step.text}
              rows={1}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [step.id]: event.target.value }))
              }
              onBlur={() => {
                const text = (drafts[step.id] ?? step.text).trim()
                if (text && text !== step.text) void persistStep(step, { text })
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.blur()
                }
              }}
              className="min-h-7 resize-none rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] leading-relaxed text-[var(--text-secondary)] outline-none focus:border-[var(--accent)]"
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
