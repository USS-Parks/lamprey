import { getDb } from './database'
import type { Goal, GoalStatus, PlanStep, PlanStepStatus } from './plan-goal-store'

// Write-through SQLite persistence for per-conversation plan steps + goals.
// Mirrors permission-policies-store: the database is the durable layer, and an
// in-memory fallback activates if getDb() ever throws (headless tests, disk
// failure) so the public API never throws into the caller. plan-goal-store
// keeps its own per-session cache on top of this and hydrates from here on the
// first access to a conversation.

interface PlanRow {
  id: string
  conversation_id: string
  text: string
  status: PlanStepStatus
  position: number
}

interface GoalRow {
  id: string
  conversation_id: string
  title: string
  description: string | null
  due_date: string | null
  status: GoalStatus
  created_at: number
  updated_at: number
}

interface ConvBucket {
  planSteps: PlanStep[]
  goals: Goal[]
}

/** One conversation's full plan + goal state, for the inspect/clear settings UI. */
export interface ConversationPlanGoalState {
  conversationId: string
  planSteps: PlanStep[]
  goals: Goal[]
}

// In-memory fallback, keyed by conversation key (the '__global__' sentinel for
// the shared bucket). Only used once persistence is known to be unavailable.
const memoryFallback = new Map<string, ConvBucket>()
let useFallback = false

function activateFallback(reason: string): void {
  if (!useFallback) {
    useFallback = true
    console.warn(
      `[plan-goal-persistence] persistence unavailable, falling back to memory: ${reason}`
    )
  }
}

export function isUsingMemoryFallback(): boolean {
  return useFallback
}

function memBucket(key: string): ConvBucket {
  let b = memoryFallback.get(key)
  if (!b) {
    b = { planSteps: [], goals: [] }
    memoryFallback.set(key, b)
  }
  return b
}

function rowToGoal(r: GoalRow): Goal {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? undefined,
    dueDate: r.due_date ?? undefined,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function loadPlanSteps(key: string): PlanStep[] {
  if (!useFallback) {
    try {
      const rows = getDb()
        .prepare(`SELECT * FROM plan_steps WHERE conversation_id = ? ORDER BY position ASC`)
        .all(key) as PlanRow[]
      return rows.map((r) => ({ id: r.id, text: r.text, status: r.status }))
    } catch (err: any) {
      activateFallback(err?.message ?? 'unknown')
    }
  }
  return memBucket(key).planSteps.map((s) => ({ ...s }))
}

export function loadGoals(key: string): Goal[] {
  if (!useFallback) {
    try {
      const rows = getDb()
        .prepare(`SELECT * FROM goals WHERE conversation_id = ?`)
        .all(key) as GoalRow[]
      return rows.map(rowToGoal)
    } catch (err: any) {
      activateFallback(err?.message ?? 'unknown')
    }
  }
  return memBucket(key).goals.map((g) => ({ ...g }))
}

/**
 * Replace the persisted plan for a conversation with `steps`. The in-memory
 * plan is a small ordered array that update_plan rewrites wholesale, so a
 * delete-then-insert inside one transaction is the simplest faithful mirror;
 * `position` preserves order on reload.
 */
export function savePlanSteps(key: string, steps: PlanStep[]): void {
  if (!useFallback) {
    try {
      const db = getDb()
      const now = Date.now()
      const replace = db.transaction((rows: PlanStep[]) => {
        db.prepare(`DELETE FROM plan_steps WHERE conversation_id = ?`).run(key)
        const insert = db.prepare(
          `INSERT INTO plan_steps
             (id, conversation_id, text, status, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        rows.forEach((s, i) => insert.run(s.id, key, s.text, s.status, i, now, now))
      })
      replace(steps)
      return
    } catch (err: any) {
      activateFallback(err?.message ?? 'unknown')
    }
  }
  memBucket(key).planSteps = steps.map((s) => ({ ...s }))
}

/** Insert or update a single goal (goals carry stable ids + their own timestamps). */
export function upsertGoal(key: string, goal: Goal): void {
  if (!useFallback) {
    try {
      getDb()
        .prepare(
          `INSERT INTO goals
             (id, conversation_id, title, description, due_date, status, created_at, updated_at)
           VALUES (@id, @conversation_id, @title, @description, @due_date, @status, @created_at, @updated_at)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             description = excluded.description,
             due_date = excluded.due_date,
             status = excluded.status,
             updated_at = excluded.updated_at`
        )
        .run({
          id: goal.id,
          conversation_id: key,
          title: goal.title,
          description: goal.description ?? null,
          due_date: goal.dueDate ?? null,
          status: goal.status,
          created_at: goal.createdAt,
          updated_at: goal.updatedAt
        })
      return
    } catch (err: any) {
      activateFallback(err?.message ?? 'unknown')
    }
  }
  const bucket = memBucket(key)
  const idx = bucket.goals.findIndex((g) => g.id === goal.id)
  if (idx >= 0) bucket.goals[idx] = { ...goal }
  else bucket.goals.push({ ...goal })
}

/** Every conversation that has any plan or goal state, with that state loaded. */
export function listAllPlanGoalState(): ConversationPlanGoalState[] {
  if (!useFallback) {
    try {
      const keys = getDb()
        .prepare(
          `SELECT conversation_id FROM plan_steps
           UNION
           SELECT conversation_id FROM goals`
        )
        .all() as Array<{ conversation_id: string }>
      return keys.map((r) => ({
        conversationId: r.conversation_id,
        planSteps: loadPlanSteps(r.conversation_id),
        goals: loadGoals(r.conversation_id)
      }))
    } catch (err: any) {
      activateFallback(err?.message ?? 'unknown')
    }
  }
  return [...memoryFallback.entries()]
    .filter(([, b]) => b.planSteps.length > 0 || b.goals.length > 0)
    .map(([key, b]) => ({
      conversationId: key,
      planSteps: b.planSteps.map((s) => ({ ...s })),
      goals: b.goals.map((g) => ({ ...g }))
    }))
}

/** Remove all plan + goal state for one conversation. */
export function clearConversation(key: string): void {
  if (!useFallback) {
    try {
      const db = getDb()
      db.prepare(`DELETE FROM plan_steps WHERE conversation_id = ?`).run(key)
      db.prepare(`DELETE FROM goals WHERE conversation_id = ?`).run(key)
      return
    } catch (err: any) {
      activateFallback(err?.message ?? 'unknown')
    }
  }
  memoryFallback.delete(key)
}

/** Remove all plan + goal state across every conversation. */
export function clearAllPlanGoalState(): void {
  if (!useFallback) {
    try {
      const db = getDb()
      db.prepare(`DELETE FROM plan_steps`).run()
      db.prepare(`DELETE FROM goals`).run()
      return
    } catch (err: any) {
      activateFallback(err?.message ?? 'unknown')
    }
  }
  memoryFallback.clear()
}

/** Test-only: drop the in-memory fallback so tests start from a clean slate. */
export function __resetPlanGoalPersistence(): void {
  memoryFallback.clear()
  useFallback = false
}

/** Test-only: force the in-memory fallback path (no real database available). */
export function __forceMemoryFallback(): void {
  useFallback = true
}
