import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { chatOnce } from '../providers/registry'
import { readDeepResearchSettings } from './adapter-cascade'
import type { ClaimSet, ClaimCluster, DisputeGroup } from './corroborator'
import type { CuratedSource } from './collector'
import { slugify } from './slugify'

// Markdown synthesizer — turns the corroborated ClaimSet into a cited
// markdown report with a numbered bibliography.
//
// Quality-bar invariant (plan §2 rule 2): every `[n]` ref in the body
// MUST map to a real source in the curated pool. `validateCitations`
// runs after the model emits the report; a fabricated `[n]` raises
// `FabricatedCitationError` and the orchestrator surfaces that to the
// user. This is the line we cannot cross.
//
// The bibliography section is generated locally (NOT from the model) so
// the URLs and titles are exact — we never let the model hallucinate a
// source URL.

export interface SynthesisInput {
  question: string
  claimSet: ClaimSet
  sources: CuratedSource[]
  /** ISO date string for "accessed YYYY-MM-DD". Injected so the test is deterministic. */
  accessedAt: string
  modelOverride?: string
}

export interface SynthesisOutput {
  markdown: string
  /** Short executive summary the chat-side message uses. */
  summary: string
  /** Source citations actually used (deduped, ordered by first appearance). */
  citedSources: CuratedSource[]
  /** Filename slug (without extension). */
  filenameSlug: string
}

export interface SynthesizeDeps {
  callLlm?: (messages: ChatCompletionMessageParam[], model: string) => Promise<string>
  /** Test override for the accessed-at injection. */
  accessedAt?: string
}

const DEFAULT_SYNTH_MODEL = 'deepseek-v3'
const MAX_RETRIES = 1

export class FabricatedCitationError extends Error {
  readonly fabricatedRefs: number[]
  constructor(fabricatedRefs: number[]) {
    super(
      `Synthesizer produced fabricated citation ref(s) not present in the source pool: ${fabricatedRefs.join(', ')}.`
    )
    this.name = 'FabricatedCitationError'
    this.fabricatedRefs = fabricatedRefs
  }
}

const SYSTEM_PROMPT = `You write a sourced markdown research report.

Inputs you are given:
- A question.
- A set of CORROBORATED CLAIMS (each tagged with the citation indices that back it; multiple sources mean independent agreement).
- A set of SINGLE-SOURCE CLAIMS (only one source backs them).
- A set of DISPUTED CLAIM PAIRS (two sources directly contradict each other).
- A SOURCE POOL (numbered 1..N — these are the ONLY citation indices you may use).

Rules — ALL MUST HOLD:
1. Every paragraph MUST contain at least one inline citation in square brackets, e.g. \`[3]\` or \`[1, 4]\`.
2. You MAY ONLY cite indices that appear in the SOURCE POOL list. NEVER invent a citation number.
3. Corroborated claims may be stated as fact and cited with the supporting indices.
4. Single-source claims MUST be prefixed with "According to [n]," (use the source's index, not the word "source").
5. Disputed claims MUST be presented as disagreement, citing BOTH sides, e.g. "Some sources report X [3]; others maintain Y [7]." You may tag with the word "[disputed]" inline if helpful.
6. Do NOT make up facts that are not in the provided claim set.
7. Do NOT include a "## Sources" or "## Bibliography" section — the pipeline appends one automatically with exact URLs.
8. Begin with a 2-3 sentence executive summary on its own paragraph (still cited). Then sections covering the topic.

Output format:
- Pure markdown. No JSON, no preamble, no code fences.
- The first paragraph IS the executive summary.
- Use \`##\` headings for sections (no \`#\` H1 — the chat surface adds its own).`

/**
 * Run the synthesizer LLM, validate the resulting citation graph, and
 * append a deterministic bibliography.
 */
export async function synthesizeReport(
  input: SynthesisInput,
  deps: SynthesizeDeps = {}
): Promise<SynthesisOutput> {
  const model = input.modelOverride ?? readDeepResearchSettings().synthesizerModel ?? DEFAULT_SYNTH_MODEL
  // R2: chatOnce returns {content, reasoning?}; synthesizer consumes body only.
  const call = deps.callLlm ?? ((m, mod) => chatOnce(m, mod).then((r) => r.content))
  const accessedAt = deps.accessedAt ?? input.accessedAt

  const validIndices = new Set(input.sources.map((s) => s.n))
  const userMessage = buildUserMessage(input)
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage }
  ]

  let body = ''
  let lastFabricated: number[] = []
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    body = await call(messages, model)
    body = stripBibliographyIfPresent(body).trim()
    const refs = extractCitationRefs(body)
    const fabricated = refs.filter((n) => !validIndices.has(n))
    if (fabricated.length === 0) break
    lastFabricated = fabricated
    if (attempt === MAX_RETRIES) {
      throw new FabricatedCitationError(fabricated)
    }
    messages.push({
      role: 'user',
      content: `Your previous report cited indices ${fabricated.join(', ')} which are NOT in the source pool. Regenerate using ONLY indices from the SOURCE POOL listed earlier.`
    })
  }
  void lastFabricated

  // Build bibliography deterministically (URLs straight from sources;
  // never from the model). Ordered by first appearance in the body so
  // the numbering visually flows top-to-bottom.
  const usedInOrder = orderCitationsByFirstAppearance(body, input.sources)
  const bibliography = buildBibliography(usedInOrder, accessedAt)
  const fullMarkdown = `${body}\n\n## Sources\n\n${bibliography}\n`

  const summary = firstParagraph(body)

  return {
    markdown: fullMarkdown,
    summary,
    citedSources: usedInOrder,
    filenameSlug: slugify(input.question)
  }
}

function buildUserMessage(input: SynthesisInput): string {
  const sourcePoolLines = input.sources
    .map((s) => `[${s.n}] ${s.title} — ${s.registrableDomain}`)
    .join('\n')

  const lines: string[] = []
  lines.push(`QUESTION: ${input.question}`)
  lines.push('')
  lines.push(`SOURCE POOL (these are the ONLY indices you may cite):\n${sourcePoolLines}`)
  lines.push('')
  if (input.claimSet.accepted.length > 0) {
    lines.push('CORROBORATED CLAIMS (≥ 2 independent domains):')
    for (const c of input.claimSet.accepted) {
      lines.push(`- ${c.representative.text}  [supported by ${c.claims.map((x) => x.source_n).join(', ')}]`)
    }
    lines.push('')
  }
  if (input.claimSet.singleSource.length > 0) {
    lines.push('SINGLE-SOURCE CLAIMS (use "According to [n]," prefix):')
    for (const c of input.claimSet.singleSource) {
      lines.push(`- ${c.representative.text}  [from ${c.claims[0].source_n}]`)
    }
    lines.push('')
  }
  if (input.claimSet.disputed.length > 0) {
    lines.push('DISPUTED CLAIM PAIRS (must be presented as disagreement, citing both sides):')
    for (const d of input.claimSet.disputed) {
      lines.push(`- A: "${d.a.representative.text}" [from ${d.a.representative.source_n}]`)
      lines.push(`  B: "${d.b.representative.text}" [from ${d.b.representative.source_n}]`)
      lines.push(`  Reason: ${d.reason}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Extract all citation numbers from a markdown body. Handles `[n]`,
 * `[n, m]`, `[n,m,p]` etc. Excludes anything inside fenced code blocks
 * (defensive — the prompt forbids code fences in output but we belt-and-
 * brace it).
 */
export function extractCitationRefs(markdown: string): number[] {
  const withoutFences = stripCodeFences(markdown)
  const matches = withoutFences.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)
  const out: number[] = []
  for (const m of matches) {
    const nums = m[1].split(',').map((x) => Number.parseInt(x.trim(), 10))
    for (const n of nums) {
      if (Number.isFinite(n)) out.push(n)
    }
  }
  return out
}

function stripCodeFences(s: string): string {
  return s.replace(/```[\s\S]*?```/g, ' ')
}

function stripBibliographyIfPresent(s: string): string {
  // Belt-and-brace: if the model emitted its own "## Sources" or "## Bibliography"
  // section despite being told not to, drop it.
  return s.replace(/\n\s*##\s*(sources|bibliography)[\s\S]*$/i, '')
}

function orderCitationsByFirstAppearance(
  markdown: string,
  sources: CuratedSource[]
): CuratedSource[] {
  const refs = extractCitationRefs(markdown)
  const seen = new Set<number>()
  const inOrder: CuratedSource[] = []
  for (const n of refs) {
    if (seen.has(n)) continue
    const src = sources.find((s) => s.n === n)
    if (!src) continue
    seen.add(n)
    inOrder.push(src)
  }
  return inOrder
}

function buildBibliography(sources: CuratedSource[], accessedAt: string): string {
  return sources
    .map((s) => `[${s.n}] [${s.title}](${s.url}) — accessed ${accessedAt}`)
    .join('\n')
}

function firstParagraph(markdown: string): string {
  // Strip leading H1/H2 if any, then take everything until the first blank line.
  const cleaned = markdown.replace(/^#+ .*\n+/, '')
  const para = cleaned.split(/\n\s*\n/, 1)[0] ?? ''
  return para.trim()
}

export const _synthesizerInternals = {
  SYSTEM_PROMPT,
  extractCitationRefs,
  buildBibliography
}
