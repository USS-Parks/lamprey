import {
  getWebSearchAdapter,
  type WebSearchOpts,
  type ImageSearchOpts
} from './web-search-adapters'

// Web/current-information tool executors. Pure - no electron imports. The
// registry wiring lives in web-tool-pack.ts. Permission gating is
// descriptor-driven; the network-touching tools carry the `network` risk and
// `requiresApproval: false` (read-only), so they run without a modal -
// matching the Codex/Claude default for web search.

const NO_PROVIDER_MSG =
  'Error: No web search provider configured. Use Settings → Web Tools.'

const FETCH_TIMEOUT_MS = 15_000
const MAX_FETCH_BYTES = 1_000_000 // 1 MB cap on response body
const MAX_RETURN_BYTES = 50_000   // 50 KB cap on returned text
const PAGE_CACHE_CAP = 10

interface CachedPage {
  url: string
  title: string
  text: string
  fetchedAt: number
}

// Simple Map-based LRU. Iteration order = insertion order; promoting an entry
// is delete + set.
class LruPageCache {
  private map = new Map<string, CachedPage>()

  get(url: string): CachedPage | undefined {
    const entry = this.map.get(url)
    if (!entry) return undefined
    // Promote.
    this.map.delete(url)
    this.map.set(url, entry)
    return entry
  }

  set(url: string, page: CachedPage): void {
    if (this.map.has(url)) this.map.delete(url)
    this.map.set(url, page)
    while (this.map.size > PAGE_CACHE_CAP) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  list(): CachedPage[] {
    return Array.from(this.map.values())
  }

  clear(): void {
    this.map.clear()
  }
}

const pageCache = new LruPageCache()

// ----------------------------------------------------------------------------
// HTML sanitization helpers
// ----------------------------------------------------------------------------

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' '
}

function decodeHtmlEntities(s: string): string {
  let out = s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => HTML_ENTITY_MAP[m] ?? m)
  // Numeric entities (decimal and hex).
  out = out.replace(/&#(\d+);/g, (_, code) => {
    const n = parseInt(code, 10)
    return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : ''
  })
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => {
    const n = parseInt(code, 16)
    return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : ''
  })
  return out
}

/**
 * Minimal HTML-to-text. Drops <script>/<style>, removes all tags, decodes
 * common entities, collapses whitespace. Good enough for "give the model
 * something to read" — not a full DOM parser.
 *
 * Exported for testing and reuse by web_find when the cache is empty and
 * we need to do a fresh fetch through web_open.
 */
export function stripHtmlToText(html: string): string {
  let s = html
  s = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
  // Preserve some structure: turn block-level closing tags into newlines.
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|br|article|section)\s*>/gi, '\n')
  s = s.replace(/<br\s*\/?\s*>/gi, '\n')
  // Strip remaining tags.
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeHtmlEntities(s)
  // Collapse runs of spaces/tabs but preserve newlines.
  s = s.replace(/[ \t]+/g, ' ')
  s = s.replace(/\n[ \t]+/g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

function extractTitle(html: string, fallbackUrl: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch?.[1]) {
    return decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim()
  }
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1Match?.[1]) {
    return stripHtmlToText(h1Match[1]).slice(0, 200)
  }
  return fallbackUrl
}

async function fetchPageBytes(url: string): Promise<{ html: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Lamprey/1.0 (+web_open)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }

    // Read up to MAX_FETCH_BYTES. The Web stream reader is the simplest way to
    // do this portably in Node 22.
    const reader = res.body?.getReader()
    if (!reader) {
      const text = await res.text()
      return { html: text.slice(0, MAX_FETCH_BYTES) }
    }
    const chunks: Uint8Array[] = []
    let received = 0
    while (received < MAX_FETCH_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(value)
      received += value.length
    }
    try {
      await reader.cancel()
    } catch {
      /* ignore */
    }
    const merged = new Uint8Array(Math.min(received, MAX_FETCH_BYTES))
    let off = 0
    for (const c of chunks) {
      const need = merged.length - off
      if (need <= 0) break
      const slice = c.subarray(0, Math.min(c.length, need))
      merged.set(slice, off)
      off += slice.length
    }
    const html = new TextDecoder('utf-8', { fatal: false }).decode(merged)
    return { html }
  } finally {
    clearTimeout(timer)
  }
}

// ----------------------------------------------------------------------------
// Tool executors
// ----------------------------------------------------------------------------

export interface WebSearchArgs {
  query: string
  count?: number
  freshness?: WebSearchOpts['freshness']
}

export async function executeWebSearch(args: WebSearchArgs): Promise<string> {
  if (!args?.query || typeof args.query !== 'string') {
    return 'Error: web_search requires a `query` string.'
  }
  const adapter = getWebSearchAdapter()
  if (!adapter) return NO_PROVIDER_MSG

  const count = clampCount(args.count, 5, 10)
  try {
    const results = await adapter.search(args.query, {
      count,
      freshness: args.freshness
    })
    if (!results.length) {
      return `No results from ${adapter.label} for: ${args.query}`
    }
    return results
      .map((r, i) => {
        const lines = [`${i + 1}. ${r.title || '(untitled)'}`, `   ${r.url}`]
        if (r.snippet) lines.push(`   ${r.snippet.replace(/\s+/g, ' ').trim()}`)
        if (r.date) lines.push(`   (${r.date})`)
        return lines.join('\n')
      })
      .join('\n\n')
  } catch (err) {
    return `Error: ${adapter.label} search failed — ${(err as Error).message}`
  }
}

export interface WebOpenArgs {
  url: string
  as?: 'text' | 'markdown'
}

export async function executeWebOpen(args: WebOpenArgs): Promise<string> {
  if (!args?.url || typeof args.url !== 'string') {
    return 'Error: web_open requires a `url` string.'
  }
  let parsed: URL
  try {
    parsed = new URL(args.url)
  } catch {
    return `Error: invalid URL — ${args.url}`
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Error: only http/https URLs are supported (got ${parsed.protocol})`
  }

  try {
    const { html } = await fetchPageBytes(args.url)
    const title = extractTitle(html, args.url)
    const text = stripHtmlToText(html)
    pageCache.set(args.url, {
      url: args.url,
      title,
      text,
      fetchedAt: Date.now()
    })
    const capped =
      text.length > MAX_RETURN_BYTES
        ? text.slice(0, MAX_RETURN_BYTES) +
          `\n\n[truncated — ${text.length - MAX_RETURN_BYTES} more chars; use web_find to search the full body]`
        : text
    return `${title}\n${args.url}\n\n${capped}`
  } catch (err) {
    return `Error: web_open failed — ${(err as Error).message}`
  }
}

export interface WebFindArgs {
  url: string
  text: string
  case_sensitive?: boolean
}

export async function executeWebFind(args: WebFindArgs): Promise<string> {
  if (!args?.url || !args?.text) {
    return 'Error: web_find requires `url` and `text` arguments.'
  }
  let entry = pageCache.get(args.url)
  if (!entry) {
    // Populate cache by calling web_open. The returned string is discarded —
    // we only need the side effect of caching.
    const openResult = await executeWebOpen({ url: args.url })
    entry = pageCache.get(args.url)
    if (!entry) {
      return `Error: could not fetch ${args.url} — ${openResult.slice(0, 200)}`
    }
  }

  const needle = args.case_sensitive ? args.text : args.text.toLowerCase()
  const lines = entry.text.split('\n')
  const matches: string[] = []
  for (let i = 0; i < lines.length && matches.length < 5; i++) {
    const hay = args.case_sensitive ? lines[i] : lines[i].toLowerCase()
    if (hay.includes(needle)) {
      const before = i > 0 ? lines[i - 1] : ''
      const after = i < lines.length - 1 ? lines[i + 1] : ''
      const ctx = [before, `>>> ${lines[i]}`, after]
        .filter((l) => l.trim() !== '')
        .join('\n')
      matches.push(`Line ${i + 1}:\n${ctx}`)
    }
  }

  if (!matches.length) {
    return `No matches for "${args.text}" in ${entry.title} (${args.url})`
  }
  return `${matches.length} match${matches.length === 1 ? '' : 'es'} for "${args.text}" in ${entry.title} (${args.url}):\n\n${matches.join('\n\n')}`
}

export interface ImageSearchArgs {
  query: string
  count?: number
}

export async function executeImageSearch(args: ImageSearchArgs): Promise<string> {
  if (!args?.query || typeof args.query !== 'string') {
    return 'Error: image_search requires a `query` string.'
  }
  const adapter = getWebSearchAdapter()
  if (!adapter) return NO_PROVIDER_MSG
  if (!adapter.imageSearch) {
    return `Error: ${adapter.label} does not support image search.`
  }

  const count = clampCount(args.count, 5, 10)
  try {
    const results = await adapter.imageSearch(args.query, {
      count
    } as ImageSearchOpts)
    if (!results.length) {
      return `No image results from ${adapter.label} for: ${args.query}`
    }
    return results
      .map((r, i) =>
        [
          `${i + 1}. ${r.title || '(untitled)'}`,
          `   thumbnail: ${r.thumbnail_url}`,
          `   source: ${r.source_url}`
        ].join('\n')
      )
      .join('\n\n')
  } catch (err) {
    return `Error: ${adapter.label} image search failed — ${(err as Error).message}`
  }
}

export interface TimeLookupArgs {
  timezone?: string
}

export async function executeTimeLookup(args: TimeLookupArgs): Promise<string> {
  const tz = args?.timezone?.trim() || 'UTC'
  try {
    const fmt = new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short'
    })
    const now = new Date()
    return `${fmt.format(now)} (${tz})`
  } catch (err) {
    return `Error: invalid timezone "${tz}" — ${(err as Error).message}`
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function clampCount(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(1, Math.min(max, Math.floor(n)))
}

// Exposed for adapter-testing IPC.
export async function probeAdapter(): Promise<{ ok: boolean; error?: string }> {
  const adapter = getWebSearchAdapter()
  if (!adapter) {
    return { ok: false, error: 'No web search provider configured.' }
  }
  try {
    const results = await adapter.search('hello world', { count: 1 })
    if (!results.length) {
      return { ok: false, error: `${adapter.label} returned no results.` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// Test-only: clear the page cache. Not exported through IPC.
export function _clearPageCacheForTest(): void {
  pageCache.clear()
}
