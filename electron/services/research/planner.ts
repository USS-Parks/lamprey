import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { chatOnce } from '../providers/registry'
import { readDeepResearchSettings } from './adapter-cascade'
import type { DepthTier } from './intent'

// Query planner — expands a research question into 3–8 sub-queries that
// span distinct angles (factual baseline, recent news, opposing view,
// comparative, technical deep-dive).
//
// One LLM call (cheap model). Strict JSON output. On malformed output,
// retries once with a tighter prompt; on the second failure, throws.
// Near-identical queries (Jaccard token overlap > 0.75) are deduped so
// the downstream collector doesn't waste a search call on a paraphrase.

export interface PlannedQuery {
  q: string
  angle: string
}

export interface PlanResult {
  queries: PlannedQuery[]
}

const DEFAULT_PLANNER_MODEL = 'deepseek-v4-flash'

const DEPTH_TARGET_COUNT: Record<DepthTier, number> = {
  quick: 3,
  standard: 5,
  exhaustive: 8
}

const PLANNER_SYSTEM_PROMPT = (target: number) =>
  `You are a research-query planner. Given a user's research question, you emit ${target} short web-search queries that cover distinct angles of the topic so a downstream pipeline can build a thorough, well-sourced answer.

Output STRICT JSON with this exact schema and no other text:
{
  "queries": [
    { "q": "search query text", "angle": "what this angle covers (3-6 words)" },
    ...
  ]
}

Each query MUST:
- be a real web-search query (3-8 words, no quotes, no operators unless they're load-bearing).
- target a DIFFERENT angle from every other query: factual baseline, recent developments / news, comparative / alternatives, opposing view / criticism, technical deep-dive, primary sources, expert opinion, statistical / quantitative data.
- be specific enough that a search engine will return relevant results; avoid vague single-word queries.

You MUST return exactly ${target} queries. Do not return more. Do not return fewer. Do not include any explanation outside the JSON.`

const RETRY_SUFFIX =
  '\n\nIMPORTANT: Your previous response was not valid JSON matching the schema. Return ONLY the JSON object, no prose, no markdown fences.'

export interface PlanQueriesDeps {
  callLlm?: (messages: ChatCompletionMessageParam[], model: string) => Promise<string>
}

/**
 * Plan sub-queries for a research question. Throws if the LLM fails to
 * produce valid JSON after one retry — callers should treat this as a
 * pipeline-stage error and surface it via the progress events.
 */
export async function planQueries(
  question: string,
  depth: DepthTier,
  modelOverride?: string,
  deps: PlanQueriesDeps = {}
): Promise<PlanResult> {
  const target = DEPTH_TARGET_COUNT[depth]
  const model = modelOverride ?? readDeepResearchSettings().classifierModel ?? DEFAULT_PLANNER_MODEL
  const call = deps.callLlm ?? ((m, mod) => chatOnce(m, mod))

  const baseMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: PLANNER_SYSTEM_PROMPT(target) },
    { role: 'user', content: question }
  ]

  let raw = await call(baseMessages, model)
  let parsed = parsePlannerOutput(raw)
  if (parsed === null) {
    // One retry with a tighter system prompt.
    const retryMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: PLANNER_SYSTEM_PROMPT(target) + RETRY_SUFFIX },
      { role: 'user', content: question }
    ]
    raw = await call(retryMessages, model)
    parsed = parsePlannerOutput(raw)
    if (parsed === null) {
      throw new Error('Planner failed to produce valid JSON after retry.')
    }
  }

  const deduped = dedupePlannedQueries(parsed.queries)
  return { queries: deduped.slice(0, target) }
}

/** Parse the LLM's JSON output. Tolerates leading/trailing prose. */
export function parsePlannerOutput(raw: string): PlanResult | null {
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
  if (!Array.isArray(p.queries)) return null
  const queries: PlannedQuery[] = []
  for (const item of p.queries) {
    if (typeof item !== 'object' || item === null) continue
    const q = (item as Record<string, unknown>).q
    const angle = (item as Record<string, unknown>).angle
    if (typeof q !== 'string' || !q.trim()) continue
    queries.push({
      q: q.trim(),
      angle: typeof angle === 'string' && angle ? angle.trim() : 'unspecified'
    })
  }
  if (queries.length === 0) return null
  return { queries }
}

/**
 * Drop queries that are near-duplicates by Jaccard token overlap. Keeps
 * the first occurrence in input order so the LLM's intended ordering is
 * preserved.
 */
export function dedupePlannedQueries(input: PlannedQuery[], threshold = 0.75): PlannedQuery[] {
  const kept: PlannedQuery[] = []
  for (const q of input) {
    const tokens = tokenize(q.q)
    const dup = kept.some((other) => jaccard(tokens, tokenize(other.q)) > threshold)
    if (!dup) kept.push(q)
  }
  return kept
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1)
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}
