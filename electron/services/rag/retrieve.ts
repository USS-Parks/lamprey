import { randomUUID } from 'crypto'
import { getDb } from '../database'
import { boundedJsonPreview, recordEvent } from '../event-log'
import { isVecAvailable } from './vec-loader'
import { __peekMemoryChunks } from './store'

// Hybrid retrieval: BM25 (FTS5) + cosine (sqlite-vec) fused via Reciprocal
// Rank Fusion. See LAMPREY_RAG_PLAN.md §2.5.
//
// Why RRF and not weighted sum:
//   The two scales (BM25 score vs cosine distance) are not commensurable.
//   Tuning a weight is a hyperparameter the user shouldn't have to set.
//   RRF is parameter-light, robust to scale, and used in practice by major
//   hybrid search systems (Elastic, Vespa). The constant `k=60` is the
//   reference value from Cormack & Clarke (2009).
//
// Persistence:
//   `retrieve()` is read-only. The chat handler (R10) creates the
//   rag_retrievals row when it knows the message_id; we hand back the
//   ranked chunks + the per-leg scores and let the caller persist.

const RRF_K = 60

export interface RetrievalInput {
  query: string
  collectionIds: string[]
  lexK?: number
  vecK?: number
  topN?: number
  filters?: {
    sourceKind?: string
    pathPrefix?: string
  }
  /** Optional pre-computed query embedding. Lets the agent pipeline reuse
   *  the same vector across planner/coder/reviewer calls without re-
   *  embedding the same text three times. */
  queryEmbedding?: Float32Array
  /** Embedder used to vectorize the query. Defaults to the active embedder
   *  in the embeddings service. Required when `queryEmbedding` is omitted. */
  embed?: (texts: string[]) => Promise<Float32Array[]>
}

export interface RetrievedChunk {
  chunkId: string
  documentId: string
  collectionId: string
  text: string
  displayName: string
  sourcePath?: string
  headingPath?: string
  page?: number
  lineStart?: number
  lineEnd?: number
  scores: { lex?: number; vec?: number; fused: number }
  ranks: { lex?: number; vec?: number }
}

export interface RetrievalRunInfo {
  retrievalId: string
  results: RetrievedChunk[]
  lexHits: number
  vecHits: number
  fusedCount: number
  durationMs: number
}

interface LexLegRow {
  rowid: number
  chunk_id: string
  score: number
}

interface VecLegRow {
  rowid: number
  chunk_id: string
  distance: number
}

interface ChunkHydrationRow {
  id: string
  document_id: string
  collection_id: string
  text: string
  heading_path: string | null
  page: number | null
  line_start: number | null
  line_end: number | null
  display_name: string
  source_path: string | null
}

// ──────────────────── public API ────────────────────

export async function retrieve(input: RetrievalInput): Promise<RetrievedChunk[]> {
  const out = await retrieveWithMeta(input)
  return out.results
}

export async function retrieveWithMeta(
  input: RetrievalInput
): Promise<RetrievalRunInfo> {
  const lexK = input.lexK ?? 30
  const vecK = input.vecK ?? 30
  const topN = input.topN ?? 8
  const startedAt = Date.now()

  if (!input.query || !input.query.trim()) {
    return {
      retrievalId: randomUUID(),
      results: [],
      lexHits: 0,
      vecHits: 0,
      fusedCount: 0,
      durationMs: 0
    }
  }
  if (!Array.isArray(input.collectionIds) || input.collectionIds.length === 0) {
    return {
      retrievalId: randomUUID(),
      results: [],
      lexHits: 0,
      vecHits: 0,
      fusedCount: 0,
      durationMs: 0
    }
  }

  // Try the real DB path; on failure fall through to the memory-fallback
  // lex-only path so unit tests and dev-without-Electron can still exercise
  // ranking semantics.
  let db: ReturnType<typeof getDb> | null = null
  try {
    db = getDb()
  } catch {
    db = null
  }

  if (db) {
    return await retrieveFromDb(db, input, lexK, vecK, topN, startedAt)
  }
  return retrieveFromMemory(input, topN, startedAt)
}

// ──────────────────── DB-backed path ────────────────────

async function retrieveFromDb(
  db: ReturnType<typeof getDb>,
  input: RetrievalInput,
  lexK: number,
  vecK: number,
  topN: number,
  startedAt: number
): Promise<RetrievalRunInfo> {
  // 1. Lexical leg (BM25 via FTS5).
  const lexResults = runLexicalLeg(db, input.query, input.collectionIds, lexK)

  // 2. Vector leg (cosine via sqlite-vec MATCH).
  let vecResults: VecLegRow[] = []
  if (isVecAvailable()) {
    const queryVec = input.queryEmbedding
      ? input.queryEmbedding
      : input.embed
      ? (await input.embed([input.query]))[0]
      : null
    if (queryVec) {
      vecResults = runVectorLeg(db, queryVec, input.collectionIds, vecK)
    }
  }

  // 3. Fuse via RRF.
  const fused = fuseRRF(lexResults, vecResults, topN)
  const fusedIds = fused.map((f) => f.chunkId)

  // 4. Hydrate the top N with text + metadata.
  const hydrated = fusedIds.length > 0 ? hydrateChunks(db, fusedIds) : []

  // 5. Stitch hydration onto the fused-order ranking.
  const byId = new Map(hydrated.map((h) => [h.id, h]))
  const results: RetrievedChunk[] = []
  for (const f of fused) {
    const row = byId.get(f.chunkId)
    if (!row) continue
    results.push({
      chunkId: row.id,
      documentId: row.document_id,
      collectionId: row.collection_id,
      text: row.text,
      displayName: row.display_name,
      sourcePath: row.source_path ?? undefined,
      headingPath: row.heading_path ?? undefined,
      page: row.page ?? undefined,
      lineStart: row.line_start ?? undefined,
      lineEnd: row.line_end ?? undefined,
      scores: f.scores,
      ranks: f.ranks
    })
  }

  const out: RetrievalRunInfo = {
    retrievalId: randomUUID(),
    results,
    lexHits: lexResults.length,
    vecHits: vecResults.length,
    fusedCount: results.length,
    durationMs: Date.now() - startedAt
  }
  emitQueryEvent('rag.query.completed', input, out)
  return out
}

function runLexicalLeg(
  db: ReturnType<typeof getDb>,
  query: string,
  collectionIds: string[],
  k: number
): LexLegRow[] {
  // The FTS5 MATCH escape strategy: wrap each whitespace-separated token in
  // quotes so reserved chars (- + : NEAR etc.) don't fall through as
  // operators. Empty after trim → empty array.
  const ftsQuery = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' OR ')
  if (!ftsQuery) return []
  const placeholders = collectionIds.map(() => '?').join(',')
  try {
    const rows = db
      .prepare(
        `SELECT c.rowid AS rowid, c.id AS chunk_id,
                bm25(rag_chunks_fts) AS score
           FROM rag_chunks_fts f
           JOIN rag_chunks c ON c.rowid = f.rowid
          WHERE rag_chunks_fts MATCH ?
            AND c.collection_id IN (${placeholders})
          ORDER BY score
          LIMIT ?`
      )
      .all(ftsQuery, ...collectionIds, k) as LexLegRow[]
    return rows
  } catch (err) {
    console.warn('[rag-retrieve] lexical leg failed:', err)
    return []
  }
}

function runVectorLeg(
  db: ReturnType<typeof getDb>,
  queryVec: Float32Array,
  collectionIds: string[],
  k: number
): VecLegRow[] {
  // sqlite-vec KNN syntax: SELECT chunk_rowid, distance FROM rag_chunk_vec
  // WHERE embedding MATCH ? AND k = ?. The candidate rowids are then
  // filtered by collection_id via a JOIN to rag_chunks.
  const placeholders = collectionIds.map(() => '?').join(',')
  try {
    const rows = db
      .prepare(
        `SELECT v.chunk_rowid AS rowid, c.id AS chunk_id,
                v.distance AS distance
           FROM rag_chunk_vec v
           JOIN rag_chunks c ON c.rowid = v.chunk_rowid
          WHERE v.embedding MATCH ?
            AND k = ?
            AND c.collection_id IN (${placeholders})
          ORDER BY distance
          LIMIT ?`
      )
      .all(Buffer.from(queryVec.buffer), k, ...collectionIds, k) as VecLegRow[]
    return rows
  } catch (err) {
    console.warn('[rag-retrieve] vector leg failed:', err)
    return []
  }
}

function hydrateChunks(
  db: ReturnType<typeof getDb>,
  chunkIds: string[]
): ChunkHydrationRow[] {
  if (chunkIds.length === 0) return []
  const placeholders = chunkIds.map(() => '?').join(',')
  try {
    return db
      .prepare(
        `SELECT c.id, c.document_id, c.collection_id, c.text,
                c.heading_path, c.page, c.line_start, c.line_end,
                d.display_name, d.source_path
           FROM rag_chunks c
           JOIN rag_documents d ON d.id = c.document_id
          WHERE c.id IN (${placeholders})`
      )
      .all(...chunkIds) as ChunkHydrationRow[]
  } catch (err) {
    console.warn('[rag-retrieve] hydration failed:', err)
    return []
  }
}

// ──────────────────── memory-fallback path (lex-only) ────────────────────

function retrieveFromMemory(
  input: RetrievalInput,
  topN: number,
  startedAt: number
): RetrievalRunInfo {
  // No FTS in the memory store — score by term-frequency over the chunk
  // text. This is enough to exercise the orchestration tests (R7 unit test
  // verifies that scope is respected and RRF math is correct); production
  // ranking quality comes from the real FTS5 + vec0 path.
  const tokens = input.query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 1)
  const chunks = __peekMemoryChunks().filter((c) =>
    input.collectionIds.includes(c.collectionId)
  )
  const scored = chunks
    .map((c, idx) => {
      const text = c.text.toLowerCase()
      let score = 0
      for (const t of tokens) {
        let from = 0
        while ((from = text.indexOf(t, from)) !== -1) {
          score++
          from += t.length
        }
      }
      return { idx, chunk: c, score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)

  const results: RetrievedChunk[] = scored.map((s, rank) => ({
    chunkId: s.chunk.id,
    documentId: s.chunk.documentId,
    collectionId: s.chunk.collectionId,
    text: s.chunk.text,
    displayName: s.chunk.documentId, // memory mode doesn't join to documents
    sourcePath: undefined,
    headingPath: s.chunk.headingPath,
    page: s.chunk.page,
    lineStart: s.chunk.lineStart,
    lineEnd: s.chunk.lineEnd,
    scores: { lex: s.score, fused: 1 / (RRF_K + rank + 1) },
    ranks: { lex: rank + 1 }
  }))
  const out: RetrievalRunInfo = {
    retrievalId: randomUUID(),
    results,
    lexHits: scored.length,
    vecHits: 0,
    fusedCount: results.length,
    durationMs: Date.now() - startedAt
  }
  emitQueryEvent('rag.query.completed', input, out)
  return out
}

// ──────────────────── RRF fusion ────────────────────

interface FusedRanking {
  chunkId: string
  scores: { lex?: number; vec?: number; fused: number }
  ranks: { lex?: number; vec?: number }
}

/**
 * Reciprocal Rank Fusion. Each candidate's fused score is the sum of
 * `1 / (k + rank)` across legs that returned it; a candidate missing from a
 * leg contributes 0. Exported for tests.
 */
export function fuseRRF(
  lex: LexLegRow[],
  vec: VecLegRow[],
  topN: number,
  k: number = RRF_K
): FusedRanking[] {
  const byChunk = new Map<
    string,
    { scores: { lex?: number; vec?: number; fused: number }; ranks: { lex?: number; vec?: number } }
  >()
  lex.forEach((row, idx) => {
    const rank = idx + 1
    const fused = 1 / (k + rank)
    byChunk.set(row.chunk_id, {
      scores: { lex: row.score, fused },
      ranks: { lex: rank }
    })
  })
  vec.forEach((row, idx) => {
    const rank = idx + 1
    const contribution = 1 / (k + rank)
    const existing = byChunk.get(row.chunk_id)
    if (existing) {
      existing.scores.vec = row.distance
      existing.scores.fused += contribution
      existing.ranks.vec = rank
    } else {
      byChunk.set(row.chunk_id, {
        scores: { vec: row.distance, fused: contribution },
        ranks: { vec: rank }
      })
    }
  })
  const sorted = [...byChunk.entries()]
    .map(([chunkId, info]) => ({
      chunkId,
      scores: info.scores,
      ranks: info.ranks
    }))
    .sort((a, b) => b.scores.fused - a.scores.fused)
  return sorted.slice(0, topN)
}

// ──────────────────── events ────────────────────

function emitQueryEvent(
  type: 'rag.query.completed' | 'rag.query.failed',
  input: RetrievalInput,
  info: RetrievalRunInfo
): void {
  try {
    recordEvent({
      type,
      actorKind: 'system',
      severity: type === 'rag.query.failed' ? 'error' : 'info',
      entityKind: 'rag-retrieval',
      entityId: info.retrievalId,
      payload: {
        retrievalId: info.retrievalId,
        scopes: input.collectionIds,
        lexHits: info.lexHits,
        vecHits: info.vecHits,
        fusedCount: info.fusedCount,
        durationMs: info.durationMs,
        queryPreview: boundedJsonPreview(input.query, 200)
      }
    })
  } catch (err) {
    console.error(`[rag-retrieve] ${type} event failed:`, err)
  }
}

/** Persist a retrieval row after the chat handler knows the message id. */
export function persistRetrieval(args: {
  retrievalId: string
  messageId: string
  conversationId: string
  queryText: string
  queryKind: string
  scopes: string[]
  results: RetrievedChunk[]
  durationMs: number
  correlationId?: string
}): void {
  try {
    const db = getDb()
    db.prepare(
      `INSERT INTO rag_retrievals
         (id, message_id, conversation_id, query_text, query_kind,
          scopes_json, results_json, duration_ms, created_at, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      args.retrievalId,
      args.messageId,
      args.conversationId,
      args.queryText,
      args.queryKind,
      JSON.stringify(args.scopes),
      JSON.stringify(
        args.results.map((r) => ({
          chunkId: r.chunkId,
          documentId: r.documentId,
          scores: r.scores,
          ranks: r.ranks
        }))
      ),
      args.durationMs,
      Date.now(),
      args.correlationId ?? null
    )
  } catch (err) {
    console.error('[rag-retrieve] persistRetrieval failed:', err)
  }
}
