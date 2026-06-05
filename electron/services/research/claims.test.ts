import { describe, expect, it, vi } from 'vitest'
import type { ExtractedPage } from './extractor'

vi.mock('../settings-helper', () => ({
  readSettings: () => ({})
}))

vi.mock('../providers/registry', () => ({
  chatOnce: async () => {
    throw new Error('chatOnce called without test override')
  },
  resolveModel: () => ({ contextWindow: 128_000 })
}))

import {
  _claimsInternals,
  extractClaims,
  extractClaimsAll,
  parseClaimsOutput
} from './claims'

function mkPage(overrides: Partial<ExtractedPage> = {}): ExtractedPage {
  return {
    n: 1,
    url: 'https://example.com/article',
    status: 'ok',
    title: 'Test Article',
    fullText: 'This is the full text of the article. It has substantial content.',
    fetchedAt: Date.now(),
    ...overrides
  }
}

describe('parseClaimsOutput', () => {
  it('parses a clean JSON object with text + span', () => {
    const raw =
      '{"claims":[{"text":"Fusion is hard.","span":"Fusion energy is notoriously hard to achieve."},{"text":"ITER aims for 2035.","span":"ITER plans first plasma in 2035."}]}'
    const out = parseClaimsOutput(raw, 3)
    expect(out.length).toBe(2)
    expect(out[0]).toEqual({
      id: '3-0',
      text: 'Fusion is hard.',
      source_n: 3,
      span: 'Fusion energy is notoriously hard to achieve.'
    })
    expect(out[1].id).toBe('3-1')
  })

  it('uses stable id format `<source_n>-<i>`', () => {
    const raw = '{"claims":[{"text":"a"},{"text":"b"},{"text":"c"}]}'
    const out = parseClaimsOutput(raw, 7)
    expect(out.map((c) => c.id)).toEqual(['7-0', '7-1', '7-2'])
  })

  it('returns [] on empty input', () => {
    expect(parseClaimsOutput('', 1)).toEqual([])
  })

  it('returns [] on malformed JSON', () => {
    expect(parseClaimsOutput('not json', 1)).toEqual([])
    expect(parseClaimsOutput('{"claims":', 1)).toEqual([])
  })

  it('returns [] when claims is missing or wrong shape', () => {
    expect(parseClaimsOutput('{}', 1)).toEqual([])
    expect(parseClaimsOutput('{"claims":"not an array"}', 1)).toEqual([])
  })

  it('extracts JSON from prose-wrapped output (markdown fences)', () => {
    const raw =
      'Sure, here are the claims:\n```json\n{"claims":[{"text":"x","span":"y"}]}\n```'
    expect(parseClaimsOutput(raw, 1).length).toBe(1)
  })

  it('drops entries without text', () => {
    const raw = '{"claims":[{"text":"good"},{"span":"orphan"},{"text":""},{"text":"   "}]}'
    expect(parseClaimsOutput(raw, 1).length).toBe(1)
  })

  it('keeps text when span is missing or non-string', () => {
    const raw = '{"claims":[{"text":"a"},{"text":"b","span":42}]}'
    const out = parseClaimsOutput(raw, 1)
    expect(out.length).toBe(2)
    expect(out[0].span).toBeUndefined()
    expect(out[1].span).toBeUndefined()
  })

  it('caps at MAX_CLAIMS_PER_SOURCE claims', () => {
    const claims = Array.from({ length: 40 }, (_, i) => ({ text: `Claim ${i}`, span: `s${i}` }))
    const raw = JSON.stringify({ claims })
    const out = parseClaimsOutput(raw, 1)
    expect(out.length).toBe(_claimsInternals.MAX_CLAIMS_PER_SOURCE)
  })

  it('caps individual claim text length', () => {
    const long = 'word '.repeat(200)
    const raw = JSON.stringify({ claims: [{ text: long, span: 'short span' }] })
    const out = parseClaimsOutput(raw, 1)
    expect(out[0].text.length).toBeLessThanOrEqual(_claimsInternals.MAX_CLAIM_CHARS + 1)
  })
})

describe('extractClaims', () => {
  it('returns [] for failed-status pages (no LLM call)', async () => {
    let llmCalls = 0
    const r = await extractClaims(
      mkPage({ status: 'failed', error: 'HTTP 404', fullText: '' }),
      undefined,
      {
        callLlm: async () => {
          llmCalls++
          return ''
        }
      }
    )
    expect(r).toEqual([])
    expect(llmCalls).toBe(0)
  })

  it('returns [] when LLM throws', async () => {
    const r = await extractClaims(mkPage(), undefined, {
      callLlm: async () => {
        throw new Error('network')
      }
    })
    expect(r).toEqual([])
  })

  it('returns parsed claims when LLM emits valid JSON', async () => {
    const raw = '{"claims":[{"text":"Fact A.","span":"Source sentence A."},{"text":"Fact B.","span":"Source sentence B."}]}'
    const r = await extractClaims(mkPage({ n: 5 }), undefined, {
      callLlm: async () => raw
    })
    expect(r.length).toBe(2)
    expect(r[0].source_n).toBe(5)
    expect(r[0].id).toBe('5-0')
  })

  it('returns [] when the model returns no claims', async () => {
    const r = await extractClaims(mkPage(), undefined, {
      callLlm: async () => '{"claims":[]}'
    })
    expect(r).toEqual([])
  })

  it('includes title + URL in the user message so the model knows the source', async () => {
    let captured = ''
    await extractClaims(
      mkPage({ url: 'https://en.wikipedia.org/wiki/X', title: 'X article' }),
      undefined,
      {
        callLlm: async (messages) => {
          captured = String(messages[1]?.content ?? '')
          return '{"claims":[]}'
        }
      }
    )
    expect(captured).toContain('https://en.wikipedia.org/wiki/X')
    expect(captured).toContain('X article')
  })
})

describe('extractClaimsAll', () => {
  it('flattens claims across pages in source order', async () => {
    const pages = [
      mkPage({ n: 1, fullText: 'page 1 content' }),
      mkPage({ n: 2, fullText: 'page 2 content' })
    ]
    const r = await extractClaimsAll(pages, 6, undefined, {
      callLlm: async () => '{"claims":[{"text":"c"}]}'
    })
    expect(r.length).toBe(2)
    expect(r[0].source_n).toBe(1)
    expect(r[1].source_n).toBe(2)
  })

  it('skips failed pages without consuming an LLM slot', async () => {
    let llmCalls = 0
    const pages = [
      mkPage({ n: 1, status: 'failed', fullText: '' }),
      mkPage({ n: 2 }),
      mkPage({ n: 3, status: 'aborted' as never, fullText: '' })
    ]
    await extractClaimsAll(pages, 6, undefined, {
      callLlm: async () => {
        llmCalls++
        return '{"claims":[]}'
      }
    })
    expect(llmCalls).toBe(1)
  })

  it('honours the abort signal', async () => {
    const pages = [mkPage({ n: 1 }), mkPage({ n: 2 })]
    const ctrl = new AbortController()
    ctrl.abort()
    const r = await extractClaimsAll(
      pages,
      6,
      undefined,
      { callLlm: async () => '{"claims":[{"text":"c"}]}' },
      ctrl.signal
    )
    expect(r.length).toBe(0)
  })
})
