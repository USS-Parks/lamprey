import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { extname, join, relative, resolve, sep } from 'path'
import { getImageGenProvider, type ImageBytes } from './image-gen-providers'

// image_generate / image_edit / image_variation executors.
//
// Each executor consults the configured provider via getImageGenProvider(),
// writes the resulting bytes into the userData artifacts/images directory,
// and returns the absolute path(s). Provider selection + credentials live in
// image-gen-providers.ts.

const NO_PROVIDER_ERR =
  'Error: No image generation provider configured. Configure in Settings → Image Generation.'

const PROMPT_PREVIEW_CHARS = 80
const MAX_VARIATIONS = 4

export interface ImageGenerateArgs {
  prompt: string
  size?: string
  quality?: string
}

export interface ImageEditArgs {
  prompt: string
  image_path: string
  mask_path?: string
  size?: string
}

export interface ImageVariationArgs {
  image_path: string
  size?: string
  n?: number
}

function artifactsDir(): string {
  const dir = join(app.getPath('userData'), 'artifacts', 'images')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function randomSuffix(): string {
  // 6-char base36 — enough to avoid collisions inside the same millisecond
  // without dragging in `crypto.randomUUID` for a filename.
  return Math.random().toString(36).slice(2, 8)
}

function extForMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/webp':
      return '.webp'
    default:
      return '.png'
  }
}

function writeBytes(bytes: ImageBytes, kind: 'gen' | 'edit' | 'var'): string {
  const ext = extForMime(bytes.mimeType)
  const filename = `img-${kind}-${Date.now()}-${randomSuffix()}${ext}`
  const dest = join(artifactsDir(), filename)
  writeFileSync(dest, bytes.bytes)
  return dest
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}

// Allowed input roots for image_edit / image_variation: the workspace tree
// and the Lamprey userData/artifacts directory (where image_generate writes).
// Without this boundary the tool can read arbitrary files off disk and upload
// them to the configured image-gen API — a quiet exfiltration path.
function allowedImageRoots(): string[] {
  const roots = [resolve(process.cwd())]
  try {
    roots.push(resolve(join(app.getPath('userData'), 'artifacts')))
  } catch {
    // app not initialised (headless test) — workspace root is the floor.
  }
  return roots
}

function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`) && !resolve(rel).match(/^[A-Za-z]:/))
}

function validateExistingImagePath(p: string, label: string): string | { error: string } {
  if (typeof p !== 'string' || p.trim() === '') {
    return { error: `${label} is required` }
  }
  if (p.includes('..')) {
    return { error: `${label} must not contain ".." segments` }
  }
  const abs = resolve(p)
  if (!existsSync(abs)) return { error: `${label} not found at ${abs}` }
  const ext = extname(abs).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    return { error: `${label} extension must be .png, .jpg, .jpeg, or .webp (got "${ext}")` }
  }
  const roots = allowedImageRoots()
  if (!roots.some((root) => isWithin(abs, root))) {
    return {
      error: `${label} must be inside the workspace or userData/artifacts (got ${abs})`
    }
  }
  return abs
}

// ─────────────────────────── image_generate ───────────────────────────

export async function executeImageGenerate(args: ImageGenerateArgs): Promise<string> {
  const prompt = typeof args?.prompt === 'string' ? args.prompt : ''
  if (!prompt.trim()) return 'Error: prompt is required and must be a non-empty string.'

  const provider = getImageGenProvider()
  if (!provider.isConfigured()) return NO_PROVIDER_ERR

  try {
    const images = await provider.generate({
      prompt,
      size: typeof args.size === 'string' ? args.size : undefined,
      quality: typeof args.quality === 'string' ? args.quality : undefined
    })
    if (images.length === 0) return 'Error: provider returned no images.'
    const dest = writeBytes(images[0], 'gen')
    const modelLabel = describeModel(provider.id, 'gpt-image-1')
    return `Generated image at ${dest} (model: ${modelLabel}, prompt: "${truncate(prompt, PROMPT_PREVIEW_CHARS)}")`
  } catch (err: any) {
    return `Error: ${err?.message ?? 'image generation failed'}`
  }
}

// ───────────────────────────── image_edit ─────────────────────────────

export async function executeImageEdit(args: ImageEditArgs): Promise<string> {
  const prompt = typeof args?.prompt === 'string' ? args.prompt : ''
  if (!prompt.trim()) return 'Error: prompt is required and must be a non-empty string.'

  const imgCheck = validateExistingImagePath(args?.image_path, 'image_path')
  if (typeof imgCheck !== 'string') return `Error: ${imgCheck.error}`

  let maskAbs: string | undefined
  if (args?.mask_path !== undefined && args.mask_path !== '') {
    const maskCheck = validateExistingImagePath(args.mask_path, 'mask_path')
    if (typeof maskCheck !== 'string') return `Error: ${maskCheck.error}`
    maskAbs = maskCheck
  }

  const provider = getImageGenProvider()
  if (!provider.isConfigured()) return NO_PROVIDER_ERR

  try {
    const images = await provider.edit({
      prompt,
      imagePath: imgCheck,
      maskPath: maskAbs,
      size: typeof args.size === 'string' ? args.size : undefined
    })
    if (images.length === 0) return 'Error: provider returned no images.'
    const dest = writeBytes(images[0], 'edit')
    return `Edited image saved to ${dest}`
  } catch (err: any) {
    return `Error: ${err?.message ?? 'image edit failed'}`
  }
}

// ─────────────────────────── image_variation ──────────────────────────

export async function executeImageVariation(args: ImageVariationArgs): Promise<string> {
  const imgCheck = validateExistingImagePath(args?.image_path, 'image_path')
  if (typeof imgCheck !== 'string') return `Error: ${imgCheck.error}`

  const requestedN = typeof args?.n === 'number' ? Math.floor(args.n) : 1
  const n = Math.max(1, Math.min(MAX_VARIATIONS, requestedN))

  const provider = getImageGenProvider()
  if (!provider.isConfigured()) return NO_PROVIDER_ERR

  try {
    const images = await provider.variation({
      imagePath: imgCheck,
      size: typeof args.size === 'string' ? args.size : undefined,
      n
    })
    if (images.length === 0) return 'Error: provider returned no images.'
    const paths = images.map((img) => writeBytes(img, 'var'))
    return `Variation image(s) saved to ${paths.join(', ')}`
  } catch (err: any) {
    return `Error: ${err?.message ?? 'image variation failed'}`
  }
}

function describeModel(providerId: string, fallback: string): string {
  return `${providerId}/${fallback}`
}
