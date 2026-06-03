import { describe, expect, it } from 'vitest'
import {
  chunk,
  MAX_CHUNK_CHARS,
  MIN_CHUNK_CHARS,
  type ChunkOptions
} from './chunker'

const DEFAULT_OPTS: ChunkOptions = { chunkSize: 800, chunkOverlap: 100 }

// ──────────────────── ceilings / floors ────────────────────

describe('chunker ceilings + floors', () => {
  it('returns [] for empty input', () => {
    expect(chunk({ text: '', sourceKind: 'paste' }, DEFAULT_OPTS)).toEqual([])
  })

  it('returns [] when the input is shorter than MIN_CHUNK_CHARS', () => {
    expect(
      chunk({ text: 'short', sourceKind: 'paste' }, DEFAULT_OPTS)
    ).toEqual([])
  })

  it('returns one chunk for input above the floor but below chunkSize', () => {
    const text = 'a'.repeat(MIN_CHUNK_CHARS + 20)
    const result = chunk({ text, sourceKind: 'paste' }, DEFAULT_OPTS)
    expect(result).toHaveLength(1)
    expect(result[0].startOffset).toBe(0)
    expect(result[0].endOffset).toBe(text.length)
    expect(result[0].text).toBe(text)
  })

  it('never emits a chunk over MAX_CHUNK_CHARS, even on a giant no-separator blob', () => {
    const text = 'x'.repeat(10_000)
    const result = chunk({ text, sourceKind: 'paste' }, DEFAULT_OPTS)
    expect(result.length).toBeGreaterThan(0)
    for (const c of result) {
      expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS)
    }
  })

  it('never emits a chunk under MIN_CHUNK_CHARS', () => {
    // Construct text with a sentence-and-tiny-tail shape so the splitter
    // would otherwise emit a tiny tail. The floor must drop it.
    const text =
      'A reasonably long sentence that is more than fifty characters in length. ' +
      'Another reasonably long sentence here for padding. tiny'
    const result = chunk({ text, sourceKind: 'paste' }, DEFAULT_OPTS)
    for (const c of result) {
      expect(c.text.length).toBeGreaterThanOrEqual(MIN_CHUNK_CHARS)
    }
  })
})

// ──────────────────── recursive splitter: 5000-char input ────────────────────

describe('recursive splitter — 5000-char prose input', () => {
  function makeProse(targetChars: number): string {
    const sentences = [
      'The quick brown fox jumps over the lazy dog.',
      'A clear and present concern is the parsing of arbitrary tokens.',
      'When in doubt, write a test that pins the exact behaviour.',
      'Lamprey routes per-model to multiple providers.',
      'The data spine records every meaningful state transition.'
    ]
    let out = ''
    let i = 0
    while (out.length < targetChars) {
      out += sentences[i % sentences.length] + ' '
      i++
      if (i % 4 === 0) out += '\n\n'
    }
    return out.slice(0, targetChars)
  }

  it('produces multiple chunks within the size budget, indices are sequential', () => {
    const text = makeProse(5000)
    const result = chunk({ text, sourceKind: 'paste' }, DEFAULT_OPTS)
    expect(result.length).toBeGreaterThanOrEqual(5)
    expect(result.length).toBeLessThanOrEqual(10)
    for (let i = 0; i < result.length; i++) {
      expect(result[i].index).toBe(i)
      expect(result[i].text.length).toBeLessThanOrEqual(DEFAULT_OPTS.chunkSize)
    }
  })

  it('every emitted chunk is a substring of the input', () => {
    const text = makeProse(5000)
    const result = chunk({ text, sourceKind: 'paste' }, DEFAULT_OPTS)
    for (const c of result) {
      expect(text).toContain(c.text)
    }
  })
})

// ──────────────────── markdown heading-aware split ────────────────────

describe('markdown heading-aware split', () => {
  it('emits chunks with headingPath set to the active heading stack', () => {
    const text = [
      '# Top',
      '',
      'Intro under the top heading. ' + 'Padding sentence. '.repeat(8),
      '',
      '## Section A',
      '',
      'Body of A. ' + 'Padding. '.repeat(20),
      '',
      '### Sub A1',
      '',
      'Body of A1. ' + 'Padding. '.repeat(10),
      '',
      '## Section B',
      '',
      'Body of B. ' + 'Padding. '.repeat(15)
    ].join('\n')
    const result = chunk(
      { text, sourceKind: 'paste', mime: 'text/markdown' },
      { chunkSize: 400, chunkOverlap: 0 }
    )
    expect(result.length).toBeGreaterThan(0)
    const paths = result.map((c) => c.headingPath)
    expect(paths).toContain('Top')
    expect(paths.some((p) => p === 'Top > Section A')).toBe(true)
    expect(paths.some((p) => p === 'Top > Section A > Sub A1')).toBe(true)
    expect(paths.some((p) => p === 'Top > Section B')).toBe(true)
  })

  it('ignores headings inside fenced code blocks', () => {
    const text = [
      '# Real Heading',
      '',
      'Body content that needs to be long enough to survive the floor. ' +
        'Padding sentence. '.repeat(8),
      '',
      '```',
      '# This is NOT a heading',
      'just code',
      '```',
      '',
      'More body content that needs to be long enough. ' +
        'Padding. '.repeat(10)
    ].join('\n')
    const result = chunk(
      { text, sourceKind: 'paste', mime: 'text/markdown' },
      { chunkSize: 800, chunkOverlap: 0 }
    )
    for (const c of result) {
      expect(c.headingPath).toBe('Real Heading')
    }
  })

  it('treats no-heading input as a single unnamed section', () => {
    const text =
      'Markdown without any headings here. ' + 'Padding sentence. '.repeat(10)
    const result = chunk(
      { text, sourceKind: 'paste', mime: 'text/markdown' },
      DEFAULT_OPTS
    )
    expect(result.length).toBeGreaterThan(0)
    for (const c of result) {
      expect(c.headingPath).toBeUndefined()
    }
  })
})

// ──────────────────── source-code lineStart/lineEnd ────────────────────

describe('source-code line ranges', () => {
  function makeLines(count: number, prefix = 'const x'): string {
    const lines: string[] = []
    for (let i = 1; i <= count; i++) {
      lines.push(`${prefix}${i} = ${i};`)
    }
    return lines.join('\n')
  }

  it('emits lineStart/lineEnd populated and monotonically advancing', () => {
    const text = makeLines(200)
    const result = chunk(
      { text, sourceKind: 'file', extension: '.ts' },
      { chunkSize: 400, chunkOverlap: 50 }
    )
    expect(result.length).toBeGreaterThan(0)
    for (const c of result) {
      expect(c.lineStart).toBeDefined()
      expect(c.lineEnd).toBeDefined()
      expect(c.lineStart!).toBeLessThanOrEqual(c.lineEnd!)
      expect(c.lineStart!).toBeGreaterThanOrEqual(1)
      expect(c.lineEnd!).toBeLessThanOrEqual(200)
    }
    // First chunk starts at line 1.
    expect(result[0].lineStart).toBe(1)
    // Successive chunks advance (allowing for overlap retreats).
    for (let i = 1; i < result.length; i++) {
      expect(result[i].lineStart!).toBeGreaterThanOrEqual(result[i - 1].lineStart!)
    }
  })

  it('a one-line file produces lineStart === lineEnd', () => {
    const text = 'const single = ' + 'x'.repeat(200) + ';'
    const result = chunk(
      { text, sourceKind: 'file', extension: '.ts' },
      DEFAULT_OPTS
    )
    expect(result).toHaveLength(1)
    expect(result[0].lineStart).toBe(1)
    expect(result[0].lineEnd).toBe(1)
  })

  it('NON-code source kind does NOT set lineStart/lineEnd', () => {
    const text = 'plain text content that meets the floor. ' + 'padding. '.repeat(10)
    const result = chunk({ text, sourceKind: 'paste' }, DEFAULT_OPTS)
    for (const c of result) {
      expect(c.lineStart).toBeUndefined()
      expect(c.lineEnd).toBeUndefined()
    }
  })
})

// ──────────────────── page stamp (PDF caller contract) ────────────────────

describe('PDF page stamping', () => {
  it('stamps every emitted chunk with the input page number', () => {
    const text = 'PDF page text content. ' + 'padding sentence. '.repeat(20)
    const result = chunk(
      { text, sourceKind: 'file', mime: 'application/pdf', page: 7 },
      DEFAULT_OPTS
    )
    expect(result.length).toBeGreaterThan(0)
    for (const c of result) {
      expect(c.page).toBe(7)
    }
  })
})
