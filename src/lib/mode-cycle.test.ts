import { describe, expect, it } from 'vitest'
import {
  MODE_CYCLE,
  currentSlot,
  nextMode,
  slotLabel,
  type ModeState
} from './mode-cycle'

describe('mode-cycle.currentSlot', () => {
  it('returns "plan" when plan is on regardless of permission', () => {
    expect(currentSlot({ permissions: 'default', plan: true })).toBe('plan')
    expect(currentSlot({ permissions: 'full', plan: true })).toBe('plan')
  })

  it('returns the permission when plan is off', () => {
    expect(currentSlot({ permissions: 'default', plan: false })).toBe('default')
    expect(currentSlot({ permissions: 'auto-review', plan: false })).toBe('auto-review')
    expect(currentSlot({ permissions: 'full', plan: false })).toBe('full')
  })
})

describe('mode-cycle.nextMode', () => {
  it('walks through all 4 slots wrapping back', () => {
    let s: ModeState = { permissions: 'default', plan: false }
    const seen: string[] = [currentSlot(s)]
    for (let i = 0; i < 4; i++) {
      s = nextMode(s)
      seen.push(currentSlot(s))
    }
    expect(seen).toEqual(['default', 'auto-review', 'full', 'plan', 'default'])
  })

  it('preserves the permission while transiting plan', () => {
    // Sit on 'full', cycle into 'plan' — permission stays 'full' underneath.
    const fullState: ModeState = { permissions: 'full', plan: false }
    const planState = nextMode(fullState)
    expect(currentSlot(planState)).toBe('plan')
    expect(planState.permissions).toBe('full')
  })

  it('moves from plan back to default (cycle loop)', () => {
    const planState: ModeState = { permissions: 'full', plan: true }
    const out = nextMode(planState)
    expect(currentSlot(out)).toBe('default')
    expect(out.plan).toBe(false)
  })

  it('MODE_CYCLE contains exactly the four expected slots', () => {
    expect(MODE_CYCLE).toEqual(['default', 'auto-review', 'full', 'plan'])
  })
})

describe('mode-cycle.slotLabel', () => {
  it('returns human-readable labels for every slot', () => {
    expect(slotLabel('default')).toBe('Default permissions')
    expect(slotLabel('auto-review')).toBe('Auto-review')
    expect(slotLabel('full')).toBe('Full access')
    expect(slotLabel('plan')).toBe('Plan mode')
  })
})
