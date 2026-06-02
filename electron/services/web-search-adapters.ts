import { getKey, hasKey } from './keychain'
import { readSettings } from './settings-helper'

// Web search adapter framework. All adapters implement the same minimal
// interface so the executor in web-tools.ts and the settings UI stay
// provider-agnostic. Adding a new provider is one class + one factory branch.
// The factory reads settings.json to pick the active provider, reads the
// matching API key from the keychain, and returns null when either is missing
// so callers can emit a clean "configure me" error.
//
// Keychain provider naming convention: `web_search:<provider>`. The keychain
// is keyed by arbitrary strings (see electron/services/keychain.ts).

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

export type WebSearchProviderId = 'brave' | 'tavily' | 'serpapi' | 'searxng'

export interface WebToolsSettings {
  searchProvider: WebSearchProviderId
  searxngEndpoint?: string
}

const DEFAULT_SETTINGS: WebToolsSettings = {
  searchProvider: 'brave'
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
    return await fetch(url, { ...rest, signal: controller.signal })
  } finally {
    clearTimeout(timer)
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
      max_results
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
  { id: 'brave', label: 'Brave Search', requiresKey: true, requiresEndpoint: false },
  { id: 'tavily', label: 'Tavily', requiresKey: true, requiresEndpoint: false },
  { id: 'serpapi', label: 'SerpAPI', requiresKey: true, requiresEndpoint: false },
  { id: 'searxng', label: 'SearXNG', requiresKey: false, requiresEndpoint: true }
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
    default:
      return null
  }
}

/** True if the provider has a key (Brave/Tavily/SerpAPI) or an endpoint (SearXNG). */
export function isProviderConfigured(id: WebSearchProviderId): boolean {
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
