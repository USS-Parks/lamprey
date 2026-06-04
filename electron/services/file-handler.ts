import { readFile, stat } from 'fs/promises'
import { basename, extname } from 'path'

export type AttachmentKind = 'text' | 'image' | 'pdf' | 'binary' | 'rag-pending'

export interface ProcessedFile {
  name: string
  kind: AttachmentKind
  mimeType: string
  size: number
  content: string
  previewText: string
  error?: string
  /** Absolute path on disk for files that aren't read inline. Populated for
   *  `kind: 'rag-pending'` so the auto-attach IPC can hand the path to the
   *  ingest manager without re-resolving it. Undefined for inline-read files
   *  (their content is already in `content`). */
  sourcePath?: string
  /** Surfaced when a file lands at the "inline-warn" tier (e.g. a 50 MB CSV).
   *  Renderer shows this as a non-blocking toast instead of an error. */
  warning?: string
}

// ──────────────────── extension groups ────────────────────

const DOCUMENT_EXTS = new Set([
  '.pdf',
  '.docx'
  // .doc / .odt / .rtf intentionally omitted — mammoth handles .docx only
  // and pdf-parse handles .pdf only; other office formats would need
  // their own loader before being safe to route through RAG.
])

const PROSE_EXTS = new Set(['.md', '.mdx', '.rst', '.txt', '.adoc'])

const STRUCTURED_DATA_EXTS = new Set([
  '.csv',
  '.tsv',
  '.json',
  '.jsonc',
  '.jsonl',
  '.ndjson',
  '.yaml',
  '.yml',
  '.toml',
  '.xml'
])

const CODE_EXTS = new Set([
  '.py',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.php',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.r',
  '.lua',
  '.svelte',
  '.vue',
  '.dart',
  '.scala',
  '.clj',
  '.ex',
  '.exs',
  '.erl',
  '.hs',
  '.ml',
  '.fs',
  '.fsx'
])

// All "text-readable" extensions for the legacy `TEXT_EXTS.has(ext) || ext === ''`
// fallback path inside processOne. Kept as a single union for backward compat
// with the existing call site; new routing logic uses the grouped sets above.
const TEXT_EXTS = new Set<string>([...PROSE_EXTS, ...STRUCTURED_DATA_EXTS, ...CODE_EXTS])

const IMAGE_EXTS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

// ──────────────────── routing ────────────────────

/** Outcome of the file-type router. The processOne function uses it to
 *  decide how to read + shape the resulting ProcessedFile. */
export type RouteAction =
  | { action: 'inline' }
  | { action: 'inline-warn'; warning: string }
  | { action: 'rag' }
  | { action: 'image' }
  | { action: 'reject'; reason: string }

// Defaults are tuned for DeepSeek V4 / Gemma / Qwen — cheap tokens, large
// context windows. Override these via Settings → Context Routing (H5) when
// running on more expensive models.
export interface RoutingThresholds {
  /** Prose (.md/.txt/.rst/etc): files at or under this size inline; above → RAG. */
  proseInlineMaxBytes: number
  /** Structured data (.json/.csv/.yaml/etc): inline up to this size. */
  structuredInlineMaxBytes: number
  /** Structured data warning tier: inline-with-toast up to this size; above → reject. */
  structuredInlineWarnMaxBytes: number
  /** Source code: inline up to this size. */
  codeInlineMaxBytes: number
  /** Source code: above this and below MAX_BYTES_PER_FILE → reject with
   *  "use grep_workspace + read_file" guidance. Code files are usually
   *  attached because the user wants you to read THIS file; if it's
   *  implausibly huge the user almost certainly misclicked. */
  codeInlineWarnMaxBytes: number
}

export const DEFAULT_ROUTING: RoutingThresholds = {
  proseInlineMaxBytes: 50 * 1024,
  structuredInlineMaxBytes: 10 * 1024 * 1024,
  structuredInlineWarnMaxBytes: 50 * 1024 * 1024,
  codeInlineMaxBytes: 2 * 1024 * 1024,
  codeInlineWarnMaxBytes: 5 * 1024 * 1024
}

const MAX_BYTES_PER_FILE = 100 * 1024 * 1024
const MAX_BYTES_TOTAL = 250 * 1024 * 1024
const PREVIEW_CHARS = 200

/**
 * Pure router — decides what to do with a file given its extension + size.
 * Replaces the v0.1.43 size-only logic. Documents always go to RAG;
 * structured data + prose + code each get their own thresholds. Images
 * always inline (vision needs the bytes). Everything else rejects.
 *
 * Exported for unit testing the matrix exhaustively.
 */
export function decideRoute(
  ext: string,
  size: number,
  thresholds: RoutingThresholds = DEFAULT_ROUTING
): RouteAction {
  // Global hard cap first — nothing escapes this regardless of extension.
  if (size > MAX_BYTES_PER_FILE) {
    return {
      action: 'reject',
      reason: `File exceeds 100MB limit (${Math.round(size / 1024 / 1024)} MB). Split into smaller files.`
    }
  }

  if (IMAGE_EXTS[ext]) {
    return { action: 'image' }
  }

  // Documents → always RAG, regardless of size. Layout-heavy formats
  // (PDF, DOCX) benefit from chunking + page-aware citation; inlining a
  // 50 KB PDF directly works but loses the citation benefits.
  if (DOCUMENT_EXTS.has(ext)) {
    return { action: 'rag' }
  }

  // Prose — short notes inline, long ones RAG (chunking pays off once
  // headings + sections matter for retrieval).
  if (PROSE_EXTS.has(ext)) {
    return size <= thresholds.proseInlineMaxBytes
      ? { action: 'inline' }
      : { action: 'rag' }
  }

  // Structured data — never RAG (chunking a CSV yields 800-char shards of
  // unrelated rows). Inline up to threshold, warn-inline up to warn cap,
  // reject above (the model can still read it via read_file with offset).
  if (STRUCTURED_DATA_EXTS.has(ext)) {
    if (size <= thresholds.structuredInlineMaxBytes) {
      return { action: 'inline' }
    }
    if (size <= thresholds.structuredInlineWarnMaxBytes) {
      return {
        action: 'inline-warn',
        warning: `Large ${ext} attachment (${formatMB(size)}). Inlining will use ~${estimateTokensK(size)}K tokens.`
      }
    }
    return {
      action: 'reject',
      reason: `${ext} attachment is ${formatMB(size)}. Cap is ${formatMB(thresholds.structuredInlineWarnMaxBytes)}. Use read_file with offset/limit to slice it.`
    }
  }

  // Source code — inline up to threshold, reject above with explicit
  // "use the agentic tools" guidance. The model has read_file +
  // grep_workspace + glob_workspace; an 8 MB attached .tsx file is
  // almost always a misclick.
  if (CODE_EXTS.has(ext)) {
    if (size <= thresholds.codeInlineMaxBytes) {
      return { action: 'inline' }
    }
    if (size <= thresholds.codeInlineWarnMaxBytes) {
      return {
        action: 'inline-warn',
        warning: `Large source-code attachment (${formatMB(size)}). Consider using grep_workspace + read_file instead of attaching the whole file.`
      }
    }
    return {
      action: 'reject',
      reason: `Source-code attachment is ${formatMB(size)}, above the ${formatMB(thresholds.codeInlineWarnMaxBytes)} cap. Use grep_workspace to find what you need, then read_file to read it.`
    }
  }

  // No-extension files (Dockerfile, Makefile, AGENTS.md sans extension, ...):
  // treat as prose with the prose thresholds. The legacy code path included
  // these in the "text" inline bucket; we preserve that behavior here so
  // existing flows don't break.
  if (ext === '') {
    return size <= thresholds.proseInlineMaxBytes
      ? { action: 'inline' }
      : { action: 'rag' }
  }

  // Everything else (unknown extension, unrecognized binary). Reject —
  // we can't decode it as text, can't index it as a document, can't
  // base64-encode it as an image. The model still has the file on disk
  // and can shell out if it absolutely must (CSV-like format we don't
  // recognize, etc.).
  return {
    action: 'reject',
    reason: `Unsupported file type "${ext || '(no extension)'}" — only documents (PDF/DOCX), prose (MD/TXT), structured data (JSON/CSV/YAML/XML), source code, and images are inlineable.`
  }
}

function formatMB(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function estimateTokensK(bytes: number): number {
  // Rough ~4 bytes/token for English text. Generous upper bound for
  // structured data which compresses better. The UI just needs an
  // order-of-magnitude hint.
  return Math.round(bytes / 4 / 1000)
}

function previewOf(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length <= PREVIEW_CHARS ? trimmed : trimmed.slice(0, PREVIEW_CHARS) + '…'
}

function lineCount(text: string): number {
  if (!text) return 0
  return text.split(/\r?\n/).length
}

async function processOne(
  filePath: string,
  thresholds: RoutingThresholds = DEFAULT_ROUTING
): Promise<ProcessedFile> {
  const name = basename(filePath)
  const ext = extname(filePath).toLowerCase()
  let size: number
  try {
    size = (await stat(filePath)).size
  } catch (err) {
    return {
      name,
      kind: 'binary',
      mimeType: 'application/octet-stream',
      size: 0,
      content: '',
      previewText: '',
      error: `Could not read file: ${(err as Error).message}`
    }
  }

  const route = decideRoute(ext, size, thresholds)

  if (route.action === 'reject') {
    return {
      name,
      kind: 'binary',
      mimeType: 'application/octet-stream',
      size,
      content: '',
      previewText: '',
      error: route.reason
    }
  }

  if (route.action === 'rag') {
    return {
      name,
      kind: 'rag-pending',
      mimeType: ext === '.pdf' ? 'application/pdf' : 'application/octet-stream',
      size,
      content: '',
      previewText: '',
      sourcePath: filePath
    }
  }

  if (route.action === 'image') {
    try {
      const buf = await readFile(filePath)
      const base64 = buf.toString('base64')
      const dataUrl = `data:${IMAGE_EXTS[ext]};base64,${base64}`
      return {
        name,
        kind: 'image',
        mimeType: IMAGE_EXTS[ext],
        size,
        content: dataUrl,
        previewText: `Image (${Math.round(size / 1024)} KB)`
      }
    } catch (err) {
      return {
        name,
        kind: 'image',
        mimeType: IMAGE_EXTS[ext],
        size,
        content: '',
        previewText: '',
        error: `Could not read image: ${(err as Error).message}`
      }
    }
  }

  // route.action === 'inline' or 'inline-warn'. Both read the file fully;
  // the difference is whether a non-blocking warning gets surfaced.
  const warning = route.action === 'inline-warn' ? route.warning : undefined

  // PDF inline path. With the new router only fires for tiny .pdf files
  // that fall under proseInlineMaxBytes via the no-route fallback —
  // wait, .pdf always routes to RAG. So this branch never runs for .pdf.
  // Keeping the no-extension/text path below is what matters.

  if (TEXT_EXTS.has(ext) || ext === '') {
    try {
      const text = await readFile(filePath, 'utf-8')
      return {
        name,
        kind: 'text',
        mimeType: 'text/plain',
        size,
        content: text,
        previewText: `${lineCount(text)} lines · ${previewOf(text)}`,
        warning
      }
    } catch (err) {
      return {
        name,
        kind: 'binary',
        mimeType: 'application/octet-stream',
        size,
        content: '',
        previewText: '',
        error: `Could not decode as UTF-8: ${(err as Error).message}`
      }
    }
  }

  // Shouldn't reach here — decideRoute would have rejected unknown
  // extensions before we got this far. Belt-and-suspenders fallback.
  return {
    name,
    kind: 'binary',
    mimeType: 'application/octet-stream',
    size,
    content: '',
    previewText: '',
    error: `Internal routing error: ext "${ext}" decided "${route.action}" but no inline handler matched`
  }
}

/**
 * Resolve effective routing thresholds. Caller can pass an override map
 * (typically Settings → Context Routing); missing keys fall through to
 * DEFAULT_ROUTING. Exported for unit testing the merge.
 */
export function resolveThresholds(
  override?: Partial<RoutingThresholds> | null
): RoutingThresholds {
  if (!override) return DEFAULT_ROUTING
  return {
    proseInlineMaxBytes:
      typeof override.proseInlineMaxBytes === 'number' && override.proseInlineMaxBytes > 0
        ? override.proseInlineMaxBytes
        : DEFAULT_ROUTING.proseInlineMaxBytes,
    structuredInlineMaxBytes:
      typeof override.structuredInlineMaxBytes === 'number' && override.structuredInlineMaxBytes > 0
        ? override.structuredInlineMaxBytes
        : DEFAULT_ROUTING.structuredInlineMaxBytes,
    structuredInlineWarnMaxBytes:
      typeof override.structuredInlineWarnMaxBytes === 'number' && override.structuredInlineWarnMaxBytes > 0
        ? override.structuredInlineWarnMaxBytes
        : DEFAULT_ROUTING.structuredInlineWarnMaxBytes,
    codeInlineMaxBytes:
      typeof override.codeInlineMaxBytes === 'number' && override.codeInlineMaxBytes > 0
        ? override.codeInlineMaxBytes
        : DEFAULT_ROUTING.codeInlineMaxBytes,
    codeInlineWarnMaxBytes:
      typeof override.codeInlineWarnMaxBytes === 'number' && override.codeInlineWarnMaxBytes > 0
        ? override.codeInlineWarnMaxBytes
        : DEFAULT_ROUTING.codeInlineWarnMaxBytes
  }
}

export async function processFiles(
  paths: string[],
  thresholds?: Partial<RoutingThresholds> | null
): Promise<ProcessedFile[]> {
  const effective = resolveThresholds(thresholds)
  const results: ProcessedFile[] = []
  let totalBytes = 0
  for (const p of paths) {
    if (totalBytes > MAX_BYTES_TOTAL) {
      results.push({
        name: basename(p),
        kind: 'binary',
        mimeType: 'application/octet-stream',
        size: 0,
        content: '',
        previewText: '',
        error: 'Skipped — combined attachment size would exceed 250MB.'
      })
      continue
    }
    const processed = await processOne(p, effective)
    totalBytes += processed.size
    results.push(processed)
  }
  return results
}
