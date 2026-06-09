import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  formatSpillPreview,
  maybeSpillToolResult,
  readSpilledResult,
  DEFAULT_SPILL_THRESHOLD
} from './tool-result-spill'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hy3-spill-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('formatSpillPreview (pure)', () => {
  it('keeps head + tail and names the ref; shorter than the original', () => {
    const full = 'A'.repeat(5000) + 'ZZZ' + 'B'.repeat(5000)
    const preview = formatSpillPreview(full, 'ref123')
    expect(preview).toContain('ref123')
    expect(preview).toContain('read_tool_result')
    expect(preview).toContain('elided')
    expect(preview.length).toBeLessThan(full.length)
    expect(preview.startsWith('A')).toBe(true) // head preserved
    expect(preview.endsWith('B'.repeat(10) /* tail tail */)).toBe(true)
  })
})

describe('maybeSpillToolResult', () => {
  it('passes small results through untouched', () => {
    const out = maybeSpillToolResult('small output', { dir })
    expect(out.spilled).toBe(false)
    expect(out.result).toBe('small output')
    expect(out.ref).toBeUndefined()
  })

  it('spills large results and returns a preview + ref', () => {
    const full = 'x'.repeat(DEFAULT_SPILL_THRESHOLD + 1000)
    const out = maybeSpillToolResult(full, { dir })
    expect(out.spilled).toBe(true)
    expect(out.ref).toBeTruthy()
    expect(out.chars).toBe(full.length)
    expect(out.result.length).toBeLessThan(full.length)
  })

  it('threshold <= 0 disables spilling', () => {
    const full = 'x'.repeat(50_000)
    expect(maybeSpillToolResult(full, { dir, threshold: 0 }).spilled).toBe(false)
  })

  it('round-trips: a spilled result is fully readable via readSpilledResult', () => {
    const full = Array.from({ length: 20_000 }, (_, i) => `line-${i}`).join('\n')
    const out = maybeSpillToolResult(full, { dir })
    expect(out.spilled).toBe(true)
    const back = JSON.parse(readSpilledResult(out.ref!, 0, full.length, dir))
    expect(back.content).toBe(full)
    expect(back.totalChars).toBe(full.length)
  })

  it('readSpilledResult pages a sub-range', () => {
    const full = 'abcdefghij'.repeat(2000)
    const out = maybeSpillToolResult(full, { dir })
    const back = JSON.parse(readSpilledResult(out.ref!, 5, 15, dir))
    expect(back.content).toBe(full.slice(5, 15))
    expect(back.start).toBe(5)
    expect(back.end).toBe(15)
  })
})

describe('readSpilledResult safety', () => {
  it('rejects traversal-shaped refs', () => {
    expect(JSON.parse(readSpilledResult('../etc/passwd', 0, 10, dir)).error).toBe('invalid ref')
    expect(JSON.parse(readSpilledResult('a/b', 0, 10, dir)).error).toBe('invalid ref')
  })

  it('reports a missing ref cleanly', () => {
    const r = JSON.parse(readSpilledResult('deadbeef-0000', 0, 10, dir))
    expect(r.error).toContain('not found')
  })
})
