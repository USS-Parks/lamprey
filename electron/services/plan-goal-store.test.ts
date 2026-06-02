import { describe, it, expect, beforeEach, vi } from 'vitest'

// Force getDb() to throw so the persistence layer engages its in-memory
// fallback. The store's write-through + hydrate paths are exercised through
// that fallback; the real SQLite path is the same code shape and is covered by
// integration smoke at runtime.
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('electron app not available in test environment')
    }
  }
}))

import {
  __dropPlanGoalCache,
  __resetPlanGoalStore,
  applyUpdatePlan,
  clearConversationState,
  createGoal,
  getGoal,
  getPlanSnapshot,
  listGoals,
  updateGoal
} from './plan-goal-store'

beforeEach(() => {
  __resetPlanGoalStore()
})

const CONV = 'conv-123'
const OTHER = 'conv-456'

describe('applyUpdatePlan — merge mode (default)', () => {
  it('appends incoming steps when no ids match', () => {
    const snap = applyUpdatePlan(CONV, {
      steps: [
        { text: 'Read the file' },
        { text: 'Edit the file' }
      ]
    })
    expect(snap.steps).toHaveLength(2)
    expect(snap.steps.map((s) => s.text)).toEqual(['Read the file', 'Edit the file'])
    expect(snap.steps.every((s) => s.id.length > 0)).toBe(true)
  })

  it('defaults new steps to pending', () => {
    const snap = applyUpdatePlan(CONV, { steps: [{ text: 'step a' }] })
    expect(snap.steps[0].status).toBe('pending')
  })

  it('updates an existing step when id matches', () => {
    const first = applyUpdatePlan(CONV, {
      steps: [{ text: 'step a' }, { text: 'step b' }]
    })
    const targetId = first.steps[0].id
    const second = applyUpdatePlan(CONV, {
      steps: [{ id: targetId, status: 'done' }]
    })
    expect(second.steps).toHaveLength(2)
    expect(second.steps[0].id).toBe(targetId)
    expect(second.steps[0].text).toBe('step a')
    expect(second.steps[0].status).toBe('done')
    expect(second.steps[1].text).toBe('step b')
  })

  it('preserves prior text when an update omits text', () => {
    const first = applyUpdatePlan(CONV, { steps: [{ text: 'original' }] })
    const id = first.steps[0].id
    const second = applyUpdatePlan(CONV, { steps: [{ id, status: 'in_progress' }] })
    expect(second.steps[0].text).toBe('original')
    expect(second.steps[0].status).toBe('in_progress')
  })

  it('appends incoming steps whose id does not match anything', () => {
    applyUpdatePlan(CONV, { steps: [{ text: 'step a' }] })
    const snap = applyUpdatePlan(CONV, {
      steps: [{ id: 'unknown-id', text: 'step b' }]
    })
    expect(snap.steps).toHaveLength(2)
    expect(snap.steps[1].text).toBe('step b')
  })
})

describe('applyUpdatePlan — replace mode', () => {
  it('replaces the entire plan when replace=true', () => {
    applyUpdatePlan(CONV, {
      steps: [{ text: 'old a' }, { text: 'old b' }, { text: 'old c' }]
    })
    const snap = applyUpdatePlan(CONV, {
      replace: true,
      steps: [{ text: 'new only', status: 'in_progress' }]
    })
    expect(snap.steps).toHaveLength(1)
    expect(snap.steps[0].text).toBe('new only')
    expect(snap.steps[0].status).toBe('in_progress')
  })

  it('honors supplied ids during replace', () => {
    const snap = applyUpdatePlan(CONV, {
      replace: true,
      steps: [{ id: 'stable-1', text: 'a' }, { id: 'stable-2', text: 'b' }]
    })
    expect(snap.steps.map((s) => s.id)).toEqual(['stable-1', 'stable-2'])
  })
})

describe('getPlanSnapshot — totals + scoping', () => {
  it('returns empty snapshot when nothing has been recorded', () => {
    const snap = getPlanSnapshot(CONV)
    expect(snap.steps).toEqual([])
    expect(snap.totals).toEqual({ pending: 0, in_progress: 0, done: 0, total: 0 })
  })

  it('counts totals across mixed statuses', () => {
    applyUpdatePlan(CONV, {
      steps: [
        { text: 'a', status: 'done' },
        { text: 'b', status: 'done' },
        { text: 'c', status: 'in_progress' },
        { text: 'd' }
      ]
    })
    const snap = getPlanSnapshot(CONV)
    expect(snap.totals).toEqual({ pending: 1, in_progress: 1, done: 2, total: 4 })
  })

  it('keeps per-conversation plans isolated', () => {
    applyUpdatePlan(CONV, { steps: [{ text: 'a' }] })
    applyUpdatePlan(OTHER, { steps: [{ text: 'x' }, { text: 'y' }] })
    expect(getPlanSnapshot(CONV).steps).toHaveLength(1)
    expect(getPlanSnapshot(OTHER).steps).toHaveLength(2)
  })

  it('returns a defensive copy — mutating the result does not affect store', () => {
    applyUpdatePlan(CONV, { steps: [{ text: 'a' }] })
    const snap = getPlanSnapshot(CONV)
    snap.steps[0].text = 'mutated'
    const refresh = getPlanSnapshot(CONV)
    expect(refresh.steps[0].text).toBe('a')
  })
})

describe('goals — create / update / get / list', () => {
  it('creates a goal with required title and generated id', () => {
    const goal = createGoal(CONV, { title: 'Ship the thing' })
    expect(goal.id.length).toBeGreaterThan(0)
    expect(goal.title).toBe('Ship the thing')
    expect(goal.status).toBe('open')
    expect(goal.createdAt).toBeGreaterThan(0)
    expect(goal.updatedAt).toBe(goal.createdAt)
  })

  it('rejects empty titles', () => {
    expect(() => createGoal(CONV, { title: '   ' })).toThrow(/title is required/i)
  })

  it('updates fields and bumps updatedAt', () => {
    const goal = createGoal(CONV, { title: 't' })
    // Snapshot BEFORE updating — updateGoal mutates the same Goal object,
    // so reading goal.updatedAt after the call would just see the new value.
    const before = goal.updatedAt
    const updated = updateGoal(CONV, { goalId: goal.id, status: 'in_progress' })
    expect(updated.status).toBe('in_progress')
    // monoNow() guarantees a strict increment even within the same clock tick.
    expect(updated.updatedAt).toBeGreaterThan(before)
  })

  it('throws on update of unknown goal id', () => {
    expect(() => updateGoal(CONV, { goalId: 'nope', title: 'x' })).toThrow(/no goal with id/i)
  })

  it('getGoal returns null for unknown id', () => {
    expect(getGoal(CONV, 'nope')).toBeNull()
  })

  it('listGoals sorts by updatedAt descending', () => {
    const a = createGoal(CONV, { title: 'a' })
    const b = createGoal(CONV, { title: 'b' })
    const list = listGoals(CONV)
    expect(list[0].id).toBe(b.id)
    expect(list[1].id).toBe(a.id)
  })
})

// __dropPlanGoalCache() clears the per-session cache but leaves persistence
// intact — the same situation as an app restart, where getState() must
// rehydrate from disk on first access.
describe('persistence — survives a simulated restart', () => {
  it('rehydrates plan steps + statuses after the cache is dropped', () => {
    const first = applyUpdatePlan(CONV, {
      steps: [
        { text: 'read', status: 'done' },
        { text: 'edit', status: 'in_progress' },
        { text: 'verify' }
      ]
    })
    const ids = first.steps.map((s) => s.id)

    __dropPlanGoalCache()

    const rehydrated = getPlanSnapshot(CONV)
    expect(rehydrated.steps.map((s) => s.id)).toEqual(ids) // order preserved
    expect(rehydrated.steps.map((s) => s.text)).toEqual(['read', 'edit', 'verify'])
    expect(rehydrated.steps.map((s) => s.status)).toEqual(['done', 'in_progress', 'pending'])
    expect(rehydrated.totals).toEqual({ pending: 1, in_progress: 1, done: 1, total: 3 })
  })

  it('rehydrates goals with their fields and updated status', () => {
    const goal = createGoal(CONV, { title: 'Ship it', description: 'the thing', dueDate: '2026-07-01' })
    updateGoal(CONV, { goalId: goal.id, status: 'in_progress' })

    __dropPlanGoalCache()

    const reread = getGoal(CONV, goal.id)
    expect(reread).not.toBeNull()
    expect(reread!.title).toBe('Ship it')
    expect(reread!.description).toBe('the thing')
    expect(reread!.dueDate).toBe('2026-07-01')
    expect(reread!.status).toBe('in_progress')
    expect(reread!.createdAt).toBe(goal.createdAt)
  })

  it('keeps persisted state isolated per conversation after rehydrate', () => {
    applyUpdatePlan(CONV, { steps: [{ text: 'a' }] })
    applyUpdatePlan(OTHER, { steps: [{ text: 'x' }, { text: 'y' }] })

    __dropPlanGoalCache()

    expect(getPlanSnapshot(CONV).steps).toHaveLength(1)
    expect(getPlanSnapshot(OTHER).steps).toHaveLength(2)
  })

  it('replace mode persists the wipe — a dropped cache does not resurrect old steps', () => {
    applyUpdatePlan(CONV, { steps: [{ text: 'old a' }, { text: 'old b' }] })
    applyUpdatePlan(CONV, { replace: true, steps: [{ text: 'fresh' }] })

    __dropPlanGoalCache()

    const snap = getPlanSnapshot(CONV)
    expect(snap.steps).toHaveLength(1)
    expect(snap.steps[0].text).toBe('fresh')
  })

  it('clearConversationState removes both plan and goals, in cache and on disk', () => {
    applyUpdatePlan(CONV, { steps: [{ text: 'a' }] })
    createGoal(CONV, { title: 'g' })

    clearConversationState(CONV)
    __dropPlanGoalCache()

    expect(getPlanSnapshot(CONV).steps).toHaveLength(0)
    expect(listGoals(CONV)).toHaveLength(0)
  })
})
