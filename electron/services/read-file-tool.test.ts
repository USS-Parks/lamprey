import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  executeReadFile,
  formatWithLineNumbers,
  isLikelyBinary,
  parsePagesArg,
  resolveReadPath,
  sliceLines,
  truncationNotice
} from './read-file-tool'

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'read-file-test-'))
})

afterEach(() => {
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

describe('parsePagesArg', () => {
  it('single page', () => {
    expect(parsePagesArg('3')).toEqual([3])
  })
  it('range', () => {
    expect(parsePagesArg('1-5')).toEqual([1, 2, 3, 4, 5])
  })
  it('comma list', () => {
    expect(parsePagesArg('1,3,5')).toEqual([1, 3, 5])
  })
  it('mixed range + list', () => {
    expect(parsePagesArg('1,3-5,9')).toEqual([1, 3, 4, 5, 9])
  })
  it('whitespace tolerated', () => {
    expect(parsePagesArg(' 1 , 3 - 5 ')).toEqual([1, 3, 4, 5])
  })
  it('dedupes overlapping ranges', () => {
    expect(parsePagesArg('1-3,2-4')).toEqual([1, 2, 3, 4])
  })
  it('rejects empty', () => {
    expect(parsePagesArg('')).toBeNull()
  })
  it('rejects negative', () => {
    expect(parsePagesArg('-1')).toBeNull()
  })
  it('rejects zero', () => {
    expect(parsePagesArg('0')).toBeNull()
  })
  it('rejects reversed range', () => {
    expect(parsePagesArg('5-1')).toBeNull()
  })
  it('rejects non-numeric', () => {
    expect(parsePagesArg('foo')).toBeNull()
  })
  it('rejects trailing comma', () => {
    expect(parsePagesArg('1,')).toBeNull()
  })
  it('rejects float', () => {
    expect(parsePagesArg('1.5')).toBeNull()
  })
})

describe('formatWithLineNumbers', () => {
  it('prefixes 1-based numbers with tab', () => {
    expect(formatWithLineNumbers(['a', 'b', 'c'], 1)).toBe('1\ta\n2\tb\n3\tc')
  })
  it('honors starting line', () => {
    expect(formatWithLineNumbers(['x'], 42)).toBe('42\tx')
  })
  it('empty array → empty string', () => {
    expect(formatWithLineNumbers([], 1)).toBe('')
  })
})

describe('isLikelyBinary', () => {
  it('NUL byte → binary', () => {
    expect(isLikelyBinary(Buffer.from([0x48, 0x00, 0x49]))).toBe(true)
  })
  it('plain UTF-8 → text', () => {
    expect(isLikelyBinary(Buffer.from('hello world', 'utf8'))).toBe(false)
  })
  it('NUL beyond 4 KB sniff window → not detected', () => {
    const big = Buffer.concat([Buffer.alloc(5000, 0x41), Buffer.from([0x00])])
    expect(isLikelyBinary(big)).toBe(false)
  })
})

describe('sliceLines', () => {
  const lines = ['a', 'b', 'c', 'd', 'e']
  it('default offset+limit → all lines', () => {
    const r = sliceLines(lines, undefined, undefined)
    expect(r.window).toEqual(lines)
    expect(r.start).toBe(1)
    expect(r.end).toBe(5)
    expect(r.truncated).toBe(false)
  })
  it('offset=2 → from b', () => {
    const r = sliceLines(lines, 2, undefined)
    expect(r.window).toEqual(['b', 'c', 'd', 'e'])
    expect(r.start).toBe(2)
    expect(r.truncated).toBe(true)
  })
  it('limit=2 → first two', () => {
    const r = sliceLines(lines, undefined, 2)
    expect(r.window).toEqual(['a', 'b'])
    expect(r.end).toBe(2)
    expect(r.truncated).toBe(true)
  })
  it('offset + limit window', () => {
    const r = sliceLines(lines, 2, 2)
    expect(r.window).toEqual(['b', 'c'])
    expect(r.start).toBe(2)
    expect(r.end).toBe(3)
  })
  it('offset past EOF → empty window', () => {
    const r = sliceLines(lines, 99, 5)
    expect(r.window).toEqual([])
    expect(r.start).toBe(6)
    expect(r.end).toBe(5)
  })
  it('offset < 1 falls back to 1', () => {
    const r = sliceLines(lines, 0, 1)
    expect(r.start).toBe(1)
    expect(r.window).toEqual(['a'])
  })
})

describe('truncationNotice', () => {
  it('full file → empty', () => {
    expect(truncationNotice(1, 10, 10)).toBe('')
  })
  it('partial → includes offset hint', () => {
    const n = truncationNotice(1, 5, 10)
    expect(n).toContain('1-5 of 10')
    expect(n).toContain('offset=6')
  })
})

describe('resolveReadPath', () => {
  it('relative inside workspace ok', () => {
    const r = resolveReadPath(workspace, 'foo.txt')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.abs.startsWith(workspace)).toBe(true)
  })
  it('".." rejected', () => {
    const r = resolveReadPath(workspace, '../escape.txt')
    expect(r.ok).toBe(false)
  })
  it('empty rejected', () => {
    expect(resolveReadPath(workspace, '').ok).toBe(false)
  })
  it('whitespace-only rejected', () => {
    expect(resolveReadPath(workspace, '   ').ok).toBe(false)
  })
})

describe('executeReadFile (text)', () => {
  it('reads a small file with line numbers', async () => {
    writeFileSync(join(workspace, 'small.txt'), 'line1\nline2\nline3')
    const r = await executeReadFile({ path: 'small.txt' }, workspace)
    expect(r.content).toBe('1\tline1\n2\tline2\n3\tline3')
    expect(r.totalLines).toBe(3)
    expect(r.truncated).toBe(false)
  })
  it('honors offset + limit', async () => {
    writeFileSync(
      join(workspace, 'multi.txt'),
      Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n')
    )
    const r = await executeReadFile(
      { path: 'multi.txt', offset: 3, limit: 2 },
      workspace
    )
    expect(r.content).toContain('3\tline3')
    expect(r.content).toContain('4\tline4')
    expect(r.content).not.toContain('5\tline5')
    expect(r.content).toContain('PARTIAL view')
    expect(r.content).toContain('offset=5')
  })
  it('empty file → "(empty file)"', async () => {
    writeFileSync(join(workspace, 'empty.txt'), '')
    const r = await executeReadFile({ path: 'empty.txt' }, workspace)
    expect(r.content).toBe('(empty file)')
    expect(r.totalLines).toBe(0)
  })
  it('subdirectory read works', async () => {
    mkdirSync(join(workspace, 'sub'))
    writeFileSync(join(workspace, 'sub/x.txt'), 'hello')
    const r = await executeReadFile({ path: 'sub/x.txt' }, workspace)
    expect(r.content).toBe('1\thello')
  })
  it('binary detection — refuses NUL-bearing file', async () => {
    writeFileSync(join(workspace, 'binary.bin'), Buffer.from([0x48, 0x00, 0x49]))
    await expect(
      executeReadFile({ path: 'binary.bin' }, workspace)
    ).rejects.toThrow(/binary/i)
  })
  it('".." path rejected with workspace-bounded message', async () => {
    await expect(
      executeReadFile({ path: '../escape.txt' }, workspace)
    ).rejects.toThrow(/outside the workspace root/)
  })
  it("'pages' on non-PDF rejected", async () => {
    writeFileSync(join(workspace, 'x.txt'), 'a')
    await expect(
      executeReadFile({ path: 'x.txt', pages: '1' }, workspace)
    ).rejects.toThrow(/only valid for \.pdf/)
  })
  it('windowed soft cap — line longer than 256 KB triggers tighten message', async () => {
    const huge = 'A'.repeat(300 * 1024) // single 300 KB line
    writeFileSync(join(workspace, 'huge.txt'), huge)
    await expect(
      executeReadFile({ path: 'huge.txt' }, workspace)
    ).rejects.toThrow(/soft cap/i)
  })
})
