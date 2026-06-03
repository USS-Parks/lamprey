// Parse [N] and [N, M] citation markers in assistant message text.
// Returns a flat list of segments — plain text and citation refs — so the
// React renderer can splat them into a React tree of strings and chips.
//
// Rules (per LAMPREY_RAG_PLAN.md §R12):
//   - [N] / [N,M] / [N, M, K] anywhere outside fenced code blocks.
//   - Skip everything inside ```...``` blocks.
//   - Skip inside single-line `inline code` segments.
//   - The N is a 1-based source id; the renderer maps it via the message's
//     sourceMap.

export type CitationSegment =
  | { kind: 'text'; text: string }
  | { kind: 'citation'; ids: number[]; raw: string }

const CITATION_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g

export function parseCitations(input: string): CitationSegment[] {
  if (!input) return []
  const segments: CitationSegment[] = []
  // 1. Mask fenced code blocks and inline code so the citation regex
  //    doesn't match inside them. Replace with same-length placeholders
  //    so offsets stay aligned, then unmask at emit time.
  const masks: { start: number; end: number; original: string }[] = []
  let masked = input

  // Fenced code: ```...``` (greedy non-newline-aware on opening fence;
  // captures up to the closing ``` on its own line OR inline).
  const fenceRe = /```[\s\S]*?```/g
  for (let m = fenceRe.exec(masked); m; m = fenceRe.exec(masked)) {
    masks.push({ start: m.index, end: m.index + m[0].length, original: m[0] })
  }
  // Inline code: `...` on a single line (no fence).
  const inlineRe = /`[^`\n]+`/g
  for (let m = inlineRe.exec(masked); m; m = inlineRe.exec(masked)) {
    // Skip if this inline run is inside a fenced block.
    if (
      masks.some((mk) => m!.index >= mk.start && m!.index + m![0].length <= mk.end)
    ) {
      continue
    }
    masks.push({ start: m.index, end: m.index + m[0].length, original: m[0] })
  }
  masks.sort((a, b) => a.start - b.start)

  // Walk through the input, emitting plain text in the masked regions
  // verbatim AND running the citation regex on the unmasked regions.
  let cursor = 0
  const emitFromTextSlice = (slice: string): void => {
    // Run citation regex on this slice.
    let last = 0
    CITATION_RE.lastIndex = 0
    for (let m = CITATION_RE.exec(slice); m; m = CITATION_RE.exec(slice)) {
      if (m.index > last) {
        segments.push({ kind: 'text', text: slice.slice(last, m.index) })
      }
      const ids = m[1].split(',').map((s) => parseInt(s.trim(), 10))
      segments.push({ kind: 'citation', ids, raw: m[0] })
      last = m.index + m[0].length
    }
    if (last < slice.length) {
      segments.push({ kind: 'text', text: slice.slice(last) })
    }
  }

  for (const mk of masks) {
    if (mk.start > cursor) {
      emitFromTextSlice(input.slice(cursor, mk.start))
    }
    segments.push({ kind: 'text', text: mk.original })
    cursor = mk.end
  }
  if (cursor < input.length) {
    emitFromTextSlice(input.slice(cursor))
  }

  // Merge adjacent text segments so the renderer doesn't get fragmented.
  const merged: CitationSegment[] = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    if (seg.kind === 'text' && last && last.kind === 'text') {
      last.text += seg.text
    } else {
      merged.push({ ...seg })
    }
  }
  return merged
}
