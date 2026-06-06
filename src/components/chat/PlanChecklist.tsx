import { usePlanStore } from '@/stores/plan-store'
import type { PlanStepStatus } from '@/lib/types'

// Compact per-conversation plan checklist. Renders only when there is at
// least one step. The model writes via the update_plan native tool; chat.ts
// emits plan:updated and the plan store drives this view live.

function StatusIcon({ status }: { status: PlanStepStatus }) {
  if (status === 'done') {
    return (
      <span
        className="inline-flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full bg-[var(--success)] text-[10px] font-bold text-[var(--bg-primary)]"
        aria-label="done"
      >
        &#10003;
      </span>
    )
  }
  if (status === 'in_progress') {
    return (
      <span
        className="inline-block h-3.5 w-3.5 flex-none animate-pulse rounded-full bg-[var(--accent)]"
        aria-label="in progress"
      />
    )
  }
  return (
    <span
      className="inline-block h-3.5 w-3.5 flex-none rounded-full border border-[var(--text-muted)]"
      aria-label="pending"
    />
  )
}

export function PlanChecklist() {
  const snapshot = usePlanStore((s) => s.snapshot)
  if (!snapshot || snapshot.steps.length === 0) return null

  const { steps, totals } = snapshot
  const allDone = totals.done === totals.total && totals.total > 0

  return (
    <div
      className="pointer-events-auto mb-2 rounded-lg bg-[var(--bg-tertiary)] px-3 py-2 text-[12px]"
      role="region"
      aria-label="Plan"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono uppercase tracking-wider text-[var(--text-muted)]">Plan</span>
        <span
          className={
            allDone
              ? 'font-mono text-[11px] text-[var(--success)]'
              : 'font-mono text-[11px] text-[var(--text-muted)]'
          }
        >
          {totals.done}/{totals.total} done
        </span>
      </div>
      <ul className="space-y-1">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2">
            <span className="mt-0.5">
              <StatusIcon status={step.status} />
            </span>
            <span
              className={
                step.status === 'done'
                  ? 'flex-1 text-[var(--text-muted)] line-through'
                  : 'flex-1 text-[var(--text-secondary)]'
              }
            >
              {step.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
