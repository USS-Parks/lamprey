import { randomUUID } from 'crypto'

// In-memory per-conversation plan + goal state.
//
// The `update_plan`, `get_goal`, `create_goal`, and `update_goal` native
// tools read/write through this module. State is keyed by conversation id
// and lives in-process only — Lamprey restarts wipe it. Persistence is a
// deferred follow-up; the current `{ planSteps, goals }` shape per
// conversation would migrate cleanly to two small tables when that lands.
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
  steps: Array<{ id?: string; text: string; status?: PlanStepStatus }>
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
  const now = Date.now()
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
  goal.updatedAt = Date.now()
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
}
