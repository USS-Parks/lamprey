import { usePlanStore } from '@/stores/plan-store'
import { useUiStore } from '@/stores/ui-store'

interface PlanGoalsPanelProps {
  conversationId: string | null
}

// Compact "plan present" pip that lives above the chat input. Replaced the
// fat inline editable checklist — that grew with the plan length and
// pushed the streaming/reasoning output off-screen. The full editable
// surface now lives in the right sidebar (Plan card); clicking the pip
// opens it.
export function PlanGoalsPanel({ conversationId }: PlanGoalsPanelProps) {
  const snapshot = usePlanStore((s) => s.snapshot)
  const planModeActive = usePlanStore((s) => s.planModeActive)
  const setActiveTool = useUiStore((s) => s.setActiveTool)

  if (!conversationId || !snapshot || snapshot.steps.length === 0) return null

  const openPlanCard = () => setActiveTool('plan')

  return (
    <button
      type="button"
      onClick={openPlanCard}
      className="pointer-events-auto mb-2 flex w-full items-center gap-2 rounded-md border border-[var(--panel-border)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-left text-[12px] shadow-sm transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-secondary)]"
      aria-label="Open plan goals in the right sidebar"
    >
      <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
        Plan
      </span>
      <span className="rounded border border-[var(--panel-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
        {snapshot.totals.done}/{snapshot.totals.total}
      </span>
      {planModeActive && (
        <span className="rounded border border-[var(--warning)] bg-[var(--warning)]/10 px-1.5 py-0.5 text-[10px] text-[var(--warning)]">
          gated · awaiting approval
        </span>
      )}
      <span className="ml-auto flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
        Open
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </button>
  )
}
