import { describe, it, expect, vi } from 'vitest'

// `automations-runner` imports `automations-store` (→ database) and
// `providers/registry` (→ electron). The describeCron + nextFireAfter
// helpers are pure of those deps but module-load triggers the chain;
// stub electron + the store so the test stays self-contained.

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/lamprey-test-irrelevant' },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('./automations-store', () => ({
  listAutomations: () => [],
  recordRun: () => undefined
}))

vi.mock('./event-log', () => ({
  boundedJsonPreview: (v: unknown) => v,
  recordEvent: () => undefined
}))

import { describeCron, nextFireAfter, parseCron } from './automations-runner'

describe('parseCron', () => {
  it('accepts 5-field expressions', () => {
    expect(() => parseCron('*/5 * * * *')).not.toThrow()
    expect(() => parseCron('0 9 * * 1-5')).not.toThrow()
  })

  it('rejects non-5-field expressions', () => {
    expect(() => parseCron('*/5 *')).toThrow(/5 fields/)
    expect(() => parseCron('* * * * * *')).toThrow(/5 fields/)
  })

  it('rejects out-of-range numbers', () => {
    expect(() => parseCron('60 * * * *')).toThrow(/bad field/)
    expect(() => parseCron('* 24 * * *')).toThrow(/bad field/)
  })
})

describe('describeCron', () => {
  it('returns presets verbatim for common patterns', () => {
    expect(describeCron('*/5 * * * *')).toBe('Every 5 minutes')
    expect(describeCron('0 9 * * 1-5')).toBe('Weekdays at 09:00')
    expect(describeCron('0 0 * * *')).toBe('Daily at midnight')
  })

  it('falls back to a field-by-field summary for novel patterns', () => {
    const out = describeCron('15 14 * * *')
    expect(out).toContain('minute 15')
    expect(out).toContain('hour 14')
  })

  it('returns null on a malformed expression', () => {
    expect(describeCron('not a cron')).toBeNull()
  })
})

describe('nextFireAfter', () => {
  it('returns a Date at second 0 for a future minute', () => {
    const from = new Date('2026-06-03T12:34:00Z')
    const next = nextFireAfter('*/5 * * * *', from)
    expect(next).not.toBeNull()
    expect(next!.getSeconds()).toBe(0)
    // Must be strictly after `from`.
    expect(next!.getTime()).toBeGreaterThan(from.getTime())
  })

  it('returns null for an unparseable expression', () => {
    expect(nextFireAfter('not a cron')).toBeNull()
  })

  it('finds the next "0 9 * * *" within 24h', () => {
    const from = new Date('2026-06-03T12:00:00')
    const next = nextFireAfter('0 9 * * *', from)
    expect(next).not.toBeNull()
    expect(next!.getHours()).toBe(9)
    expect(next!.getMinutes()).toBe(0)
  })
})
