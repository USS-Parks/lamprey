import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSearchAdapter, WebSearchProviderId, WebSearchResult } from '../web-search-adapters'

// Hoisted state lets us swap out per-provider behaviour in each test.
const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  configured: new Set<WebSearchProviderId>(['duckduckgo', 'brave', 'serpapi', 'tavily', 'searxng']),
  searchImpls: new Map<WebSearchProviderId, (q: string) => Promise<WebSearchResult[]>>()
}))

vi.mock('../settings-helper', () => ({
  readSettings: () => state.settings
}))

vi.mock('../web-search-adapters', async () => {
  const actual = await vi.importActual<typeof import('../web-search-adapters')>('../web-search-adapters')
  return {
    ...actual,
    isProviderConfigured: (id: WebSearchProviderId) => state.configured.has(id),
    getWebSearchAdapterById: (id: WebSearchProviderId): WebSearchAdapter | null => {
      const impl = state.searchImpls.get(id)
      if (!impl) return null
      return {
        id,
        label: id,
        search: impl
      }
    }
  }
})

import {
  DEFAULT_PROVIDER_CASCADE,
  dedupeByCanonical,
  readDeepResearchSettings,
  searchCascade,
  _cascadeInternals
} from './adapter-cascade'

function adapter(
  id: WebSearchProviderId,
  fn: (q: string) => Promise<WebSearchResult[]> | WebSearchResult[]
): void {
  state.searchImpls.set(id, async (q) => fn(q))
}

beforeEach(() => {
  state.settings = {}
  state.configured = new Set(['duckduckgo', 'brave', 'serpapi'])
  state.searchImpls = new Map()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readDeepResearchSettings', () => {
  it('returns defaults when settings.json is empty', () => {
    const s = readDeepResearchSettings()
    expect(s.providerCascade).toEqual(DEFAULT_PROVIDER_CASCADE)
    // D10 flipped the default to true now that the orchestrator is wired.
    expect(s.autoTrigger).toBe(true)
    expect(s.depthTier).toBe('auto')
  })

  it('reads a user-supplied provider cascade', () => {
    state.settings = { deepResearch: { providerCascade: ['brave', 'duckduckgo'] } }
    const s = readDeepResearchSettings()
    expect(s.providerCascade).toEqual(['brave', 'duckduckgo'])
  })

  it('drops unknown provider ids from the cascade', () => {
    state.settings = { deepResearch: { providerCascade: ['brave', 'banana', 'serpapi'] } }
    const s = readDeepResearchSettings()
    expect(s.providerCascade).toEqual(['brave', 'serpapi'])
  })

  it('falls back to defaults when the user-supplied cascade is empty', () => {
    state.settings = { deepResearch: { providerCascade: [] } }
    const s = readDeepResearchSettings()
    expect(s.providerCascade).toEqual(DEFAULT_PROVIDER_CASCADE)
  })

  it('reads autoTrigger + depthTier + model overrides', () => {
    state.settings = {
      deepResearch: {
        autoTrigger: true,
        depthTier: 'exhaustive',
        classifierModel: 'deepseek-v3-flash',
        synthesizerModel: 'deepseek-v3'
      }
    }
    const s = readDeepResearchSettings()
    expect(s.autoTrigger).toBe(true)
    expect(s.depthTier).toBe('exhaustive')
    expect(s.classifierModel).toBe('deepseek-v3-flash')
    expect(s.synthesizerModel).toBe('deepseek-v3')
  })

  it('drops unknown depthTier values and falls back to auto', () => {
    state.settings = { deepResearch: { depthTier: 'extreme' } }
    expect(readDeepResearchSettings().depthTier).toBe('auto')
  })
})

describe('quickCanonical', () => {
  const { quickCanonical } = _cascadeInternals
  it('lowercases the host and strips www.', () => {
    expect(quickCanonical('https://WWW.Example.COM/path/')).toBe('https://example.com/path')
  })
  it('strips utm_ tracking params and fbclid', () => {
    expect(quickCanonical('https://example.com/x?utm_source=twitter&fbclid=abc&keep=1'))
      .toBe('https://example.com/x?keep=1')
  })
  it('drops the URL fragment', () => {
    expect(quickCanonical('https://example.com/x#section'))
      .toBe('https://example.com/x')
  })
  it('sorts remaining query params for stable dedup', () => {
    expect(quickCanonical('https://example.com/?b=2&a=1'))
      .toBe('https://example.com/?a=1&b=2')
  })
  it('preserves non-URL strings unchanged', () => {
    expect(quickCanonical('not-a-url')).toBe('not-a-url')
  })
})

describe('dedupeByCanonical', () => {
  it('removes duplicate URLs that differ only by tracking params', () => {
    const input: WebSearchResult[] = [
      { title: 'A', url: 'https://example.com/x?utm_source=twitter', snippet: '' },
      { title: 'A dup', url: 'https://example.com/x?fbclid=abc', snippet: '' },
      { title: 'B', url: 'https://other.com/y', snippet: '' }
    ]
    const out = dedupeByCanonical(input)
    expect(out.length).toBe(2)
    expect(out[0].title).toBe('A')
  })
})

describe('searchCascade — first-non-empty mode', () => {
  it('uses the first provider when it returns results', async () => {
    adapter('duckduckgo', () => [{ title: 'A', url: 'https://a.example.com', snippet: 's' }])
    adapter('brave', () => {
      throw new Error('should not be called')
    })

    const r = await searchCascade('hello')
    expect(r.results.length).toBe(1)
    expect(r.providersUsed).toEqual(['duckduckgo'])
    expect(r.errors.length).toBe(0)
  })

  it('falls through on HTTP 429 to the next provider', async () => {
    adapter('duckduckgo', () => {
      throw new Error('HTTP 429 rate limited')
    })
    adapter('brave', () => [{ title: 'B', url: 'https://b.example.com', snippet: 's' }])

    const r = await searchCascade('hello')
    expect(r.providersUsed).toEqual(['brave'])
    expect(r.results[0].title).toBe('B')
    expect(r.errors.length).toBe(1)
    expect(r.errors[0].provider).toBe('duckduckgo')
  })

  it('falls through on HTTP 503 to the next provider', async () => {
    adapter('duckduckgo', () => {
      throw new Error('Brave search HTTP 503: service unavailable')
    })
    adapter('brave', () => [{ title: 'B', url: 'https://b.example.com', snippet: 's' }])

    const r = await searchCascade('hello')
    expect(r.providersUsed).toEqual(['brave'])
  })

  it('falls through on empty result set', async () => {
    adapter('duckduckgo', () => [])
    adapter('brave', () => [{ title: 'B', url: 'https://b.example.com', snippet: 's' }])

    const r = await searchCascade('hello')
    expect(r.providersUsed).toEqual(['brave'])
    expect(r.errors[0].error).toMatch(/Empty result set/)
  })

  it('skips providers that are not configured (silent filter — no error noise)', async () => {
    state.configured = new Set(['brave', 'serpapi'])
    adapter('brave', () => [{ title: 'B', url: 'https://b.example.com', snippet: 's' }])
    const r = await searchCascade('hello')
    expect(r.providersUsed).toEqual(['brave'])
    // DDG was filtered out before the loop ran, so it does NOT appear in
    // errors. Only providers that were actually attempted and failed
    // contribute to the error trail.
    expect(r.errors.some((e) => e.provider === 'duckduckgo')).toBe(false)
  })

  it('returns empty results + error trail when every provider fails', async () => {
    adapter('duckduckgo', () => {
      throw new Error('HTTP 429')
    })
    adapter('brave', () => {
      throw new Error('HTTP 500')
    })
    adapter('serpapi', () => {
      throw new Error('HTTP 503')
    })

    const r = await searchCascade('hello')
    expect(r.results).toEqual([])
    expect(r.providersUsed).toEqual([])
    expect(r.errors.length).toBe(3)
  })

  it('returns a clean error when no providers are configured at all', async () => {
    state.configured = new Set()
    const r = await searchCascade('hello')
    expect(r.results).toEqual([])
    expect(r.providersUsed).toEqual([])
    expect(r.errors.length).toBeGreaterThan(0)
  })

  it('respects the providers opts override', async () => {
    adapter('duckduckgo', () => [{ title: 'DDG', url: 'https://ddg.example.com', snippet: '' }])
    adapter('serpapi', () => [{ title: 'SERP', url: 'https://serp.example.com', snippet: '' }])
    const r = await searchCascade('hello', { providers: ['serpapi'] })
    expect(r.providersUsed).toEqual(['serpapi'])
    expect(r.results[0].title).toBe('SERP')
  })

  it('non-transient errors abort the cascade with a CascadeFailureError', async () => {
    adapter('duckduckgo', () => {
      throw new Error('Programming bug — undefined.foo')
    })
    adapter('brave', () => [{ title: 'B', url: 'https://b.example.com', snippet: 's' }])
    await expect(searchCascade('hello')).rejects.toThrow(/Cascade aborted at duckduckgo/)
  })
})

describe('searchCascade — mergeAll mode', () => {
  it('merges results across providers and dedupes', async () => {
    adapter('duckduckgo', () => [
      { title: 'shared', url: 'https://shared.example.com/?utm_source=ddg', snippet: '' },
      { title: 'ddg-only', url: 'https://ddg-only.example.com', snippet: '' }
    ])
    adapter('brave', () => [
      { title: 'shared dup', url: 'https://shared.example.com/?fbclid=abc', snippet: '' },
      { title: 'brave-only', url: 'https://brave-only.example.com', snippet: '' }
    ])
    state.configured = new Set(['duckduckgo', 'brave'])

    const r = await searchCascade('hello', { mergeAll: true })
    expect(r.providersUsed.sort()).toEqual(['brave', 'duckduckgo'])
    expect(r.results.length).toBe(3) // shared dedupes
    const urls = r.results.map((x) => x.url)
    expect(urls.some((u) => u.includes('shared.example.com'))).toBe(true)
    expect(urls).toContain('https://ddg-only.example.com')
    expect(urls).toContain('https://brave-only.example.com')
  })

  it('mergeAll collects errors from failed providers without aborting', async () => {
    adapter('duckduckgo', () => {
      throw new Error('HTTP 429')
    })
    adapter('brave', () => [{ title: 'B', url: 'https://b.example.com', snippet: '' }])
    state.configured = new Set(['duckduckgo', 'brave'])

    const r = await searchCascade('hello', { mergeAll: true })
    expect(r.providersUsed).toEqual(['brave'])
    expect(r.results.length).toBe(1)
    expect(r.errors[0].provider).toBe('duckduckgo')
  })
})
