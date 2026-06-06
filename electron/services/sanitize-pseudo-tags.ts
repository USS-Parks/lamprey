// Robustness Hotfix HX3 (v0.8.4). Pure rewriter that converts stray
// pseudo-XML pairs in assistant text — `<bash>…</bash>`, `<tool>…</tool>`,
// `<run>…</run>`, `<shell>…</shell>`, `<execute>…</execute>`,
// `<command>…</command>`, `<terminal>…</terminal>`, `<output>…</output>`,
// `<result>…</result>`, `<stdout>…</stdout>`, `<stderr>…</stderr>` — into
// fenced Markdown code blocks. Models occasionally emit these as a
// substitute for an actual tool invocation; the chat bubble would render
// the literal text and the user has to re-prompt the model to actually do
// the work. This sanitizer is the persist-side complement to HX2's
// prompt-level `PSEUDO_TAG_GUARD` — belt-and-braces.
//
// Invariants:
// - Pure: no side effects.
// - Idempotent: `sanitizePseudoTags(sanitizePseudoTags(x)) === sanitizePseudoTags(x)`.
// - Fence-aware: pseudo-tags that fall inside an existing ``` fenced block
//   are left alone (the model already wrapped them, no need to rewrite).
// - Unbalanced-safe: an open tag with no matching close is left intact
//   (we'd rather under-rewrite than corrupt downstream content).
// - Case-insensitive on tag names.
// - Multi-line bodies preserved.

// Command-shaped pseudo-tags map to ```bash. Output-shaped pseudo-tags map
// to ```text. The split is deliberate: rewriting `<output>…</output>` to a
// `bash` fence would lie about the content; `text` is honest.
const SHELL_TAGS = ['bash', 'tool', 'run', 'shell', 'execute', 'command', 'terminal'] as const
const OUTPUT_TAGS = ['output', 'result', 'stdout', 'stderr'] as const

type TagKind = 'shell' | 'output'

interface TagMatch {
  start: number // index of '<' in the opening tag
  end: number // index AFTER the '>' of the closing tag
  kind: TagKind
  body: string // text between open and close tags (verbatim)
}

// Find the index ranges of pre-existing fenced code blocks (``` … ```).
// Used to skip pseudo-tag rewrites that already live inside a fence.
function findFenceRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const re = /```[\s\S]*?```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length })
  }
  return ranges
}

function isInsideRange(index: number, ranges: Array<{ start: number; end: number }>): boolean {
  for (const r of ranges) {
    if (index >= r.start && index < r.end) return true
  }
  return false
}

// Scan the text for `<tag>…</tag>` pairs across both shell and output tag
// families. Non-greedy body match across newlines. Case-insensitive tag
// names but body preserved verbatim (case + whitespace).
function findPseudoTagMatches(text: string): TagMatch[] {
  const matches: TagMatch[] = []
  for (const tag of SHELL_TAGS) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        kind: 'shell',
        body: m[1]
      })
    }
  }
  for (const tag of OUTPUT_TAGS) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        kind: 'output',
        body: m[1]
      })
    }
  }
  // Apply rewrites left-to-right; sort by start ascending. Overlapping
  // pseudo-tags (e.g. `<bash><tool>` interleaved) are pathological and
  // resolved by taking the first match — the second rewrite would be
  // dropped if its range was consumed by the first.
  matches.sort((a, b) => a.start - b.start)
  return matches
}

function renderFence(kind: TagKind, body: string): string {
  const lang = kind === 'shell' ? 'bash' : 'text'
  // Strip a single leading + trailing newline if present (the model
  // typically writes `<bash>\n…\n</bash>`); the fence supplies its own
  // newline structure so a doubled one looks scruffy. Inner newlines are
  // preserved.
  let trimmed = body
  if (trimmed.startsWith('\n')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('\n')) trimmed = trimmed.slice(0, -1)
  return '```' + lang + '\n' + trimmed + '\n```'
}

export function sanitizePseudoTags(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text

  const fenceRanges = findFenceRanges(text)
  const matches = findPseudoTagMatches(text)
  if (matches.length === 0) return text

  // Build the output by stitching together: prefix → rewritten | original.
  // Track the cursor position; skip matches that fall inside a fence range
  // or that overlap an earlier match.
  let cursor = 0
  let out = ''
  let lastEnd = 0
  for (const m of matches) {
    if (m.start < lastEnd) continue // overlap with prior accepted match — drop
    if (isInsideRange(m.start, fenceRanges)) continue // inside an existing fence — leave it alone
    if (m.start > cursor) out += text.slice(cursor, m.start)
    out += renderFence(m.kind, m.body)
    cursor = m.end
    lastEnd = m.end
  }
  if (cursor < text.length) out += text.slice(cursor)
  return out
}
