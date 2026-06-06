import { getKey, hasKey } from './keychain'
import { readSettings } from './settings-helper'
import { safeFetch } from './url-safety'

// Web search adapter framework. All adapters implement the same minimal
// interface so the executor in web-tools.ts and the settings UI stay
// provider-agnostic. Adding a new provider is one class + one factory branch.
// The factory reads settings.json to pick the active provider, reads the
// matching API key from the keychain, and returns null when either is missing
// so callers can emit a clean "configure me" error.
//
// Keychain provider naming convention: `web_search:<provider>`. The keychain
// is keyed by arbitrary strings (see electron/services/keychain.ts).
//
// SEC-2: every adapter call goes through `safeFetch` so loopback/RFC1918/
// link-local destinations are refused even when the user-configured SearXNG
// endpoint is internal, and 3xx redirects (e.g. a SerpAPI/Brave server
// hop) are re-validated rather than blindly followed.

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  date?: string
}

export interface ImageSearchResult {
  title: string
  thumbnail_url: string
  source_url: string
}

export interface WebSearchOpts {
  count?: number
  freshness?: 'day' | 'week' | 'month' | 'year'
}

export interface ImageSearchOpts {
  count?: number
}

export interface WebSearchAdapter {
  /** Stable id used in settings + keychain. */
  readonly id: WebSearchProviderId
  /** Human label for the UI. */
  readonly label: string
  search(query: string, opts?: WebSearchOpts): Promise<WebSearchResult[]>
  imageSearch?(query: string, opts?: ImageSearchOpts): Promise<ImageSearchResult[]>
}

export type WebSearchProviderId = 'duckduckgo' | 'brave' | 'tavily' | 'serpapi' | 'searxng' | 'wikipedia'

export interface WebToolsSettings {
  searchProvider: WebSearchProviderId
  searxngEndpoint?: string
}

// New installs default to DuckDuckGo (no API key required). Existing users
// who already saved a provider keep their choice — readWebToolsSettings()
// reads settings.json first and only falls back to this default if absent.
const DEFAULT_SETTINGS: WebToolsSettings = {
  searchProvider: 'duckduckgo'
}

const REQUEST_TIMEOUT_MS = 15_000

function freshnessToBraveCode(f?: WebSearchOpts['freshness']): string | undefined {
  switch (f) {
    case 'day':
      return 'pd'
    case 'week':
      return 'pw'
    case 'month':
      return 'pm'
    case 'year':
      return 'py'
    default:
      return undefined
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...rest } = init
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // SEC-2: safeFetch validates the URL and every redirect target through
    // assertPublicUrl before issuing the request. SearXNG endpoints pointing
    // at loopback / RFC1918, and SaaS adapters that redirect into an
    // internal IP, are both refused with a clean UnsafeUrlError.
    return await safeFetch(url, { ...rest, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ----------------------------------------------------------------------------
// DuckDuckGo adapter (no API key required)
// ----------------------------------------------------------------------------
//
// Hits the lightweight HTML endpoint at html.duckduckgo.com, which returns a
// static HTML SERP that we parse with a self-contained tag-extractor. No DOM
// library is pulled in — the markup is simple enough that two-stage regex is
// sufficient (and the parser is heavily unit-tested against pinned fixtures).
//
// Two selector strategies are tried in order so a single template change on
// DDG's side doesn't fully break the adapter:
//   1. The classic `result__a` / `result__snippet` / `result__url` blocks.
//   2. A fallback that walks every `<a class="result__a">` and finds the
//      nearest snippet text node.
//
// If both yield zero results, the adapter returns `[]` (downstream cascade
// will fall through to the next configured provider). It never throws on
// "empty SERP" — only on network errors or HTTP non-2xx.

const DDG_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/'

function freshnessToDdg(f?: WebSearchOpts['freshness']): string | undefined {
  switch (f) {
    case 'day':
      return 'd'
    case 'week':
      return 'w'
    case 'month':
      return 'm'
    case 'year':
      return 'y'
    default:
      return undefined
  }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(parseInt(code, 10)))
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, '')).trim()
}

function unwrapDdgRedirect(href: string): string {
  // DDG wraps result URLs as `//duckduckgo.com/l/?uddg=<encoded>&...` or
  // `/l/?uddg=<encoded>&...`. Strip the wrapper if present.
  try {
    const trimmed = href.startsWith('//') ? `https:${href}` : href.startsWith('/l/') ? `https://duckduckgo.com${href}` : href
    const url = new URL(trimmed)
    if (url.hostname.endsWith('duckduckgo.com') && url.pathname === '/l/') {
      const uddg = url.searchParams.get('uddg')
      if (uddg) return decodeURIComponent(uddg)
    }
    return trimmed
  } catch {
    return href
  }
}

/**
 * Parse a DuckDuckGo HTML SERP into search results. Exported so the unit
 * tests (and any future debugging) can exercise the parser without hitting
 * the network.
 *
 * Strategy: walk every `<a class="result__a">` anchor in document order;
 * each anchor carries the result title + href. For the snippet, look ahead
 * up to 1.2 KB for the nearest `result__snippet`-classed element. This is
 * resilient to template revisions because it doesn't depend on a particular
 * containing-div structure — the classic SERP and the lite-template SERP
 * both use the `result__a` anchor.
 */
export function parseDuckDuckGoHtml(html: string, max: number): WebSearchResult[] {
  const out: WebSearchResult[] = []
  const anchorRe = /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = anchorRe.exec(html)) !== null && out.length < max) {
    const url = unwrapDdgRedirect(decodeHtmlEntities(m[1]))
    const title = stripTags(m[2])
    if (!url || !title) continue
    // Look ahead up to ~1.2KB for the nearest snippet. Accept either an
    // <a>, <div>, or <span> element carrying the `result__snippet` class.
    const start = m.index + m[0].length
    const tail = html.slice(start, start + 1200)
    const snippetMatch = tail.match(
      /<(?:a|div|span)\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/
    )
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : ''
    out.push({ title, url, snippet })
  }
  return out
}

class DuckDuckGoAdapter implements WebSearchAdapter {
  readonly id = 'duckduckgo' as const
  readonly label = 'DuckDuckGo'

  async search(query: string, opts: WebSearchOpts = {}): Promise<WebSearchResult[]> {
    const count = Math.max(1, Math.min(30, opts.count ?? 10))
    const params = new URLSearchParams({ q: query })
    const df = freshnessToDdg(opts.freshness)
    if (df) params.set('df', df)

    const res = await fetchWithTimeout(DDG_HTML_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml',
        // DDG returns a much simpler markup for common UA strings. Use a
        // generic desktop UA so we get parseable HTML rather than the JS
        // single-page-app shell.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      },
      body: params.toString()
    })
    if (!res.ok) {
      throw new Error(`DuckDuckGo HTTP ${res.status}: ${await safeReadText(res)}`)
    }
    const html = await res.text()
    return parseDuckDuckGoHtml(html, count)
  }
}

// ----------------------------------------------------------------------------
// Brave Search adapter
// ----------------------------------------------------------------------------

class BraveAdapter implements WebSearchAdapter {
  readonly id = 'brave' as const
  readonly label = 'Brave Search'

  constructor(private readonly apiKey: string) {}

  async search(query: string, opts: WebSearchOpts = {}): Promise<WebSearchResult[]> {
    const count = Math.max(1, Math.min(10, opts.count ?? 5))
    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', query)
    url.searchParams.set('count', String(count))
    const freshness = freshnessToBraveCode(opts.freshness)
    if (freshness) url.searchParams.set('freshness', freshness)

    const res = await fetchWithTimeout(url.toString(), {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.apiKey
      }
    })
    if (!res.ok) {
      throw new Error(`Brave search HTTP ${res.status}: ${await safeReadText(res)}`)
    }
    const json = (await res.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> }
    }
    const list = json.web?.results ?? []
    return list.map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.description ?? '',
      date: r.age
    }))
  }

  async imageSearch(query: string, opts: ImageSearchOpts = {}): Promise<ImageSearchResult[]> {
    const count = Math.max(1, Math.min(10, opts.count ?? 5))
    const url = new URL('https://api.search.brave.com/res/v1/images/search')
    url.searchParams.set('q', query)
    url.searchParams.set('count', String(count))

    const res = await fetchWithTimeout(url.toString(), {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.apiKey
      }
    })
    if (!res.ok) {
      throw new Error(`Brave image search HTTP ${res.status}: ${await safeReadText(res)}`)
    }
    const json = (await res.json()) as {
      results?: Array<{
        title?: string
        url?: string
        thumbnail?: { src?: string }
        properties?: { url?: string }
      }>
    }
    const list = json.results ?? []
    return list.map((r) => ({
      title: r.title ?? '',
      thumbnail_url: r.thumbnail?.src ?? r.properties?.url ?? '',
      source_url: r.url ?? ''
    }))
  }
}

// ----------------------------------------------------------------------------
// Tavily adapter
// ----------------------------------------------------------------------------

class TavilyAdapter implements WebSearchAdapter {
  readonly id = 'tavily' as const
  readonly label = 'Tavily'

  constructor(private readonly apiKey: string) {}

  async search(query: string, opts: WebSearchOpts = {}): Promise<WebSearchResult[]> {
    const max_results = Math.max(1, Math.min(10, opts.count ?? 5))
    const body: Record<string, unknown> = {
      api_key: this.apiKey,
      query,
      max_results,
      // R6 — `advanced` returns ranked, deduped, content-clean results that are
      // higher quality for research-grade citation work. Costs 2 credits per
      // call instead of 1 (basic); worth it for the deep-research cascade
      // since downstream readers depend on the snippet being substantive.
      search_depth: 'advanced',
      // `include_answer: 'advanced'` adds a synthesized answer paragraph in
      // the response. We don't use it (the orchestrator runs its own
      // synthesizer), but enabling it doesn't cost extra credits and keeps
      // the API response shape consistent with what the user expects from
      // the Tavily web console.
      include_answer: 'advanced'
    }
    // Tavily accepts time_range when supplied; map common freshness windows.
    if (opts.freshness) {
      body.time_range = opts.freshness === 'day' ? 'd' :
                        opts.freshness === 'week' ? 'w' :
                        opts.freshness === 'month' ? 'm' : 'y'
    }

    const res = await fetchWithTimeout('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      throw new Error(`Tavily HTTP ${res.status}: ${await safeReadText(res)}`)
    }
    const json = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string; published_date?: string }>
    }
    return (json.results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.content ?? '',
      date: r.published_date
    }))
  }

  async imageSearch(query: string, opts: ImageSearchOpts = {}): Promise<ImageSearchResult[]> {
    const max_results = Math.max(1, Math.min(10, opts.count ?? 5))
    const body = {
      api_key: this.apiKey,
      query,
      max_results,
      include_images: true,
      include_image_descriptions: true
    }
    const res = await fetchWithTimeout('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      throw new Error(`Tavily image HTTP ${res.status}: ${await safeReadText(res)}`)
    }
    const json = (await res.json()) as {
      images?: Array<string | { url?: string; description?: string }>
    }
    const raw = json.images ?? []
    return raw.slice(0, max_results).map((img) => {
      if (typeof img === 'string') {
        return { title: query, thumbnail_url: img, source_url: img }
      }
      return {
        title: img.description ?? query,
        thumbnail_url: img.url ?? '',
        source_url: img.url ?? ''
      }
    })
  }
}

// ----------------------------------------------------------------------------
// SerpAPI adapter (Google engine)
// ----------------------------------------------------------------------------

class SerpApiAdapter implements WebSearchAdapter {
  readonly id = 'serpapi' as const
  readonly label = 'SerpAPI'

  constructor(private readonly apiKey: string) {}

  async search(query: string, opts: WebSearchOpts = {}): Promise<WebSearchResult[]> {
    const num = Math.max(1, Math.min(10, opts.count ?? 5))
    const url = new URL('https://serpapi.com/search.json')
    url.searchParams.set('engine', 'google')
    url.searchParams.set('q', query)
    url.searchParams.set('num', String(num))
    url.searchParams.set('api_key', this.apiKey)
    if (opts.freshness) {
      // tbs=qdr:[d|w|m|y]
      const code = opts.freshness === 'day' ? 'd' :
                   opts.freshness === 'week' ? 'w' :
                   opts.freshness === 'month' ? 'm' : 'y'
      url.searchParams.set('tbs', `qdr:${code}`)
    }

    const res = await fetchWithTimeout(url.toString(), {
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) {
      throw new Error(`SerpAPI HTTP ${res.status}: ${await safeReadText(res)}`)
    }
    const json = (await res.json()) as {
      organic_results?: Array<{ title?: string; link?: string; snippet?: string; date?: string }>
    }
    return (json.organic_results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.link ?? '',
      snippet: r.snippet ?? '',
      date: r.date
    }))
  }

  async imageSearch(query: string, opts: ImageSearchOpts = {}): Promise<ImageSearchResult[]> {
    const num = Math.max(1, Math.min(10, opts.count ?? 5))
    const url = new URL('https://serpapi.com/search.json')
    url.searchParams.set('engine', 'google_images')
    url.searchParams.set('q', query)
    url.searchParams.set('num', String(num))
    url.searchParams.set('api_key', this.apiKey)

    const res = await fetchWithTimeout(url.toString(), {
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) {
      throw new Error(`SerpAPI images HTTP ${res.status}: ${await safeReadText(res)}`)
    }
    const json = (await res.json()) as {
      images_results?: Array<{
        title?: string
        thumbnail?: string
        original?: string
        link?: string
      }>
    }
    return (json.images_results ?? []).slice(0, num).map((r) => ({
      title: r.title ?? '',
      thumbnail_url: r.thumbnail ?? '',
      source_url: r.original ?? r.link ?? ''
    }))
  }
}

// ----------------------------------------------------------------------------
// SearXNG adapter (no key required, user-configured endpoint)
// ----------------------------------------------------------------------------

class SearxngAdapter implements WebSearchAdapter {
  readonly id = 'searxng' as const
  readonly label = 'SearXNG'

  constructor(private readonly endpoint: string) {
    // Normalize trailing slash.
    this.endpoint = endpoint.replace(/\/+$/, '')
  }

  async search(query: string, opts: WebSearchOpts = {}): Promise<WebSearchResult[]> {
    const count = Math.max(1, Math.min(10, opts.count ?? 5))
    const url = new URL(`${this.endpoint}/search`)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    if (opts.freshness) {
      const range = opts.freshness === 'day' ? 'day' :
                    opts.freshness === 'week' ? 'week' :
                    opts.freshness === 'month' ? 'month' : 'year'
      url.searchParams.set('time_range', range)
    }

    const res = await fetchWithTimeout(url.toString(), {
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) {
      throw new Error(`SearXNG HTTP ${res.status}: ${await safeReadText(res)}`)
    }
    const json = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string; publishedDate?: string }>
    }
    return (json.results ?? []).slice(0, count).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.content ?? '',
      date: r.publishedDate
    }))
  }

  async imageSearch(query: string, opts: ImageSearchOpts = {}): Promise<ImageSearchResult[]> {
    const count = Math.max(1, Math.min(10, opts.count ?? 5))
    const url = new URL(`${this.endpoint}/search`)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('categories', 'images')

    const res = await fetchWithTimeout(url.toString(), {
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) {
      throw new Error(`SearXNG images HTTP ${res.status}: ${await safeReadText(res)}`)
    }
    const json = (await res.json()) as {
      results?: Array<{
        title?: string
        img_src?: string
        thumbnail_src?: string
        thumbnail?: string
        url?: string
      }>
    }
    return (json.results ?? []).slice(0, count).map((r) => ({
      title: r.title ?? '',
      thumbnail_url: r.thumbnail_src ?? r.thumbnail ?? r.img_src ?? '',
      source_url: r.url ?? r.img_src ?? ''
    }))
  }
}

// ----------------------------------------------------------------------------
// Wikipedia adapter (no API key required, no scraping)
// ----------------------------------------------------------------------------
//
// Hits Wikipedia's stable OpenSearch REST API (an established machine-readable
// endpoint, NOT HTML scraping): `https://en.wikipedia.org/w/api.php?action=opensearch`
// Returns an array of the form [query, titles[], descriptions[], urls[]] which
// we project into WebSearchResult[]. The endpoint is rate-limited but generous
// (~200 req/s) and has been stable for years — exactly the kind of zero-key
// floor the deep-research cascade needs after the DDG HTML endpoint regressed.

const WIKIPEDIA_OPENSEARCH_ENDPOINT = 'https://en.wikipedia.org/w/api.php'

class WikipediaAdapter implements WebSearchAdapter {
  readonly id = 'wikipedia' as const
  readonly label = 'Wikipedia'

  async search(query: string, opts: WebSearchOpts = {}): Promise<WebSearchResult[]> {
    const limit = Math.max(1, Math.min(50, opts.count ?? 10))
    const params = new URLSearchParams({
      action: 'opensearch',
      search: query,
      limit: String(limit),
      namespace: '0',
      format: 'json',
      origin: '*'
    })
    const url = `${WIKIPEDIA_OPENSEARCH_ENDPOINT}?${params.toString()}`
    const res = await fetchWithTimeout(url, {
      headers: {
        Accept: 'application/json',
        // Wikipedia asks API consumers to identify themselves. Generic UA
        // is fine; the policy is about contact info, not browser-spoofing.
        'User-Agent':
          'Lamprey-Harness/0.7 (https://github.com/USS-Parks/lamprey; research-cascade)'
      }
    })
    if (!res.ok) {
      throw new Error(`Wikipedia HTTP ${res.status}: ${await safeReadText(res)}`)
    }
    const json = (await res.json()) as [string, string[], string[], string[]]
    // OpenSearch contract: [query, titles, descriptions, urls]. We do NOT
    // trust the array shape — defensive null-checks in case the schema ever
    // changes (it hasn't in the API's lifetime, but cheap insurance).
    if (!Array.isArray(json) || json.length < 4) return []
    const titles = json[1] ?? []
    const descriptions = json[2] ?? []
    const urls = json[3] ?? []
    const out: WebSearchResult[] = []
    for (let i = 0; i < titles.length; i++) {
      const title = titles[i]
      const url = urls[i]
      if (!title || !url) continue
      out.push({
        title,
        url,
        snippet: descriptions[i] ?? ''
      })
    }
    return out
  }
}

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

export function readWebToolsSettings(): WebToolsSettings {
  const all = readSettings()
  const raw = (all.webTools as Partial<WebToolsSettings> | undefined) ?? {}
  const provider = raw.searchProvider ?? DEFAULT_SETTINGS.searchProvider
  return {
    searchProvider: provider,
    searxngEndpoint: raw.searxngEndpoint
  }
}

export const ALL_WEB_SEARCH_PROVIDERS: ReadonlyArray<{
  id: WebSearchProviderId
  label: string
  requiresKey: boolean
  requiresEndpoint: boolean
}> = [
  { id: 'duckduckgo', label: 'DuckDuckGo · no key required (unreliable)', requiresKey: false, requiresEndpoint: false },
  { id: 'brave', label: 'Brave Search', requiresKey: true, requiresEndpoint: false },
  { id: 'tavily', label: 'Tavily', requiresKey: true, requiresEndpoint: false },
  { id: 'serpapi', label: 'SerpAPI', requiresKey: true, requiresEndpoint: false },
  { id: 'searxng', label: 'SearXNG', requiresKey: false, requiresEndpoint: true },
  { id: 'wikipedia', label: 'Wikipedia · no key required', requiresKey: false, requiresEndpoint: false }
]

export function keychainProviderFor(id: WebSearchProviderId): string {
  return `web_search:${id}`
}

/**
 * Build the configured adapter, or return null if the active provider is not
 * fully configured (missing key / missing endpoint). Callers should emit a
 * clean "configure me" error in that case.
 */
export function getWebSearchAdapter(): WebSearchAdapter | null {
  const settings = readWebToolsSettings()
  const provider = settings.searchProvider

  switch (provider) {
    case 'duckduckgo': {
      return new DuckDuckGoAdapter()
    }
    case 'brave': {
      const key = getKey(keychainProviderFor('brave'))
      if (!key) return null
      return new BraveAdapter(key)
    }
    case 'tavily': {
      const key = getKey(keychainProviderFor('tavily'))
      if (!key) return null
      return new TavilyAdapter(key)
    }
    case 'serpapi': {
      const key = getKey(keychainProviderFor('serpapi'))
      if (!key) return null
      return new SerpApiAdapter(key)
    }
    case 'searxng': {
      const endpoint = settings.searxngEndpoint?.trim()
      if (!endpoint) return null
      return new SearxngAdapter(endpoint)
    }
    case 'wikipedia':
      return new WikipediaAdapter()
    default:
      return null
  }
}

/**
 * Build a specific adapter by id, regardless of which provider is currently
 * "active" in settings. Used by the deep-research cascade (D2) to try a
 * declared list of providers in order. Returns null when the requested
 * provider is not fully configured (missing key / endpoint).
 */
export function getWebSearchAdapterById(id: WebSearchProviderId): WebSearchAdapter | null {
  switch (id) {
    case 'duckduckgo':
      return new DuckDuckGoAdapter()
    case 'brave': {
      const key = getKey(keychainProviderFor('brave'))
      return key ? new BraveAdapter(key) : null
    }
    case 'tavily': {
      const key = getKey(keychainProviderFor('tavily'))
      return key ? new TavilyAdapter(key) : null
    }
    case 'serpapi': {
      const key = getKey(keychainProviderFor('serpapi'))
      return key ? new SerpApiAdapter(key) : null
    }
    case 'searxng': {
      const endpoint = readWebToolsSettings().searxngEndpoint?.trim()
      return endpoint ? new SearxngAdapter(endpoint) : null
    }
    case 'wikipedia':
      return new WikipediaAdapter()
    default:
      return null
  }
}

/** True if the provider has a key (Brave/Tavily/SerpAPI), an endpoint (SearXNG),
 *  or is unconditionally available (DDG, Wikipedia). */
export function isProviderConfigured(id: WebSearchProviderId): boolean {
  if (id === 'duckduckgo' || id === 'wikipedia') return true
  if (id === 'searxng') {
    return Boolean(readWebToolsSettings().searxngEndpoint?.trim())
  }
  return hasKey(keychainProviderFor(id))
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text.slice(0, 200)
  } catch {
    return '<no body>'
  }
}
