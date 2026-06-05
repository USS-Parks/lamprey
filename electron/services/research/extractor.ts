import { parse, type HTMLElement } from 'node-html-parser'
import { safeFetch } from '../url-safety'
import type { CuratedSource } from './collector'

// Readable-text extractor — turns a curated source's URL into a readable
// `{title, byline, published_at?, full_text, fetched_at, status}` record
// for the downstream claim-extraction stage.
//
// Strategy:
//   1. `safeFetch` HTML (cap MAX_FETCH_BYTES); skip on non-2xx or HTML
//      content-type mismatch (PDFs etc. are out of scope this phase).
//   2. `node-html-parser` to walk a lightweight DOM. We strip `<script>`,
//      `<style>`, `<nav>`, `<footer>`, `<aside>`, `<form>`, `<iframe>`,
//      `<noscript>`, common comment/ad/cookie blocks.
//   3. Pick the main content via priority order: `<article>`, `<main>`,
//      `[role="main"]`, then the largest text-bearing `<div>`/`<section>`
//      among top-level body children.
//   4. Extract title (prefer `<h1>` over `<title>` when both are present
//      and clearly different), byline (from `[rel="author"]`,
//      `<meta name="author">`, `.byline`, `.author`), published_at (from
//      `<time datetime>`, `<meta property="article:published_time">`).
//   5. Cap output text at MAX_RETURN_BYTES (30KB) — lower than web-tools.ts'
//      50KB so there's room for downstream context.
//
// Non-200, extraction-empty, or non-HTML content-type → `status: 'failed'`,
// downstream skips that source.
//
// Every outbound network call goes through `safeFetch` — the SSRF
// invariant from §2 must hold here too.

const FETCH_TIMEOUT_MS = 15_000
const MAX_FETCH_BYTES = 1_000_000 // 1 MB cap on fetched body
const MAX_RETURN_BYTES = 30_000   // 30 KB cap on extracted text

const BOILERPLATE_SELECTORS = [
  'script', 'style', 'noscript', 'nav', 'footer', 'aside', 'form',
  'iframe', 'svg', 'header[role="banner"]'
]

const BOILERPLATE_CLASS_PATTERNS = [
  /\bnav\b/i, /\bmenu\b/i, /\bfooter\b/i, /\bheader\b/i, /\bsidebar\b/i,
  /\bad(s|vert)?\b/i, /\bcookie/i, /\bnewsletter/i, /\bcomment(s)?\b/i,
  /\bshare/i, /\bsocial/i, /\bsubscribe/i, /\brelated/i, /\bpromo/i
]

export type ExtractStatus = 'ok' | 'failed' | 'aborted'

export interface ExtractedPage {
  /** Citation index — copied from CuratedSource.n. */
  n: number
  url: string
  status: ExtractStatus
  title: string
  byline?: string
  publishedAt?: string
  fullText: string
  fetchedAt: number
  /** Optional error message when status is 'failed'. */
  error?: string
}

export interface ExtractOpts {
  signal?: AbortSignal
  /** Test-only override for the HTTP fetch. */
  fetchFn?: (url: string, signal: AbortSignal) => Promise<{ ok: boolean; status: number; body: string; contentType: string | null }>
}

/**
 * Extract a single page. Never throws — failures land in the returned
 * status. Throwing would interrupt parallel extraction; the orchestrator
 * relies on per-page `status: 'failed'` to skip without aborting peers.
 */
export async function extractPage(
  source: CuratedSource,
  opts: ExtractOpts = {}
): Promise<ExtractedPage> {
  const fetchedAt = -1 // overwritten after a successful fetch
  if (opts.signal?.aborted) {
    return makeFailed(source, 'aborted', 'aborted before fetch')
  }
  let html: string
  let contentType: string | null = null
  let status: number
  try {
    if (opts.fetchFn) {
      const res = await opts.fetchFn(source.url, opts.signal ?? new AbortController().signal)
      if (!res.ok) return makeFailed(source, 'failed', `HTTP ${res.status}`)
      html = res.body
      contentType = res.contentType
      status = res.status
    } else {
      const result = await fetchHtml(source.url, opts.signal)
      if (!result.ok) return makeFailed(source, 'failed', result.error ?? 'fetch failed')
      html = result.body
      contentType = result.contentType
      status = result.status
    }
  } catch (err) {
    return makeFailed(source, 'failed', (err as Error).message ?? String(err))
  }
  void fetchedAt
  void status

  if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
    return makeFailed(source, 'failed', `unsupported content-type ${contentType}`)
  }

  if (opts.signal?.aborted) {
    return makeFailed(source, 'aborted', 'aborted after fetch')
  }

  let root: HTMLElement
  try {
    root = parse(html, { lowerCaseTagName: false, comment: false })
  } catch (err) {
    return makeFailed(source, 'failed', `parse error: ${(err as Error).message}`)
  }

  pruneBoilerplate(root)
  const { title, byline, publishedAt } = extractMeta(root)
  const main = pickMain(root)
  const fullText = capBytes(collectText(main), MAX_RETURN_BYTES)

  if (!fullText) {
    return makeFailed(source, 'failed', 'no extractable text after pruning')
  }

  return {
    n: source.n,
    url: source.url,
    status: 'ok',
    title: title || source.title || source.url,
    byline,
    publishedAt,
    fullText,
    fetchedAt: Date.now()
  }
}

function makeFailed(source: CuratedSource, status: 'failed' | 'aborted', error: string): ExtractedPage {
  return {
    n: source.n,
    url: source.url,
    status,
    title: source.title,
    fullText: '',
    fetchedAt: Date.now(),
    error
  }
}

interface FetchResult {
  ok: boolean
  status: number
  body: string
  contentType: string | null
  error?: string
}

async function fetchHtml(url: string, externalSignal?: AbortSignal): Promise<FetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const onExternalAbort = () => controller.abort()
  externalSignal?.addEventListener('abort', onExternalAbort)
  try {
    const res = await safeFetch(url, { signal: controller.signal })
    const contentType = res.headers.get('content-type')
    if (!res.ok) {
      return { ok: false, status: res.status, body: '', contentType, error: `HTTP ${res.status}` }
    }
    // Read up to MAX_FETCH_BYTES.
    const buffer = await readCappedBody(res, MAX_FETCH_BYTES)
    return { ok: true, status: res.status, body: buffer, contentType }
  } catch (err) {
    return { ok: false, status: 0, body: '', contentType: null, error: (err as Error).message ?? String(err) }
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

async function readCappedBody(res: Response, cap: number): Promise<string> {
  if (!res.body) return await res.text()
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let total = 0
  let out = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    out += decoder.decode(value, { stream: true })
    if (total >= cap) {
      try { await reader.cancel() } catch { /* ignore */ }
      break
    }
  }
  out += decoder.decode()
  return out
}

function pruneBoilerplate(root: HTMLElement): void {
  for (const sel of BOILERPLATE_SELECTORS) {
    root.querySelectorAll(sel).forEach((el) => el.remove())
  }
  // Class-based pruning: walk all elements and drop those whose class
  // matches a boilerplate pattern.
  const all = root.querySelectorAll('*')
  for (const el of all) {
    const cls = (el.getAttribute?.('class') ?? '').toString()
    const id = (el.getAttribute?.('id') ?? '').toString()
    const haystack = `${cls} ${id}`
    if (!haystack.trim()) continue
    if (BOILERPLATE_CLASS_PATTERNS.some((re) => re.test(haystack))) {
      el.remove()
    }
  }
}

function pickMain(root: HTMLElement): HTMLElement {
  const article = root.querySelector('article')
  if (article && nonTrivialText(article)) return article
  const main = root.querySelector('main')
  if (main && nonTrivialText(main)) return main
  const roleMain = root.querySelector('[role="main"]')
  if (roleMain && nonTrivialText(roleMain)) return roleMain
  // Fallback: among top-level body children, pick the largest text block.
  const body = root.querySelector('body') ?? root
  let best: HTMLElement = body
  let bestLen = textLength(body)
  for (const child of body.querySelectorAll('div, section')) {
    const len = textLength(child)
    if (len > bestLen) {
      best = child
      bestLen = len
    }
  }
  return best
}

function nonTrivialText(el: HTMLElement): boolean {
  return textLength(el) > 200
}

function textLength(el: HTMLElement): number {
  return (el.text ?? '').replace(/\s+/g, ' ').trim().length
}

function collectText(el: HTMLElement): string {
  const raw = (el.text ?? '').replace(/[ \t]+/g, ' ')
  // Collapse runs of newlines but preserve paragraph breaks.
  return raw.replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function extractMeta(root: HTMLElement): { title: string; byline?: string; publishedAt?: string } {
  let title = ''
  const h1 = root.querySelector('h1')
  if (h1) title = h1.text.trim()
  if (!title) {
    const titleEl = root.querySelector('title')
    if (titleEl) title = titleEl.text.trim()
  }
  if (!title) {
    const ogTitle = root.querySelector('meta[property="og:title"]')
    title = (ogTitle?.getAttribute('content') ?? '').trim()
  }

  let byline: string | undefined
  const authorMeta = root.querySelector('meta[name="author"]')
  byline = authorMeta?.getAttribute('content')?.trim()
  if (!byline) {
    const relAuthor = root.querySelector('[rel="author"]')
    byline = relAuthor?.text?.trim() || undefined
  }
  if (!byline) {
    const bylineEl = root.querySelector('.byline, .author, [itemprop="author"]')
    byline = bylineEl?.text?.trim() || undefined
  }
  if (byline && byline.length > 120) byline = byline.slice(0, 120)

  let publishedAt: string | undefined
  const time = root.querySelector('time[datetime]')
  publishedAt = time?.getAttribute('datetime')?.trim()
  if (!publishedAt) {
    const articleTime = root.querySelector('meta[property="article:published_time"]')
    publishedAt = articleTime?.getAttribute('content')?.trim()
  }

  return { title, byline, publishedAt }
}

function capBytes(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}…`
}

/**
 * Extract a batch of curated sources with bounded concurrency. Wraps
 * `extractPage` so the orchestrator (D10) has a one-shot entry point.
 */
export async function extractAll(
  sources: CuratedSource[],
  concurrency = 6,
  signal?: AbortSignal,
  fetchFn?: ExtractOpts['fetchFn']
): Promise<ExtractedPage[]> {
  const out: ExtractedPage[] = new Array(sources.length)
  let next = 0
  const runners = Array.from({ length: Math.min(concurrency, sources.length) }, async () => {
    while (true) {
      if (signal?.aborted) return
      const i = next++
      if (i >= sources.length) return
      out[i] = await extractPage(sources[i], { signal, fetchFn })
    }
  })
  await Promise.all(runners)
  return out.filter(Boolean)
}

export const _extractorInternals = {
  MAX_FETCH_BYTES,
  MAX_RETURN_BYTES,
  pruneBoilerplate,
  pickMain,
  extractMeta,
  collectText
}
