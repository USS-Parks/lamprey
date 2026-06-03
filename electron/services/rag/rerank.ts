import { boundedJsonPreview, recordEvent } from '../event-log'
import type { RetrievedChunk } from './retrieve'

// Optional rerank pass. Three modes:
//   off                  — pass-through.
//   local-cross-encoder  — Xenova/ms-marco-MiniLM-L-6-v2 scoring per pair.
//                          Slow per-pair but high quality. Off by default.
//   llm                  — one-shot rerank prompt to the active fast model.
//                          Cheap and OK quality; useful when latency budget
//                          is small.
//
// Either pipe is OFF by default in settings; the toggle is in R13's
// RagSettings panel. When rerank is enabled, retrieve.ts is expected to
// over-fetch (topN * 3 typically) and let the reranker reorder + truncate.

export type RerankMode = 'off' | 'local-cross-encoder' | 'llm'

export interface RerankDeps {
  /** Provider for the cross-encoder mode. Returns one score per (q, c)
   *  pair, higher = more relevant. Production wires this to the
   *  embeddings-worker rerank channel; tests pass a stub. */
  crossEncoderScore?: (
    query: string,
    candidates: { id: string; text: string }[]
  ) => Promise<number[]>
  /** Provider for the LLM mode. Returns the candidate ids in rerank order,
   *  best-first. On parse failure callers fall through to the input order. */
  llmRerank?: (
    query: string,
    candidates: { id: string; text: string }[]
  ) => Promise<string[] | null>
}

export interface RerankInput {
  query: string
  candidates: RetrievedChunk[]
  mode: RerankMode
  /** Optional cap on how many candidates the reranker processes. Cross-
   *  encoder rerank cost scales with candidate count; LLM rerank prompt
   *  size scales the same way. */
  maxCandidates?: number
  /** Truncate each candidate's text in the LLM prompt to this many chars. */
  llmCharCap?: number
}

const DEFAULT_LLM_CHAR_CAP = 400

export async function rerank(
  input: RerankInput,
  deps: RerankDeps = {}
): Promise<RetrievedChunk[]> {
  const startedAt = Date.now()
  const candidates = input.maxCandidates
    ? input.candidates.slice(0, input.maxCandidates)
    : input.candidates
  const beforeIds = candidates.map((c) => c.chunkId)

  if (input.mode === 'off' || candidates.length <= 1) {
    return candidates
  }

  let reranked: RetrievedChunk[] = candidates
  let ok = false
  let errorPreview: string | undefined

  try {
    if (input.mode === 'local-cross-encoder') {
      if (!deps.crossEncoderScore) {
        throw new Error('local-cross-encoder mode requires crossEncoderScore dep')
      }
      const scores = await deps.crossEncoderScore(
        input.query,
        candidates.map((c) => ({ id: c.chunkId, text: c.text }))
      )
      if (scores.length !== candidates.length) {
        throw new Error(
          `cross-encoder returned ${scores.length} scores for ${candidates.length} candidates`
        )
      }
      const indexed = candidates.map((c, i) => ({ c, s: scores[i] }))
      indexed.sort((a, b) => b.s - a.s)
      reranked = indexed.map((x) => x.c)
      ok = true
    } else if (input.mode === 'llm') {
      if (!deps.llmRerank) {
        throw new Error('llm mode requires llmRerank dep')
      }
      const charCap = input.llmCharCap ?? DEFAULT_LLM_CHAR_CAP
      const ordered = await deps.llmRerank(
        input.query,
        candidates.map((c) => ({
          id: c.chunkId,
          text: c.text.slice(0, charCap)
        }))
      )
      if (ordered && ordered.length > 0) {
        const byId = new Map(candidates.map((c) => [c.chunkId, c]))
        const out: RetrievedChunk[] = []
        for (const id of ordered) {
          const hit = byId.get(id)
          if (hit) out.push(hit)
        }
        // Append any candidates the LLM dropped so the caller never loses
        // a chunk silently.
        for (const c of candidates) {
          if (!ordered.includes(c.chunkId)) out.push(c)
        }
        reranked = out
        ok = true
      } else {
        // Parse failure → log + fall through to input order. The plan
        // calls for graceful degradation here.
        reranked = candidates
        errorPreview = 'llm returned null/empty ordering'
      }
    }
  } catch (err) {
    reranked = candidates
    errorPreview = (err as Error)?.message ?? String(err)
    console.warn('[rag-rerank] mode', input.mode, 'failed:', errorPreview)
  }

  const afterIds = reranked.map((c) => c.chunkId)
  try {
    recordEvent({
      type: 'rag.rerank.completed',
      actorKind: 'system',
      severity: ok ? 'info' : 'warning',
      payload: {
        mode: input.mode,
        candidates: candidates.length,
        durationMs: Date.now() - startedAt,
        beforeTopIds: beforeIds.slice(0, 8),
        afterTopIds: afterIds.slice(0, 8),
        errorPreview: errorPreview ? boundedJsonPreview(errorPreview) : undefined
      }
    })
  } catch (err) {
    console.error('[rag-rerank] event failed:', err)
  }

  return reranked
}
