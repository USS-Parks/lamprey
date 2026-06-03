import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  __MAX_TEXT_BYTES_FOR_TEST,
  isSupportedTextExtension,
  loadFromBuffer,
  loadText
} from './text'
import { loadDocument } from './index'

const FIXTURE_DIR = join(__dirname, '__fixtures__')

// ──────────────────── text loader (real fixtures) ────────────────────

describe('loadText (real fixtures)', () => {
  it('round-trips sample.md and reports text/markdown mime', async () => {
    const result = await loadText(join(FIXTURE_DIR, 'sample.md'))
    expect(result.mime).toBe('text/markdown')
    expect(result.text).toContain('# Sample Markdown')
    expect(result.text).toContain('## Section A')
  })

  it('round-trips sample.ts and reports the TypeScript mime', async () => {
    const result = await loadText(join(FIXTURE_DIR, 'sample.ts'))
    expect(result.mime).toBe('text/x-typescript')
    expect(result.text).toContain('export function describeConfig')
  })

  it('round-trips sample.txt and reports text/plain', async () => {
    const result = await loadText(join(FIXTURE_DIR, 'sample.txt'))
    expect(result.mime).toBe('text/plain')
    expect(result.text).toContain('Plain text sample fixture')
  })
})

// ──────────────────── text loader (failure paths) ────────────────────

describe('loadText (failure paths)', () => {
  it('rejects unsupported extensions with a clear error', async () => {
    expect(isSupportedTextExtension('a.unknownext')).toBe(false)
    await expect(loadText('does-not-matter.unknownext')).rejects.toThrow(
      /Unsupported text extension/i
    )
  })

  it('rejects a file with NUL bytes as binary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamprey-loader-bin-'))
    try {
      const p = join(dir, 'fake.txt')
      const buf = Buffer.concat([
        Buffer.from('header bytes '),
        Buffer.from([0, 0, 0]),
        Buffer.from('tail bytes')
      ])
      writeFileSync(p, buf)
      await expect(loadText(p)).rejects.toThrow(/binary/i)
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects oversize files with a size error (synthetic limit via buffer path)', () => {
    // The buffer path shares the same MAX cap; test it there so we don't
    // have to write a 25 MB file to disk just to confirm the error string.
    const buf = Buffer.alloc(__MAX_TEXT_BYTES_FOR_TEST + 1)
    expect(() => loadFromBuffer('big.txt', buf)).toThrow(/exceeds/i)
  })
})

// ──────────────────── loadFromBuffer ────────────────────

describe('loadFromBuffer', () => {
  it('returns the buffer contents with the mime derived from the name', () => {
    const result = loadFromBuffer('note.md', Buffer.from('# in memory\n\nbody'))
    expect(result.mime).toBe('text/markdown')
    expect(result.text).toContain('# in memory')
  })

  it('falls back to text/plain when the extension is unknown', () => {
    const result = loadFromBuffer('note.unknownext', Buffer.from('hello'))
    expect(result.mime).toBe('text/plain')
  })

  it('rejects a binary buffer', () => {
    const buf = Buffer.concat([Buffer.from('ok'), Buffer.from([0])])
    expect(() => loadFromBuffer('x.txt', buf)).toThrow(/binary/i)
  })
})

// ──────────────────── dispatcher ────────────────────

describe('loadDocument dispatcher', () => {
  it('routes .md to the text loader', async () => {
    const result = await loadDocument(join(FIXTURE_DIR, 'sample.md'))
    expect(result.kind).toBe('text')
    if (result.kind === 'text') {
      expect(result.mime).toBe('text/markdown')
      expect(result.text).toContain('Section A')
    }
  })

  it('rejects an unsupported extension', async () => {
    await expect(loadDocument('nope.xyz')).rejects.toThrow(/Unsupported/i)
  })

  // PDF + DOCX dispatch are integration paths — they require real binary
  // fixtures, which we don't generate inline (small binary blobs round-trip
  // poorly through PR review). The runtime ingest smoke covers them via
  // user-supplied files. The loader contracts themselves are unit-tested
  // above for the failure paths the dispatcher exposes.
})
