import { describe, expect, it } from 'vitest'
import { contextPercent, contextTone } from './context-meter'

describe('contextPercent', () => {
  it('returns null when the context window is unknown', () => {
    expect(contextPercent(10_000, undefined)).toBeNull()
    expect(contextPercent(10_000, 0)).toBeNull()
  })

  it('computes a rounded percentage', () => {
    expect(contextPercent(50_000, 200_000)).toBe(25)
    expect(contextPercent(67_500, 200_000)).toBe(34)
  })

  it('clamps to [0, 100] when the spend overruns the window', () => {
    expect(contextPercent(300_000, 200_000)).toBe(100)
    expect(contextPercent(-5, 200_000)).toBe(0)
  })

  it('returns 0 for a non-finite spend rather than NaN', () => {
    expect(contextPercent(NaN, 200_000)).toBe(0)
  })
})

describe('contextTone', () => {
  it('returns neutral below 70%', () => {
    expect(contextTone(0)).toBe('neutral')
    expect(contextTone(69)).toBe('neutral')
  })

  it('returns amber at the 70% threshold', () => {
    expect(contextTone(70)).toBe('amber')
    expect(contextTone(89)).toBe('amber')
  })

  it('returns red at the 90% threshold', () => {
    expect(contextTone(90)).toBe('red')
    expect(contextTone(100)).toBe('red')
  })
})
