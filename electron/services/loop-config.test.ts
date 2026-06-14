import { describe, it, expect } from 'vitest'
import { resolveLoopConfig, LOOP_CONFIG_DEFAULTS } from './loop-config'

// LP-7 — pure resolver, runs everywhere.

describe('resolveLoopConfig', () => {
  it('returns defaults for null/missing', () => {
    expect(resolveLoopConfig(null)).toEqual(LOOP_CONFIG_DEFAULTS)
    expect(resolveLoopConfig({}).enabled).toBe(false)
  })

  it('reads loopsEnabled', () => {
    expect(resolveLoopConfig({ loopsEnabled: true }).enabled).toBe(true)
    expect(resolveLoopConfig({ loopsEnabled: 'yes' }).enabled).toBe(false)
  })

  it('reads numeric overrides and ignores invalid values', () => {
    const cfg = resolveLoopConfig({
      loopMaxIterations: 5,
      loopTokenBudget: 'nope',
      loopMaxWallclockMs: 60000
    })
    expect(cfg.maxIterations).toBe(5)
    expect(cfg.maxWallclockMs).toBe(60000)
    expect(cfg.tokenBudget).toBe(LOOP_CONFIG_DEFAULTS.tokenBudget)
  })

  it('clamps maxConcurrent and minIntervalSeconds to >= 1', () => {
    expect(resolveLoopConfig({ loopMaxConcurrent: 0 }).maxConcurrent).toBe(1)
    expect(resolveLoopConfig({ loopMinIntervalSeconds: 0 }).minIntervalSeconds).toBe(1)
  })
})
