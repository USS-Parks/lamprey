import { readFile, stat } from 'fs/promises'
import { extname } from 'path'

// Plain-text loader: markdown, source code, JSON, YAML, CSV. Binary files
// and oversize files are rejected with explicit errors so the ingest UI can
// surface the actual reason (rather than silently failing or proceeding
// with corrupted UTF-8).

export interface LoadedText {
  text: string
  mime: string
}

// Cap is generous (25 MB) — anything bigger is almost always a misclick on
// a binary file or a corpus dump that should be split into smaller files
// first. The ingest UI can surface this as a clear "file too large" badge.
const MAX_TEXT_BYTES = 25 * 1024 * 1024

// First 4 KB is enough to spot a binary file via NUL-byte presence; that's
// the same heuristic git uses to detect binary blobs.
const BINARY_SNIFF_BYTES = 4 * 1024

const EXT_TO_MIME: Record<string, string> = {
  '.md': 'text/markdown',
  '.mdx': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.ts': 'text/x-typescript',
  '.tsx': 'text/x-tsx',
  '.js': 'text/javascript',
  '.jsx': 'text/x-jsx',
  '.py': 'text/x-python',
  '.rs': 'text/x-rust',
  '.go': 'text/x-go',
  '.java': 'text/x-java',
  '.rb': 'text/x-ruby',
  '.cs': 'text/x-csharp',
  '.cpp': 'text/x-c++',
  '.c': 'text/x-c',
  '.h': 'text/x-c-header',
  '.swift': 'text/x-swift',
  '.kt': 'text/x-kotlin',
  '.sh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript',
  '.ps1': 'text/x-powershell',
  '.html': 'text/html',
  '.css': 'text/css',
  '.scss': 'text/x-scss'
}

export function isSupportedTextExtension(path: string): boolean {
  return extname(path).toLowerCase() in EXT_TO_MIME
}

export async function loadText(path: string): Promise<LoadedText> {
  const ext = extname(path).toLowerCase()
  const mime = EXT_TO_MIME[ext]
  if (!mime) {
    throw new Error(`Unsupported text extension: ${ext || '(none)'}`)
  }
  const stats = await stat(path)
  if (stats.size > MAX_TEXT_BYTES) {
    throw new Error(
      `File exceeds ${MAX_TEXT_BYTES} bytes (got ${stats.size}). Split into smaller files.`
    )
  }
  // Binary sniff: read the first KB raw and check for NUL bytes. We avoid
  // reading the whole file twice by using a buffer load then string decode.
  const buf = await readFile(path)
  const sniffEnd = Math.min(buf.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < sniffEnd; i++) {
    if (buf[i] === 0) {
      throw new Error(`File appears binary (NUL byte at offset ${i}): ${path}`)
    }
  }
  const text = buf.toString('utf-8')
  return { text, mime }
}

/**
 * Load text from an in-memory buffer (for paste / drag-drop string inputs).
 * The caller supplies a display name so the dispatcher can pick a mime by
 * extension. NO PDF/DOCX paste support in v1 — those need their own loaders.
 */
export function loadFromBuffer(
  name: string,
  buffer: Buffer
): LoadedText {
  const ext = extname(name).toLowerCase()
  const mime = EXT_TO_MIME[ext] ?? 'text/plain'
  if (buffer.length > MAX_TEXT_BYTES) {
    throw new Error(
      `Buffer exceeds ${MAX_TEXT_BYTES} bytes (got ${buffer.length})`
    )
  }
  // Same binary sniff as the file-path path.
  const sniffEnd = Math.min(buffer.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < sniffEnd; i++) {
    if (buffer[i] === 0) {
      throw new Error(`Buffer appears binary (NUL byte at offset ${i})`)
    }
  }
  return { text: buffer.toString('utf-8'), mime }
}

export const __MAX_TEXT_BYTES_FOR_TEST = MAX_TEXT_BYTES
