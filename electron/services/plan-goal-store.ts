import { randomUUID } from 'crypto'

// Per-conversation plan + goal state for the `update_plan`, `get_goal`,
// `create_goal`, and `update_goal` native tools.
//
// KNOWN GAP — provisional in-memory only. State lives in process maps and
// resets on Lamprey restart; nothing is persisted to disk yet, no settings
// UI surfaces or clears it, and there is no cross-device sync. The
// `{ planSteps, goals }` shape per conversation maps cleanly onto two
// small SQLite tables when persistence lands — same migration path as
// permissions-store. Documented alongside the permissions-store gap in
// PLANNING/CODEX_TOOLSET_PARITY_PROGRESS.md.
//
// Conversation id is optional everywhere: missing/undefined ids map to a
// shared GLOBAL_KEY bucket so a tool run without a conversation context
// still works.

const GLOBAL_KEY = '__global__'

export type PlanStepStatus = 'pending' | 'in_progress' | 'done'

export interface PlanStep {
  id: string
  text: string
  status: PlanStepStatus
}

export type GoalStatus = 'open' | 'in_progress' | 'done' | 'abandoned'

export interface Goal {
  id: string
  title: string
  description?: string
  dueDate?: string
  status: GoalStatus
  createdAt: number
  updatedAt: number
}

interface ConversationState {
  planSteps: PlanStep[]
  goals: Map<string, Goal>
}

const state = new Map<string, ConversationState>()

// Strictly-monotonic timestamp source for createdAt / updatedAt. Date.now()
// can return the same value across back-to-back calls — on Windows the
// system clock resolution is ~15 ms and even setTimeout(0) often does not
// advance it within the same tick. We need the timestamps to be a faithful
// total order so listGoals() can sort by "most recently updated" deterministically.
let __monoCursor = 0
function monoNow(): number {
  const t = Date.now()
  __monoCursor = t > __monoCursor ? t : __monoCursor + 1
  return __monoCursor
}

function getState(conversationId: string | undefined): ConversationState {
  const key = conversationId ?? GLOBAL_KEY
  let s = state.get(key)
  if (!s) {
    s = { planSteps: [], goals: new Map() }
    state.set(key, s)
  }
  return s
}

// ───────────────────── Plan steps ─────────────────────

export interface UpdatePlanInput {
  // text is optional at the type level because the executor's update path
  // accepts a status-only patch and preserves the prior text. The model-
  // facing JSON schema (native-dev-tool-pack.ts) still requires text for
  // append calls; this only relaxes the TS shape for in-process callers.
  steps: Array<{ id?: string; text?: string; status?: PlanStepStatus }>
  replace?: boolean
}

export interface PlanSnapshot {
  conversationId: string
  steps: PlanStep[]
  totals: { pending: number; in_progress: number; done: number; total: number }
}

/**
 * Apply an update_plan call. When `replace` is true, the existing plan is
 * wiped and the incoming steps become the whole plan. Otherwise the steps
 * are merged: any incoming step whose `id` matches an existing step updates
 * that step (text + status); incoming steps without an `id` (or with an id
 * that doesn't match) are appended as new steps.
 */
export function applyUpdatePlan(
  conversationId: string | undefined,
  input: UpdatePlanInput
): PlanSnapshot {
  const s = getState(conversationId)
  const incoming = Array.isArray(input?.steps) ? input.steps : []

  if (input?.replace) {
    s.planSteps = incoming.map((step) => ({
      id: step.id && step.id.length > 0 ? step.id : randomUUID(),
      text: String(step.text ?? ''),
      status: step.status ?? 'pending'
    }))
    return planSnapshot(conversationId, s)
  }

  for (const step of incoming) {
    const targetId = step.id && step.id.length > 0 ? step.id : null
    const existingIdx = targetId
      ? s.planSteps.findIndex((p) => p.id === targetId)
      : -1
    if (existingIdx >= 0) {
      const prev = s.planSteps[existingIdx]
      s.planSteps[existingIdx] = {
        id: prev.id,
        text: step.text != null ? String(step.text) : prev.text,
        status: step.status ?? prev.status
      }
    } else {
      s.planSteps.push({
        id: targetId ?? randomUUID(),
        text: String(step.text ?? ''),
        status: step.status ?? 'pending'
      })
    }
  }

  return planSnapshot(conversationId, s)
}

function planSnapshot(
  conversationId: string | undefined,
  s: ConversationState
): PlanSnapshot {
  const totals = { pending: 0, in_progress: 0, done: 0, total: s.planSteps.length }
  for (const step of s.planSteps) totals[step.status] += 1
  return {
    conversationId: conversationId ?? GLOBAL_KEY,
    steps: s.planSteps.map((p) => ({ ...p })),
    totals
  }
}

/** Public read of the current plan for `conversationId`. Returns an empty
 * snapshot when nothing has been recorded yet so renderer code doesn't have
 * to branch on "no plan vs empty plan". */
export function getPlanSnapshot(conversationId: string | undefined): PlanSnapshot {
  return planSnapshot(conversationId, getState(conversationId))
}

// ───────────────────── Goals ─────────────────────

export interface CreateGoalInput {
  title: string
  description?: string
  dueDate?: string
}

export interface UpdateGoalInput {
  goalId: string
  title?: string
  description?: string
  dueDate?: string
  status?: GoalStatus
}

export function createGoal(
  conversationId: string | undefined,
  input: CreateGoalInput
): Goal {
  const s = getState(conversationId)
  const now = monoNow()
  const goal: Goal = {
    id: randomUUID(),
    title: String(input.title ?? '').trim(),
    description: input.description,
    dueDate: input.dueDate,
    status: 'open',
    createdAt: now,
    updatedAt: now
  }
  if (!goal.title) throw new Error('create_goal: title is required')
  s.goals.set(goal.id, goal)
  return goal
}

export function updateGoal(
  conversationId: string | undefined,
  input: UpdateGoalInput
): Goal {
  const s = getState(conversationId)
  const goal = s.goals.get(input.goalId)
  if (!goal) throw new Error(`update_goal: no goal with id "${input.goalId}"`)
  if (input.title !== undefined) goal.title = String(input.title)
  if (input.description !== undefined) goal.description = input.description
  if (input.dueDate !== undefined) goal.dueDate = input.dueDate
  if (input.status !== undefined) goal.status = input.status
  goal.updatedAt = monoNow()
  s.goals.set(goal.id, goal)
  return goal
}

export function getGoal(
  conversationId: string | undefined,
  goalId: string
): Goal | null {
  const s = getState(conversationId)
  return s.goals.get(goalId) ?? null
}

export function listGoals(conversationId: string | undefined): Goal[] {
  const s = getState(conversationId)
  return Array.from(s.goals.values()).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Test-only: reset all per-conversation state. */
export function __resetPlanGoalStore(): void {
  state.clear()
  __monoCursor = 0
}
