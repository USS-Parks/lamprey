import { describe, expect, it } from 'vitest'
import { fuseAcrossVariants, parseRewrites, rewriteQuery } from './multi-query'

describe('parseRewrites', () => {
  it('parses a clean JSON array', () => {
    expect(parseRewrites('["a", "b", "c"]')).toEqual(['a', 'b', 'c'])
  })

  it('tolerates leading prose around the array', () => {
    expect(parseRewrites('Here you go: ["a", "b"]')).toEqual(['a', 'b'])
  })

  it('returns null on malformed JSON', () => {
    expect(parseRewrites('not json')).toBeNull()
    expect(parseRewrites('[a, b]')).toBeNull()
  })

  it('filters out non-string entries', () => {
    expect(parseRewrites('["a", 42, null, "b"]')).toEqual(['a', 'b'])
  })

  it('returns null for non-array JSON', () => {
    expect(parseRewrites('{"a":1}')).toBeNull()
  })
})

describe('rewriteQuery', () => {
  it('returns [original, ...rewrites] when the planner replies with a clean array', async () => {
    const result = await rewriteQuery('how do tools work', async () =>
      JSON.stringify(['what is the tool system', 'tool dispatch architecture'])
    )
    expect(result[0]).toBe('how do tools work')
    expect(result).toContain('what is the tool system')
    expect(result).toContain('tool dispatch architecture')
  })

  it('returns [original] when the planner throws (graceful fall-through)', async () => {
    const result = await rewriteQuery('q', () =>
      Promise.reject(new Error('planner down'))
    )
    expect(result).toEqual(['q'])
  })

  it('returns [original] when the planner reply does not parse', async () => {
    const result = await rewriteQuery('q', async () => 'gibberish reply')
    expect(result).toEqual(['q'])
  })

  it('drops rewrites longer than the length cap', async () => {
    const tooLong = 'x'.repeat(201)
    const result = await rewriteQuery('q', async () =>
      JSON.stringify([tooLong, 'short alt'])
    )
    expect(result).not.toContain(tooLong)
    expect(result).toContain('short alt')
  })

  it('drops rewrites that are case-insensitive duplicates of the original', async () => {
    const result = await rewriteQuery('Hello World', async () =>
      JSON.stringify(['HELLO WORLD', 'genuinely new phrasing'])
    )
    expect(result).toEqual(['Hello World', 'genuinely new phrasing'])
  })

  it('caps the output at maxRewrites + 1', async () => {
    const result = await rewriteQuery(
      'q',
      async () => JSON.stringify(['a1', 'a2', 'a3', 'a4', 'a5']),
      2
    )
    // 1 original + max 2 rewrites = 3 entries.
    expect(result).toHaveLength(3)
  })

  it('empty / whitespace-only input → []', async () => {
    expect(await rewriteQuery('', async () => '[]')).toEqual([])
    expect(await rewriteQuery('   ', async () => '[]')).toEqual([])
  })
})

describe('fuseAcrossVariants', () => {
  it('a chunk present in two variants ranks above a chunk in only one', () => {
    const v1 = [{ chunkId: 'A' }, { chunkId: 'B' }]
    const v2 = [{ chunkId: 'A' }, { chunkId: 'C' }]
    const fused = fuseAcrossVariants([v1, v2], 5)
    expect(fused[0].chunkId).toBe('A')
  })

  it('returns at most topN entries', () => {
    const v1 = Array.from({ length: 10 }, (_, i) => ({ chunkId: `X${i}` }))
    expect(fuseAcrossVariants([v1], 3)).toHaveLength(3)
  })
})
