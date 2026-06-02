import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from '@/stores/toast-store'
import type { ConversationPlanGoalState, Goal, PlanStep, PlanStepStatus } from '@/lib/types'

// Inspect / clear the persisted plan + goal state the `update_plan` and
// create_goal / update_goal tools write per conversation (see
// plan-goal-persistence.ts). This is the cleanup side of that store: the model
// fills it during normal use; here the user can see what's stored and wipe it
// per conversation or all at once. Clearing emits `plan:updated` so an open
// checklist refreshes to empty.

const GLOBAL_KEY = '__global__'

interface PlanApi {
  listAllState: () => Promise<{
    success: boolean
    data?: ConversationPlanGoalState[]
    error?: string
  }>
  clearConversationState: (
    conversationId: string
  ) => Promise<{ success: boolean; error?: string }>
  clearAllState: () => Promise<{ success: boolean; error?: string }>
}

function getApi(): PlanApi | null {
  if (typeof window === 'undefined') return null
  const api = (window as unknown as { api?: { plan?: PlanApi } }).api
  return api?.plan ?? null
}

const STEP_LABEL: Record<PlanStepStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  done: 'Done'
}

const STEP_DOT: Record<PlanStepStatus, string> = {
  pending: 'text-[var(--text-muted)]',
  in_progress: 'text-amber-300',
  done: 'text-emerald-300'
}

function conversationLabel(id: string): string {
  return id === GLOBAL_KEY ? 'Global (no conversation)' : `Conversation ${id.slice(0, 8)}…`
}

function PlanStepRow({ step, index }: { step: PlanStep; index: number }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className={`pt-0.5 font-mono ${STEP_DOT[step.status]}`}>
        {step.status === 'done' ? '●' : '○'}
      </span>
      <span className="text-[var(--text-muted)]">{index}.</span>
      <span className="min-w-0 flex-1 break-words text-[var(--text-secondary)]">
        {step.text || <em className="text-[var(--text-muted)]">(empty)</em>}
      </span>
      <span className="shrink-0 font-mono text-[10px] uppercase text-[var(--text-muted)]">
        {STEP_LABEL[step.status]}
      </span>
    </li>
  )
}

function GoalRow({ goal }: { goal: Goal }) {
  return (
    <li className="flex items-start justify-between gap-2 text-xs">
      <span className="min-w-0 flex-1 break-words text-[var(--text-secondary)]">
        {goal.title}
        {goal.dueDate && (
          <span className="ml-1 text-[10px] text-[var(--text-muted)]">· due {goal.dueDate}</span>
        )}
      </span>
      <span className="shrink-0 font-mono text-[10px] uppercase text-[var(--text-muted)]">
        {goal.status}
      </span>
    </li>
  )
}

export function PlanGoalSettings() {
  const [states, setStates] = useState<ConversationPlanGoalState[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const api = getApi()
    if (!api) return
    setLoading(true)
    try {
      const response = await api.listAllState()
      if (response.success && response.data) {
        setStates(response.data)
      } else {
        toast.error(`Failed to load plan/goal state: ${response.error ?? 'unknown error'}`)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Conversations with the most steps + goals first; stable by id otherwise.
  const sorted = useMemo(
    () =>
      [...states].sort((a, b) => {
        const sizeA = a.planSteps.length + a.goals.length
        const sizeB = b.planSteps.length + b.goals.length
        return sizeB - sizeA || a.conversationId.localeCompare(b.conversationId)
      }),
    [states]
  )

  const totalSteps = useMemo(() => states.reduce((n, s) => n + s.planSteps.length, 0), [states])
  const totalGoals = useMemo(() => states.reduce((n, s) => n + s.goals.length, 0), [states])

  const handleClearConversation = async (conversationId: string) => {
    const api = getApi()
    if (!api) return
    if (
      !window.confirm(
        `Clear the plan and goals for ${conversationLabel(conversationId)}? This cannot be undone.`
      )
    ) {
      return
    }
    setBusy(conversationId)
    try {
      const response = await api.clearConversationState(conversationId)
      if (!response.success) {
        toast.error(`Failed to clear: ${response.error ?? 'unknown error'}`)
        return
      }
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const handleClearAll = async () => {
    const api = getApi()
    if (!api) return
    if (states.length === 0) return
    if (
      !window.confirm(
        `Clear plan and goal state for all ${states.length} conversation(s)? This cannot be undone.`
      )
    ) {
      return
    }
    setBusy('all')
    try {
      const response = await api.clearAllState()
      if (!response.success) {
        toast.error(`Failed to clear all: ${response.error ?? 'unknown error'}`)
        return
      }
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6 text-sm text-[var(--text-primary)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Plans &amp; goals</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Plan checklists and goals the model creates with the <code>update_plan</code>,{' '}
            <code>create_goal</code>, and <code>update_goal</code> tools, persisted per
            conversation. They&apos;re cleared automatically when you delete a conversation; clear
            them manually here.
          </p>
        </div>
        <button
          type="button"
          disabled={states.length === 0 || busy === 'all'}
          onClick={handleClearAll}
          className="shrink-0 rounded border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[10px] uppercase text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'all' ? 'Clearing…' : 'Clear all'}
        </button>
      </div>

      {loading && <div className="text-xs text-[var(--text-muted)]">Loading…</div>}

      {!loading && states.length === 0 && (
        <div className="rounded border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
          No stored plans or goals yet.
        </div>
      )}

      {!loading && states.length > 0 && (
        <p className="text-[11px] text-[var(--text-muted)]">
          {states.length} conversation(s) · {totalSteps} plan step(s) · {totalGoals} goal(s)
        </p>
      )}

      {!loading &&
        sorted.map((state) => {
          const clearing = busy === state.conversationId
          return (
            <section
              key={state.conversationId}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-mono text-sm font-semibold text-[var(--text-primary)]">
                    {conversationLabel(state.conversationId)}
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                    {state.planSteps.length} step(s) · {state.goals.length} goal(s)
                  </p>
                </div>
                <button
                  type="button"
                  disabled={clearing}
                  onClick={() => handleClearConversation(state.conversationId)}
                  className="shrink-0 rounded border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[10px] uppercase text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {clearing ? 'Clearing…' : 'Clear'}
                </button>
              </div>

              {state.planSteps.length > 0 && (
                <div className="mb-2">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                    Plan
                  </div>
                  <ul className="space-y-1">
                    {state.planSteps.map((step, i) => (
                      <PlanStepRow key={step.id} step={step} index={i + 1} />
                    ))}
                  </ul>
                </div>
              )}

              {state.goals.length > 0 && (
                <div>
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                    Goals
                  </div>
                  <ul className="space-y-1">
                    {state.goals.map((goal) => (
                      <GoalRow key={goal.id} goal={goal} />
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )
        })}
    </div>
  )
}
