// Recursive character splitter with markdown-heading and source-code
// awareness. Pure: no IO, no IPC, no DB. Consumed by the ingest
// orchestrator (R5).
//
// Design notes (from LAMPREY_RAG_PLAN.md §2.4):
//   - Default separators: ["\n\n", "\n", ". ", " ", ""] — recursive walk
//     down the list until a chunk fits the target size.
//   - Markdown: pre-split on headings, then recursive within each section.
//     Headings build a `headingPath` like "Section A > Subsection".
//   - PDFs (sourceKind 'file' + mime 'application/pdf'): the caller (R4
//     loader) passes one ChunkInput per page; this chunker recursive-splits
//     within the page and stamps `page`.
//   - Source code: count newlines to set lineStart/lineEnd per chunk.
//     Tree-sitter-aware splitting is intentionally NOT built — it's a v2.
//   - Hard ceilings: chunks > 2000 chars get re-split with chunkSize/2;
//     chunks < 50 chars are dropped (table-of-contents fragments).

export type ChunkSourceKind =
  | 'file'
  | 'paste'
  | 'workspace'
  | 'skill'
  | 'memory'
  | 'planning'

export interface ChunkInput {
  text: string
  sourceKind: ChunkSourceKind
  /** Hint for chunker dispatch. Common values:
   *    text/markdown  → markdown heading-aware path
   *    application/pdf + paged=true → page-scoped recursive split
   *    text/plain     → plain recursive split
   */
  mime?: string
  /** Optional extension hint when mime isn't available. Lowercase, leading
   *  dot included (e.g. ".md", ".ts"). */
  extension?: string
  /** When the chunker is called per-page by the PDF loader, this is the
   *  page number to stamp onto every emitted chunk for the page. */
  page?: number
}

export interface ChunkOptions {
  chunkSize: number
  chunkOverlap: number
}

export interface ChunkOutput {
  index: number
  startOffset: number
  endOffset: number
  text: string
  headingPath?: string
  page?: number
  lineStart?: number
  lineEnd?: number
}

// Hard ceilings — see plan §2.4. Exported so the test file pins them.
export const MAX_CHUNK_CHARS = 2000
export const MIN_CHUNK_CHARS = 50

const DEFAULT_SEPARATORS = ['\n\n', '\n', '. ', ' ', '']

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.rb',
  '.cs',
  '.cpp',
  '.c',
  '.h',
  '.swift',
  '.kt',
  '.sh',
  '.bash',
  '.ps1'
])

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx'])

// ──────────────────── public entry point ────────────────────

export function chunk(input: ChunkInput, opts: ChunkOptions): ChunkOutput[] {
  const text = input.text
  if (!text || typeof text !== 'string') return []
  if (text.length < MIN_CHUNK_CHARS) return []

  const isMarkdown =
    input.mime === 'text/markdown' ||
    (input.extension && MARKDOWN_EXTENSIONS.has(input.extension.toLowerCase()))
  const isCode =
    !isMarkdown &&
    input.sourceKind === 'file' &&
    input.extension &&
    CODE_EXTENSIONS.has(input.extension.toLowerCase())

  let raw: RawChunk[]
  if (isMarkdown) {
    raw = chunkMarkdown(text, opts)
  } else {
    raw = recursiveSplit(text, 0, opts)
  }

  // Re-split any chunk that exceeded the hard ceiling (typically happens
  // when a giant paragraph with no separators fell through to char-level
  // splits with an off-by-one).
  const ceilingEnforced: RawChunk[] = []
  for (const c of raw) {
    if (c.text.length > MAX_CHUNK_CHARS) {
      const reSplit = recursiveSplit(
        c.text,
        c.startOffset,
        { chunkSize: Math.floor(opts.chunkSize / 2), chunkOverlap: 0 },
        c.headingPath
      )
      ceilingEnforced.push(...reSplit)
    } else {
      ceilingEnforced.push(c)
    }
  }

  // Drop chunks under the floor; re-index sequentially.
  const filtered = ceilingEnforced.filter((c) => c.text.length >= MIN_CHUNK_CHARS)

  const outputs: ChunkOutput[] = filtered.map((c, idx) => {
    const out: ChunkOutput = {
      index: idx,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      text: c.text
    }
    if (c.headingPath) out.headingPath = c.headingPath
    if (input.page !== undefined) out.page = input.page
    if (isCode) {
      const { lineStart, lineEnd } = computeLineRange(text, c.startOffset, c.endOffset)
      out.lineStart = lineStart
      out.lineEnd = lineEnd
    }
    return out
  })

  return outputs
}

// ──────────────────── recursive splitter ────────────────────

interface RawChunk {
  startOffset: number
  endOffset: number
  text: string
  headingPath?: string
}

function recursiveSplit(
  text: string,
  baseOffset: number,
  opts: ChunkOptions,
  headingPath?: string
): RawChunk[] {
  if (text.length === 0) return []
  if (text.length <= opts.chunkSize) {
    return [
      {
        startOffset: baseOffset,
        endOffset: baseOffset + text.length,
        text,
        headingPath
      }
    ]
  }

  // Walk separators large → small. For each, try splitting; if any resulting
  // piece is still over chunkSize, recurse into that piece with the NEXT
  // separator.
  const pieces = splitIntoPieces(text, opts.chunkSize)
  // Merge consecutive small pieces into windowed chunks of ~chunkSize with
  // chunkOverlap overlap. This preserves the recursive splitter's hallmark
  // overlap behaviour without re-implementing langchain's MergeSplits.
  return windowPieces(pieces, baseOffset, opts, headingPath)
}

/**
 * Walk the separator hierarchy until every piece is <= chunkSize. Returned
 * pieces are contiguous and cover the input; the offsets are relative to
 * the input string, NOT to any outer baseOffset (the caller adds that).
 */
function splitIntoPieces(text: string, chunkSize: number): { text: string; offset: number }[] {
  // Each entry of `working` is a piece + its offset relative to the input.
  let working: { text: string; offset: number }[] = [{ text, offset: 0 }]
  for (const sep of DEFAULT_SEPARATORS) {
    if (working.every((p) => p.text.length <= chunkSize)) break
    const next: { text: string; offset: number }[] = []
    for (const piece of working) {
      if (piece.text.length <= chunkSize) {
        next.push(piece)
        continue
      }
      if (sep === '') {
        // Empty separator: char-level split into chunkSize-sized windows.
        for (let i = 0; i < piece.text.length; i += chunkSize) {
          next.push({
            text: piece.text.slice(i, i + chunkSize),
            offset: piece.offset + i
          })
        }
      } else {
        const parts = splitWithSeparator(piece.text, sep)
        let cursor = 0
        for (const part of parts) {
          if (part.length === 0) {
            cursor += 0
            continue
          }
          next.push({ text: part, offset: piece.offset + cursor })
          cursor += part.length
        }
      }
    }
    working = next
  }
  return working
}

/**
 * Split by separator while KEEPING the separator attached to the preceding
 * piece. This is how langchain-style char splitters preserve readability —
 * a paragraph break stays at the end of its paragraph, a sentence period
 * stays with its sentence. Returns pieces that, concatenated in order,
 * exactly reproduce the input.
 */
function splitWithSeparator(text: string, sep: string): string[] {
  if (sep.length === 0) return [text]
  const out: string[] = []
  let from = 0
  let idx = text.indexOf(sep, from)
  while (idx !== -1) {
    out.push(text.slice(from, idx + sep.length))
    from = idx + sep.length
    idx = text.indexOf(sep, from)
  }
  if (from < text.length) out.push(text.slice(from))
  return out
}

/**
 * Window the pieces into chunks of approximately chunkSize, with chunkOverlap
 * characters carried into the next chunk. Each chunk's offset is relative to
 * the input string (the caller adds the baseOffset before emitting).
 */
function windowPieces(
  pieces: { text: string; offset: number }[],
  baseOffset: number,
  opts: ChunkOptions,
  headingPath?: string
): RawChunk[] {
  const out: RawChunk[] = []
  if (pieces.length === 0) return out

  let i = 0
  while (i < pieces.length) {
    let acc = ''
    let accStart = pieces[i].offset
    let accEnd = pieces[i].offset
    let j = i
    while (j < pieces.length && acc.length + pieces[j].text.length <= opts.chunkSize) {
      acc += pieces[j].text
      accEnd = pieces[j].offset + pieces[j].text.length
      j++
    }
    if (acc.length === 0) {
      // A single piece exceeded chunkSize even after the recursive walk —
      // hard-fall to a char slice. Should be rare with the empty-separator
      // base case above, but the safety net keeps us forward-progress.
      const piece = pieces[i]
      acc = piece.text.slice(0, opts.chunkSize)
      accStart = piece.offset
      accEnd = piece.offset + acc.length
      pieces[i] = {
        text: piece.text.slice(opts.chunkSize),
        offset: piece.offset + opts.chunkSize
      }
    } else {
      i = j
    }

    out.push({
      startOffset: baseOffset + accStart,
      endOffset: baseOffset + accEnd,
      text: acc,
      headingPath
    })

    // Walk i backwards to create overlap: figure out how many pieces' worth
    // of text fit into chunkOverlap chars, and rewind to that boundary.
    if (i < pieces.length && opts.chunkOverlap > 0 && out.length > 0) {
      let overlap = 0
      let k = j - 1
      while (k >= 0 && overlap < opts.chunkOverlap) {
        overlap += pieces[k].text.length
        k--
      }
      // k+1 is the first piece that contributes to overlap. Restart from
      // there, but never go backwards from the original i (otherwise infinite
      // loop on tiny pieces).
      const candidate = Math.max(k + 1, i - (j - i))
      // Guard against zero forward progress.
      i = Math.max(candidate, j > i ? i : j + 1)
    }
  }

  return out
}

// ──────────────────── markdown-aware split ────────────────────

interface HeadingSection {
  headingPath: string | undefined
  text: string
  baseOffset: number
}

function chunkMarkdown(text: string, opts: ChunkOptions): RawChunk[] {
  const sections = splitOnMarkdownHeadings(text)
  const out: RawChunk[] = []
  for (const s of sections) {
    if (s.text.length === 0) continue
    out.push(...recursiveSplit(s.text, s.baseOffset, opts, s.headingPath))
  }
  return out
}

/**
 * Walk the document line by line. Track the heading stack so each section
 * gets a "Top > Middle > Leaf" path. The section's `baseOffset` is the
 * absolute character offset where the section starts within `text`.
 */
function splitOnMarkdownHeadings(text: string): HeadingSection[] {
  const out: HeadingSection[] = []
  const headingRe = /^(#{1,6})[ \t]+(.+?)\s*$/
  const stack: string[] = []
  let cursor = 0
  let sectionStart = 0
  let inFence = false

  const lines = text.split(/(\r\n|\n)/)
  // The split keeps the separators alternating, so iterate in pairs.
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i]
    const sep = lines[i + 1] ?? ''
    const lineLen = line.length + sep.length
    // Track fenced code blocks so headings INSIDE them don't start sections.
    if (/^```/.test(line)) inFence = !inFence
    if (!inFence) {
      const m = line.match(headingRe)
      if (m) {
        // Close out the previous section before starting a new one.
        if (cursor > sectionStart) {
          out.push({
            headingPath: stack.length > 0 ? stack.join(' > ') : undefined,
            text: text.slice(sectionStart, cursor),
            baseOffset: sectionStart
          })
        }
        const level = m[1].length
        const title = m[2].trim()
        // Pop the stack to match the new level, then push the new heading.
        stack.length = Math.max(0, level - 1)
        stack[level - 1] = title
        sectionStart = cursor
      }
    }
    cursor += lineLen
  }
  // Flush the trailing section.
  if (cursor > sectionStart) {
    out.push({
      headingPath: stack.length > 0 ? stack.join(' > ') : undefined,
      text: text.slice(sectionStart, cursor),
      baseOffset: sectionStart
    })
  }
  return out
}

// ──────────────────── source-code line ranges ────────────────────

function computeLineRange(
  fullText: string,
  startOffset: number,
  endOffset: number
): { lineStart: number; lineEnd: number } {
  // Lines are 1-based; lineStart is the line that contains startOffset, and
  // lineEnd is the line that contains the LAST character of endOffset (so
  // a chunk that ends mid-line includes that line). Newlines BEFORE the
  // offset count toward the line number.
  let line = 1
  for (let i = 0; i < startOffset && i < fullText.length; i++) {
    if (fullText.charCodeAt(i) === 10) line++ // '\n'
  }
  const lineStart = line
  // Continue counting from startOffset to endOffset-1.
  const endProbe = Math.min(endOffset, fullText.length)
  for (let i = startOffset; i < endProbe; i++) {
    if (fullText.charCodeAt(i) === 10) line++
  }
  // A chunk that ends right AT a newline boundary shouldn't include the
  // next line — the +1-on-newline above already advanced. Roll back if the
  // last char we examined was a newline AND we're not at file end.
  const lastChar = endProbe > 0 ? fullText.charCodeAt(endProbe - 1) : 0
  let lineEnd = line
  if (lastChar === 10 && lineEnd > lineStart) lineEnd--
  return { lineStart, lineEnd }
}
