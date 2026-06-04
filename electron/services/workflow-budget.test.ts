import { describe, expect, it } from 'vitest'
import {
  makeBudgetTracker,
  resolveModelId,
  setTierModelMap,
  tierOfModel,
  TIER_MODEL_MAP
} from './workflow-budget'

describe('tierOfModel', () => {
  it('classifies cheap-tier model IDs via substring', () => {
    expect(tierOfModel('deepseek-v4-flash')).toBe('cheap')
    expect(tierOfModel('claude-haiku-4-5')).toBe('cheap')
    expect(tierOfModel('gemma-3n')).toBe('cheap')
    expect(tierOfModel('qwen-mini')).toBe('cheap')
    expect(tierOfModel('cheap')).toBe('cheap')
  })

  it('classifies pro-tier model IDs via substring', () => {
    expect(tierOfModel('deepseek-v4-pro')).toBe('pro')
    expect(tierOfModel('claude-opus-4-7')).toBe('pro')
    expect(tierOfModel('claude-sonnet-4-6')).toBe('pro')
    expect(tierOfModel('pro')).toBe('pro')
  })

  it('returns unknown for unrecognised IDs', () => {
    expect(tierOfModel('mystery-model')).toBe('unknown')
    expect(tierOfModel(undefined)).toBe('unknown')
    expect(tierOfModel('')).toBe('unknown')
  })
})

describe('resolveModelId', () => {
  it('passes through concrete model IDs', () => {
    expect(resolveModelId('deepseek-v4-pro', 'd')).toBe('deepseek-v4-pro')
  })
  it('resolves symbolic tier names via TIER_MODEL_MAP', () => {
    expect(resolveModelId('cheap', 'd')).toBe(TIER_MODEL_MAP.cheap)
    expect(resolveModelId('pro', 'd')).toBe(TIER_MODEL_MAP.pro)
  })
  it('falls back to defaultModel when undefined', () => {
    expect(resolveModelId(undefined, 'fallback-id')).toBe('fallback-id')
  })
})

describe('setTierModelMap', () => {
  it('updates the symbolic mapping', () => {
    setTierModelMap({ cheap: 'custom-cheap-id' })
    expect(resolveModelId('cheap', 'd')).toBe('custom-cheap-id')
    // Restore.
    setTierModelMap({ cheap: 'deepseek-v4-flash' })
  })
})

describe('makeBudgetTracker', () => {
  it('starts at 0 spent across all tiers when no model is recorded', () => {
    const t = makeBudgetTracker(100)
    expect(t.spent()).toBe(0)
    expect(t.remaining()).toBe(100)
    expect(t.byTier()).toEqual({ cheap: 0, pro: 0, unknown: 0 })
  })

  it('returns Infinity remaining when total is null', () => {
    const t = makeBudgetTracker(null)
    expect(t.remaining()).toBe(Infinity)
    expect(t.total).toBeNull()
  })

  it('accumulates per-tier spend', () => {
    const t = makeBudgetTracker(100)
    t.record('deepseek-v4-flash', 5) // cheap
    t.record('deepseek-v4-pro', 10) // pro
    t.record('deepseek-v4-flash', 7) // cheap again
    t.record('weird-model', 3) // unknown
    expect(t.spent()).toBe(25)
    expect(t.remaining()).toBe(75)
    expect(t.byTier()).toEqual({ cheap: 12, pro: 10, unknown: 3 })
  })

  it('ignores zero / negative token deltas', () => {
    const t = makeBudgetTracker(10)
    t.record('cheap', 0)
    t.record('cheap', -5)
    expect(t.spent()).toBe(0)
  })

  it('byTier() returns a copy (mutation does not affect tracker)', () => {
    const t = makeBudgetTracker(null)
    t.record('cheap', 5)
    const snap = t.byTier()
    snap.cheap = 999
    expect(t.byTier().cheap).toBe(5)
  })
})
