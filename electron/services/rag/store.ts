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

// ──────────────────── test-only hooks ────────────────────

export function __resetCollectionStore(): void {
  memoryFallback.length = 0
  useFallback = false
}

export function __forceMemoryFallback(): void {
  useFallback = true
}
