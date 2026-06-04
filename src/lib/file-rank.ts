// Fluidity J3: ranking + caret-context helpers for the @file mention popover.
//
// Pure / framework-free so the ranking and code-fence detection are
// exhaustively unit-testable. The popover component handles render +
// keyboard binding; this module owns the "given text + caret, what's the
// active @-token and what files match it?" problem.

/**
 * Score a candidate path against a query. Higher is better. Returns
 * -Infinity if the query isn't a (case-insensitive) subsequence of the
 * candidate. Extension matches dominate so typing ".ts" surfaces every
 * TypeScript file before any subsequence-only match.
 */
export function scoreFile(query: string, candidate: string): number {
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()
  if (!q) return 0
  // Subsequence prerequisite — bail if the query isn't even findable.
  let qi = 0
  for (let i = 0; i < c.length && qi < q.length; i++) {
    if (c[i] === q[qi]) qi++
  }
  if (qi < q.length) return -Infinity

  let score = 100

  // Pure extension query (".ts", ".tsx", ".json", etc.) → files of that
  // extension dominate. Detect a leading "." and a trailing tail with no
  // path separators.
  if (q.startsWith('.') && q.length > 1 && !q.includes('/') && !q.includes('\\')) {
    if (c.endsWith(q)) score += 500
  }

  // Basename hits beat path hits.
  const sep = Math.max(c.lastIndexOf('/'), c.lastIndexOf('\\'))
  const base = sep >= 0 ? c.slice(sep + 1) : c
  if (base === q) score += 400
  else if (base.startsWith(q)) score += 200
  else if (base.includes(q)) score += 80
  else if (c.includes(q)) score += 20

  // Shorter paths break ties (less ambiguity, fewer keystrokes).
  score -= Math.min(50, c.length / 4)

  return score
}

export function rankFiles(query: string, files: readonly string[], limit = 8): string[] {
  if (files.length === 0) return []
  // Empty query → shortest paths first (typically project root files).
  if (!query) {
    return [...files].sort((a, b) => a.length - b.length).slice(0, limit)
  }
  const scored: { f: string; s: number }[] = []
  for (const f of files) {
    const s = scoreFile(query, f)
    if (s > -Infinity) scored.push({ f, s })
  }
  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, limit).map((x) => x.f)
}

/**
 * Look backwards from `caret` for the start of an @-mention token. Returns
 * the token text (everything after `@`) and the position of the `@` itself.
 * Returns null when:
 *   - there's no `@` immediately preceding a contiguous \w./- run
 *   - the `@` is mid-word (e.g. `email@addr.com` — only fires at word boundary)
 *   - the caret is inside a fenced code block (```...```) or inline `…`
 */
export function detectAtMention(
  text: string,
  caret: number
): { token: string; start: number; end: number } | null {
  if (caret < 1) return null
  // Walk backward through path-chars to find the @ marker.
  let i = caret - 1
  while (i >= 0 && /[\w./\\:-]/.test(text[i])) i--
  if (i < 0 || text[i] !== '@') return null
  // Word-boundary check: @ must be at start or follow whitespace/punctuation.
  if (i > 0 && !/[\s({[]/.test(text[i - 1])) return null
  if (isInsideCodeContext(text, i)) return null
  return {
    token: text.slice(i + 1, caret),
    start: i,
    end: caret
  }
}

/**
 * True when `pos` falls inside a ``` fenced block or a single-backtick span
 * on the current line. Cheap parser — counts fence openers up to `pos`.
 */
export function isInsideCodeContext(text: string, pos: number): boolean {
  const before = text.slice(0, pos)
  // Triple-backtick fences. Odd count of openers → inside.
  const fences = before.match(/```/g)
  if (fences && fences.length % 2 === 1) return true
  // Single-backtick span on the current line. Strip triples first so the
  // remaining ` are single-backticks only.
  const lineStart = before.lastIndexOf('\n') + 1
  const lineBefore = before.slice(lineStart).replace(/```/g, '')
  const singles = lineBefore.match(/`/g)
  if (singles && singles.length % 2 === 1) return true
  return false
}
