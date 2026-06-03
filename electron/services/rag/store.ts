import { randomUUID } from 'crypto'
import { getDb } from '../database'

// rag_collections CRUD. The store owns id generation, timestamping, and the
// row ↔ object conversion. Per the persistence-boundary doc, IPC handlers
// call into this module and not directly into SQLite; spine emission also
// lives here so an event row is impossible to miss.
//
// The `RagCollection` type is duplicated in `src/lib/types.ts` for the
// renderer (the two tsconfig roots can't reach across the electron/src
// boundary). Keep both in lockstep — same field names, same optionality.
export interface RagCollection {
  id: string
  name: string
  description?: string
  embedderId: string
  chunkSize: number
  chunkOverlap: number
  workspacePath?: string
  projectId?: string
  createdAt: number
  updatedAt: number
}
//
// Pattern mirrors `permission-policies-store.ts`: DB-first with a process-
// local memory fallback that activates if `getDb()` throws (headless tests).
// Mirroring the fallback specifically for collections keeps the test layer
// straightforward; rag_documents and rag_chunks land in R5 and don't need
// the same treatment because their tests get real fixtures and stubs.

export type CollectionInput = {
  name: string
  description?: string
  embedderId: string
  chunkSize?: number
  chunkOverlap?: number
  workspacePath?: string
  projectId?: string
}

export type CollectionPatch = Partial<
  Pick<
    CollectionInput,
    'name' | 'description' | 'embedderId' | 'chunkSize' | 'chunkOverlap' | 'workspacePath' | 'projectId'
  >
>

interface CollectionRow {
  id: string
  name: string
  description: string | null
  embedder_id: string
  chunk_size: number
  chunk_overlap: number
  workspace_path: string | null
  project_id: string | null
  created_at: number
  updated_at: number
}

const DEFAULT_CHUNK_SIZE = 800
const DEFAULT_CHUNK_OVERLAP = 100

function rowToCollection(row: CollectionRow): RagCollection {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    embedderId: row.embedder_id,
    chunkSize: row.chunk_size,
    chunkOverlap: row.chunk_overlap,
    workspacePath: row.workspace_path ?? undefined,
    projectId: row.project_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// ──────────────────── memory fallback ────────────────────

const memoryFallback: RagCollection[] = []
let useFallback = false

function activateFallback(reason: string): void {
  if (!useFallback) {
    useFallback = true
    console.warn(
      `[rag-collections] persistence unavailable, falling back to memory: ${reason}`
    )
  }
}

export function isUsingMemoryFallback(): boolean {
  return useFallback
}

// ──────────────────── CRUD ────────────────────

export function createCollection(input: CollectionInput): RagCollection {
  if (!input || typeof input.name !== 'string' || input.name.trim() === '') {
    throw new Error('createCollection: name is required')
  }
  if (!input.embedderId || typeof input.embedderId !== 'string') {
    throw new Error('createCollection: embedderId is required')
  }
  const id = randomUUID()
  const now = Date.now()
  const record: RagCollection = {
    id,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    embedderId: input.embedderId,
    chunkSize: input.chunkSize ?? DEFAULT_CHUNK_SIZE,
    chunkOverlap: input.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
    workspacePath: input.workspacePath || undefined,
    projectId: input.projectId || undefined,
    createdAt: now,
    updatedAt: now
  }

  if (!useFallback) {
    try {
      const db = getDb()
      db.prepare(
        `INSERT INTO rag_collections
           (id, name, description, embedder_id, chunk_size, chunk_overlap,
            workspace_path, project_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id,
        record.name,
        record.description ?? null,
        record.embedderId,
        record.chunkSize,
        record.chunkOverlap,
        record.workspacePath ?? null,
        record.projectId ?? null,
        record.createdAt,
        record.updatedAt
      )
      return record
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  memoryFallback.push({ ...record })
  return record
}

export function listCollections(): RagCollection[] {
  if (!useFallback) {
    try {
      const db = getDb()
      const rows = db
        .prepare('SELECT * FROM rag_collections ORDER BY updated_at DESC')
        .all() as CollectionRow[]
      return rows.map(rowToCollection)
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  return [...memoryFallback]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => ({ ...c }))
}

export function getCollection(id: string): RagCollection | null {
  if (!useFallback) {
    try {
      const db = getDb()
      const row = db
        .prepare('SELECT * FROM rag_collections WHERE id = ?')
        .get(id) as CollectionRow | undefined
      return row ? rowToCollection(row) : null
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  const found = memoryFallback.find((c) => c.id === id)
  return found ? { ...found } : null
}

export function updateCollection(id: string, patch: CollectionPatch): RagCollection {
  const existing = getCollection(id)
  if (!existing) {
    throw new Error(`updateCollection: no collection with id "${id}"`)
  }
  const now = Date.now()
  const next: RagCollection = {
    ...existing,
    name: patch.name?.trim() ? patch.name.trim() : existing.name,
    description:
      patch.description !== undefined
        ? patch.description?.trim() || undefined
        : existing.description,
    embedderId: patch.embedderId ?? existing.embedderId,
    chunkSize: patch.chunkSize ?? existing.chunkSize,
    chunkOverlap: patch.chunkOverlap ?? existing.chunkOverlap,
    workspacePath:
      patch.workspacePath !== undefined ? patch.workspacePath || undefined : existing.workspacePath,
    projectId:
      patch.projectId !== undefined ? patch.projectId || undefined : existing.projectId,
    updatedAt: now
  }

  if (!useFallback) {
    try {
      const db = getDb()
      db.prepare(
        `UPDATE rag_collections
            SET name = ?, description = ?, embedder_id = ?,
                chunk_size = ?, chunk_overlap = ?,
                workspace_path = ?, project_id = ?,
                updated_at = ?
          WHERE id = ?`
      ).run(
        next.name,
        next.description ?? null,
        next.embedderId,
        next.chunkSize,
        next.chunkOverlap,
        next.workspacePath ?? null,
        next.projectId ?? null,
        next.updatedAt,
        id
      )
      return next
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  const idx = memoryFallback.findIndex((c) => c.id === id)
  if (idx >= 0) memoryFallback[idx] = { ...next }
  return { ...next }
}

export function deleteCollection(id: string): boolean {
  if (!useFallback) {
    try {
      const db = getDb()
      // rag_documents.collection_id has ON DELETE CASCADE, which cascades to
      // rag_chunks. rag_chunk_vec rows are NOT cascaded by SQLite (vec0 is a
      // virtual table and FKs don't reach it); R5's ingest path is responsible
      // for keeping vec rows in lockstep with chunks. Deleting the collection
      // here is safe because the chunk delete trigger fires on rag_chunks,
      // and R5 will add a chunk-AFTER-DELETE trigger that also removes the
      // matching vec rows when ingest lands.
      const result = db
        .prepare('DELETE FROM rag_collections WHERE id = ?')
        .run(id)
      return result.changes > 0
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  const idx = memoryFallback.findIndex((c) => c.id === id)
  if (idx < 0) return false
  memoryFallback.splice(idx, 1)
  return true
}

// ════════════════════ DOCUMENTS ════════════════════

// rag_documents CRUD + chunk-insert + cascade-on-delete. Same memory-
// fallback pattern as collections so headless tests can exercise the ingest
// orchestrator end-to-end without booting better-sqlite3.

export type DocumentStatus =
  | 'queued'
  | 'loading'
  | 'chunking'
  | 'embedding'
  | 'ready'
  | 'error'
  | 'stale'

export type DocumentSourceKind =
  | 'file'
  | 'paste'
  | 'workspace'
  | 'skill'
  | 'memory'
  | 'planning'

export interface RagDocument {
  id: string
  collectionId: string
  sourceKind: DocumentSourceKind
  sourcePath?: string
  displayName: string
  mime?: string
  bytes?: number
  hashSha256: string
  mtime?: number
  status: DocumentStatus
  statusDetail?: string
  chunkCount: number
  ingestedAt?: number
  updatedAt: number
}

export interface RagChunkRow {
  id: string
  documentId: string
  collectionId: string
  chunkIndex: number
  startOffset: number
  endOffset: number
  headingPath?: string
  page?: number
  lineStart?: number
  lineEnd?: number
  text: string
  tokenCount?: number
  createdAt: number
}

export interface InsertDocumentInput {
  collectionId: string
  sourceKind: DocumentSourceKind
  sourcePath?: string
  displayName: string
  mime?: string
  bytes?: number
  hashSha256: string
  mtime?: number
  status: DocumentStatus
  statusDetail?: string
}

interface DocumentRow {
  id: string
  collection_id: string
  source_kind: DocumentSourceKind
  source_path: string | null
  display_name: string
  mime: string | null
  bytes: number | null
  hash_sha256: string
  mtime: number | null
  status: DocumentStatus
  status_detail: string | null
  chunk_count: number
  ingested_at: number | null
  updated_at: number
}

function rowToDocument(row: DocumentRow): RagDocument {
  return {
    id: row.id,
    collectionId: row.collection_id,
    sourceKind: row.source_kind,
    sourcePath: row.source_path ?? undefined,
    displayName: row.display_name,
    mime: row.mime ?? undefined,
    bytes: row.bytes ?? undefined,
    hashSha256: row.hash_sha256,
    mtime: row.mtime ?? undefined,
    status: row.status,
    statusDetail: row.status_detail ?? undefined,
    chunkCount: row.chunk_count,
    ingestedAt: row.ingested_at ?? undefined,
    updatedAt: row.updated_at
  }
}

interface MemoryDocument extends RagDocument {
  // The memory fallback also holds the chunks in process memory so the
  // ingest orchestrator can verify counts + the orchestrator's
  // transaction-shape behaviour in tests.
}

const memoryDocuments: MemoryDocument[] = []
const memoryChunks: RagChunkRow[] = []

// ──────────────────── document CRUD ────────────────────

export function insertDocument(input: InsertDocumentInput): RagDocument {
  if (!input.collectionId) throw new Error('insertDocument: collectionId is required')
  if (!input.displayName) throw new Error('insertDocument: displayName is required')
  if (!input.hashSha256) throw new Error('insertDocument: hashSha256 is required')
  const id = randomUUID()
  const now = Date.now()
  const record: RagDocument = {
    id,
    collectionId: input.collectionId,
    sourceKind: input.sourceKind,
    sourcePath: input.sourcePath,
    displayName: input.displayName,
    mime: input.mime,
    bytes: input.bytes,
    hashSha256: input.hashSha256,
    mtime: input.mtime,
    status: input.status,
    statusDetail: input.statusDetail,
    chunkCount: 0,
    ingestedAt: undefined,
    updatedAt: now
  }

  if (!useFallback) {
    try {
      const db = getDb()
      db.prepare(
        `INSERT INTO rag_documents
           (id, collection_id, source_kind, source_path, display_name,
            mime, bytes, hash_sha256, mtime,
            status, status_detail, chunk_count, ingested_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`
      ).run(
        record.id,
        record.collectionId,
        record.sourceKind,
        record.sourcePath ?? null,
        record.displayName,
        record.mime ?? null,
        record.bytes ?? null,
        record.hashSha256,
        record.mtime ?? null,
        record.status,
        record.statusDetail ?? null,
        record.updatedAt
      )
      return record
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  memoryDocuments.push({ ...record })
  return record
}

export interface DocumentPatch {
  status?: DocumentStatus
  statusDetail?: string | null
  chunkCount?: number
  ingestedAt?: number
}

export function updateDocument(id: string, patch: DocumentPatch): RagDocument | null {
  if (!useFallback) {
    try {
      const db = getDb()
      const sets: string[] = ['updated_at = ?']
      const params: Array<string | number | null> = [Date.now()]
      if (patch.status !== undefined) {
        sets.push('status = ?')
        params.push(patch.status)
      }
      if (patch.statusDetail !== undefined) {
        sets.push('status_detail = ?')
        params.push(patch.statusDetail ?? null)
      }
      if (patch.chunkCount !== undefined) {
        sets.push('chunk_count = ?')
        params.push(patch.chunkCount)
      }
      if (patch.ingestedAt !== undefined) {
        sets.push('ingested_at = ?')
        params.push(patch.ingestedAt)
      }
      params.push(id)
      db.prepare(`UPDATE rag_documents SET ${sets.join(', ')} WHERE id = ?`).run(
        ...params
      )
      const row = db
        .prepare('SELECT * FROM rag_documents WHERE id = ?')
        .get(id) as DocumentRow | undefined
      return row ? rowToDocument(row) : null
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  const idx = memoryDocuments.findIndex((d) => d.id === id)
  if (idx < 0) return null
  const next: MemoryDocument = {
    ...memoryDocuments[idx],
    status: patch.status ?? memoryDocuments[idx].status,
    statusDetail:
      patch.statusDetail === undefined
        ? memoryDocuments[idx].statusDetail
        : patch.statusDetail ?? undefined,
    chunkCount:
      patch.chunkCount === undefined
        ? memoryDocuments[idx].chunkCount
        : patch.chunkCount,
    ingestedAt:
      patch.ingestedAt === undefined ? memoryDocuments[idx].ingestedAt : patch.ingestedAt,
    updatedAt: Date.now()
  }
  memoryDocuments[idx] = next
  return { ...next }
}

export function getDocument(id: string): RagDocument | null {
  if (!useFallback) {
    try {
      const db = getDb()
      const row = db
        .prepare('SELECT * FROM rag_documents WHERE id = ?')
        .get(id) as DocumentRow | undefined
      return row ? rowToDocument(row) : null
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  const found = memoryDocuments.find((d) => d.id === id)
  return found ? { ...found } : null
}

export function findDocumentByHash(
  collectionId: string,
  hashSha256: string
): RagDocument | null {
  if (!useFallback) {
    try {
      const db = getDb()
      const row = db
        .prepare(
          `SELECT * FROM rag_documents
             WHERE collection_id = ? AND hash_sha256 = ?
             LIMIT 1`
        )
        .get(collectionId, hashSha256) as DocumentRow | undefined
      return row ? rowToDocument(row) : null
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  const found = memoryDocuments.find(
    (d) => d.collectionId === collectionId && d.hashSha256 === hashSha256
  )
  return found ? { ...found } : null
}

export function listDocuments(collectionId: string): RagDocument[] {
  if (!useFallback) {
    try {
      const db = getDb()
      const rows = db
        .prepare(
          `SELECT * FROM rag_documents
             WHERE collection_id = ?
             ORDER BY updated_at DESC`
        )
        .all(collectionId) as DocumentRow[]
      return rows.map(rowToDocument)
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  return memoryDocuments
    .filter((d) => d.collectionId === collectionId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((d) => ({ ...d }))
}

export function deleteDocument(id: string): boolean {
  if (!useFallback) {
    try {
      const db = getDb()
      // rag_documents.id is the FK target for rag_chunks; the FK is ON
      // DELETE CASCADE so chunks go too. rag_chunk_vec rows are NOT
      // cascaded (vec0 is outside the FK plumbing) — we DELETE them
      // explicitly first so the rowids freed by the chunk delete don't
      // leak into the next vec INSERT.
      const chunkRows = db
        .prepare('SELECT rowid FROM rag_chunks WHERE document_id = ?')
        .all(id) as { rowid: number }[]
      for (const r of chunkRows) {
        try {
          db.prepare('DELETE FROM rag_chunk_vec WHERE chunk_rowid = ?').run(r.rowid)
        } catch {
          // vec0 absent — fine.
        }
      }
      const result = db
        .prepare('DELETE FROM rag_documents WHERE id = ?')
        .run(id)
      return result.changes > 0
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  const idx = memoryDocuments.findIndex((d) => d.id === id)
  if (idx < 0) return false
  memoryDocuments.splice(idx, 1)
  // Cascade chunks.
  for (let i = memoryChunks.length - 1; i >= 0; i--) {
    if (memoryChunks[i].documentId === id) memoryChunks.splice(i, 1)
  }
  return true
}

// ──────────────────── chunks ────────────────────

export interface InsertChunkInput {
  documentId: string
  collectionId: string
  chunkIndex: number
  startOffset: number
  endOffset: number
  text: string
  headingPath?: string
  page?: number
  lineStart?: number
  lineEnd?: number
  tokenCount?: number
}

/**
 * Insert N chunks for one document and (optionally) write the matching vec
 * rows in a single transaction. The FTS5 mirror is kept in sync by the
 * AFTER INSERT trigger declared in `database.ts`.
 *
 * The vec write is gated on `vectors` being non-null AND `isVecAvailable()`
 * returning true. When `rag_chunk_vec` doesn't exist (older DB or extension
 * unavailable), the chunks still land — retrieval falls back to FTS-only.
 *
 * Returns the inserted chunk rowids in input order so the caller can
 * reconcile against `vectors` for a future re-insert.
 */
export function insertChunks(
  chunks: InsertChunkInput[],
  vectors?: Float32Array[]
): { rowids: number[]; ids: string[] } {
  if (chunks.length === 0) return { rowids: [], ids: [] }
  if (vectors && vectors.length !== chunks.length) {
    throw new Error(
      `insertChunks: vectors.length (${vectors.length}) must match chunks.length (${chunks.length})`
    )
  }
  const ids = chunks.map(() => randomUUID())
  const now = Date.now()

  if (!useFallback) {
    try {
      const db = getDb()
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { isVecAvailable } = require('./vec-loader') as {
        isVecAvailable: () => boolean
      }
      const writeVec = !!vectors && isVecAvailable()
      const insertChunk = db.prepare(
        `INSERT INTO rag_chunks
           (id, document_id, collection_id, chunk_index,
            start_offset, end_offset, heading_path, page,
            line_start, line_end, text, token_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const insertVec = writeVec
        ? db.prepare(
            'INSERT INTO rag_chunk_vec(chunk_rowid, embedding) VALUES (?, ?)'
          )
        : null
      const tx = db.transaction(() => {
        const rowids: number[] = []
        for (let i = 0; i < chunks.length; i++) {
          const c = chunks[i]
          const result = insertChunk.run(
            ids[i],
            c.documentId,
            c.collectionId,
            c.chunkIndex,
            c.startOffset,
            c.endOffset,
            c.headingPath ?? null,
            c.page ?? null,
            c.lineStart ?? null,
            c.lineEnd ?? null,
            c.text,
            c.tokenCount ?? null,
            now
          )
          const rowid = Number(result.lastInsertRowid)
          rowids.push(rowid)
          if (insertVec && vectors) {
            insertVec.run(rowid, Buffer.from(vectors[i].buffer))
          }
        }
        return rowids
      })
      const rowids = tx()
      return { rowids, ids }
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }

  // Memory fallback: synthesize sequential rowids so the orchestrator can
  // assert one-to-one correspondence with vectors.
  const rowids: number[] = []
  let nextRowid = memoryChunks.length + 1
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    memoryChunks.push({
      id: ids[i],
      documentId: c.documentId,
      collectionId: c.collectionId,
      chunkIndex: c.chunkIndex,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      headingPath: c.headingPath,
      page: c.page,
      lineStart: c.lineStart,
      lineEnd: c.lineEnd,
      text: c.text,
      tokenCount: c.tokenCount,
      createdAt: now
    })
    rowids.push(nextRowid++)
  }
  return { rowids, ids }
}

export function deleteChunksForDocument(documentId: string): number {
  if (!useFallback) {
    try {
      const db = getDb()
      // Pre-fetch rowids so the vec rows can be removed alongside the
      // chunk rows. The FTS trigger fires AFTER DELETE on rag_chunks; the
      // vec table is virtual and doesn't get the FK cascade.
      const chunkRows = db
        .prepare('SELECT rowid FROM rag_chunks WHERE document_id = ?')
        .all(documentId) as { rowid: number }[]
      const tx = db.transaction(() => {
        for (const r of chunkRows) {
          try {
            db.prepare('DELETE FROM rag_chunk_vec WHERE chunk_rowid = ?').run(
              r.rowid
            )
          } catch {
            // vec0 absent — fine.
          }
        }
        const result = db
          .prepare('DELETE FROM rag_chunks WHERE document_id = ?')
          .run(documentId)
        return result.changes
      })
      return tx()
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  let count = 0
  for (let i = memoryChunks.length - 1; i >= 0; i--) {
    if (memoryChunks[i].documentId === documentId) {
      memoryChunks.splice(i, 1)
      count++
    }
  }
  return count
}

export function getChunk(chunkId: string): RagChunkRow | null {
  if (!useFallback) {
    try {
      const db = getDb()
      const row = db
        .prepare(
          `SELECT id, document_id, collection_id, chunk_index,
                  start_offset, end_offset, heading_path, page,
                  line_start, line_end, text, token_count, created_at
             FROM rag_chunks WHERE id = ?`
        )
        .get(chunkId) as
        | {
            id: string
            document_id: string
            collection_id: string
            chunk_index: number
            start_offset: number
            end_offset: number
            heading_path: string | null
            page: number | null
            line_start: number | null
            line_end: number | null
            text: string
            token_count: number | null
            created_at: number
          }
        | undefined
      if (!row) return null
      return {
        id: row.id,
        documentId: row.document_id,
        collectionId: row.collection_id,
        chunkIndex: row.chunk_index,
        startOffset: row.start_offset,
        endOffset: row.end_offset,
        headingPath: row.heading_path ?? undefined,
        page: row.page ?? undefined,
        lineStart: row.line_start ?? undefined,
        lineEnd: row.line_end ?? undefined,
        text: row.text,
        tokenCount: row.token_count ?? undefined,
        createdAt: row.created_at
      }
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  const found = memoryChunks.find((c) => c.id === chunkId)
  return found ? { ...found } : null
}

export function countChunksForDocument(documentId: string): number {
  if (!useFallback) {
    try {
      const db = getDb()
      const row = db
        .prepare('SELECT COUNT(*) AS n FROM rag_chunks WHERE document_id = ?')
        .get(documentId) as { n: number }
      return row.n
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  return memoryChunks.filter((c) => c.documentId === documentId).length
}

// ════════════════════ CONVERSATION ATTACHMENTS (R11) ════════════════════

export interface RagAttachment {
  conversationId: string
  collectionId?: string
  documentId?: string
  attachedAt: number
}

const memoryAttachments: RagAttachment[] = []

export function addAttachment(input: {
  conversationId: string
  collectionId?: string
  documentId?: string
}): RagAttachment {
  if (!input.conversationId) throw new Error('addAttachment: conversationId is required')
  if (!input.collectionId && !input.documentId) {
    throw new Error('addAttachment: collectionId or documentId is required')
  }
  if (input.collectionId && input.documentId) {
    throw new Error('addAttachment: exactly one of collectionId / documentId')
  }
  const record: RagAttachment = {
    conversationId: input.conversationId,
    collectionId: input.collectionId,
    documentId: input.documentId,
    attachedAt: Date.now()
  }

  if (!useFallback) {
    try {
      const db = getDb()
      db.prepare(
        `INSERT INTO conversation_rag_attachments
           (conversation_id, collection_id, document_id, attached_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(conversation_id,
                     COALESCE(collection_id, ''),
                     COALESCE(document_id, ''))
         DO UPDATE SET attached_at = excluded.attached_at`
      ).run(
        record.conversationId,
        record.collectionId ?? null,
        record.documentId ?? null,
        record.attachedAt
      )
      return record
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  const existing = memoryAttachments.find(
    (a) =>
      a.conversationId === record.conversationId &&
      a.collectionId === record.collectionId &&
      a.documentId === record.documentId
  )
  if (existing) existing.attachedAt = record.attachedAt
  else memoryAttachments.push({ ...record })
  return record
}

export function removeAttachment(input: {
  conversationId: string
  collectionId?: string
  documentId?: string
}): boolean {
  if (!useFallback) {
    try {
      const db = getDb()
      const result = db
        .prepare(
          `DELETE FROM conversation_rag_attachments
             WHERE conversation_id = ?
               AND COALESCE(collection_id, '') = COALESCE(?, '')
               AND COALESCE(document_id, '')   = COALESCE(?, '')`
        )
        .run(
          input.conversationId,
          input.collectionId ?? null,
          input.documentId ?? null
        )
      return result.changes > 0
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  const idx = memoryAttachments.findIndex(
    (a) =>
      a.conversationId === input.conversationId &&
      a.collectionId === input.collectionId &&
      a.documentId === input.documentId
  )
  if (idx < 0) return false
  memoryAttachments.splice(idx, 1)
  return true
}

export function listAttachments(conversationId: string): RagAttachment[] {
  if (!useFallback) {
    try {
      const db = getDb()
      const rows = db
        .prepare(
          `SELECT * FROM conversation_rag_attachments
             WHERE conversation_id = ?
             ORDER BY attached_at DESC`
        )
        .all(conversationId) as Array<{
        conversation_id: string
        collection_id: string | null
        document_id: string | null
        attached_at: number
      }>
      return rows.map((r) => ({
        conversationId: r.conversation_id,
        collectionId: r.collection_id ?? undefined,
        documentId: r.document_id ?? undefined,
        attachedAt: r.attached_at
      }))
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  return memoryAttachments
    .filter((a) => a.conversationId === conversationId)
    .sort((a, b) => b.attachedAt - a.attachedAt)
    .map((a) => ({ ...a }))
}

// ──────────────────── test-only hooks ────────────────────

export function __resetCollectionStore(): void {
  memoryFallback.length = 0
  memoryDocuments.length = 0
  memoryChunks.length = 0
  memoryAttachments.length = 0
  useFallback = false
}

export function __forceMemoryFallback(): void {
  useFallback = true
}

/** Test-only: peek the chunk memory store without going through queries. */
export function __peekMemoryChunks(): readonly RagChunkRow[] {
  return memoryChunks
}
