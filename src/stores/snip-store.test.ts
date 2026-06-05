import { describe, expect, it } from 'vitest'
import { formatCount } from './snip-store'

describe('snip-store — formatCount', () => {
  it('renders raw values under 1000', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(1)).toBe('1')
    expect(formatCount(999)).toBe('999')
  })

  it('renders 1k–1M with one decimal', () => {
    expect(formatCount(1000)).toBe('1.0k')
    expect(formatCount(1234)).toBe('1.2k')
    expect(formatCount(99_999)).toBe('100.0k')
  })

  it('renders 1M+ with one decimal', () => {
    expect(formatCount(1_000_000)).toBe('1.0M')
    expect(formatCount(2_300_000)).toBe('2.3M')
  })

  it('is monotonic', () => {
    let lastNumeric = -Infinity
    for (let n = 0; n < 1_000_000; n += 1234) {
      const s = formatCount(n)
      // Parse the numeric prefix so we can compare across k/M boundaries.
      const num = parseFloat(s)
      if (s.endsWith('k')) {
        expect(num * 1000).toBeGreaterThanOrEqual(lastNumeric)
        lastNumeric = num * 1000
      } else if (s.endsWith('M')) {
        expect(num * 1_000_000).toBeGreaterThanOrEqual(lastNumeric)
        lastNumeric = num * 1_000_000
      } else {
        expect(num).toBeGreaterThanOrEqual(lastNumeric)
        lastNumeric = num
      }
    }
  })
})
