import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { chatOnce } from '../providers/registry'
import { readDeepResearchSettings } from './adapter-cascade'
import type { Claim } from './claims'
import type { CuratedSource } from './collector'

// Multi-source corroboration — clusters claims by semantic similarity and
// classifies each cluster as:
//   * `accepted`     — supported by ≥ 2 independent registrable domains.
//   * `singleSource` — supported by exactly 1 registrable domain.
//   * `disputed`     — two clusters that semantically contradict each
//                       other (detected by a small LLM call comparing
//                       candidate pairs).
//
// Independence is counted by **registrable domain**, not URL: two
// articles from sub-domains of the same publisher count once. This is
// the property that makes corroboration meaningful — agreement among
// outlets that owe their reporting to the same parent is not real
// agreement.
//
// Clustering is greedy + deterministic: claims are processed in input
// order; each joins the first existing cluster whose representative
// passes the cosine-similarity threshold (default 0.78), otherwise it
// seeds a new cluster. This is stable across runs without needing
// k-means random init.

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Float32Array[]>
}

export interface ClaimCluster {
  /** Stable cluster id — `c<index>`. */
  id: string
  /** First-joined claim, used as the cluster's representative. */
  representative: Claim
  /** All claims in the cluster (always includes the representative). */
  claims: Claim[]
  /** Unique registrable domains supporting this cluster. */
  supportingDomains: string[]
}

export interface DisputeGroup {
  a: ClaimCluster
  b: ClaimCluster
  reason: string
}

export interface ClaimSet {
  accepted: ClaimCluster[]
  singleSource: ClaimCluster[]
  disputed: DisputeGroup[]
}

export interface CorroborateOpts {
  /** Cosine similarity threshold for clustering. Default 0.78. */
  clusterThreshold?: number
  /** Maximum opposing-cluster pairs to ask the LLM about. Default 12. */
  maxOppositionPairs?: number
  /** Override the LLM model used for opposition detection. */
  modelOverride?: string
  /** Test override for the opposition LLM call. */
  callLlm?: (messages: ChatCompletionMessageParam[], model: string) => Promise<string>
  /** Abort signal. */
  signal?: AbortSignal
}

const DEFAULT_THRESHOLD = 0.78
const DEFAULT_MAX_OPPOSITION_PAIRS = 12
const DEFAULT_OPPOSITION_MODEL = 'deepseek-v4-flash'

const OPPOSITION_SYSTEM_PROMPT = `You decide whether two factual claims about the same topic CONTRADICT each other.

Output STRICT JSON with this exact schema and no other text:
{ "contradicts": boolean, "reason": "short explanation (under 25 words)" }

Two claims contradict each other if they cannot both be true at the same time given the same referent. They merely DIFFER if they are about different aspects of the same topic. They are CORROBORATING if they say the same thing in different words.

Examples:
- "X is 5 meters tall" vs "X is 3 meters tall" → contradicts: true
- "X is hard to build" vs "X is expensive" → contradicts: false (different facets)
- "X has been demonstrated" vs "X is purely theoretical" → contradicts: true
- "X consumes 100 W" vs "X consumes around 90 to 110 W" → contradicts: false (consistent ranges)`

/**
 * Public entry point. Embeds claims, clusters them, scores cluster
 * support by independent registrable domains, and (optionally) asks a
 * small LLM to flag opposing pairs as disputed. Returns a `ClaimSet`
 * partitioned into `accepted`, `singleSource`, and `disputed` buckets.
 */
export async function corroborate(
  claims: Claim[],
  sources: CuratedSource[],
  embeddings: EmbeddingProvider,
  opts: CorroborateOpts = {}
): Promise<ClaimSet> {
  if (claims.length === 0) return { accepted: [], singleSource: [], disputed: [] }

  const threshold = opts.clusterThreshold ?? DEFAULT_THRESHOLD
  const maxOpposition = opts.maxOppositionPairs ?? DEFAULT_MAX_OPPOSITION_PAIRS

  // Embed once.
  let vectors: Float32Array[]
  try {
    vectors = await embeddings.embed(claims.map((c) => c.text))
  } catch (err) {
    console.warn('[research/corroborator] embeddings unavailable; treating every claim as single-source:', (err as Error).message)
    // Fall back: every claim is its own cluster, all single-source.
    return fallbackEachClaimSingle(claims, sources)
  }

  if (vectors.length !== claims.length) {
    console.warn(`[research/corroborator] embedding count ${vectors.length} ≠ claims count ${claims.length}; falling back`)
    return fallbackEachClaimSingle(claims, sources)
  }

  // Normalize for cosine.
  const norms = vectors.map(normalize)

  // Greedy cluster.
  const clusters: ClaimCluster[] = []
  for (let i = 0; i < claims.length; i++) {
    if (opts.signal?.aborted) break
    let joined = false
    for (const c of clusters) {
      const repIdx = claims.indexOf(c.representative)
      if (repIdx < 0) continue
      const sim = cosine(norms[i], norms[repIdx])
      if (sim >= threshold) {
        c.claims.push(claims[i])
        joined = true
        break
      }
    }
    if (!joined) {
      clusters.push({
        id: `c${clusters.length}`,
        representative: claims[i],
        claims: [claims[i]]
      } as unknown as ClaimCluster) // supportingDomains assigned below
    }
  }

  // Score support by unique registrable domain.
  for (const c of clusters) {
    const domains = new Set<string>()
    for (const cl of c.claims) {
      const src = sources.find((s) => s.n === cl.source_n)
      if (src) domains.add(src.registrableDomain)
    }
    c.supportingDomains = Array.from(domains).sort()
  }

  // Partition.
  const accepted: ClaimCluster[] = []
  const singleSource: ClaimCluster[] = []
  for (const c of clusters) {
    if (c.supportingDomains.length >= 2) accepted.push(c)
    else singleSource.push(c)
  }

  // Detect disputes: pair the top clusters by support breadth, ask the
  // LLM on at most `maxOpposition` likely-opposing pairs. To filter the
  // pair space cheaply we require some token overlap so we don't ask
  // about clearly unrelated topics.
  const disputed: DisputeGroup[] = []
  if (clusters.length >= 2 && opts.callLlm !== undefined) {
    const candidatePairs = buildOppositionCandidates(clusters, maxOpposition)
    for (const [a, b] of candidatePairs) {
      if (opts.signal?.aborted) break
      const verdict = await askIfOpposed(a.representative.text, b.representative.text, opts)
      if (verdict?.contradicts) {
        disputed.push({ a, b, reason: verdict.reason })
      }
    }
  } else if (clusters.length >= 2 && opts.callLlm === undefined && !opts.modelOverride) {
    // Default-deps path: only do the opposition pass when the caller
    // explicitly opts in by providing a callLlm or a modelOverride. The
    // orchestrator (D10) wires the real chatOnce call.
  }

  // Remove disputed clusters from accepted/singleSource so a claim isn't
  // counted twice.
  const disputedIds = new Set<string>()
  for (const d of disputed) {
    disputedIds.add(d.a.id)
    disputedIds.add(d.b.id)
  }

  return {
    accepted: accepted.filter((c) => !disputedIds.has(c.id)),
    singleSource: singleSource.filter((c) => !disputedIds.has(c.id)),
    disputed
  }
}

/**
 * Variant that always runs the opposition pass when there are clusters
 * to compare. Wraps `corroborate` with the default chatOnce as the LLM
 * caller. The orchestrator (D10) uses this; tests use `corroborate`
 * directly with explicit mocks.
 */
export async function corroborateWithOpposition(
  claims: Claim[],
  sources: CuratedSource[],
  embeddings: EmbeddingProvider,
  opts: CorroborateOpts = {}
): Promise<ClaimSet> {
  const callLlm = opts.callLlm ?? ((m, mod) => chatOnce(m, mod))
  return corroborate(claims, sources, embeddings, { ...opts, callLlm })
}

// --------------------------------------------------------------------

function fallbackEachClaimSingle(claims: Claim[], sources: CuratedSource[]): ClaimSet {
  const singleSource = claims.map<ClaimCluster>((c, i) => ({
    id: `c${i}`,
    representative: c,
    claims: [c],
    supportingDomains: (() => {
      const src = sources.find((s) => s.n === c.source_n)
      return src ? [src.registrableDomain] : []
    })()
  }))
  return { accepted: [], singleSource, disputed: [] }
}

function normalize(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}

function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2)
  )
}

function tokenOverlap(a: string, b: string): number {
  const ta = tokenSet(a)
  const tb = tokenSet(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let n = 0
  for (const t of ta) if (tb.has(t)) n++
  return n / Math.min(ta.size, tb.size)
}

/**
 * Pick candidate cluster pairs to ask the LLM about. The clustering step
 * already separated paraphrases — two clusters in different buckets
 * means their embeddings disagreed despite (potentially) overlapping
 * tokens. So all this stage does is filter out pairs that share so few
 * tokens they aren't about the same topic at all, then rank by overlap
 * so the most-topical pairs go to the LLM first.
 */
export function buildOppositionCandidates(
  clusters: ClaimCluster[],
  cap: number
): Array<[ClaimCluster, ClaimCluster]> {
  const pairs: Array<{ a: ClaimCluster; b: ClaimCluster; score: number }> = []
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i]
      const b = clusters[j]
      const overlap = tokenOverlap(a.representative.text, b.representative.text)
      if (overlap < 0.15) continue
      pairs.push({ a, b, score: overlap })
    }
  }
  // Sort by overlap descending (more topical-overlap → more likely to
  // actually disagree on the same point) and take the top `cap`.
  pairs.sort((x, y) => y.score - x.score)
  return pairs.slice(0, cap).map((p) => [p.a, p.b])
}

interface OppositionVerdict {
  contradicts: boolean
  reason: string
}

async function askIfOpposed(
  textA: string,
  textB: string,
  opts: CorroborateOpts
): Promise<OppositionVerdict | null> {
  if (!opts.callLlm) return null
  const model = opts.modelOverride ?? readDeepResearchSettings().classifierModel ?? DEFAULT_OPPOSITION_MODEL
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: OPPOSITION_SYSTEM_PROMPT },
    { role: 'user', content: `Claim A: ${textA}\nClaim B: ${textB}` }
  ]
  let raw: string
  try {
    raw = await opts.callLlm(messages, model)
  } catch (err) {
    console.warn(`[research/corroborator] opposition LLM call failed: ${(err as Error).message}`)
    return null
  }
  return parseOppositionOutput(raw)
}

export function parseOppositionOutput(raw: string): OppositionVerdict | null {
  if (!raw) return null
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as Record<string, unknown>
  const contradicts = typeof p.contradicts === 'boolean' ? p.contradicts : false
  const reason = typeof p.reason === 'string' && p.reason ? p.reason : 'no reason given'
  return { contradicts, reason }
}

export const _corroboratorInternals = {
  DEFAULT_THRESHOLD,
  DEFAULT_MAX_OPPOSITION_PAIRS,
  cosine,
  normalize,
  tokenOverlap
}
