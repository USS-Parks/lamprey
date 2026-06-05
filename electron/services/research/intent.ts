import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { chatOnce } from '../providers/registry'
import { readDeepResearchSettings } from './adapter-cascade'

// Intent classifier for auto-routing research-worthy chat turns into the
// deep-research pipeline.
//
// Two stages:
//   1. Heuristic prefilter (pure, fast, deterministic). Short-circuits
//      `shouldResearch=false` for prompts that are clearly code-edit shaped
//      (start with verbs like "fix"/"write"/"refactor", contain a file path,
//      are very short, or are issued in plan mode). Short-circuits
//      `shouldResearch=true` for prompts that begin with research-loud
//      phrases ("tell me about", "what is", "compare", "latest", etc.) so
//      we don't pay an LLM call for the obvious cases.
//   2. LLM classifier (only when the prefilter is undecided). Returns the
//      full `{shouldResearch, depth, confidence, reason}` shape.
//
// Plus two parsing utilities for explicit user intent:
//   * `parseResearchPrefix(content)` strips `--no-research` and `/research`
//     prefixes from the front of the message and returns the underlying
//     verb + cleaned content.
//
// Per-session caching of classifier results is keyed by a stable hash of
// the prompt body so re-runs of the same prompt within a session do not
// re-bill the model.

export type DepthTier = 'quick' | 'standard' | 'exhaustive'

export interface ResearchIntent {
  shouldResearch: boolean
  depth: DepthTier
  confidence: number
  reason: string
}

const DEFAULT_INTENT: ResearchIntent = {
  shouldResearch: false,
  depth: 'standard',
  confidence: 0,
  reason: 'default'
}

// ------------------------------------------------------------------------
// Prefix parsing — explicit user intent
// ------------------------------------------------------------------------

export type ResearchVerb = 'none' | 'force' | 'suppress'

export interface ParsedPrefix {
  verb: ResearchVerb
  /** Body of the prompt with the prefix removed and whitespace trimmed. */
  body: string
}

/**
 * Strip a research-control prefix from the front of the prompt:
 *   * `/research <query>` → `{ verb: 'force', body: '<query>' }`
 *   * `--no-research <query>` → `{ verb: 'suppress', body: '<query>' }`
 *   * otherwise → `{ verb: 'none', body: <original trimmed> }`
 *
 * Only the FIRST prefix in the message is consumed. The prefix is
 * case-insensitive and ignores surrounding whitespace.
 */
export function parseResearchPrefix(content: string): ParsedPrefix {
  const trimmed = content.trim()
  const forceMatch = trimmed.match(/^\/research(?:\b|\s|$)/i)
  if (forceMatch) {
    return { verb: 'force', body: trimmed.slice(forceMatch[0].length).trim() }
  }
  const suppressMatch = trimmed.match(/^--no-research(?:\b|\s|$)/i)
  if (suppressMatch) {
    return { verb: 'suppress', body: trimmed.slice(suppressMatch[0].length).trim() }
  }
  return { verb: 'none', body: trimmed }
}

// ------------------------------------------------------------------------
// Heuristic prefilter
// ------------------------------------------------------------------------

export type PrefilterDecision =
  | { decision: 'skip'; reason: string }
  | { decision: 'allow'; depth: DepthTier; reason: string }
  | { decision: 'undecided'; reason: string }

const CODE_EDIT_VERBS = [
  'fix', 'write', 'implement', 'refactor', 'add', 'remove', 'rename',
  'debug', 'test', 'build', 'deploy', 'merge', 'commit', 'push', 'edit',
  'create', 'delete', 'update', 'modify', 'install', 'configure', 'review'
]

const RESEARCH_LOUD_PHRASES = [
  'tell me about', 'what is the', 'what are the', 'how does', 'how do',
  'why does', 'why is', 'compare ', 'versus ', ' vs ', 'latest', 'news on',
  'recent developments', 'state of the art', 'survey of', 'overview of',
  'pros and cons', 'review of', 'who is', 'history of'
]

// Mirrors the J10 path-autolink regex enough for prefilter purposes
// (main-process code cannot import from `src/`). Matches `foo.ts`,
// `path/to/bar.tsx`, `src\\app.tsx`, `./foo.json`, etc.
const PATH_LIKE_RE = /(?:^|\s)\.?[\w./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|css|scss|html|sh|py|go|rs|toml|yaml|yml)(?::\d+)?(?:\s|$|[,.!?])/i

export interface PrefilterInput {
  content: string
  planMode?: boolean
}

/**
 * Pure heuristic prefilter. Returns one of:
 *   * `skip` — definitely NOT research (route to normal chat).
 *   * `allow` — definitely research (skip the LLM classifier; route to
 *     pipeline at the suggested depth).
 *   * `undecided` — defer to the LLM classifier.
 */
export function prefilterResearch(input: PrefilterInput): PrefilterDecision {
  const content = input.content.trim()
  if (!content) return { decision: 'skip', reason: 'empty body' }

  if (input.planMode) {
    return { decision: 'skip', reason: 'plan mode active' }
  }

  const lower = content.toLowerCase()
  const firstWord = lower.split(/\s+/, 1)[0] ?? ''

  // Code-edit shaped: verb at position 0.
  if (CODE_EDIT_VERBS.includes(firstWord)) {
    return { decision: 'skip', reason: `code-edit verb "${firstWord}" at start` }
  }

  // Path-like token anywhere → almost certainly a code question.
  if (PATH_LIKE_RE.test(content)) {
    return { decision: 'skip', reason: 'contains a path-like token' }
  }

  // Backticked code fences anywhere → code question.
  if (/```/.test(content)) {
    return { decision: 'skip', reason: 'contains a code fence' }
  }

  const wordCount = content.split(/\s+/).filter(Boolean).length

  // Research-loud phrases short-circuit `allow` so we skip the LLM. This
  // beats the length check so e.g. "history of the printing press" (5
  // words) still escalates.
  const looksLikeResearch = RESEARCH_LOUD_PHRASES.some((p) => lower.includes(p))
  if (looksLikeResearch) {
    return {
      decision: 'allow',
      depth: depthFromLength(wordCount),
      reason: 'research-loud phrase detected'
    }
  }

  // Very short prompts without a question mark are not research.
  if (wordCount < 8 && !content.includes('?')) {
    return { decision: 'skip', reason: 'too short and not a question' }
  }

  // Otherwise defer.
  return { decision: 'undecided', reason: 'no decisive heuristic; ask the LLM' }
}

function depthFromLength(words: number): DepthTier {
  if (words >= 40) return 'exhaustive'
  if (words >= 18) return 'standard'
  return 'quick'
}

// ------------------------------------------------------------------------
// LLM classifier
// ------------------------------------------------------------------------

const CLASSIFIER_SYSTEM_PROMPT = `You decide whether a user's chat message should be routed to a deep web-research pipeline (which will fetch 12-50 sources and synthesise a cited report) or handled as a normal chat turn.

Output STRICT JSON with this exact schema and no other text:
{
  "shouldResearch": boolean,
  "depth": "quick" | "standard" | "exhaustive",
  "confidence": number from 0 to 1,
  "reason": short string explaining the decision
}

Guidance:
- shouldResearch=true ONLY when the message asks a factual/exploratory question whose answer requires citing external sources (e.g. "what is the current state of fusion energy?", "compare REST vs GraphQL", "latest research on quantum error correction").
- shouldResearch=false for code-editing requests, debugging, refactoring, writing tasks the model can do from internal knowledge, follow-ups to ongoing work, or anything personal/conversational.
- depth: "quick" for narrow lookups (~12 sources), "standard" for broad questions (~25), "exhaustive" for audit-style or comparative deep-dives (~50).
- confidence: be honest. If unsure, return shouldResearch=false with low confidence.
- reason: one sentence, no quotes inside.`

const DEFAULT_CLASSIFIER_MODEL = 'deepseek-v4-flash'

interface ClassifierDeps {
  /** Override the LLM caller for testing. Defaults to `chatOnce`. */
  callLlm?: (messages: ChatCompletionMessageParam[], model: string) => Promise<string>
}

/**
 * Run the LLM classifier on the given prompt body. Returns null on
 * malformed/empty output rather than throwing — the caller falls back to
 * the safe-default (no research).
 */
export async function classifyResearchIntent(
  body: string,
  modelOverride: string | undefined,
  deps: ClassifierDeps = {}
): Promise<ResearchIntent | null> {
  const model = modelOverride ?? readDeepResearchSettings().classifierModel ?? DEFAULT_CLASSIFIER_MODEL
  const call = deps.callLlm ?? ((m, mod) => chatOnce(m, mod))
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
    { role: 'user', content: body }
  ]
  let raw: string
  try {
    raw = await call(messages, model)
  } catch (err) {
    console.warn('[research/intent] classifier LLM call failed:', (err as Error).message)
    return null
  }
  return parseClassifierOutput(raw)
}

/** Parse the LLM's JSON output. Tolerates leading/trailing prose. */
export function parseClassifierOutput(raw: string): ResearchIntent | null {
  if (!raw) return null
  // Find the first balanced-looking JSON object.
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  const json = raw.slice(start, end + 1)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as Record<string, unknown>
  const shouldResearch = typeof p.shouldResearch === 'boolean' ? p.shouldResearch : false
  const depthRaw = typeof p.depth === 'string' ? p.depth : 'standard'
  const depth: DepthTier =
    depthRaw === 'quick' || depthRaw === 'exhaustive' ? depthRaw : 'standard'
  const confidence = typeof p.confidence === 'number'
    ? Math.max(0, Math.min(1, p.confidence))
    : 0
  const reason = typeof p.reason === 'string' && p.reason ? p.reason : 'no reason given'
  return { shouldResearch, depth, confidence, reason }
}

// ------------------------------------------------------------------------
// Public composer + cache
// ------------------------------------------------------------------------

const sessionCache = new Map<string, ResearchIntent>()
const SESSION_CACHE_CAP = 200

function cacheKey(body: string): string {
  // Cheap stable hash. Good enough for in-session dedup; not a crypto hash.
  let h = 0
  for (let i = 0; i < body.length; i++) {
    h = (h * 31 + body.charCodeAt(i)) | 0
  }
  return `${body.length}:${h}`
}

export interface EscalateOpts {
  /** Whether plan mode is active for the current conversation. */
  planMode?: boolean
  /** When false, the LLM step is skipped (only the prefilter runs). */
  enableLlm?: boolean
  /** Override the classifier model. */
  modelOverride?: string
  /** Test override for the LLM caller. */
  deps?: ClassifierDeps
}

export interface EscalateDecision extends ResearchIntent {
  /** How the decision was reached: explicit prefix, prefilter, or LLM. */
  source: 'prefix' | 'prefilter' | 'llm' | 'default'
  /** The body of the prompt with any control prefix stripped. */
  body: string
  /** The original verb extracted from the prefix, if any. */
  verb: ResearchVerb
}

/**
 * Public entry point used by chat.ts. Combines prefix parsing, prefilter,
 * and LLM classifier into a single decision:
 *   1. `--no-research` prefix → always false.
 *   2. `/research` prefix → always true (depth from body length).
 *   3. prefilter `skip` → false.
 *   4. prefilter `allow` → true at the suggested depth (no LLM call).
 *   5. prefilter `undecided` → LLM classifier; on null/error → safe default false.
 *
 * The result is cached by prompt body for the lifetime of the process so
 * re-sending the same prompt doesn't re-pay the model cost.
 */
export async function shouldEscalateToResearch(
  rawContent: string,
  opts: EscalateOpts = {}
): Promise<EscalateDecision> {
  const { verb, body } = parseResearchPrefix(rawContent)

  if (verb === 'suppress') {
    return {
      ...DEFAULT_INTENT,
      depth: depthFromLength(body.split(/\s+/).filter(Boolean).length),
      reason: 'user supplied --no-research prefix',
      source: 'prefix',
      body,
      verb
    }
  }
  if (verb === 'force') {
    return {
      shouldResearch: true,
      depth: depthFromLength(body.split(/\s+/).filter(Boolean).length),
      confidence: 1,
      reason: 'user supplied /research prefix',
      source: 'prefix',
      body,
      verb
    }
  }

  // Prefilter
  const pf = prefilterResearch({ content: body, planMode: opts.planMode })
  if (pf.decision === 'skip') {
    return { ...DEFAULT_INTENT, reason: pf.reason, source: 'prefilter', body, verb }
  }
  if (pf.decision === 'allow') {
    return {
      shouldResearch: true,
      depth: pf.depth,
      confidence: 0.85,
      reason: pf.reason,
      source: 'prefilter',
      body,
      verb
    }
  }

  // Cached LLM result?
  const key = cacheKey(body)
  const cached = sessionCache.get(key)
  if (cached) {
    return { ...cached, source: 'llm', body, verb }
  }

  // LLM stage (unless caller disables it for cheap deterministic tests)
  if (opts.enableLlm === false) {
    return { ...DEFAULT_INTENT, reason: 'LLM disabled by caller', source: 'default', body, verb }
  }

  const llm = await classifyResearchIntent(body, opts.modelOverride, opts.deps)
  if (!llm) {
    return { ...DEFAULT_INTENT, reason: 'classifier returned no usable output', source: 'default', body, verb }
  }

  // Cache and return.
  while (sessionCache.size >= SESSION_CACHE_CAP) {
    const oldest = sessionCache.keys().next().value
    if (oldest === undefined) break
    sessionCache.delete(oldest)
  }
  sessionCache.set(key, llm)
  return { ...llm, source: 'llm', body, verb }
}

/** Exported for tests so a fresh session can verify cache miss behaviour. */
export function _clearIntentCache(): void {
  sessionCache.clear()
}

// ------------------------------------------------------------------------
// Chat turn routing — what chat.ts actually consumes
// ------------------------------------------------------------------------

export type ChatTurnRoute =
  | { kind: 'normal'; content: string; reason: string }
  | { kind: 'research'; body: string; depth: DepthTier; confidence: number; reason: string }

export interface RouteOpts {
  /** Result of reading `deepResearch.autoTrigger` from settings. */
  autoTrigger: boolean
  /** Plan mode currently active for this conversation. */
  planMode?: boolean
  /** Minimum classifier confidence required to escalate (default 0.6). */
  confidenceThreshold?: number
  /** When false, skip the LLM stage entirely (cheap path for autoTrigger=false). */
  enableLlm?: boolean
  /** Override the classifier model. */
  modelOverride?: string
  /** Test override for the LLM caller. */
  deps?: ClassifierDeps
}

/**
 * Single routing decision for `chat:send`. Always cheap when autoTrigger
 * is off (only the prefix check + prefilter run); only pays the LLM cost
 * when autoTrigger is on AND the prefilter is undecided.
 */
export async function routeChatTurn(rawContent: string, opts: RouteOpts): Promise<ChatTurnRoute> {
  const { verb, body } = parseResearchPrefix(rawContent)
  const threshold = opts.confidenceThreshold ?? 0.6

  if (verb === 'suppress') {
    return { kind: 'normal', content: body, reason: 'user supplied --no-research prefix' }
  }
  if (verb === 'force') {
    const depth = depthFromLength(body.split(/\s+/).filter(Boolean).length)
    return {
      kind: 'research',
      body,
      depth,
      confidence: 1,
      reason: 'user supplied /research prefix'
    }
  }

  // When autoTrigger is off, never escalate via classifier — only the
  // explicit /research prefix can force the pipeline.
  if (!opts.autoTrigger) {
    return { kind: 'normal', content: body, reason: 'autoTrigger off' }
  }

  const decision = await shouldEscalateToResearch(rawContent, {
    planMode: opts.planMode,
    enableLlm: opts.enableLlm,
    modelOverride: opts.modelOverride,
    deps: opts.deps
  })

  if (decision.shouldResearch && decision.confidence >= threshold) {
    return {
      kind: 'research',
      body: decision.body,
      depth: decision.depth,
      confidence: decision.confidence,
      reason: decision.reason
    }
  }

  return { kind: 'normal', content: decision.body, reason: decision.reason }
}
