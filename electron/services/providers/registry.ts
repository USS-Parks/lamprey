import OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import { getKey } from '../keychain'

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

export interface ChatStreamCallbacks {
  onChunk: (content: string) => void
  onDone: (fullContent: string, toolCalls?: ToolCallAccumulator[]) => void
  onError: (error: string) => void
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

export async function chatOnce(
  messages: ChatCompletionMessageParam[],
  modelId: string,
  signal?: AbortSignal
): Promise<string> {
  const desc = resolveModel(modelId)
  const client = getClientForProvider(desc.provider)
  const response = await client.chat.completions.create(
    {
      model: desc.apiModelId,
      messages
    },
    signal ? { signal } : undefined
  )
  return response.choices[0]?.message?.content || ''
}

export async function chatStream(
  messages: ChatCompletionMessageParam[],
  modelId: string,
  tools: ChatCompletionTool[] | undefined,
  callbacks: ChatStreamCallbacks,
  signal?: AbortSignal,
  params?: ChatStreamParams
): Promise<void> {
  const desc = resolveModel(modelId)
  const client = getClientForProvider(desc.provider)
  const usableTools = desc.supportsTools && tools && tools.length > 0 ? tools : undefined

  let fullContent = ''
  const toolCallsAccumulator: Map<number, ToolCallAccumulator> = new Map()
  let retries = 0
  const maxRetries = 3

  while (retries <= maxRetries) {
    try {
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
        { signal }
      )

      for await (const chunk of stream) {
        if (signal?.aborted) {
          callbacks.onDone(fullContent + ' [cancelled]')
          return
        }

        const delta = chunk.choices[0]?.delta

        if (delta?.content) {
          fullContent += delta.content
          callbacks.onChunk(delta.content)
        }

        if (delta?.tool_calls) {
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
      }

      const toolCalls = toolCallsAccumulator.size > 0
        ? Array.from(toolCallsAccumulator.values())
        : undefined

      callbacks.onDone(fullContent, toolCalls)
      return
    } catch (err: any) {
      if (signal?.aborted) {
        callbacks.onDone(fullContent + ' [cancelled]')
        return
      }

      if (err?.status === 401 || err?.status === 403) {
        callbacks.onError(`Invalid ${PROVIDERS[desc.provider].label} API key`)
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

      callbacks.onError(err?.message || 'Unknown error')
      return
    }
  }
}
