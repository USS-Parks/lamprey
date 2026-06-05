import type { WebSearchResult } from '../web-search-adapters'
import type { PlannedQuery } from './planner'
import type { DepthTier } from './intent'
import {
  searchCascade,
  type CascadeOpts,
  type CascadeResult
} from './adapter-cascade'
import {
  canonicalUrl,
  dedupeByCanonicalUrl,
  registrableDomain
} from './url-canonicalize'

// Source collector — fans planner queries through the search cascade,
// dedupes, curates, ranks, and emits the top-N numbered sources for the
// downstream extractor + claims pipeline.
//
// Per the plan §2 invariants:
//   * pipeline is provider-agnostic — uses the cascade end-to-end
//   * dedup is by canonical URL (case-insensitive host, tracking params
//     dropped, trailing slash normalised)
//   * domain cap (≤ DEFAULT_DOMAIN_CAP = 3) per registrable domain so a
//     single publisher can't monopolise the result set
//   * spam-domain blocklist drops a conservative set of low-trust hosts
//     (false positives are worse than letting noise through, so the list
//     is tight)
//   * trust score boosts `.gov` / `.edu` and a small allowlist of known
//     major publishers; everything else is neutral
//
// Concurrency: planner queries are fanned out in parallel with a hard
// cap of CONCURRENCY (4) so a planner emitting 8 sub-queries doesn't
// burst against rate-limited providers. The cascade itself stops at the
// first non-empty provider per query unless `mergeAll: true`.

export interface CuratedSource {
  /** 1-based index used as the citation number throughout the pipeline. */
  n: number
  url: string
  /** Canonical form of the URL (used for dedup keys, never for display). */
  canonicalUrl: string
  title: string
  snippet: string
  registrableDomain: string
  trustScore: number
  /** Which planner query found this URL first. */
  sourceQuery: string
  sourceAngle: string
  /** Which provider returned this URL first. */
  provider: string
}

export interface CollectOpts {
  /** Hard ceiling on results per depth tier. Overrides the default map. */
  maxPerDepth?: Partial<Record<DepthTier, number>>
  /** Override the per-domain cap (default 3). */
  domainCap?: number
  /** Override the cascade options (e.g. force mergeAll for exhaustive). */
  cascadeOpts?: CascadeOpts
  /** AbortSignal — checked between queries and before result curation. */
  signal?: AbortSignal
  /** Test-only override for the search call. */
  searchFn?: (q: string, opts: CascadeOpts) => Promise<CascadeResult>
}

export interface CollectResult {
  sources: CuratedSource[]
  /** Provider IDs actually used across the fan-out. */
  providersUsed: string[]
  /** Number of raw results before dedup + curation. */
  rawCount: number
  errors: Array<{ query: string; error: string }>
}

const DEFAULT_DEPTH_CAP: Record<DepthTier, number> = {
  quick: 12,
  standard: 25,
  exhaustive: 50
}
const DEFAULT_DOMAIN_CAP = 3
const CONCURRENCY = 4

// Conservative spam-domain blocklist. Tight on purpose — false positives
// here drop legitimate sources. Add domains here only when they
// consistently produce AI-generated / low-quality content.
const SPAM_DOMAINS = new Set<string>([
  // Known low-content / aggregator / content-farm domains.
  'ezinearticles.com',
  'hubpages.com',
  'squidoo.com',
  'articlesbase.com',
  'buzzle.com',
  'webmd-spam.example'  // placeholder slot for future additions
])

// Major-publisher / canonical-source allowlist for trust boost. Kept
// small + curated; everything not on this list scores neutral and is
// neither boosted nor downweighted.
const TRUSTED_DOMAINS = new Set<string>([
  // Reference works
  'wikipedia.org', 'britannica.com', 'archive.org',
  // News (mixed perspectives intentionally)
  'reuters.com', 'apnews.com', 'bbc.co.uk', 'bbc.com', 'npr.org',
  'nytimes.com', 'wsj.com', 'washingtonpost.com', 'theguardian.com',
  'economist.com', 'ft.com', 'bloomberg.com',
  // Science / engineering primary
  'arxiv.org', 'nature.com', 'science.org', 'cell.com', 'pubmed.ncbi.nlm.nih.gov',
  'pnas.org', 'plos.org', 'springer.com', 'ieee.org', 'acm.org',
  // Reference docs
  'developer.mozilla.org', 'rfc-editor.org', 'tools.ietf.org', 'w3.org',
  // Tech industry mid-trust
  'arstechnica.com', 'techcrunch.com', 'theverge.com', 'wired.com'
])

function trustScoreFor(domain: string): number {
  if (domain.endsWith('.gov') || domain.endsWith('.gov.uk') || domain.endsWith('.gov.au')) return 3
  if (domain.endsWith('.edu') || domain.endsWith('.ac.uk') || domain.endsWith('.edu.au')) return 3
  if (TRUSTED_DOMAINS.has(domain)) return 2
  return 1
}

function isSpamDomain(domain: string): boolean {
  return SPAM_DOMAINS.has(domain)
}

interface RawHit {
  result: WebSearchResult
  query: string
  angle: string
  provider: string
}

async function runPool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
  signal?: AbortSignal
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      if (signal?.aborted) return
      const i = next++
      if (i >= items.length) return
      out[i] = await worker(items[i])
    }
  })
  await Promise.all(runners)
  return out
}

/**
 * Collect curated sources for the planner's queries. Returns the top-N
 * by depth tier, numbered 1..N for citation use downstream.
 */
export async function collectSources(
  planned: PlannedQuery[],
  depth: DepthTier,
  opts: CollectOpts = {}
): Promise<CollectResult> {
  const max = opts.maxPerDepth?.[depth] ?? DEFAULT_DEPTH_CAP[depth]
  const domainCap = opts.domainCap ?? DEFAULT_DOMAIN_CAP
  const cascadeOpts: CascadeOpts = { count: Math.min(15, max), ...opts.cascadeOpts }
  const searchFn = opts.searchFn ?? ((q, o) => searchCascade(q, o))
  const errors: Array<{ query: string; error: string }> = []
  const providersUsedSet = new Set<string>()

  // Fan out planner queries with bounded concurrency.
  const perQueryResults = await runPool(
    planned,
    async (pq) => {
      try {
        const r = await searchFn(pq.q, cascadeOpts)
        r.providersUsed.forEach((p) => providersUsedSet.add(p))
        if (r.errors.length > 0 && r.results.length === 0) {
          errors.push({ query: pq.q, error: r.errors.map((e) => `${e.provider}: ${e.error}`).join(' | ') })
        }
        const provider = r.providersUsed[0] ?? 'unknown'
        const hits: RawHit[] = r.results.map((res) => ({
          result: res,
          query: pq.q,
          angle: pq.angle,
          provider
        }))
        return hits
      } catch (err) {
        errors.push({ query: pq.q, error: (err as Error).message ?? String(err) })
        return []
      }
    },
    CONCURRENCY,
    opts.signal
  )

  if (opts.signal?.aborted) {
    return { sources: [], providersUsed: [], rawCount: 0, errors }
  }

  const allHits = perQueryResults.flat()
  const rawCount = allHits.length

  // Curate: spam filter → dedup by canonical URL → domain cap → rank.
  const filtered = allHits.filter((hit) => {
    if (!hit.result.url) return false
    const d = registrableDomain(hit.result.url)
    return !isSpamDomain(d)
  })

  // Dedup by canonical URL, keeping the highest-ranked occurrence per URL.
  const deduped = dedupeByCanonicalUrl(filtered.map((h) => ({ ...h, url: h.result.url })))
  const dedupedHits = deduped.map((d) => ({
    result: d.result,
    query: d.query,
    angle: d.angle,
    provider: d.provider
  }))

  // Enforce per-domain cap.
  const perDomain = new Map<string, number>()
  const capped: RawHit[] = []
  for (const h of dedupedHits) {
    const d = registrableDomain(h.result.url)
    const seen = perDomain.get(d) ?? 0
    if (seen >= domainCap) continue
    perDomain.set(d, seen + 1)
    capped.push(h)
  }

  // Rank by trust score (descending). Deterministic tiebreak by canonical
  // URL so test fixtures don't flake.
  const ranked = [...capped].sort((a, b) => {
    const ta = trustScoreFor(registrableDomain(a.result.url))
    const tb = trustScoreFor(registrableDomain(b.result.url))
    if (ta !== tb) return tb - ta
    return canonicalUrl(a.result.url).localeCompare(canonicalUrl(b.result.url))
  })

  // Truncate to depth-tier max, number from 1.
  const sources: CuratedSource[] = ranked.slice(0, max).map((h, i) => {
    const d = registrableDomain(h.result.url)
    return {
      n: i + 1,
      url: h.result.url,
      canonicalUrl: canonicalUrl(h.result.url),
      title: h.result.title,
      snippet: h.result.snippet,
      registrableDomain: d,
      trustScore: trustScoreFor(d),
      sourceQuery: h.query,
      sourceAngle: h.angle,
      provider: h.provider
    }
  })

  return {
    sources,
    providersUsed: Array.from(providersUsedSet),
    rawCount,
    errors
  }
}

export const _collectorInternals = {
  trustScoreFor,
  isSpamDomain,
  DEFAULT_DEPTH_CAP,
  DEFAULT_DOMAIN_CAP
}
