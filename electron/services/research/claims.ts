import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { chatOnce } from '../providers/registry'
import { readDeepResearchSettings } from './adapter-cascade'
import type { ExtractedPage } from './extractor'

// Atomic-claim extraction per source.
//
// Each extracted page (D6 output) is sent to the configured claims model
// once. The model emits a flat list of factual claims, each tied to a
// verbatim "span" (the sentence the claim was drawn from) so the
// downstream corroborator (D8) can present evidence and the synthesiser
// (D9) can verify nothing is fabricated.
//
// Concurrency: capped at 6 per `extractAll`-style pool so long-running
// pipelines don't burst against rate-limited model providers. Each call
// is independent; one failure does not abort peers (returns an empty
// claim list for the failing source, downstream skips it).

export interface Claim {
  /** Stable id: `<source_n>-<i>` where i is the claim index within the source. */
  id: string
  /** The claim, paraphrased into a single declarative sentence. */
  text: string
  /** 1-based citation index of the source this claim was drawn from. */
  source_n: number
  /** Verbatim sentence from the source the claim is drawn from. May be missing on legacy/malformed output. */
  span?: string
}

export interface ExtractClaimsDeps {
  callLlm?: (messages: ChatCompletionMessageParam[], model: string) => Promise<string>
}

const DEFAULT_CLAIMS_MODEL = 'deepseek-v4-flash'
const MAX_CLAIMS_PER_SOURCE = 25
const MAX_SPAN_CHARS = 600
const MAX_CLAIM_CHARS = 400

const CLAIMS_SYSTEM_PROMPT = `You extract atomic factual claims from a single web page so a downstream pipeline can corroborate them across other sources.

Output STRICT JSON with this exact schema and no other text:
{
  "claims": [
    { "text": "single declarative sentence stating one fact", "span": "the verbatim sentence from the source that backs this claim" },
    ...
  ]
}

Rules:
- Each "text" entry MUST be a single declarative sentence stating ONE fact (subject-verb-object; no compound claims joined by "and" / "but").
- "span" MUST be a verbatim substring (or near-substring) of the source — the sentence the claim was drawn from. NEVER paraphrase the span.
- Exclude opinions, marketing language ("revolutionary", "best-in-class"), rhetorical questions, ads, headlines without bodies, navigation text, and content from comment sections.
- Exclude claims that are too vague to verify ("X has been growing in importance").
- Emit at most ${MAX_CLAIMS_PER_SOURCE} claims. If the page contains more facts than that, emit the ${MAX_CLAIMS_PER_SOURCE} most central / most quantifiable.
- If the page contains no extractable factual claims, return {"claims":[]}.
- Output nothing outside the JSON object.`

/**
 * Extract atomic factual claims from one extracted page. Returns `[]` on
 * failed-status sources, on LLM errors, or on malformed model output —
 * never throws. The orchestrator relies on this to keep peers alive.
 */
export async function extractClaims(
  page: ExtractedPage,
  modelOverride?: string,
  deps: ExtractClaimsDeps = {}
): Promise<Claim[]> {
  if (page.status !== 'ok' || !page.fullText) return []

  const model = modelOverride ?? readDeepResearchSettings().classifierModel ?? DEFAULT_CLAIMS_MODEL
  // R2: chatOnce returns {content, reasoning?}. Research callers consume
  // body only — reasoning preservation is a chat-mode concern, not a
  // research-claim-extraction concern.
  const call = deps.callLlm ?? ((m, mod) => chatOnce(m, mod).then((r) => r.content))

  const userMessage = `Source title: ${page.title}\nSource URL: ${page.url}\n\nPage content (extracted main text):\n${page.fullText}`
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: CLAIMS_SYSTEM_PROMPT },
    { role: 'user', content: userMessage }
  ]

  let raw: string
  try {
    raw = await call(messages, model)
  } catch (err) {
    console.warn(`[research/claims] LLM call failed for source ${page.n}: ${(err as Error).message}`)
    return []
  }

  return parseClaimsOutput(raw, page.n)
}

/**
 * Parse claims JSON from the model. Tolerates surrounding prose and
 * markdown fences. Returns `[]` on malformed output (caller logs and
 * skips the source).
 *
 * Exported so the parser can be tested independently of the LLM call.
 */
export function parseClaimsOutput(raw: string, sourceN: number): Claim[] {
  if (!raw) return []
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const p = parsed as Record<string, unknown>
  if (!Array.isArray(p.claims)) return []

  const out: Claim[] = []
  let truncated = false
  for (const item of p.claims) {
    if (typeof item !== 'object' || item === null) continue
    const text = (item as Record<string, unknown>).text
    const span = (item as Record<string, unknown>).span
    if (typeof text !== 'string' || !text.trim()) continue
    if (out.length >= MAX_CLAIMS_PER_SOURCE) {
      truncated = true
      break
    }
    out.push({
      id: `${sourceN}-${out.length}`,
      text: cap(text.trim(), MAX_CLAIM_CHARS),
      source_n: sourceN,
      span: typeof span === 'string' && span.trim()
        ? cap(span.trim(), MAX_SPAN_CHARS)
        : undefined
    })
  }
  if (truncated) {
    console.info(`[research/claims] truncated source ${sourceN} to ${MAX_CLAIMS_PER_SOURCE} claims.`)
  }
  return out
}

function cap(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/**
 * Batch entry point — extract claims from a list of pages in parallel
 * with a hard concurrency cap. Pages with `status !== 'ok'` are skipped
 * cleanly (no LLM call). Returns a flat list of every claim from every
 * source, in source-order then claim-order.
 */
export async function extractClaimsAll(
  pages: ExtractedPage[],
  concurrency = 6,
  modelOverride?: string,
  deps: ExtractClaimsDeps = {},
  signal?: AbortSignal
): Promise<Claim[]> {
  const perPage: Claim[][] = new Array(pages.length)
  let next = 0
  const runners = Array.from({ length: Math.min(concurrency, pages.length) }, async () => {
    while (true) {
      if (signal?.aborted) return
      const i = next++
      if (i >= pages.length) return
      perPage[i] = await extractClaims(pages[i], modelOverride, deps)
    }
  })
  await Promise.all(runners)
  return perPage.filter(Boolean).flat()
}

export const _claimsInternals = {
  MAX_CLAIMS_PER_SOURCE,
  MAX_SPAN_CHARS,
  MAX_CLAIM_CHARS,
  CLAIMS_SYSTEM_PROMPT
}
