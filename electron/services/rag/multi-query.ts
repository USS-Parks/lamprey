// Multi-query rewrite. Optional. When on, the Planner model rewrites the
// user's query into 2-3 alternate phrasings; each is retrieved separately;
// results are unioned via RRF. Helpful for under-specified queries.
//
// Defaults from the plan:
//   - max rewrites: 3
//   - per-rewrite length cap: 200 chars
//   - parse failure: return [original query] (graceful fall-through)

const MAX_REWRITE_CHARS = 200

export type PlannerRunner = (prompt: string) => Promise<string>

const PROMPT = (q: string): string =>
  [
    'You will rewrite a retrieval query into 2-3 short alternate phrasings.',
    'Each alternate should keep the original intent but vary the phrasing,',
    'terminology, or specificity so a hybrid retrieval can surface different',
    'candidate passages.',
    '',
    `Original query: ${q}`,
    '',
    'Return ONLY a JSON array of 2-3 strings. No prose, no labels, no markdown.',
    'Example: ["alternate phrasing 1", "alternate phrasing 2"]'
  ].join('\n')

/**
 * Rewrite the input query via the supplied planner. Returns the original
 * query first followed by up to N parsed rewrites. On parse failure or any
 * thrown error, returns just `[query]` so the caller proceeds without
 * multi-query (the contract is "graceful fall-through").
 */
export async function rewriteQuery(
  query: string,
  planner: PlannerRunner,
  maxRewrites = 3
): Promise<string[]> {
  if (!query || !query.trim()) return []
  const trimmed = query.trim()
  let raw: string
  try {
    raw = await planner(PROMPT(trimmed))
  } catch {
    return [trimmed]
  }
  const parsed = parseRewrites(raw)
  if (!parsed) return [trimmed]
  const out: string[] = [trimmed]
  for (const r of parsed) {
    const cleaned = r.trim()
    if (!cleaned) continue
    if (cleaned.length > MAX_REWRITE_CHARS) continue
    if (cleaned.toLowerCase() === trimmed.toLowerCase()) continue
    out.push(cleaned)
    if (out.length >= maxRewrites + 1) break
  }
  return out
}

/**
 * Parse the planner's reply. Tolerant of leading prose: searches for the
 * first JSON array and returns its parsed strings. Returns null when
 * nothing usable is found.
 */
export function parseRewrites(raw: string): string[] | null {
  if (!raw) return null
  const arrayMatch = raw.match(/\[[\s\S]*?\]/)
  if (!arrayMatch) return null
  try {
    const parsed = JSON.parse(arrayMatch[0]) as unknown
    if (!Array.isArray(parsed)) return null
    const strings: string[] = []
    for (const item of parsed) {
      if (typeof item === 'string') strings.push(item)
    }
    return strings
  } catch {
    return null
  }
}

/**
 * RRF across multiple result sets. Each set is a per-query ranking; we
 * compute the sum of `1/(60 + rank)` for each chunkId across all variants.
 * Exported here (rather than retrieve.ts) so the multi-query path stays
 * the only caller and the inner retrieval per-variant doesn't double-fuse.
 */
export function fuseAcrossVariants<T extends { chunkId: string }>(
  variantResults: T[][],
  topN: number,
  k = 60
): T[] {
  const scoreByChunk = new Map<string, { score: number; entry: T }>()
  for (const results of variantResults) {
    results.forEach((r, idx) => {
      const rank = idx + 1
      const contribution = 1 / (k + rank)
      const existing = scoreByChunk.get(r.chunkId)
      if (existing) {
        existing.score += contribution
      } else {
        scoreByChunk.set(r.chunkId, { score: contribution, entry: r })
      }
    })
  }
  return [...scoreByChunk.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((x) => x.entry)
}
