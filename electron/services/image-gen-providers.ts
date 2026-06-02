import { readFileSync, statSync } from 'fs'
import { extname } from 'path'
import { getKey } from './keychain'
import { readSettings } from './settings-helper'

// Pluggable image generation provider abstraction so the executor in
// image-tools.ts does not bake in OpenAI specifics. Currently OpenAI (real)
// and Stability (stub returning "not implemented").
//
// Provider selection comes from settings.json (`imageGen.provider` / `.model`
// / `.size`). API keys live in the keychain under `image_gen:<provider>` -
// kept namespaced so chat provider keys (`openai`, `deepseek`, ...) and the
// image-gen credentials don't collide. The handler may bring its own key per
// request (used by `imageGen:test`).

export type ImageGenProviderId = 'openai' | 'stability'

export interface ImageGenSettings {
  provider: ImageGenProviderId
  model?: string
  size?: string
}

export const DEFAULT_IMAGE_SETTINGS: ImageGenSettings = {
  provider: 'openai',
  model: 'gpt-image-1',
  size: '1024x1024'
}

const ALLOWED_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024', 'auto'])
const ALLOWED_QUALITIES = new Set(['low', 'medium', 'high', 'auto'])
const MAX_IMAGE_BYTES = 25 * 1024 * 1024 // 25 MB per OpenAI's docs
const NETWORK_TIMEOUT_MS = 60_000

export interface GenerateArgs {
  prompt: string
  size?: string
  quality?: string
  model?: string
}

export interface EditArgs {
  prompt: string
  imagePath: string
  maskPath?: string
  size?: string
  model?: string
}

export interface VariationArgs {
  imagePath: string
  size?: string
  n?: number
  model?: string
}

export interface ImageBytes {
  bytes: Buffer
  mimeType: string
}

export interface ImageGenProvider {
  readonly id: ImageGenProviderId
  /** Whether the provider has the credentials it needs. */
  isConfigured(): boolean
  generate(args: GenerateArgs): Promise<ImageBytes[]>
  edit(args: EditArgs): Promise<ImageBytes[]>
  variation(args: VariationArgs): Promise<ImageBytes[]>
}

// ─────────────────────────── helpers ───────────────────────────

function extensionToMime(path: string): string | null {
  const ext = extname(path).toLowerCase()
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    default:
      return null
  }
}

function readImageFile(path: string): { buf: Buffer; mime: string } {
  let st
  try {
    st = statSync(path)
  } catch {
    throw new Error(`image file not found: ${path}`)
  }
  if (!st.isFile()) throw new Error(`not a file: ${path}`)
  if (st.size > MAX_IMAGE_BYTES) {
    throw new Error(`image file too large (${st.size} bytes, max ${MAX_IMAGE_BYTES})`)
  }
  const mime = extensionToMime(path)
  if (!mime) {
    throw new Error(`unsupported image extension for ${path} (allowed: .png, .jpg, .jpeg, .webp)`)
  }
  const buf = readFileSync(path)
  return { buf, mime }
}

function normalizeSize(size: string | undefined, fallback: string): string {
  if (!size) return fallback
  if (!ALLOWED_SIZES.has(size)) {
    throw new Error(
      `invalid size "${size}" (allowed: ${[...ALLOWED_SIZES].join(', ')})`
    )
  }
  return size
}

function normalizeQuality(quality: string | undefined): string | undefined {
  if (quality === undefined) return undefined
  if (!ALLOWED_QUALITIES.has(quality)) {
    throw new Error(
      `invalid quality "${quality}" (allowed: ${[...ALLOWED_QUALITIES].join(', ')})`
    )
  }
  return quality
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function sanitizeError(err: unknown, key: string): string {
  // Never leak the API key in error output, even by accident.
  const raw = err instanceof Error ? err.message : String(err ?? 'unknown error')
  if (key && raw.includes(key)) return raw.replace(key, '[redacted]')
  return raw
}

// ─────────────────────────── OpenAI provider ───────────────────────────

class OpenAIImageGenProvider implements ImageGenProvider {
  readonly id: ImageGenProviderId = 'openai'

  constructor(
    private apiKey: string | null,
    private model: string = 'gpt-image-1'
  ) {}

  isConfigured(): boolean {
    return typeof this.apiKey === 'string' && this.apiKey.length > 0
  }

  private requireKey(): string {
    if (!this.isConfigured() || !this.apiKey) {
      throw new Error(
        'No image generation provider configured. Configure in Settings → Image Generation.'
      )
    }
    return this.apiKey
  }

  async generate(args: GenerateArgs): Promise<ImageBytes[]> {
    const key = this.requireKey()
    const size = normalizeSize(args.size, '1024x1024')
    const quality = normalizeQuality(args.quality)
    const model = args.model || this.model || 'gpt-image-1'

    const body: Record<string, unknown> = { model, prompt: args.prompt, size, n: 1 }
    if (quality) body.quality = quality

    let resp: Response
    try {
      resp = await fetchWithTimeout('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })
    } catch (err) {
      throw new Error(`OpenAI image generation request failed: ${sanitizeError(err, key)}`, {
        cause: err
      })
    }

    return parseOpenAIImageResponse(resp, key)
  }

  async edit(args: EditArgs): Promise<ImageBytes[]> {
    const key = this.requireKey()
    const size = normalizeSize(args.size, '1024x1024')
    const model = args.model || this.model || 'gpt-image-1'

    const image = readImageFile(args.imagePath)
    let mask: { buf: Buffer; mime: string } | null = null
    if (args.maskPath) mask = readImageFile(args.maskPath)

    const form = new FormData()
    form.append('model', model)
    form.append('prompt', args.prompt)
    form.append('size', size)
    form.append('n', '1')
    form.append(
      'image',
      new Blob([image.buf as unknown as ArrayBuffer], { type: image.mime }),
      basename(args.imagePath)
    )
    if (mask) {
      form.append(
        'mask',
        new Blob([mask.buf as unknown as ArrayBuffer], { type: mask.mime }),
        basename(args.maskPath!)
      )
    }

    let resp: Response
    try {
      resp = await fetchWithTimeout('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form
      })
    } catch (err) {
      throw new Error(`OpenAI image edit request failed: ${sanitizeError(err, key)}`, {
        cause: err
      })
    }
    return parseOpenAIImageResponse(resp, key)
  }

  async variation(args: VariationArgs): Promise<ImageBytes[]> {
    const key = this.requireKey()
    const size = normalizeSize(args.size, '1024x1024')
    // OpenAI's variations endpoint only supports dall-e-2. Force it here so
    // callers can leave args.model undefined.
    const model = args.model || 'dall-e-2'
    const n = Math.max(1, Math.min(4, args.n ?? 1))

    const image = readImageFile(args.imagePath)
    const form = new FormData()
    form.append('model', model)
    form.append('size', size)
    form.append('n', String(n))
    form.append(
      'image',
      new Blob([image.buf as unknown as ArrayBuffer], { type: image.mime }),
      basename(args.imagePath)
    )

    let resp: Response
    try {
      resp = await fetchWithTimeout('https://api.openai.com/v1/images/variations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form
      })
    } catch (err) {
      throw new Error(`OpenAI image variation request failed: ${sanitizeError(err, key)}`, {
        cause: err
      })
    }
    return parseOpenAIImageResponse(resp, key)
  }
}

function basename(p: string): string {
  // Tiny local helper so we don't add a path import just for this. Strip
  // trailing separators, then take the last segment. Works for forward and
  // back slashes.
  const cleaned = p.replace(/[\\/]+$/, '')
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'))
  return idx === -1 ? cleaned : cleaned.slice(idx + 1)
}

async function parseOpenAIImageResponse(
  resp: Response,
  key: string
): Promise<ImageBytes[]> {
  if (!resp.ok) {
    let detail = ''
    try {
      const text = await resp.text()
      detail = text.slice(0, 500)
    } catch {
      // ignore
    }
    throw new Error(
      `OpenAI image API ${resp.status} ${resp.statusText}: ${sanitizeError(detail, key)}`
    )
  }

  let payload: { data?: Array<{ b64_json?: string; url?: string }> }
  try {
    payload = (await resp.json()) as typeof payload
  } catch (err) {
    throw new Error(`OpenAI image API returned non-JSON body: ${sanitizeError(err, key)}`, {
      cause: err
    })
  }
  const data = payload.data ?? []
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('OpenAI image API returned no image data')
  }

  const out: ImageBytes[] = []
  for (const entry of data) {
    if (entry.b64_json) {
      out.push({ bytes: Buffer.from(entry.b64_json, 'base64'), mimeType: 'image/png' })
    } else if (entry.url) {
      // dall-e-2 variations may return a URL. Fetch the bytes inline so the
      // caller doesn't have to know about the two-shape response.
      let imgResp: Response
      try {
        imgResp = await fetchWithTimeout(entry.url, { method: 'GET' })
      } catch (err) {
        throw new Error(`failed to fetch generated image url: ${sanitizeError(err, key)}`, {
          cause: err
        })
      }
      if (!imgResp.ok) {
        throw new Error(
          `image url fetch failed: ${imgResp.status} ${imgResp.statusText}`
        )
      }
      const arr = await imgResp.arrayBuffer()
      const mime = imgResp.headers.get('content-type') ?? 'image/png'
      out.push({ bytes: Buffer.from(arr), mimeType: mime })
    } else {
      throw new Error('OpenAI image API returned a data entry without b64_json or url')
    }
  }
  return out
}

// ─────────────────────────── Stability stub ───────────────────────────

class StabilityImageGenProvider implements ImageGenProvider {
  readonly id: ImageGenProviderId = 'stability'

  isConfigured(): boolean {
    // Even with a key configured, the provider is intentionally not wired up
    // yet. Returning false keeps `imageGen:test` honest.
    return false
  }

  async generate(): Promise<ImageBytes[]> {
    throw new Error('Stability AI provider not yet implemented.')
  }

  async edit(): Promise<ImageBytes[]> {
    throw new Error('Stability AI provider not yet implemented.')
  }

  async variation(): Promise<ImageBytes[]> {
    throw new Error('Stability AI provider not yet implemented.')
  }
}

// ─────────────────────────── factory ───────────────────────────

export function getImageGenSettings(): ImageGenSettings {
  const settings = readSettings()
  const raw = (settings.imageGen as Partial<ImageGenSettings> | undefined) ?? {}
  const provider: ImageGenProviderId =
    raw.provider === 'stability' ? 'stability' : 'openai'
  return {
    provider,
    model: typeof raw.model === 'string' ? raw.model : DEFAULT_IMAGE_SETTINGS.model,
    size: typeof raw.size === 'string' ? raw.size : DEFAULT_IMAGE_SETTINGS.size
  }
}

export function keychainProviderKey(provider: ImageGenProviderId): string {
  return `image_gen:${provider}`
}

/**
 * Resolve the configured provider, loading credentials from the keychain.
 * Always returns a provider instance — `isConfigured()` and the per-call
 * `requireKey` paths are how callers know the credentials aren't there yet.
 */
export function getImageGenProvider(): ImageGenProvider {
  const settings = getImageGenSettings()
  switch (settings.provider) {
    case 'stability':
      return new StabilityImageGenProvider()
    case 'openai':
    default: {
      const key = getKey(keychainProviderKey('openai'))
      return new OpenAIImageGenProvider(key, settings.model || 'gpt-image-1')
    }
  }
}
