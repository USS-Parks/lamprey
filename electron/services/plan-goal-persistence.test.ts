import { describe, it, expect, beforeEach, vi } from 'vitest'

// Force getDb() to throw so the persistence store engages its in-memory
// fallback. We exercise the API through that layer — the DB path is the same
// code shape and is covered by integration smoke at runtime.
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('electron app not available in test environment')
    }
  }
}))

import {
  __forceMemoryFallback,
  __resetPlanGoalPersistence,
  clearAllPlanGoalState,
  clearConversation,
  listAllPlanGoalState,
  loadGoals,
  loadPlanSteps,
  savePlanSteps,
  upsertGoal
} from './plan-goal-persistence'
import type { Goal, PlanStep } from './plan-goal-store'

const A = 'conv-a'
const B = 'conv-b'

const step = (id: string, text: string, status: PlanStep['status'] = 'pending'): PlanStep => ({
  id,
  text,
  status
})

const goal = (id: string, overrides: Partial<Goal> = {}): Goal => ({
  id,
  title: `goal ${id}`,
  status: 'open',
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

beforeEach(() => {
  __resetPlanGoalPersistence()
  __forceMemoryFallback()
})

describe('plan steps', () => {
  it('round-trips saved steps in order', () => {
    savePlanSteps(A, [step('1', 'a', 'done'), step('2', 'b'), step('3', 'c', 'in_progress')])
    const loaded = loadPlanSteps(A)
    expect(loaded.map((s) => s.id)).toEqual(['1', '2', '3'])
    expect(loaded.map((s) => s.status)).toEqual(['done', 'pending', 'in_progress'])
  })

  it('save replaces the whole plan (no leftover rows)', () => {
    savePlanSteps(A, [step('1', 'a'), step('2', 'b')])
    savePlanSteps(A, [step('9', 'only')])
    expect(loadPlanSteps(A).map((s) => s.id)).toEqual(['9'])
  })

  it('returns a defensive copy — mutating the result does not affect the store', () => {
    savePlanSteps(A, [step('1', 'a')])
    loadPlanSteps(A)[0].text = 'mutated'
    expect(loadPlanSteps(A)[0].text).toBe('a')
  })

  it('keeps conversations isolated', () => {
    savePlanSteps(A, [step('1', 'a')])
    savePlanSteps(B, [step('2', 'b'), step('3', 'c')])
    expect(loadPlanSteps(A)).toHaveLength(1)
    expect(loadPlanSteps(B)).toHaveLength(2)
  })
})

describe('goals', () => {
  it('inserts then updates the same id (no duplicate)', () => {
    upsertGoal(A, goal('g1', { title: 'first', updatedAt: 1 }))
    upsertGoal(A, goal('g1', { title: 'second', status: 'done', updatedAt: 2 }))
    const goals = loadGoals(A)
    expect(goals).toHaveLength(1)
    expect(goals[0].title).toBe('second')
    expect(goals[0].status).toBe('done')
  })

  it('preserves optional fields and nulls', () => {
    upsertGoal(A, goal('g1', { description: 'desc', dueDate: '2026-07-01' }))
    upsertGoal(A, goal('g2'))
    const byId = Object.fromEntries(loadGoals(A).map((g) => [g.id, g]))
    expect(byId.g1.description).toBe('desc')
    expect(byId.g1.dueDate).toBe('2026-07-01')
    expect(byId.g2.description).toBeUndefined()
    expect(byId.g2.dueDate).toBeUndefined()
  })
})

describe('clearing', () => {
  it('clearConversation drops only that conversation', () => {
    savePlanSteps(A, [step('1', 'a')])
    upsertGoal(A, goal('g1'))
    savePlanSteps(B, [step('2', 'b')])
    clearConversation(A)
    expect(loadPlanSteps(A)).toHaveLength(0)
    expect(loadGoals(A)).toHaveLength(0)
    expect(loadPlanSteps(B)).toHaveLength(1)
  })

  it('clearAllPlanGoalState drops everything', () => {
    savePlanSteps(A, [step('1', 'a')])
    upsertGoal(B, goal('g1'))
    clearAllPlanGoalState()
    expect(loadPlanSteps(A)).toHaveLength(0)
    expect(loadGoals(B)).toHaveLength(0)
  })
})

describe('listAllPlanGoalState', () => {
  it('returns one entry per conversation with state, plan + goals loaded', () => {
    savePlanSteps(A, [step('1', 'a'), step('2', 'b')])
    upsertGoal(A, goal('g1'))
    upsertGoal(B, goal('g2'))

    const all = listAllPlanGoalState()
    const byId = Object.fromEntries(all.map((s) => [s.conversationId, s]))
    expect(Object.keys(byId).sort()).toEqual([A, B])
    expect(byId[A].planSteps).toHaveLength(2)
    expect(byId[A].goals).toHaveLength(1)
    expect(byId[B].planSteps).toHaveLength(0)
    expect(byId[B].goals).toHaveLength(1)
  })

  it('omits conversations with no state and reflects clears', () => {
    savePlanSteps(A, [step('1', 'a')])
    upsertGoal(B, goal('g1'))
    expect(listAllPlanGoalState()).toHaveLength(2)

    clearConversation(A)
    const remaining = listAllPlanGoalState()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].conversationId).toBe(B)
  })

  it('is empty after clearAllPlanGoalState', () => {
    savePlanSteps(A, [step('1', 'a')])
    upsertGoal(B, goal('g1'))
    clearAllPlanGoalState()
    expect(listAllPlanGoalState()).toEqual([])
  })
})
