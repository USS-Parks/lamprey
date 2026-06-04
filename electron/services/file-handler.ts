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
}

const TEXT_EXTS = new Set([
  '.txt',
  '.md',
  '.mdx',
  '.py',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.json',
  '.jsonc',
  '.csv',
  '.tsv',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
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
  '.vue'
])

const IMAGE_EXTS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

// Inline ingest threshold. At or below this size the file's content is read,
// previewed, and sent inline in the user message. Above it (up to the
// per-file hard cap below) the file is marked `kind: 'rag-pending'`: the
// renderer routes it through the RAG ingest pipeline into a per-conversation
// auto-collection, and augmentForChat retrieves only the relevant chunks at
// send time. This keeps prompt budgets bounded for large PDFs / corpora.
const INLINE_THRESHOLD_BYTES = 5 * 1024 * 1024
const MAX_BYTES_PER_FILE = 100 * 1024 * 1024
const MAX_BYTES_TOTAL = 250 * 1024 * 1024
const PREVIEW_CHARS = 200

function previewOf(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length <= PREVIEW_CHARS ? trimmed : trimmed.slice(0, PREVIEW_CHARS) + '…'
}

function lineCount(text: string): number {
  if (!text) return 0
  return text.split(/\r?\n/).length
}

async function processOne(filePath: string): Promise<ProcessedFile> {
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

  if (size > MAX_BYTES_PER_FILE) {
    return {
      name,
      kind: 'binary',
      mimeType: 'application/octet-stream',
      size,
      content: '',
      previewText: '',
      error: `File exceeds 100MB limit (${Math.round(size / 1024 / 1024)} MB). Split into smaller files.`
    }
  }

  // Images always go inline (base64 in the request body); vision models need
  // the bytes, RAG can't index them. The 100 MB cap above still applies.
  // Everything else over the inline threshold gets routed to RAG ingest.
  if (size > INLINE_THRESHOLD_BYTES && !IMAGE_EXTS[ext]) {
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

  if (IMAGE_EXTS[ext]) {
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

  if (ext === '.pdf') {
    try {
      const buf = await readFile(filePath)
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: buf })
      try {
        const result = await parser.getText()
        const text = result.text || ''
        return {
          name,
          kind: 'pdf',
          mimeType: 'application/pdf',
          size,
          content: text,
          previewText: previewOf(text) || `PDF (${Math.round(size / 1024)} KB)`
        }
      } finally {
        await parser.destroy().catch(() => {})
      }
    } catch (err) {
      return {
        name,
        kind: 'pdf',
        mimeType: 'application/pdf',
        size,
        content: '',
        previewText: '',
        error: `PDF extraction failed: ${(err as Error).message}`
      }
    }
  }

  if (TEXT_EXTS.has(ext) || ext === '') {
    try {
      const text = await readFile(filePath, 'utf-8')
      return {
        name,
        kind: 'text',
        mimeType: 'text/plain',
        size,
        content: text,
        previewText: `${lineCount(text)} lines · ${previewOf(text)}`
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

  return {
    name,
    kind: 'binary',
    mimeType: 'application/octet-stream',
    size,
    content: '',
    previewText: `Binary file (${Math.round(size / 1024)} KB) — content not included.`
  }
}

export async function processFiles(paths: string[]): Promise<ProcessedFile[]> {
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
    const processed = await processOne(p)
    totalBytes += processed.size
    results.push(processed)
  }
  return results
}
