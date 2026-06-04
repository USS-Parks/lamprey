import { describe, it, expect } from 'vitest'
import {
  collapsedSummary,
  formatElapsed,
  previewResult,
  summarizeArgs
} from './tool-card-helpers'

describe('collapsedSummary', () => {
  it('returns the same as summarizeArgs when short enough', () => {
    const args = { a: 1, b: 2 }
    expect(collapsedSummary(args)).toBe(summarizeArgs(args))
  })

  it('caps at 60 chars with an ellipsis', () => {
    const longArgs = { path: 'a/very/long/path/that/goes/on/and/on/and/keeps/on/going.ts' }
    const out = collapsedSummary(longArgs)
    expect(out.length).toBe(60)
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns "{empty}" for missing args', () => {
    expect(collapsedSummary(undefined)).toBe('{empty}')
    expect(collapsedSummary({})).toBe('{empty}')
  })
})

describe('summarizeArgs', () => {
  it('returns {empty} for missing/empty args', () => {
    expect(summarizeArgs(undefined)).toBe('{empty}')
    expect(summarizeArgs({})).toBe('{empty}')
  })

  it('joins up to 3 top-level keys', () => {
    const out = summarizeArgs({ a: 1, b: 'two', c: true })
    expect(out).toBe('a=1, b="two", c=true')
  })

  it('quotes strings and shows numbers/booleans raw', () => {
    expect(summarizeArgs({ msg: 'hello' })).toBe('msg="hello"')
    expect(summarizeArgs({ n: 42 })).toBe('n=42')
    expect(summarizeArgs({ f: false })).toBe('f=false')
  })

  it('truncates long string values', () => {
    const long = 'x'.repeat(200)
    const out = summarizeArgs({ s: long })
    expect(out.length).toBeLessThan(80)
    expect(out).toContain('…')
  })

  it('collapses whitespace inside strings', () => {
    expect(summarizeArgs({ s: 'a   b\nc\td' })).toBe('s="a b c d"')
  })

  it('summarizes arrays by length, not contents', () => {
    expect(summarizeArgs({ items: [1, 2, 3, 4, 5] })).toBe('items=[5 items]')
    expect(summarizeArgs({ items: ['solo'] })).toBe('items=[1 item]')
  })

  it('summarizes objects by key count', () => {
    expect(summarizeArgs({ payload: { a: 1, b: 2, c: 3 } })).toBe('payload={3 keys}')
    expect(summarizeArgs({ payload: { only: 1 } })).toBe('payload={1 key}')
  })

  it('emits "+N more" when there are more than 3 keys', () => {
    const out = summarizeArgs({ a: 1, b: 2, c: 3, d: 4, e: 5 })
    expect(out).toBe('a=1, b=2, c=3, +2 more')
  })

  it('handles null and undefined values', () => {
    expect(summarizeArgs({ a: null, b: undefined })).toBe('a=null, b=undefined')
  })
})

describe('previewResult', () => {
  it('returns the original when within both caps', () => {
    const r = previewResult('short result')
    expect(r.text).toBe('short result')
    expect(r.truncated).toBe(false)
  })

  it('truncates by line count', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n')
    const r = previewResult(six, { lineCap: 3 })
    expect(r.text).toBe('a\nb\nc…')
    expect(r.truncated).toBe(true)
  })

  it('truncates by character cap', () => {
    const long = 'x'.repeat(500)
    const r = previewResult(long, { charCap: 100 })
    expect(r.text.length).toBe(100) // 99 chars + ellipsis
    expect(r.truncated).toBe(true)
  })

  it('handles empty/undefined input', () => {
    expect(previewResult(undefined)).toEqual({ text: '', truncated: false })
    expect(previewResult('')).toEqual({ text: '', truncated: false })
  })

  it('applies whichever cap hits first', () => {
    // 10 lines × 50 chars each = 500 chars; lineCap=4 hits before charCap=240
    const text = Array.from({ length: 10 }, () => 'x'.repeat(50)).join('\n')
    const r = previewResult(text, { lineCap: 4, charCap: 240 })
    expect(r.truncated).toBe(true)
    expect(r.text.split('\n').length).toBeLessThanOrEqual(4)
  })
})

describe('formatElapsed', () => {
  it('shows ms under 1 second', () => {
    expect(formatElapsed(123)).toBe('123ms')
    expect(formatElapsed(0)).toBe('0ms')
  })

  it('shows whole seconds under 1 minute', () => {
    expect(formatElapsed(1500)).toBe('1s')
    expect(formatElapsed(59_999)).toBe('59s')
  })

  it('shows minutes + seconds for longer durations', () => {
    expect(formatElapsed(60_000)).toBe('1m 0s')
    expect(formatElapsed(64_000)).toBe('1m 4s')
    expect(formatElapsed(125_000)).toBe('2m 5s')
  })
})
