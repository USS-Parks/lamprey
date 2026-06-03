import { describe, expect, it } from 'vitest'
import { parseCitations } from './citation-parser'

describe('parseCitations — single', () => {
  it('returns a single text segment when no citations are present', () => {
    const segs = parseCitations('hello world')
    expect(segs).toEqual([{ kind: 'text', text: 'hello world' }])
  })

  it('parses [N] as a citation segment', () => {
    const segs = parseCitations('Foo [1] bar')
    expect(segs).toEqual([
      { kind: 'text', text: 'Foo ' },
      { kind: 'citation', ids: [1], raw: '[1]' },
      { kind: 'text', text: ' bar' }
    ])
  })

  it('parses [N, M, K] as a multi-id citation segment', () => {
    const segs = parseCitations('See [1, 2, 3] for details.')
    const cite = segs.find((s) => s.kind === 'citation') as
      | { kind: 'citation'; ids: number[] }
      | undefined
    expect(cite?.ids).toEqual([1, 2, 3])
  })

  it('tolerates whitespace in [N , M]', () => {
    const segs = parseCitations('text [1 , 2] tail')
    const cite = segs.find((s) => s.kind === 'citation') as
      | { kind: 'citation'; ids: number[] }
      | undefined
    expect(cite?.ids).toEqual([1, 2])
  })

  it('handles multiple citations on the same line', () => {
    const segs = parseCitations('a [1] b [2] c [3] d')
    const citations = segs.filter((s) => s.kind === 'citation')
    expect(citations).toHaveLength(3)
    expect(citations.map((c) => (c as { ids: number[] }).ids.flat())).toEqual([
      [1],
      [2],
      [3]
    ])
  })
})

describe('parseCitations — code blocks (skip)', () => {
  it('does NOT parse citations inside fenced code blocks', () => {
    const text = 'before [1]\n```\nconst [2]\n```\nafter [3]'
    const segs = parseCitations(text)
    const citations = segs.filter((s) => s.kind === 'citation') as Array<{
      kind: 'citation'
      ids: number[]
    }>
    expect(citations.map((c) => c.ids).flat()).toEqual([1, 3])
  })

  it('does NOT parse citations inside inline code', () => {
    const segs = parseCitations('text `code [1] code` more [2]')
    const citations = segs.filter((s) => s.kind === 'citation') as Array<{
      kind: 'citation'
      ids: number[]
    }>
    expect(citations.map((c) => c.ids).flat()).toEqual([2])
  })

  it('handles a fenced block with language hint', () => {
    const text = 'before [1]\n```js\nconst arr = [2]\n```\nafter [3]'
    const segs = parseCitations(text)
    const citations = segs.filter((s) => s.kind === 'citation') as Array<{
      kind: 'citation'
      ids: number[]
    }>
    expect(citations.map((c) => c.ids).flat()).toEqual([1, 3])
  })
})

describe('parseCitations — edge cases', () => {
  it('empty input → empty array', () => {
    expect(parseCitations('')).toEqual([])
  })

  it('non-number content in brackets is NOT parsed as a citation', () => {
    const segs = parseCitations('see [appendix] for context')
    expect(segs.every((s) => s.kind === 'text')).toBe(true)
  })

  it('a stray bracket character does not break parsing', () => {
    const segs = parseCitations('before [ stuff and [1] then ] after')
    const citations = segs.filter((s) => s.kind === 'citation')
    expect(citations).toHaveLength(1)
  })

  it('merges adjacent text segments so the renderer sees one entry per run', () => {
    const segs = parseCitations('aaa bbb ccc')
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual({ kind: 'text', text: 'aaa bbb ccc' })
  })
})
