import { readFile, stat } from 'fs/promises'
import { extname } from 'path'
import { resolvePathWithinWorkspace } from './apply-patch-tool'

// Token-aware file reader. The model calls this instead of
// `shell_command cat`/`Get-Content` so the call doesn't pay the shell
// approval round-trip AND comes back as structured content the model can
// reason about by line number.
//
// Pagination follows Claude Code's posture: offset is 1-based, limit
// defaults to 2000, the tool always returns a `cat -n`-style prefix so
// the model can quote line numbers in subsequent tool calls
// (apply_patch, grep_workspace context lines, etc.). When the file
// exceeds the soft cap or the model's range exceeds it, we emit a
// `PARTIAL view` notice describing what's missing.
//
// PDFs use the existing `pdf-parse` dependency — the same one the auto-
// RAG pipeline uses — but only extract the requested pages. The `pages`
// arg accepts "1", "1-5", or "1,3,5"; max 20 pages per call (matches
// Claude Code, keeps per-call PDF parsing bounded).

export interface ReadFileArgs {
  path: string
  offset?: number
  limit?: number
  pages?: string
}

export interface ReadFileResult {
  content: string
  truncated: boolean
  totalLines?: number
  totalPages?: number
  returnedRange?: { start: number; end: number }
}

const DEFAULT_LIMIT = 2000
const SOFT_BYTE_CAP = 256 * 1024
const HARD_BYTE_CAP = 2 * 1024 * 1024
const MAX_PDF_PAGES_PER_CALL = 20
const BINARY_SNIFF_BYTES = 4096

/**
 * Parse the `pages` argument into a sorted, deduplicated, 1-based page
 * list. Accepts "1", "3,5,8", "1-5", or "1,3-5,9". Returns null on a
 * malformed input so the caller emits a precise error.
 */
export function parsePagesArg(raw: string): number[] | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const out: Set<number> = new Set()
  for (const piece of trimmed.split(',')) {
    const part = piece.trim()
    if (part === '') return null
    const dash = part.indexOf('-')
    if (dash === -1) {
      const n = Number.parseInt(part, 10)
      if (!Number.isFinite(n) || n < 1 || String(n) !== part) return null
      out.add(n)
    } else {
      const aStr = part.slice(0, dash).trim()
      const bStr = part.slice(dash + 1).trim()
      const a = Number.parseInt(aStr, 10)
      const b = Number.parseInt(bStr, 10)
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < a) return null
      if (String(a) !== aStr || String(b) !== bStr) return null
      for (let i = a; i <= b; i++) out.add(i)
    }
  }
  return Array.from(out).sort((x, y) => x - y)
}

/**
 * Format a slice of source text as `cat -n` (1-based line numbers,
 * tab separator, trailing newline per line). Caller supplies the
 * absolute starting line so this works on any window.
 */
export function formatWithLineNumbers(lines: string[], startLine: number): string {
  return lines.map((l, i) => `${startLine + i}\t${l}`).join('\n')
}

/** Crude binary sniff: NUL byte in the first 4 KB. Matches files.ts. */
export function isLikelyBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, BINARY_SNIFF_BYTES))
  return sample.includes(0)
}

/**
 * Apply offset+limit to a line array. offset is 1-based; missing/<1
 * defaults to 1. limit > 0; missing defaults to DEFAULT_LIMIT.
 * Returns the window plus the absolute range it covers so callers can
 * stamp accurate `PARTIAL view` notices.
 */
export function sliceLines(
  lines: string[],
  offset: number | undefined,
  limit: number | undefined
): { window: string[]; start: number; end: number; truncated: boolean } {
  const total = lines.length
  const start = offset && offset >= 1 ? Math.floor(offset) : 1
  const n = limit && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT
  const startIdx = Math.min(start - 1, total)
  const endExcl = Math.min(startIdx + n, total)
  return {
    window: lines.slice(startIdx, endExcl),
    start: startIdx + 1,
    end: endExcl,
    truncated: total > endExcl || startIdx > 0
  }
}

/**
 * Build the `PARTIAL view` notice for the model when not all lines fit.
 * Three shapes:
 *  - "PARTIAL view: showing lines 1-500 of 1234" (start of file)
 *  - "PARTIAL view: showing lines 501-1000 of 1234" (middle / offset)
 *  - empty string (no truncation)
 */
export function truncationNotice(start: number, end: number, total: number): string {
  if (start === 1 && end === total) return ''
  return `\n\n[PARTIAL view: showing lines ${start}-${end} of ${total}. Call read_file again with offset=${end + 1} for the next page.]`
}

/**
 * Pure resolver. Takes a workspace root and the user-supplied path,
 * applies the same workspace-bounded check the patch/shell tools use,
 * AND accepts absolute paths that resolve to the same boundary. Returns
 * the resolved absolute path on success or an error string on rejection.
 */
export function resolveReadPath(
  workspaceRoot: string,
  candidate: string
): { ok: true; abs: string } | { ok: false; error: string } {
  if (!candidate || typeof candidate !== 'string' || candidate.trim() === '') {
    return { ok: false, error: 'path is required' }
  }
  const resolved = resolvePathWithinWorkspace(workspaceRoot, candidate)
  if (resolved === null) {
    return {
      ok: false,
      error: `path "${candidate}" resolves outside the workspace root or contains a ".." traversal`
    }
  }
  return { ok: true, abs: resolved }
}

/**
 * Read a non-PDF text file with offset/limit pagination. Returns the
 * cat -n formatted window plus metadata for the PARTIAL notice. Refuses
 * binaries (by NUL-byte sniff) and files over HARD_BYTE_CAP.
 */
export async function readTextFile(
  abs: string,
  offset?: number,
  limit?: number
): Promise<ReadFileResult> {
  const stats = await stat(abs)
  if (stats.size > HARD_BYTE_CAP) {
    throw new Error(
      `file is ${(stats.size / 1024 / 1024).toFixed(1)} MB, hard cap is ${HARD_BYTE_CAP / 1024 / 1024} MB. Use grep_workspace + offset/limit windows instead of reading the whole file.`
    )
  }
  if (stats.size === 0) {
    return { content: '(empty file)', truncated: false, totalLines: 0 }
  }
  const buf = await readFile(abs)
  if (isLikelyBinary(buf)) {
    throw new Error(
      `${abs} appears to be binary (NUL byte in first 4 KB). Use view_image for images; binary blobs are not readable.`
    )
  }
  const text = buf.toString('utf8')
  const lines = text.split(/\r?\n/)
  const totalLines = lines.length
  const { window, start, end, truncated } = sliceLines(lines, offset, limit)

  // Soft byte cap inside the returned window — even a small "limit"
  // could pull massive megabytes if a single line is huge (a minified
  // bundle, say). Bail back to the model with a precise message.
  const windowBytes = Buffer.byteLength(window.join('\n'), 'utf8')
  if (windowBytes > SOFT_BYTE_CAP) {
    throw new Error(
      `requested window is ${(windowBytes / 1024).toFixed(0)} KB, soft cap is ${SOFT_BYTE_CAP / 1024} KB per call. Tighten 'limit' or rely on grep_workspace to find the relevant line first.`
    )
  }

  const formatted = formatWithLineNumbers(window, start)
  const notice = truncated ? truncationNotice(start, end, totalLines) : ''
  return {
    content: formatted + notice,
    truncated,
    totalLines,
    returnedRange: { start, end }
  }
}

/**
 * Read a PDF, optionally restricted to a page range. Pages are 1-based.
 * The output is text-only (no layout); use the regular RAG ingest path
 * if the model needs semantic chunks of the entire document.
 */
export async function readPdfFile(
  abs: string,
  pagesArg?: string
): Promise<ReadFileResult> {
  const stats = await stat(abs)
  if (stats.size > HARD_BYTE_CAP) {
    throw new Error(
      `PDF is ${(stats.size / 1024 / 1024).toFixed(1)} MB, hard cap is ${HARD_BYTE_CAP / 1024 / 1024} MB. Attach via the chip UI to route through RAG.`
    )
  }
  const buf = await readFile(abs)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PDFParse } = (await import('pdf-parse')) as any
  const parser = new PDFParse({ data: buf })
  try {
    const result = await parser.getText()
    const allPages: Array<{ pageNumber?: number; text?: string }> =
      Array.isArray(result?.pages) ? result.pages : []
    const totalPages = allPages.length

    let wanted: number[]
    if (pagesArg) {
      const parsed = parsePagesArg(pagesArg)
      if (!parsed) {
        throw new Error(
          `invalid pages "${pagesArg}". Use e.g. "1", "1-5", "1,3-5,9".`
        )
      }
      if (parsed.length > MAX_PDF_PAGES_PER_CALL) {
        throw new Error(
          `requested ${parsed.length} pages, cap is ${MAX_PDF_PAGES_PER_CALL} per call. Split into smaller requests.`
        )
      }
      wanted = parsed.filter((p) => p <= totalPages)
      if (wanted.length === 0) {
        throw new Error(`no requested pages exist (document has ${totalPages} pages)`)
      }
    } else {
      // No range → first MAX_PDF_PAGES_PER_CALL pages. Prevents the
      // unbounded "send me the whole 500-page PDF inline" pathology.
      wanted = []
      for (let i = 1; i <= Math.min(totalPages, MAX_PDF_PAGES_PER_CALL); i++) {
        wanted.push(i)
      }
    }

    const chunks: string[] = []
    for (const pageNum of wanted) {
      const page = allPages[pageNum - 1]
      const text = (page?.text ?? '').trim()
      chunks.push(`--- Page ${pageNum} ---\n${text || '(no extractable text on this page)'}`)
    }
    const content = chunks.join('\n\n')
    const truncated = wanted.length < totalPages
    let notice = ''
    if (truncated) {
      const missing = totalPages - wanted.length
      notice = `\n\n[PARTIAL view: showing ${wanted.length} of ${totalPages} pages. ${missing} more page${missing === 1 ? '' : 's'} available; call read_file again with pages="<range>" to fetch.]`
    }
    return {
      content: content + notice,
      truncated,
      totalPages,
      returnedRange: { start: wanted[0], end: wanted[wanted.length - 1] }
    }
  } finally {
    await parser.destroy().catch(() => {})
  }
}

/**
 * Top-level orchestrator the tool handler calls. Resolves the path,
 * dispatches to PDF vs. text, formats the unified result. Throws on
 * any rejection so the tool handler's catch turns it into status: error.
 */
export async function executeReadFile(
  args: ReadFileArgs,
  workspaceRoot: string
): Promise<ReadFileResult> {
  const resolved = resolveReadPath(workspaceRoot, args.path)
  if (!resolved.ok) {
    throw new Error(resolved.error)
  }
  const ext = extname(resolved.abs).toLowerCase()
  if (ext === '.pdf') {
    return readPdfFile(resolved.abs, args.pages)
  }
  if (args.pages) {
    throw new Error(`'pages' is only valid for .pdf files; got ${ext || '(no extension)'}`)
  }
  return readTextFile(resolved.abs, args.offset, args.limit)
}
