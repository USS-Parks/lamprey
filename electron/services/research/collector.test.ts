import { describe, expect, it, vi } from 'vitest'
import type { WebSearchResult } from '../web-search-adapters'
import type { CascadeResult } from './adapter-cascade'

vi.mock('../settings-helper', () => ({
  readSettings: () => ({})
}))

import { canonicalUrl, dedupeByCanonicalUrl, registrableDomain } from './url-canonicalize'
import { _collectorInternals, collectSources } from './collector'

const { trustScoreFor, isSpamDomain, DEFAULT_DEPTH_CAP, DEFAULT_DOMAIN_CAP } = _collectorInternals

describe('canonicalUrl', () => {
  const cases: Array<[string, string]> = [
    ['https://Example.com', 'https://example.com/'],
    ['https://www.example.com/foo/', 'https://example.com/foo'],
    ['https://EXAMPLE.com/foo?utm_source=twitter', 'https://example.com/foo'],
    ['https://example.com/foo?fbclid=abc&keep=1', 'https://example.com/foo?keep=1'],
    ['https://example.com/foo#section', 'https://example.com/foo'],
    ['https://example.com/?b=2&a=1', 'https://example.com/?a=1&b=2'],
    ['https://example.com/?mc_eid=xyz', 'https://example.com/'],
    ['https://example.com/?gclid=g123&utm_campaign=launch', 'https://example.com/'],
    ['https://news.example.com/article-1', 'https://news.example.com/article-1'],
    ['https://example.co.uk/foo/', 'https://example.co.uk/foo'],
    ['HTTPS://EXAMPLE.COM/Foo', 'https://example.com/Foo'],
    ['not-a-url', 'not-a-url'],
    ['https://example.com', 'https://example.com/'],
    ['https://example.com/', 'https://example.com/'],
    ['https://example.com/path/?ref=newsletter', 'https://example.com/path']
  ]
  for (const [input, expected] of cases) {
    it(`canonicalises "${input}" → "${expected}"`, () => {
      expect(canonicalUrl(input)).toBe(expected)
    })
  }
})

describe('registrableDomain', () => {
  const cases: Array<[string, string]> = [
    ['https://www.example.com/foo', 'example.com'],
    ['https://blog.example.com/foo', 'example.com'],
    ['https://news.bbc.co.uk/article', 'bbc.co.uk'],
    ['https://a.b.example.com.au', 'example.com.au'],
    ['https://someone.github.io/repo', 'someone.github.io'],
    ['https://my-site.pages.dev', 'my-site.pages.dev'],
    ['https://example.com', 'example.com'],
    ['https://EXAMPLE.COM', 'example.com'],
    ['https://www.bbc.com/news', 'bbc.com'],
    ['https://localhost', 'localhost'],
    ['not-a-url', 'not-a-url']
  ]
  for (const [input, expected] of cases) {
    it(`registrable domain of "${input}" → "${expected}"`, () => {
      expect(registrableDomain(input)).toBe(expected)
    })
  }
})

describe('dedupeByCanonicalUrl', () => {
  it('removes duplicates and preserves first-occurrence order', () => {
    const input = [
      { url: 'https://example.com/x?utm_source=a', title: 'A' },
      { url: 'https://example.com/x?fbclid=b', title: 'A dup' },
      { url: 'https://other.com/y', title: 'B' },
      { url: 'https://example.com/x', title: 'A dup 2' }
    ]
    const out = dedupeByCanonicalUrl(input)
    expect(out.length).toBe(2)
    expect(out[0].title).toBe('A')
    expect(out[1].title).toBe('B')
  })

  it('handles empty input', () => {
    expect(dedupeByCanonicalUrl([])).toEqual([])
  })
})

describe('trustScoreFor', () => {
  it('boosts .gov to score 3', () => {
    expect(trustScoreFor('whitehouse.gov')).toBe(3)
    expect(trustScoreFor('nih.gov')).toBe(3)
  })
  it('boosts .edu to score 3', () => {
    expect(trustScoreFor('mit.edu')).toBe(3)
    expect(trustScoreFor('stanford.edu')).toBe(3)
  })
  it('boosts allowlisted major publishers to score 2', () => {
    expect(trustScoreFor('wikipedia.org')).toBe(2)
    expect(trustScoreFor('reuters.com')).toBe(2)
    expect(trustScoreFor('nature.com')).toBe(2)
  })
  it('neutral score 1 for unknown domains', () => {
    expect(trustScoreFor('random-blog.com')).toBe(1)
    expect(trustScoreFor('someone.github.io')).toBe(1)
  })
  it('is deterministic across calls', () => {
    const a = trustScoreFor('reuters.com')
    const b = trustScoreFor('reuters.com')
    expect(a).toBe(b)
  })
})

describe('isSpamDomain', () => {
  it('drops known content-farm domains', () => {
    expect(isSpamDomain('ezinearticles.com')).toBe(true)
    expect(isSpamDomain('hubpages.com')).toBe(true)
  })
  it('lets neutral domains pass', () => {
    expect(isSpamDomain('example.com')).toBe(false)
    expect(isSpamDomain('wikipedia.org')).toBe(false)
  })
})

describe('collectSources', () => {
  function mkResult(url: string, title: string, snippet = ''): WebSearchResult {
    return { title, url, snippet }
  }

  function mkCascade(results: WebSearchResult[], providers: string[] = ['duckduckgo']): CascadeResult {
    return { results, providersUsed: providers as never[], errors: [] }
  }

  it('returns numbered sources from the planner queries', async () => {
    const r = await collectSources(
      [
        { q: 'fusion energy', angle: 'baseline' },
        { q: 'iter project', angle: 'projects' }
      ],
      'quick',
      {
        searchFn: async (q) => {
          if (q === 'fusion energy') {
            return mkCascade([
              mkResult('https://en.wikipedia.org/wiki/Fusion_power', 'Fusion power - Wikipedia'),
              mkResult('https://example.com/fusion-101', 'Fusion 101')
            ])
          }
          return mkCascade([
            mkResult('https://www.iter.org/proj/InaFewLines', 'ITER in a few lines')
          ])
        }
      }
    )
    expect(r.sources.length).toBeGreaterThanOrEqual(2)
    expect(r.sources[0].n).toBe(1)
    expect(r.sources.every((s, i) => s.n === i + 1)).toBe(true)
    expect(r.providersUsed).toContain('duckduckgo')
  })

  it('caps per-domain to DEFAULT_DOMAIN_CAP', async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://news.example.com/article-${i}`)
    const r = await collectSources(
      [{ q: 'x', angle: 'a' }],
      'standard',
      {
        searchFn: async () => mkCascade(urls.map((u, i) => mkResult(u, `Article ${i}`)))
      }
    )
    const exampleCount = r.sources.filter((s) => s.registrableDomain === 'example.com').length
    expect(exampleCount).toBe(DEFAULT_DOMAIN_CAP)
  })

  it('drops spam domains from the curated set', async () => {
    const r = await collectSources(
      [{ q: 'x', angle: 'a' }],
      'quick',
      {
        searchFn: async () =>
          mkCascade([
            mkResult('https://ezinearticles.com/article', 'spam'),
            mkResult('https://hubpages.com/foo', 'spam2'),
            mkResult('https://example.com/good', 'good')
          ])
      }
    )
    expect(r.sources.every((s) => s.registrableDomain !== 'ezinearticles.com')).toBe(true)
    expect(r.sources.every((s) => s.registrableDomain !== 'hubpages.com')).toBe(true)
    expect(r.sources.some((s) => s.title === 'good')).toBe(true)
  })

  it('dedupes cross-query URLs by canonical equality', async () => {
    const r = await collectSources(
      [
        { q: 'query 1', angle: 'a' },
        { q: 'query 2', angle: 'b' }
      ],
      'quick',
      {
        searchFn: async () =>
          mkCascade([
            mkResult('https://www.example.com/foo?utm_source=q1', 'A'),
            mkResult('https://example.com/foo?fbclid=q2', 'A again')
          ])
      }
    )
    // Two queries × 2 hits = 4 raw, but they all canonicalise to the same
    // URL → 1 curated source.
    const uniqueCanonical = new Set(r.sources.map((s) => s.canonicalUrl))
    expect(uniqueCanonical.size).toBe(r.sources.length)
    expect(r.sources.length).toBe(1)
  })

  it('truncates to the depth-tier cap', async () => {
    // Use distinct domains so the per-domain cap doesn't bite first.
    const urls = Array.from({ length: 20 }, (_, i) => `https://site${i}.example.com/p`)
    const r = await collectSources(
      [{ q: 'x', angle: 'a' }],
      'quick',
      {
        searchFn: async () => mkCascade(urls.map((u, i) => mkResult(u, `T${i}`)))
      }
    )
    expect(r.sources.length).toBeLessThanOrEqual(DEFAULT_DEPTH_CAP.quick)
  })

  it('ranks .gov / .edu / allowlisted publishers above neutral domains', async () => {
    const r = await collectSources(
      [{ q: 'x', angle: 'a' }],
      'quick',
      {
        searchFn: async () =>
          mkCascade([
            mkResult('https://random-blog.com/a', 'neutral'),
            mkResult('https://nature.com/article', 'major publisher'),
            mkResult('https://nih.gov/doc', 'gov'),
            mkResult('https://reuters.com/story', 'reuters')
          ])
      }
    )
    // Highest-trust comes first.
    expect(r.sources[0].trustScore).toBe(3)
  })

  it('records errors when every provider in the cascade fails for a query', async () => {
    const r = await collectSources(
      [{ q: 'broken', angle: 'a' }],
      'quick',
      {
        searchFn: async () => ({
          results: [],
          providersUsed: [],
          errors: [{ provider: 'duckduckgo', error: 'HTTP 429' }]
        })
      }
    )
    expect(r.sources.length).toBe(0)
    expect(r.errors.length).toBe(1)
    expect(r.errors[0].query).toBe('broken')
  })

  it('respects the AbortSignal — returns empty when aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const r = await collectSources(
      [{ q: 'x', angle: 'a' }],
      'quick',
      {
        signal: ctrl.signal,
        searchFn: async () => mkCascade([mkResult('https://example.com/a', 'A')])
      }
    )
    expect(r.sources.length).toBe(0)
  })

  it('records the planner angle on each curated source', async () => {
    const r = await collectSources(
      [{ q: 'fusion energy 2026', angle: 'recent-developments' }],
      'quick',
      {
        searchFn: async () => mkCascade([mkResult('https://example.com/a', 'A')])
      }
    )
    expect(r.sources[0].sourceAngle).toBe('recent-developments')
    expect(r.sources[0].sourceQuery).toBe('fusion energy 2026')
  })
})
