import { describe, it, expect, beforeEach, vi } from 'vitest'

// Force getDb() to throw so the persistence store engages its in-memory
// fallback. Mirrors plan-goal-persistence.test.ts — the DB path is the same
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
  __resetStageMetricsForTests,
  deleteStageMetricsForMessage,
  isUsingMemoryFallback,
  listStageMetrics,
  saveStageMetrics
} from './stage-metrics-store'

const M1 = 'msg-1'
const M2 = 'msg-2'

beforeEach(() => {
  __resetStageMetricsForTests()
  __forceMemoryFallback()
})

describe('saveStageMetrics + listStageMetrics', () => {
  it('round-trips a single-stage row', () => {
    saveStageMetrics(M1, {
      stage: 'single',
      model: 'deepseek-v4-pro',
      promptTokens: 1200,
      completionTokens: 340,
      durationMs: 4100
    })
    const rows = listStageMetrics(M1)
    expect(rows).toHaveLength(1)
    expect(rows[0].stage).toBe('single')
    expect(rows[0].model).toBe('deepseek-v4-pro')
    expect(rows[0].promptTokens).toBe(1200)
    expect(rows[0].completionTokens).toBe(340)
    expect(rows[0].durationMs).toBe(4100)
    expect(rows[0].messageId).toBe(M1)
    expect(typeof rows[0].id).toBe('string')
    expect(rows[0].id.length).toBeGreaterThan(0)
  })

  it('preserves insertion order for a multi-agent pipeline', () => {
    saveStageMetrics(M1, { stage: 'planner', promptTokens: 800, completionTokens: 200 })
    saveStageMetrics(M1, { stage: 'coder', promptTokens: 1500, completionTokens: 700 })
    saveStageMetrics(M1, { stage: 'reviewer', promptTokens: 600, completionTokens: 120 })

    const rows = listStageMetrics(M1)
    expect(rows.map((r) => r.stage)).toEqual(['planner', 'coder', 'reviewer'])
  })

  it('returns an empty list for an unknown messageId', () => {
    expect(listStageMetrics('not-a-real-id')).toEqual([])
  })

  it('isolates rows per messageId', () => {
    saveStageMetrics(M1, { stage: 'planner', promptTokens: 1 })
    saveStageMetrics(M2, { stage: 'coder', promptTokens: 2 })
    expect(listStageMetrics(M1).map((r) => r.stage)).toEqual(['planner'])
    expect(listStageMetrics(M2).map((r) => r.stage)).toEqual(['coder'])
  })

  it('allows duplicate stage rows (planner-twice rerun audit shape)', () => {
    saveStageMetrics(M1, { stage: 'planner', promptTokens: 100 })
    saveStageMetrics(M1, { stage: 'planner', promptTokens: 110 })
    expect(listStageMetrics(M1)).toHaveLength(2)
  })

  it('defaults model + token + duration fields to null when omitted', () => {
    saveStageMetrics(M1, { stage: 'coder' })
    const [row] = listStageMetrics(M1)
    expect(row.model).toBeNull()
    expect(row.promptTokens).toBeNull()
    expect(row.completionTokens).toBeNull()
    expect(row.durationMs).toBeNull()
  })
})

describe('input validation', () => {
  it('rejects an empty messageId', () => {
    expect(() => saveStageMetrics('', { stage: 'planner' })).toThrow(/messageId/)
  })

  it('rejects an invalid stage', () => {
    // @ts-expect-error — deliberate invalid stage at runtime
    expect(() => saveStageMetrics(M1, { stage: 'mystery' })).toThrow(/invalid stage/)
  })
})

describe('deleteStageMetricsForMessage', () => {
  it('removes only the targeted message bucket', () => {
    saveStageMetrics(M1, { stage: 'planner' })
    saveStageMetrics(M1, { stage: 'coder' })
    saveStageMetrics(M2, { stage: 'reviewer' })

    deleteStageMetricsForMessage(M1)
    expect(listStageMetrics(M1)).toEqual([])
    expect(listStageMetrics(M2)).toHaveLength(1)
  })

  it('is a no-op for an unknown messageId', () => {
    expect(() => deleteStageMetricsForMessage('not-a-real-id')).not.toThrow()
  })
})

describe('fallback flag', () => {
  it('reports in-use after a forced fallback', () => {
    expect(isUsingMemoryFallback()).toBe(true)
  })

  it('resets cleanly between suites', () => {
    saveStageMetrics(M1, { stage: 'planner' })
    __resetStageMetricsForTests()
    // After reset and without re-forcing the fallback, listStageMetrics would
    // try real getDb() → throws (electron mocked) → activates fallback again
    // → returns empty (no rows yet in the fresh bucket).
    expect(listStageMetrics(M1)).toEqual([])
  })
})
