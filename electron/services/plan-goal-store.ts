import { randomUUID } from 'crypto'
import {
  clearAllPlanGoalState,
  clearConversation as persistClearConversation,
  listAllPlanGoalState,
  loadGoals,
  loadPlanSteps,
  savePlanSteps,
  upsertGoal,
  __resetPlanGoalPersistence,
  type ConversationPlanGoalState
} from './plan-goal-persistence'

// Per-conversation plan + goal state for the `update_plan`, `get_goal`,
// `create_goal`, and `update_goal` native tools.
//
// Durability: this module is a per-session cache in front of
// plan-goal-persistence, which writes through to two SQLite tables
// (`plan_steps`, `goals`). State is hydrated from disk on the first access to a
// conversation and survives Lamprey restarts. If persistence is unavailable
// (headless tests, disk failure) the persistence layer transparently falls back
// to memory, so this cache still works for the session — same fallback contract
// as permissions-store.
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

function keyOf(conversationId: string | undefined): string {
  return conversationId ?? GLOBAL_KEY
}

function getState(conversationId: string | undefined): ConversationState {
  const key = keyOf(conversationId)
  let s = state.get(key)
  if (!s) {
    // First access this session — hydrate from persistence. Returns empty when
    // nothing was stored (or when persistence is unavailable).
    const goals = new Map<string, Goal>()
    for (const g of loadGoals(key)) goals.set(g.id, g)
    s = { planSteps: loadPlanSteps(key), goals }
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
    savePlanSteps(keyOf(conversationId), s.planSteps)
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

  savePlanSteps(keyOf(conversationId), s.planSteps)
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
  upsertGoal(keyOf(conversationId), goal)
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
  upsertGoal(keyOf(conversationId), goal)
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

/** Every conversation with plan or goal state, for the inspect/clear UI.
 * Reads through persistence (the authoritative store — writes are write-through),
 * so it reflects conversations not loaded into the session cache. */
export function getAllPlanGoalState(): ConversationPlanGoalState[] {
  return listAllPlanGoalState()
}

/** Drop all plan + goal state for one conversation, in cache and on disk.
 * Call when a conversation is deleted so its rows don't linger. */
export function clearConversationState(conversationId: string | undefined): void {
  const key = keyOf(conversationId)
  state.delete(key)
  persistClearConversation(key)
}

/** Drop every conversation's plan + goal state (cache + disk). */
export function clearAllState(): void {
  state.clear()
  clearAllPlanGoalState()
}

/** Test-only: reset all per-conversation state (cache + persistence). */
export function __resetPlanGoalStore(): void {
  state.clear()
  __monoCursor = 0
  __resetPlanGoalPersistence()
}

/** Test-only: drop the per-session cache without touching persistence, to
 * simulate an app restart that must rehydrate plan + goal state from disk. */
export function __dropPlanGoalCache(): void {
  state.clear()
  __monoCursor = 0
}
