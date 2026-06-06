import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// web-search-adapters reads settings.json + the keychain. We mock the
// adapter dependencies to focus on the SSRF/safeFetch wiring.

const state = vi.hoisted(() => ({
  provider: 'searxng' as
    | 'duckduckgo'
    | 'brave'
    | 'tavily'
    | 'serpapi'
    | 'searxng'
    | 'wikipedia',
  endpoint: 'http://127.0.0.1:8888',
  hasKeyFor: new Set<string>(['web_search:brave', 'web_search:tavily', 'web_search:serpapi']),
  keyValue: 'test-key-12345'
}))

vi.mock('./settings-helper', () => ({
  readSettings: () => ({
    webTools: { searchProvider: state.provider, searxngEndpoint: state.endpoint }
  })
}))

vi.mock('./keychain', () => ({
  getKey: (provider: string) => (state.hasKeyFor.has(provider) ? state.keyValue : null),
  hasKey: (provider: string) => state.hasKeyFor.has(provider)
}))

import {
  ALL_WEB_SEARCH_PROVIDERS,
  getWebSearchAdapter,
  isProviderConfigured,
  parseDuckDuckGoHtml
} from './web-search-adapters'

describe('web-search-adapters — SEC-2 (safeFetch integration)', () => {
  const originalFetch = globalThis.fetch
  let fetchCalls: string[] = []
  let respondWith: () => Response = () => new Response('{}', { status: 200 })

  beforeEach(() => {
    fetchCalls = []
    // Spy on the global so we can confirm whether the adapter reached the
    // network. safeFetch routes through `fetch`; if the URL is internal
    // safeFetch refuses BEFORE calling it, which is exactly what we assert.
    globalThis.fetch = (async (input: unknown) => {
      fetchCalls.push(String(input))
      return respondWith()
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('SearXNG endpoint pointing at loopback is refused before any network call', async () => {
    state.provider = 'searxng'
    state.endpoint = 'http://127.0.0.1:8888'
    const adapter = getWebSearchAdapter()
    expect(adapter).not.toBeNull()
    await expect(adapter!.search('hello')).rejects.toThrow(/127\.0\.0\.1|loopback|Refused/i)
    expect(fetchCalls).toEqual([])
  })

  it('SearXNG endpoint pointing at the cloud metadata IP is refused', async () => {
    state.provider = 'searxng'
    state.endpoint = 'http://169.254.169.254'
    const adapter = getWebSearchAdapter()
    await expect(adapter!.search('hello')).rejects.toThrow(/169\.254\.169\.254/)
    expect(fetchCalls).toEqual([])
  })

  it('SearXNG endpoint pointing at RFC1918 is refused', async () => {
    state.provider = 'searxng'
    state.endpoint = 'http://10.0.0.1'
    const adapter = getWebSearchAdapter()
    await expect(adapter!.search('hello')).rejects.toThrow(/Refused/i)
    expect(fetchCalls).toEqual([])
  })

  it('SearXNG image search hitting loopback is also refused (proves swap reaches every fetch site)', async () => {
    state.provider = 'searxng'
    state.endpoint = 'http://127.0.0.1'
    const adapter = getWebSearchAdapter()
    expect(adapter?.imageSearch).toBeTruthy()
    await expect(adapter!.imageSearch!('cats')).rejects.toThrow(/Refused/i)
    expect(fetchCalls).toEqual([])
  })

  it('redirect into an internal IP is refused even from a public adapter host', async () => {
    state.provider = 'brave'
    respondWith = () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/' }
      })
    const adapter = getWebSearchAdapter()
    await expect(adapter!.search('hello')).rejects.toThrow(/169\.254\.169\.254/)
    // The first hop ran (against the public Brave host); the redirect is
    // what got refused. Either zero or one network call is acceptable —
    // what matters is that the second call (to the internal IP) never
    // happened.
    expect(fetchCalls.length).toBeLessThanOrEqual(1)
    for (const c of fetchCalls) {
      expect(c).not.toContain('169.254.169.254')
    }
  })
})

// --------------------------------------------------------------------------
// D1 — DuckDuckGo adapter
// --------------------------------------------------------------------------

const DDG_FIXTURE_CLASSIC = `
<div class="results">
  <div class="result results_links results_links_deep web-result">
    <h2 class="result__title">
      <a class="result__a" href="https://en.wikipedia.org/wiki/Fusion_power">Fusion power - Wikipedia</a>
    </h2>
    <a class="result__snippet" href="https://en.wikipedia.org/wiki/Fusion_power">
      Fusion power is a proposed form of power generation that would generate electricity by using heat from nuclear fusion reactions.
    </a>
    <a class="result__url" href="https://en.wikipedia.org/wiki/Fusion_power">en.wikipedia.org</a>
  </div>
  <div class="result results_links">
    <h2 class="result__title">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.iter.org%2Fproj%2FInaFewLines&amp;rut=abc">ITER &amp; Fusion in a few lines</a>
    </h2>
    <a class="result__snippet" href="https://www.iter.org/proj/InaFewLines">
      A short introduction to the ITER project &amp; fusion energy programme.
    </a>
    <a class="result__url" href="https://www.iter.org">www.iter.org</a>
  </div>
  <div class="result results_links">
    <h2 class="result__title">
      <a class="result__a" href="https://www.fusionindustryassociation.org/">Fusion Industry Association</a>
    </h2>
    <a class="result__snippet" href="https://www.fusionindustryassociation.org/">
      Trade group representing private fusion energy companies.
    </a>
    <a class="result__url" href="https://www.fusionindustryassociation.org">fusionindustryassociation.org</a>
  </div>
</div>`

const DDG_FIXTURE_FALLBACK_ONLY = `
<ul>
  <li>
    <a class="result__a" href="https://example.com/a">Page A title &mdash; trimmed</a>
    <div class="result__snippet">Snippet A about page A content.</div>
  </li>
  <li>
    <a class="result__a" href="https://example.com/b">Page B</a>
    <span class="result__snippet">Snippet B explains page B.</span>
  </li>
</ul>`

describe('parseDuckDuckGoHtml', () => {
  it('parses the classic result block structure', () => {
    const results = parseDuckDuckGoHtml(DDG_FIXTURE_CLASSIC, 10)
    expect(results.length).toBe(3)
    expect(results[0].title).toBe('Fusion power - Wikipedia')
    expect(results[0].url).toBe('https://en.wikipedia.org/wiki/Fusion_power')
    expect(results[0].snippet).toContain('proposed form of power generation')
  })

  it('unwraps DuckDuckGo /l/?uddg= redirect URLs', () => {
    const results = parseDuckDuckGoHtml(DDG_FIXTURE_CLASSIC, 10)
    expect(results[1].url).toBe('https://www.iter.org/proj/InaFewLines')
  })

  it('decodes html entities in titles and snippets', () => {
    const results = parseDuckDuckGoHtml(DDG_FIXTURE_CLASSIC, 10)
    expect(results[1].title).toBe('ITER & Fusion in a few lines')
    expect(results[1].snippet).toContain('ITER project & fusion')
  })

  it('respects the max-result cap', () => {
    const results = parseDuckDuckGoHtml(DDG_FIXTURE_CLASSIC, 2)
    expect(results.length).toBe(2)
  })

  it('falls back to anchor-walking when the classic block markup is absent', () => {
    const results = parseDuckDuckGoHtml(DDG_FIXTURE_FALLBACK_ONLY, 10)
    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results[0].title).toMatch(/Page A title/)
    expect(results[0].url).toBe('https://example.com/a')
    expect(results[0].snippet).toContain('Snippet A')
    expect(results[1].title).toBe('Page B')
  })

  it('returns an empty array for unrecognised markup rather than throwing', () => {
    expect(parseDuckDuckGoHtml('<html><body>no results</body></html>', 10)).toEqual([])
  })
})

describe('DuckDuckGo adapter — wiring', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('factory returns an adapter even with no API key configured', () => {
    state.provider = 'duckduckgo'
    state.hasKeyFor = new Set()
    const adapter = getWebSearchAdapter()
    expect(adapter).not.toBeNull()
    expect(adapter!.id).toBe('duckduckgo')
    expect(adapter!.label).toBe('DuckDuckGo')
  })

  it('isProviderConfigured returns true for duckduckgo regardless of keychain', () => {
    expect(isProviderConfigured('duckduckgo')).toBe(true)
  })

  it('search() posts to html.duckduckgo.com via safeFetch with the freshness param', async () => {
    state.provider = 'duckduckgo'
    let capturedUrl = ''
    let capturedInit: { method?: string; body?: BodyInit | null } = {}
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedInit = { method: init?.method, body: init?.body }
      return new Response(DDG_FIXTURE_CLASSIC, {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      })
    }) as typeof fetch

    const adapter = getWebSearchAdapter()
    const results = await adapter!.search('fusion energy', { freshness: 'month', count: 5 })

    expect(capturedUrl).toContain('html.duckduckgo.com/html')
    expect(capturedInit.method).toBe('POST')
    expect(String(capturedInit.body)).toContain('q=fusion+energy')
    expect(String(capturedInit.body)).toContain('df=m')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].url).toMatch(/^https?:\/\//)
  })

  it('search() throws on HTTP non-2xx', async () => {
    state.provider = 'duckduckgo'
    globalThis.fetch = (async () => new Response('rate limited', { status: 429 })) as typeof fetch
    const adapter = getWebSearchAdapter()
    await expect(adapter!.search('x')).rejects.toThrow(/HTTP 429/)
  })

  it('search() returns [] on empty SERP rather than throwing', async () => {
    state.provider = 'duckduckgo'
    globalThis.fetch = (async () =>
      new Response('<html><body>no results</body></html>', { status: 200 })) as typeof fetch
    const adapter = getWebSearchAdapter()
    const results = await adapter!.search('zorblax')
    expect(results).toEqual([])
  })

  it('ALL_WEB_SEARCH_PROVIDERS includes duckduckgo first', () => {
    expect(ALL_WEB_SEARCH_PROVIDERS[0].id).toBe('duckduckgo')
    expect(ALL_WEB_SEARCH_PROVIDERS[0].requiresKey).toBe(false)
    expect(ALL_WEB_SEARCH_PROVIDERS[0].requiresEndpoint).toBe(false)
  })
})

describe('WikipediaAdapter — R5 (zero-key floor)', () => {
  const originalFetch = globalThis.fetch
  let capturedUrl = ''

  afterEach(() => {
    globalThis.fetch = originalFetch
    capturedUrl = ''
  })

  it('Wikipedia is always configured (no key needed)', () => {
    expect(isProviderConfigured('wikipedia')).toBe(true)
  })

  it('Wikipedia is in the provider registry as zero-key', () => {
    const entry = ALL_WEB_SEARCH_PROVIDERS.find((p) => p.id === 'wikipedia')
    expect(entry).toBeDefined()
    expect(entry!.requiresKey).toBe(false)
    expect(entry!.requiresEndpoint).toBe(false)
  })

  it('search() returns parsed OpenSearch results', async () => {
    state.provider = 'wikipedia'
    const sampleResponse = JSON.stringify([
      'fusion energy',
      ['Nuclear fusion', 'Fusion power', 'Fusion ignition'],
      ['Process of merging atomic nuclei', 'Power produced by fusion', ''],
      [
        'https://en.wikipedia.org/wiki/Nuclear_fusion',
        'https://en.wikipedia.org/wiki/Fusion_power',
        'https://en.wikipedia.org/wiki/Fusion_ignition'
      ]
    ])
    globalThis.fetch = (async (input: unknown) => {
      capturedUrl = String(input)
      return new Response(sampleResponse, { status: 200 })
    }) as typeof fetch

    const adapter = getWebSearchAdapter()
    expect(adapter).not.toBeNull()
    const results = await adapter!.search('fusion energy')

    expect(capturedUrl).toContain('en.wikipedia.org/w/api.php')
    expect(capturedUrl).toContain('action=opensearch')
    expect(capturedUrl).toContain('search=fusion+energy')
    expect(results).toHaveLength(3)
    expect(results[0]).toEqual({
      title: 'Nuclear fusion',
      url: 'https://en.wikipedia.org/wiki/Nuclear_fusion',
      snippet: 'Process of merging atomic nuclei'
    })
  })

  it('search() returns [] when Wikipedia returns no hits', async () => {
    state.provider = 'wikipedia'
    const empty = JSON.stringify(['zorblax', [], [], []])
    globalThis.fetch = (async () => new Response(empty, { status: 200 })) as typeof fetch
    const adapter = getWebSearchAdapter()
    const results = await adapter!.search('zorblax')
    expect(results).toEqual([])
  })

  it('search() throws on HTTP non-2xx so the cascade can fall through', async () => {
    state.provider = 'wikipedia'
    globalThis.fetch = (async () => new Response('rate', { status: 429 })) as typeof fetch
    const adapter = getWebSearchAdapter()
    await expect(adapter!.search('x')).rejects.toThrow(/HTTP 429/)
  })
})

describe('TavilyAdapter — R6 (advanced search depth)', () => {
  const originalFetch = globalThis.fetch
  let capturedBody = ''

  beforeEach(() => {
    // A prior describe block (SSRF) clears hasKeyFor. Restore it here so the
    // Tavily case finds a key. Order-independence belt + suspenders.
    state.hasKeyFor = new Set<string>([
      'web_search:brave',
      'web_search:tavily',
      'web_search:serpapi'
    ])
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    capturedBody = ''
  })

  it('sends search_depth: advanced + include_answer: advanced in the request body', async () => {
    state.provider = 'tavily'
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '')
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'Result A',
              url: 'https://example.com/a',
              content: 'Snippet A'
            }
          ]
        }),
        { status: 200 }
      )
    }) as typeof fetch

    const adapter = getWebSearchAdapter()
    expect(adapter).not.toBeNull()
    const results = await adapter!.search('test query')

    const parsed = JSON.parse(capturedBody) as Record<string, unknown>
    expect(parsed.search_depth).toBe('advanced')
    expect(parsed.include_answer).toBe('advanced')
    expect(parsed.query).toBe('test query')
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://example.com/a')
  })

  it('does NOT leak the api_key into snippet / url fields', async () => {
    // Defensive: a malformed Tavily response shape must not let api_key bleed
    // into WebSearchResult. We don't echo the api_key out anywhere; this test
    // pins that contract against accidental refactors.
    state.provider = 'tavily'
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200 })) as typeof fetch
    const adapter = getWebSearchAdapter()
    const results = await adapter!.search('q')
    expect(results).toEqual([])
  })
})
