import OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getKey } from '../keychain'
import { boundedJsonPreview, recordEvent } from '../event-log'
import { trace } from '../debug-trace'

// T1 — SSE inactivity watchdog. Some providers (notably DeepSeek under load
// and OpenRouter when routing through a stalled upstream) silently leave the
// SSE socket half-open: no chunks, no FIN, no error. The `for await` loop
// below would otherwise wait forever. We race each chunk-await against a
// timer and abort the underlying HTTP request on expiry; the throw lands in
// the existing partial-persist + retry path so the user's on-screen content
// is preserved and a flaky provider gets the same retry treatment as a 429.
export class StreamInactivityError extends Error {
  constructor(public readonly inactivityMs: number) {
    super(`Stream stalled — provider sent no chunks for ${Math.round(inactivityMs / 1000)}s.`)
    this.name = 'StreamInactivityError'
  }
}

const DEFAULT_STREAM_INACTIVITY_MS = 60_000
const MIN_STREAM_INACTIVITY_MS = 5_000

// Test hook: setting this overrides the settings.json value for the duration
// of the test. Cleared by setting back to null.
let streamInactivityOverrideMs: number | null = null
export function __setStreamInactivityForTesting(ms: number | null): void {
  streamInactivityOverrideMs = ms
}

// Injected by main.ts during boot so we can read settings.json without an
// electron import in test contexts. Tests leave it null and use the override.
let userDataPathProvider: (() => string) | null = null
export function setUserDataPathProvider(fn: (() => string) | null): void {
  userDataPathProvider = fn
}

function readStreamInactivityMs(): number {
  if (streamInactivityOverrideMs !== null) return streamInactivityOverrideMs
  if (!userDataPathProvider) return DEFAULT_STREAM_INACTIVITY_MS
  try {
    const path = join(userDataPathProvider(), 'settings.json')
    if (!existsSync(path)) return DEFAULT_STREAM_INACTIVITY_MS
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as { streamInactivityMs?: unknown }
    const ms = raw.streamInactivityMs
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_STREAM_INACTIVITY_MS
    if (ms <= 0) return 0 // 0 disables the watchdog entirely
    return Math.max(MIN_STREAM_INACTIVITY_MS, ms)
  } catch {
    return DEFAULT_STREAM_INACTIVITY_MS
  }
}

export type ProviderId = 'deepseek' | 'google' | 'dashscope' | 'openrouter'

export interface ProviderDescriptor {
  id: ProviderId
  label: string
  baseURL: string
  keyEnv: string
  docsUrl: string
}

export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    keyEnv: 'deepseek',
    docsUrl: 'https://platform.deepseek.com/api_keys'
  },
  google: {
    id: 'google',
    label: 'Google AI (Gemma)',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    keyEnv: 'google',
    docsUrl: 'https://aistudio.google.com/app/apikey'
  },
  dashscope: {
    id: 'dashscope',
    label: 'Alibaba DashScope (Qwen)',
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    keyEnv: 'dashscope',
    docsUrl: 'https://dashscope.console.aliyun.com/apiKey'
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (Gemma 4, multi-model)',
    baseURL: 'https://openrouter.ai/api/v1',
    keyEnv: 'openrouter',
    docsUrl: 'https://openrouter.ai/keys'
  }
}

export interface ModelDescriptor {
  id: string
  name: string
  provider: ProviderId
  apiModelId: string
  contextWindow: number
  supportsTools: boolean
  supportsVision: boolean
  isReasoner?: boolean
  tier: 'pro' | 'flash' | 'open' | 'coder' | 'reasoner'
  description: string
}

// Each `apiModelId` is sent verbatim in the `model` field of the request to
// that provider's published API. These IDs come from each provider's docs
// and the OpenRouter live /v1/models response captured during development;
// they are NOT guaranteed to still be live. Use Settings -> Models ->
// "Verify against providers" to check every entry against the provider's
// current /v1/models list with your stored key.
export const MODEL_CATALOG: ModelDescriptor[] = [
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    apiModelId: 'deepseek-v4-pro',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: false,
    tier: 'pro',
    description: 'Flagship DeepSeek V4 — high-performance reasoning, 1M token context.'
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    apiModelId: 'deepseek-v4-flash',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: false,
    tier: 'flash',
    description: 'Fast DeepSeek V4 — supports both non-thinking and thinking modes (default), 1M context.'
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat (legacy alias)',
    provider: 'deepseek',
    apiModelId: 'deepseek-chat',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: false,
    tier: 'pro',
    description: 'Legacy alias — currently routes to V4 Flash (non-thinking). DeepSeek plans to deprecate.'
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner (legacy alias)',
    provider: 'deepseek',
    apiModelId: 'deepseek-reasoner',
    contextWindow: 1_000_000,
    supportsTools: false,
    supportsVision: false,
    isReasoner: true,
    tier: 'reasoner',
    description: 'Legacy alias — currently routes to V4 Flash (thinking). DeepSeek plans to deprecate.'
  },
  {
    id: 'gemma-3-27b-it',
    name: 'Gemma 3 27B',
    provider: 'google',
    apiModelId: 'gemma-3-27b-it',
    contextWindow: 131072,
    supportsTools: true,
    supportsVision: true,
    tier: 'open',
    description: 'Google open-weight 27B multimodal model via AI Studio.'
  },
  {
    id: 'gemma-3-12b-it',
    name: 'Gemma 3 12B',
    provider: 'google',
    apiModelId: 'gemma-3-12b-it',
    contextWindow: 131072,
    supportsTools: true,
    supportsVision: true,
    tier: 'open',
    description: 'Smaller Gemma 3 variant — faster, lower cost.'
  },
  // Gemma 4 via OpenRouter — verified live on openrouter.ai/api/v1/models.
  // Free variants are rate-limited; the non-free entries bill via OpenRouter
  // credits. AI Studio's native Gemma 4 endpoints exist too but their id
  // strings aren't published on any public-readable page — paste those into
  // Settings → Models → Custom Models if you prefer the direct route.
  {
    id: 'gemma-4-31b-it-free',
    name: 'Gemma 4 31B (free, OpenRouter)',
    provider: 'openrouter',
    apiModelId: 'google/gemma-4-31b-it:free',
    contextWindow: 262144,
    supportsTools: true,
    supportsVision: true,
    tier: 'open',
    description: 'Gemma 4 31B-instruction-tuned, rate-limited free tier via OpenRouter.'
  },
  {
    id: 'gemma-4-31b-it',
    name: 'Gemma 4 31B (OpenRouter)',
    provider: 'openrouter',
    apiModelId: 'google/gemma-4-31b-it',
    contextWindow: 262144,
    supportsTools: true,
    supportsVision: true,
    tier: 'open',
    description: 'Gemma 4 31B-instruction-tuned, paid tier via OpenRouter credits.'
  },
  {
    id: 'gemma-4-26b-a4b-it-free',
    name: 'Gemma 4 26B A4B (free, OpenRouter)',
    provider: 'openrouter',
    apiModelId: 'google/gemma-4-26b-a4b-it:free',
    contextWindow: 262144,
    supportsTools: true,
    supportsVision: true,
    tier: 'open',
    description: 'Gemma 4 26B activation-tuned, rate-limited free tier via OpenRouter.'
  },
  {
    id: 'gemma-4-26b-a4b-it',
    name: 'Gemma 4 26B A4B (OpenRouter)',
    provider: 'openrouter',
    apiModelId: 'google/gemma-4-26b-a4b-it',
    contextWindow: 262144,
    supportsTools: true,
    supportsVision: true,
    tier: 'open',
    description: 'Gemma 4 26B activation-tuned, paid tier via OpenRouter credits.'
  },
  {
    id: 'qwen3-max',
    name: 'Qwen3 Max',
    provider: 'dashscope',
    apiModelId: 'qwen3-max',
    contextWindow: 262144,
    supportsTools: true,
    supportsVision: false,
    tier: 'pro',
    description: 'Alibaba Qwen3 flagship — 262K context, tool use.'
  },
  {
    id: 'qwen3-coder-plus',
    name: 'Qwen3 Coder Plus',
    provider: 'dashscope',
    apiModelId: 'qwen3-coder-plus',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: false,
    tier: 'coder',
    description: 'Flagship Qwen3 coding model — 1M context, agentic tool use.'
  },
  {
    id: 'qwen3-coder-flash',
    name: 'Qwen3 Coder Flash',
    provider: 'dashscope',
    apiModelId: 'qwen3-coder-flash',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: false,
    tier: 'coder',
    description: 'Faster Qwen3 coder — 1M context, agentic tool use.'
  },
  {
    id: 'qwen3.5-plus',
    name: 'Qwen 3.5 Plus',
    provider: 'dashscope',
    apiModelId: 'qwen3.5-plus',
    contextWindow: 1_000_000,
    supportsTools: false,
    supportsVision: true,
    tier: 'pro',
    description: 'Qwen 3.5 multimodal — 1M context, vision input.'
  },
  {
    id: 'qwen3.5-flash',
    name: 'Qwen 3.5 Flash',
    provider: 'dashscope',
    apiModelId: 'qwen3.5-flash',
    contextWindow: 1_000_000,
    supportsTools: false,
    supportsVision: true,
    tier: 'flash',
    description: 'Faster Qwen 3.5 multimodal — 1M context, vision input.'
  },
  {
    id: 'qwen-long',
    name: 'Qwen Long',
    provider: 'dashscope',
    apiModelId: 'qwen-long',
    contextWindow: 10_000_000,
    supportsTools: false,
    supportsVision: false,
    tier: 'pro',
    description: 'Qwen long-context model — 10M token window for very large documents.'
  }
  // qwen3.7 is referenced in Alibaba's blog announcements but the DashScope
  // model catalog at fetch time did not list a qwen3.7-* api id. Paste the
  // exact id from your DashScope console into Custom Models when it lands.
]

export interface ChatStreamParams {
  temperature?: number
  topP?: number
  maxTokens?: number | null
}

/**
 * Audit context optionally passed by the orchestrator (chat:send, agent
 * pipeline, automations) so chatStream / chatOnce can emit `model.request.*`
 * events linked to the right correlation id. When omitted, the provider
 * helpers run silent — same behavior as before Prompt 3 — so tests and
 * stand-alone callers don't need to plumb anything.
 */
export interface ModelRequestAudit {
  correlationId?: string
  conversationId?: string
  /** Optional label for the role making the call (planner/coder/reviewer/
   *  composer/title-gen). Goes in the event payload, not the actor field. */
  role?: string
  /** Distinguish completion turns from incidental composer/title helpers in
   *  the timeline. Default 'main'. */
  purpose?: 'main' | 'composer' | 'title' | 'pipeline' | 'sub-agent' | 'other'
}

export interface StreamingVitals {
  lastChunkAt: number
  msSinceLastChunk: number
  chunkCount: number
  tokenEstimate: number
  attemptElapsedMs: number
}

export interface ChatStreamCallbacks {
  onChunk: (content: string) => void
  /** Reasoning-channel deltas. DeepSeek's reasoner / V4-Flash thinking mode
   *  streams chain-of-thought on `delta.reasoning_content` (some providers
   *  alias it to `delta.reasoning`). When omitted, reasoning is dropped. */
  onReasoning?: (content: string) => void
  /** T4 — heartbeat the provider fires ~every 2s during a streaming attempt
   *  so the caller can broadcast a `chat:streaming-vitals` event. Lets the
   *  renderer show "last chunk Ns ago / N tokens" so the user can tell a
   *  slow think from a dead socket without canceling. */
  onVitals?: (vitals: StreamingVitals) => void
  onDone: (
    fullContent: string,
    toolCalls?: ToolCallAccumulator[],
    fullReasoning?: string
  ) => void
  /** Called when the stream gives up. `partial` carries whatever body +
   *  reasoning had already arrived before the failure, so the caller can
   *  persist it as a partial assistant message instead of letting the user's
   *  on-screen content evaporate. Partial in-flight tool calls are NOT
   *  exposed because their args may be incomplete and would break the next
   *  tool round. */
  onError: (
    error: string,
    partial?: { content: string; reasoning?: string }
  ) => void
}

export interface ToolCallAccumulator {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

const clientCache = new Map<ProviderId, OpenAI>()

export function resetProviderClients(): void {
  clientCache.clear()
}

export function resetProviderClient(provider: ProviderId): void {
  clientCache.delete(provider)
}

function getClientForProvider(provider: ProviderId): OpenAI {
  const cached = clientCache.get(provider)
  if (cached) return cached
  const desc = PROVIDERS[provider]
  const apiKey = getKey(desc.keyEnv)
  if (!apiKey) {
    throw new Error(`${desc.label} API key not configured. Add one in Settings → API Keys.`)
  }
  const client = new OpenAI({ apiKey, baseURL: desc.baseURL })
  clientCache.set(provider, client)
  return client
}

export function resolveModel(modelId: string): ModelDescriptor {
  const found = MODEL_CATALOG.find((m) => m.id === modelId)
  if (found) return found
  // Unknown model id — assume DeepSeek, OpenAI-compatible.
  return {
    id: modelId,
    name: modelId,
    provider: 'deepseek',
    apiModelId: modelId,
    contextWindow: 65536,
    supportsTools: true,
    supportsVision: false,
    tier: 'pro',
    description: 'Custom model.'
  }
}

export function getProviderForModel(modelId: string): ProviderId {
  return resolveModel(modelId).provider
}

export function getApiModelId(modelId: string): string {
  return resolveModel(modelId).apiModelId
}

export interface KeyValidationResult {
  ok: boolean
  reason?: string
  modelCount?: number
}

export async function validateProviderKeyDetailed(provider: ProviderId): Promise<KeyValidationResult> {
  let client: OpenAI
  try {
    client = getClientForProvider(provider)
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'No API key stored for this provider.' }
  }

  // Primary check: GET /v1/models. Costs nothing, requires only auth, and
  // works on every OpenAI-compatible provider we route to. A 401/403 here
  // is the only thing that proves the key itself is bad.
  try {
    const response = await client.models.list()
    const count = Array.isArray(response.data) ? response.data.length : 0
    return { ok: true, modelCount: count }
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) {
      return { ok: false, reason: `Provider rejected the key (HTTP ${err.status}).` }
    }
    // Fall through to a chat-completion fallback for providers that don't
    // expose /v1/models — DashScope's compatible-mode endpoint, for instance.
    return validateViaChatProbe(provider, client, err)
  }
}

async function validateViaChatProbe(
  provider: ProviderId,
  client: OpenAI,
  originalError: any
): Promise<KeyValidationResult> {
  // Pick the cheapest catalog model we know about for this provider. This is
  // a fallback only — if the call fails for any non-auth reason we report it
  // verbatim rather than claiming the key is invalid.
  const probe = MODEL_CATALOG.find((m) => m.provider === provider)
  if (!probe) {
    return {
      ok: false,
      reason: originalError?.message || `No catalog model available to probe ${provider}.`
    }
  }
  try {
    const response = await client.chat.completions.create({
      model: probe.apiModelId,
      messages: [{ role: 'user', content: 'ok' }],
      max_tokens: 1
    })
    return { ok: !!response.choices[0]?.message }
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) {
      return { ok: false, reason: `Provider rejected the key (HTTP ${err.status}).` }
    }
    return {
      ok: false,
      reason:
        err?.message ||
        originalError?.message ||
        'Provider returned an unexpected error during validation.'
    }
  }
}

// Boolean wrapper retained for the legacy single-key path
// (settings:testApiKey -> DeepSeekClient.validateKey).
export async function validateProviderKey(provider: ProviderId): Promise<boolean> {
  const result = await validateProviderKeyDetailed(provider)
  return result.ok
}

export type CatalogStatus = 'verified' | 'missing' | 'no-key' | 'unsupported-endpoint' | 'auth-failed' | 'error'

export interface ProviderCatalogReport {
  provider: ProviderId
  status: 'ok' | 'no-key' | 'unsupported-endpoint' | 'auth-failed' | 'error'
  reason?: string
  // Sample of live ids returned by /v1/models (capped for size).
  liveIds?: string[]
  liveCount?: number
}

export interface CatalogVerificationReport {
  generatedAt: number
  providers: ProviderCatalogReport[]
  models: Array<{
    modelId: string
    name: string
    provider: ProviderId
    apiModelId: string
    status: CatalogStatus
    reason?: string
  }>
}

// Calls each provider's /v1/models endpoint with the stored key and confirms
// that every catalog apiModelId is present in the live response. Returns a
// structured report so the UI can show per-model status — no inferences, no
// fabricated "verified" claims.
export async function verifyCatalog(): Promise<CatalogVerificationReport> {
  const providerIds = Object.keys(PROVIDERS) as ProviderId[]

  const providerReports = await Promise.all(
    providerIds.map(async (pid): Promise<ProviderCatalogReport> => {
      let client: OpenAI
      try {
        client = getClientForProvider(pid)
      } catch (err: any) {
        return { provider: pid, status: 'no-key', reason: err?.message || 'No API key stored.' }
      }
      try {
        const response = await client.models.list()
        const ids = (Array.isArray(response.data) ? response.data : [])
          .map((m: any) => (typeof m?.id === 'string' ? m.id : null))
          .filter((id): id is string => !!id)
        return {
          provider: pid,
          status: 'ok',
          liveIds: ids.slice(0, 500),
          liveCount: ids.length
        }
      } catch (err: any) {
        if (err?.status === 401 || err?.status === 403) {
          return {
            provider: pid,
            status: 'auth-failed',
            reason: `Provider rejected the key (HTTP ${err.status}).`
          }
        }
        if (err?.status === 404 || err?.status === 405) {
          // Provider's compatible-mode endpoint doesn't expose /v1/models;
          // we can't confirm or refute the catalog without spending tokens.
          return {
            provider: pid,
            status: 'unsupported-endpoint',
            reason: `Provider does not expose /v1/models (HTTP ${err.status}). Catalog entries for this provider cannot be auto-verified.`
          }
        }
        return {
          provider: pid,
          status: 'error',
          reason: err?.message || 'Unknown error contacting provider.'
        }
      }
    })
  )

  const providerReportByProvider = new Map<ProviderId, ProviderCatalogReport>(
    providerReports.map((r) => [r.provider, r])
  )

  const models = MODEL_CATALOG.map((m) => {
    const report = providerReportByProvider.get(m.provider)
    let status: CatalogStatus
    let reason: string | undefined
    if (!report || report.status === 'no-key') {
      status = 'no-key'
      reason = `Add a ${PROVIDERS[m.provider].label} key in Settings → API Keys to verify.`
    } else if (report.status === 'auth-failed') {
      status = 'auth-failed'
      reason = report.reason
    } else if (report.status === 'unsupported-endpoint') {
      status = 'unsupported-endpoint'
      reason = report.reason
    } else if (report.status === 'error') {
      status = 'error'
      reason = report.reason
    } else if (report.liveIds && report.liveIds.includes(m.apiModelId)) {
      status = 'verified'
    } else {
      status = 'missing'
      reason = `Provider's /v1/models response did not include "${m.apiModelId}".`
    }
    return {
      modelId: m.id,
      name: m.name,
      provider: m.provider,
      apiModelId: m.apiModelId,
      status,
      reason
    }
  })

  return {
    generatedAt: Date.now(),
    providers: providerReports,
    models
  }
}

/** Reasoning Audit Phase R2 — chatOnce now returns BOTH the visible body
 *  and any chain-of-thought the provider emitted alongside it. Reads the
 *  two field names different OpenAI-compatible APIs use:
 *    - `message.reasoning`         (OpenRouter, some DeepSeek variants)
 *    - `message.reasoning_content` (DashScope qwen, deepseek-reasoner on
 *                                   non-streamed responses)
 *  Both are stripped + trimmed; if both are populated, `reasoning` wins.
 *  Undefined when neither is set or both are empty. Callers that only
 *  care about the body destructure `{ content }`. */
export interface ChatOnceResult {
  content: string
  reasoning?: string
}

export async function chatOnce(
  messages: ChatCompletionMessageParam[],
  modelId: string,
  signal?: AbortSignal,
  audit?: ModelRequestAudit
): Promise<ChatOnceResult> {
  const desc = resolveModel(modelId)
  const client = getClientForProvider(desc.provider)
  const startedAt = Date.now()
  const traceId = randomUUID().slice(0, 8)
  trace('chatOnce.enter', {
    traceId,
    model: desc.id,
    apiModelId: desc.apiModelId,
    provider: desc.provider,
    purpose: audit?.purpose,
    role: audit?.role,
    conversationId: audit?.conversationId,
    parentSignalAborted: signal?.aborted ?? null,
    messageCount: messages.length
  })
  emitModelRequestStarted(desc, audit, { streaming: false, toolCount: 0 })
  try {
    const response = await client.chat.completions.create(
      {
        model: desc.apiModelId,
        messages
      },
      signal ? { signal } : undefined
    )
    const message = response.choices[0]?.message as
      | { content?: string | null; reasoning?: string | null; reasoning_content?: string | null }
      | undefined
    const content = message?.content || ''
    // Provider field-name variance — see ChatOnceResult docstring. Take
    // the first populated value; trim whitespace; treat empty as absent.
    const rawReasoning =
      (typeof message?.reasoning === 'string' && message.reasoning.length > 0
        ? message.reasoning
        : typeof message?.reasoning_content === 'string' && message.reasoning_content.length > 0
          ? message.reasoning_content
          : '') ?? ''
    const reasoning = rawReasoning.trim().length > 0 ? rawReasoning.trim() : undefined
    const finishReason = response.choices[0]?.finish_reason ?? undefined
    trace('chatOnce.complete', {
      traceId,
      durationMs: Date.now() - startedAt,
      contentLen: content.length,
      reasoningLen: reasoning?.length ?? 0,
      finishReason
    })
    emitModelRequestCompleted(desc, audit, {
      streaming: false,
      toolCount: 0,
      retryCount: 0,
      durationMs: Date.now() - startedAt,
      finishReason,
      cancelled: signal?.aborted ?? false
    })
    return { content, reasoning }
  } catch (err: any) {
    trace('chatOnce.error', {
      traceId,
      durationMs: Date.now() - startedAt,
      errName: err?.name,
      errStatus: err?.status,
      errMessage: String(err?.message ?? err).slice(0, 200),
      parentSignalAborted: signal?.aborted ?? null
    })
    emitModelRequestFailed(desc, audit, {
      streaming: false,
      toolCount: 0,
      retryCount: 0,
      durationMs: Date.now() - startedAt,
      cancelled: signal?.aborted ?? false,
      error: err
    })
    throw err
  }
}

export async function chatStream(
  messages: ChatCompletionMessageParam[],
  modelId: string,
  tools: ChatCompletionTool[] | undefined,
  callbacks: ChatStreamCallbacks,
  signal?: AbortSignal,
  params?: ChatStreamParams,
  audit?: ModelRequestAudit
): Promise<void> {
  const desc = resolveModel(modelId)
  const client = getClientForProvider(desc.provider)
  const usableTools = desc.supportsTools && tools && tools.length > 0 ? tools : undefined
  const offeredToolCount = usableTools?.length ?? 0

  const startedAt = Date.now()
  emitModelRequestStarted(desc, audit, {
    streaming: true,
    toolCount: offeredToolCount
  })

  let fullContent = ''
  let fullReasoning = ''
  const toolCallsAccumulator: Map<number, ToolCallAccumulator> = new Map()
  let retries = 0
  const maxRetries = 3
  const inactivityMs = readStreamInactivityMs()

  // DBG2 — per-call trace id so we can correlate every line in
  // lamprey-debug.log back to the same stream invocation.
  const traceId = randomUUID().slice(0, 8)
  trace('chatStream.enter', {
    traceId,
    model: desc.id,
    apiModelId: desc.apiModelId,
    provider: desc.provider,
    inactivityMs,
    toolCount: offeredToolCount,
    purpose: audit?.purpose,
    conversationId: audit?.conversationId
  })

  // T4 — vitals heartbeat. Fires every 2s while the attempt streams. Counters
  // reset on each retry so the renderer's "Ns since last chunk" reflects the
  // CURRENT attempt, not the cumulative attempt history.
  const VITALS_HEARTBEAT_MS = 2_000
  let vitalsTimer: ReturnType<typeof setInterval> | null = null
  let lastChunkAt = 0
  let chunkCount = 0
  let attemptStartedAt = Date.now()
  const startVitalsHeartbeat = (): void => {
    if (!callbacks.onVitals) return
    if (vitalsTimer) clearInterval(vitalsTimer)
    vitalsTimer = setInterval(() => {
      try {
        const now = Date.now()
        const tokenEstimate = Math.round(
          (fullContent.length + fullReasoning.length) / 4
        )
        callbacks.onVitals?.({
          lastChunkAt,
          msSinceLastChunk: lastChunkAt === 0 ? now - attemptStartedAt : now - lastChunkAt,
          chunkCount,
          tokenEstimate,
          attemptElapsedMs: now - attemptStartedAt
        })
      } catch (err) {
        console.warn('[providers] vitals heartbeat threw:', err)
      }
    }, VITALS_HEARTBEAT_MS)
  }
  const stopVitalsHeartbeat = (): void => {
    if (vitalsTimer) {
      clearInterval(vitalsTimer)
      vitalsTimer = null
    }
  }

  while (retries <= maxRetries) {
    // T1 — Per-attempt controller. User-signal aborts route through this;
    // the inactivity timer also fires it. We use the `inactivityFired` flag
    // to disambiguate inactivity-abort from user-cancel in the catch.
    const attemptController = new AbortController()
    let inactivityFired = false
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null

    const clearInactivityTimer = (): void => {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer)
        inactivityTimer = null
      }
    }
    const armInactivityTimer = (): void => {
      if (inactivityMs <= 0) {
        trace('chatStream.watchdog.disabled', { traceId, retries, reason: 'inactivityMs<=0' })
        return
      }
      clearInactivityTimer()
      const armedAt = Date.now()
      inactivityTimer = setTimeout(() => {
        const elapsed = Date.now() - armedAt
        trace('chatStream.watchdog.fired', {
          traceId,
          retries,
          inactivityMs,
          actualElapsedMs: elapsed,
          chunkCount,
          fullContentLen: fullContent.length,
          fullReasoningLen: fullReasoning.length
        })
        inactivityFired = true
        attemptController.abort()
        trace('chatStream.watchdog.abort-called', {
          traceId,
          attemptControllerAborted: attemptController.signal.aborted
        })
      }, inactivityMs)
    }

    const onUserAbort = (): void => attemptController.abort()
    if (signal) {
      if (signal.aborted) attemptController.abort()
      else signal.addEventListener('abort', onUserAbort, { once: true })
    }

    try {
      attemptStartedAt = Date.now()
      lastChunkAt = 0
      chunkCount = 0
      startVitalsHeartbeat()
      armInactivityTimer()
      trace('chatStream.attempt.start', { traceId, retries, attemptStartedAt })
      const stream = await client.chat.completions.create(
        {
          model: desc.apiModelId,
          messages,
          stream: true,
          tools: usableTools,
          ...(params?.temperature !== undefined && { temperature: params.temperature }),
          ...(params?.topP !== undefined && { top_p: params.topP }),
          ...(params?.maxTokens != null && { max_tokens: params.maxTokens })
        },
        { signal: attemptController.signal }
      )
      trace('chatStream.sdk.stream-resolved', {
        traceId,
        retries,
        delayMs: Date.now() - attemptStartedAt
      })

      // DBG2 — manual iteration so we can log each .next() lifecycle and
      // see whether the hang lives at iterator.next or at chunk-process.
      const iter = (stream as unknown as AsyncIterable<any>)[Symbol.asyncIterator]()
      let iterIndex = 0
      while (true) {
        const nextStartedAt = Date.now()
        trace('chatStream.iter.next.await', {
          traceId,
          retries,
          iterIndex,
          msSinceLastChunk: lastChunkAt === 0 ? null : nextStartedAt - lastChunkAt,
          inactivityFired,
          attemptControllerAborted: attemptController.signal.aborted,
          parentSignalAborted: signal?.aborted ?? null
        })
        let iterResult: IteratorResult<any>
        try {
          iterResult = await iter.next()
        } catch (iterErr: any) {
          trace('chatStream.iter.next.throw', {
            traceId,
            retries,
            iterIndex,
            waitMs: Date.now() - nextStartedAt,
            errName: iterErr?.name,
            errMessage: String(iterErr?.message ?? iterErr).slice(0, 200),
            inactivityFired,
            attemptControllerAborted: attemptController.signal.aborted,
            parentSignalAborted: signal?.aborted ?? null
          })
          throw iterErr
        }
        trace('chatStream.iter.next.resolved', {
          traceId,
          retries,
          iterIndex,
          waitMs: Date.now() - nextStartedAt,
          done: iterResult.done,
          hasValue: iterResult.value !== undefined
        })
        if (iterResult.done) break
        const chunk = iterResult.value
        iterIndex++
        clearInactivityTimer()
        lastChunkAt = Date.now()
        chunkCount++
        if (signal?.aborted) {
          stopVitalsHeartbeat()
          callbacks.onDone(
            fullContent + ' [cancelled]',
            undefined,
            fullReasoning || undefined
          )
          emitModelRequestCompleted(desc, audit, {
            streaming: true,
            toolCount: offeredToolCount,
            retryCount: retries,
            durationMs: Date.now() - startedAt,
            cancelled: true,
            emittedToolCallCount: toolCallsAccumulator.size
          })
          return
        }

        const delta = chunk.choices[0]?.delta as
          | (typeof chunk.choices[0]['delta'] & {
              reasoning_content?: string | null
              reasoning?: string | null
            })
          | undefined

        let chunkKind: string = 'empty'
        if (delta?.content) {
          chunkKind = 'content'
          fullContent += delta.content
          callbacks.onChunk(delta.content)
        }

        // DeepSeek reasoners + V4-Flash thinking-mode emit chain-of-thought
        // on `delta.reasoning_content`. OpenRouter normalizes the same channel
        // to `delta.reasoning`. Forward whichever the provider sends so the
        // renderer can show a live "thinking…" block.
        const reasoningDelta =
          (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) ||
          (typeof delta?.reasoning === 'string' && delta.reasoning) ||
          ''
        if (reasoningDelta) {
          chunkKind = chunkKind === 'content' ? 'content+reasoning' : 'reasoning'
          fullReasoning += reasoningDelta
          callbacks.onReasoning?.(reasoningDelta)
        }

        if (delta?.tool_calls) {
          chunkKind = chunkKind === 'empty' ? 'tool_call' : chunkKind + '+tool_call'
          for (const tc of delta.tool_calls) {
            const idx = tc.index
            if (!toolCallsAccumulator.has(idx)) {
              toolCallsAccumulator.set(idx, {
                id: tc.id || '',
                type: 'function',
                function: { name: '', arguments: '' }
              })
            }
            const acc = toolCallsAccumulator.get(idx)!
            if (tc.id) acc.id = tc.id
            if (tc.function?.name) acc.function.name = tc.function.name
            if (tc.function?.arguments) acc.function.arguments += tc.function.arguments
          }
        }
        trace('chatStream.chunk.processed', {
          traceId,
          retries,
          iterIndex,
          chunkKind,
          chunkCount,
          contentDeltaLen: delta?.content?.length ?? 0,
          reasoningDeltaLen: reasoningDelta.length,
          finishReason: chunk.choices?.[0]?.finish_reason ?? null
        })
        armInactivityTimer()
      }

      trace('chatStream.iter.done', {
        traceId,
        retries,
        chunkCount,
        contentLen: fullContent.length,
        reasoningLen: fullReasoning.length,
        toolCalls: toolCallsAccumulator.size
      })
      clearInactivityTimer()
      stopVitalsHeartbeat()
      if (signal) signal.removeEventListener('abort', onUserAbort)

      const toolCalls = toolCallsAccumulator.size > 0
        ? Array.from(toolCallsAccumulator.values())
        : undefined

      callbacks.onDone(fullContent, toolCalls, fullReasoning || undefined)
      emitModelRequestCompleted(desc, audit, {
        streaming: true,
        toolCount: offeredToolCount,
        retryCount: retries,
        durationMs: Date.now() - startedAt,
        cancelled: false,
        emittedToolCallCount: toolCalls?.length ?? 0
      })
      return
    } catch (err: any) {
      clearInactivityTimer()
      stopVitalsHeartbeat()
      if (signal) signal.removeEventListener('abort', onUserAbort)

      trace('chatStream.catch.entered', {
        traceId,
        retries,
        errName: err?.name,
        errStatus: err?.status,
        errMessage: String(err?.message ?? err).slice(0, 200),
        inactivityFired,
        parentSignalAborted: signal?.aborted ?? null,
        attemptControllerAborted: attemptController.signal.aborted,
        chunkCount,
        fullContentLen: fullContent.length,
        fullReasoningLen: fullReasoning.length
      })

      // User-cancelled — the attempt controller was fired by the user signal,
      // not the watchdog. Treat as a clean cancellation regardless of which
      // error the SDK threw on the way out.
      if (signal?.aborted) {
        callbacks.onDone(
          fullContent + ' [cancelled]',
          undefined,
          fullReasoning || undefined
        )
        emitModelRequestCompleted(desc, audit, {
          streaming: true,
          toolCount: offeredToolCount,
          retryCount: retries,
          durationMs: Date.now() - startedAt,
          cancelled: true,
          emittedToolCallCount: toolCallsAccumulator.size
        })
        return
      }

      // Inactivity watchdog fired. Treat like a transient network error:
      // retry up to maxRetries with the same back-off, then emit a clearly
      // labeled error so the user knows the provider stalled (not bad code).
      if (inactivityFired) {
        if (retries < maxRetries) {
          retries++
          const delay = Math.pow(2, retries) * 1000
          trace('chatStream.retry.inactivity', { traceId, retries, backoffMs: delay })
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        const stallErr = new StreamInactivityError(inactivityMs)
        trace('chatStream.exit.inactivity-exhausted', {
          traceId,
          retries,
          inactivityMs,
          contentLen: fullContent.length,
          reasoningLen: fullReasoning.length
        })
        callbacks.onError(stallErr.message, {
          content: fullContent,
          reasoning: fullReasoning || undefined
        })
        emitModelRequestFailed(desc, audit, {
          streaming: true,
          toolCount: offeredToolCount,
          retryCount: retries,
          durationMs: Date.now() - startedAt,
          cancelled: false,
          error: stallErr
        })
        return
      }

      if (err?.status === 401 || err?.status === 403) {
        callbacks.onError(
          `Invalid ${PROVIDERS[desc.provider].label} API key`,
          { content: fullContent, reasoning: fullReasoning || undefined }
        )
        emitModelRequestFailed(desc, audit, {
          streaming: true,
          toolCount: offeredToolCount,
          retryCount: retries,
          durationMs: Date.now() - startedAt,
          cancelled: false,
          error: err,
          httpStatus: err?.status
        })
        return
      }

      if (err?.status === 429 && retries < maxRetries) {
        retries++
        const delay = Math.pow(2, retries) * 1000
        await new Promise((r) => setTimeout(r, delay))
        continue
      }

      if (retries < maxRetries && !err?.status) {
        retries++
        const delay = Math.pow(2, retries) * 1000
        await new Promise((r) => setTimeout(r, delay))
        continue
      }

      callbacks.onError(
        err?.message || 'Unknown error',
        { content: fullContent, reasoning: fullReasoning || undefined }
      )
      emitModelRequestFailed(desc, audit, {
        streaming: true,
        toolCount: offeredToolCount,
        retryCount: retries,
        durationMs: Date.now() - startedAt,
        cancelled: false,
        error: err,
        httpStatus: err?.status
      })
      return
    }
  }
}

// ──────────────────── model-request audit helpers ────────────────────

// Producers for `model.request.*` events. The handlers above call these at
// every terminal point — clean completion, signal-cancelled mid-stream,
// non-retryable error, retries-exhausted error. The wrapper try/catches keep
// the chat path resilient: any event-log failure must not poison the
// response we hand back to chat.ts.

interface ModelRequestStartedOptions {
  streaming: boolean
  toolCount: number
}

function emitModelRequestStarted(
  desc: ModelDescriptor,
  audit: ModelRequestAudit | undefined,
  opts: ModelRequestStartedOptions
): void {
  if (!audit) return
  try {
    recordEvent({
      type: 'model.request.started',
      actorKind: 'system',
      conversationId: audit.conversationId,
      correlationId: audit.correlationId,
      entityKind: 'model',
      entityId: desc.id,
      payload: {
        provider: desc.provider,
        model: desc.id,
        apiModelId: desc.apiModelId,
        streaming: opts.streaming,
        toolCount: opts.toolCount,
        role: audit.role,
        purpose: audit.purpose ?? 'main'
      }
    })
  } catch (err) {
    console.error('[providers] model.request.started event failed:', err)
  }
}

interface ModelRequestCompletedOptions {
  streaming: boolean
  toolCount: number
  retryCount: number
  durationMs: number
  cancelled: boolean
  finishReason?: string
  emittedToolCallCount?: number
}

function emitModelRequestCompleted(
  desc: ModelDescriptor,
  audit: ModelRequestAudit | undefined,
  opts: ModelRequestCompletedOptions
): void {
  if (!audit) return
  try {
    recordEvent({
      type: 'model.request.completed',
      actorKind: 'model',
      severity: opts.cancelled ? 'warning' : 'info',
      conversationId: audit.conversationId,
      correlationId: audit.correlationId,
      entityKind: 'model',
      entityId: desc.id,
      payload: {
        provider: desc.provider,
        model: desc.id,
        apiModelId: desc.apiModelId,
        streaming: opts.streaming,
        toolCount: opts.toolCount,
        emittedToolCallCount: opts.emittedToolCallCount ?? 0,
        retryCount: opts.retryCount,
        durationMs: opts.durationMs,
        cancelled: opts.cancelled,
        finishReason: opts.finishReason,
        role: audit.role,
        purpose: audit.purpose ?? 'main'
      }
    })
  } catch (err) {
    console.error('[providers] model.request.completed event failed:', err)
  }
}

interface ModelRequestFailedOptions {
  streaming: boolean
  toolCount: number
  retryCount: number
  durationMs: number
  cancelled: boolean
  error: unknown
  httpStatus?: number
}

function emitModelRequestFailed(
  desc: ModelDescriptor,
  audit: ModelRequestAudit | undefined,
  opts: ModelRequestFailedOptions
): void {
  if (!audit) return
  try {
    const err = opts.error as { message?: string; name?: string } | undefined
    recordEvent({
      type: 'model.request.failed',
      actorKind: 'model',
      severity: 'error',
      conversationId: audit.conversationId,
      correlationId: audit.correlationId,
      entityKind: 'model',
      entityId: desc.id,
      payload: {
        provider: desc.provider,
        model: desc.id,
        apiModelId: desc.apiModelId,
        streaming: opts.streaming,
        toolCount: opts.toolCount,
        retryCount: opts.retryCount,
        durationMs: opts.durationMs,
        httpStatus: opts.httpStatus,
        cancelled: opts.cancelled,
        errorClass: err?.name,
        errorPreview: boundedJsonPreview(err?.message),
        role: audit.role,
        purpose: audit.purpose ?? 'main'
      }
    })
  } catch (e) {
    console.error('[providers] model.request.failed event failed:', e)
  }
}
