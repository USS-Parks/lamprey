import { beforeEach, describe, expect, it, vi } from 'vitest'

// rag_collections CRUD tests. Same `vi.mock('electron')` pattern as the
// other store tests — getDb() throws under the mock and the store engages
// its memory fallback. The cascade and FTS-sync-trigger checks from the
// R1 spec require a real DB, so they live in a `describe.skipIf` block
// with the SQL contract documented inline.
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('electron app not available in test environment')
    }
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

import {
  __forceMemoryFallback,
  __resetCollectionStore,
  createCollection,
  deleteCollection,
  getCollection,
  isUsingMemoryFallback,
  listCollections,
  updateCollection
} from './store'

beforeEach(() => {
  __resetCollectionStore()
  __forceMemoryFallback()
})

// ──────────────────── input validation ────────────────────

describe('createCollection validation', () => {
  it('rejects an empty / whitespace name', () => {
    expect(() =>
      createCollection({ name: '', embedderId: 'bge-small-en-v1.5' })
    ).toThrow(/name is required/i)
    expect(() =>
      createCollection({ name: '   ', embedderId: 'bge-small-en-v1.5' })
    ).toThrow(/name is required/i)
  })

  it('rejects a missing / non-string embedderId', () => {
    expect(() =>
      // @ts-expect-error: deliberately invalid for the runtime guard
      createCollection({ name: 'X' })
    ).toThrow(/embedderId is required/i)
    expect(() =>
      // @ts-expect-error: deliberately invalid for the runtime guard
      createCollection({ name: 'X', embedderId: 42 })
    ).toThrow(/embedderId is required/i)
  })
})

// ──────────────────── CRUD roundtrip ────────────────────

describe('createCollection + getCollection roundtrip', () => {
  it('inserts and reads back with generated id + timestamps + defaults', () => {
    const created = createCollection({
      name: 'Project docs',
      embedderId: 'bge-small-en-v1.5'
    })
    expect(created.id).toMatch(/[0-9a-f-]{36}/)
    expect(created.createdAt).toBeGreaterThan(0)
    expect(created.updatedAt).toBe(created.createdAt)
    // Defaults from the plan: chunk_size=800, chunk_overlap=100.
    expect(created.chunkSize).toBe(800)
    expect(created.chunkOverlap).toBe(100)

    const fetched = getCollection(created.id)
    expect(fetched).not.toBeNull()
    expect(fetched?.name).toBe('Project docs')
    expect(fetched?.embedderId).toBe('bge-small-en-v1.5')
  })

  it('preserves caller-supplied chunkSize / chunkOverlap / scope fields', () => {
    const created = createCollection({
      name: 'Custom',
      embedderId: 'all-MiniLM-L6-v2',
      chunkSize: 1024,
      chunkOverlap: 64,
      workspacePath: '/repo',
      projectId: 'proj-X',
      description: 'A custom collection'
    })
    expect(created.chunkSize).toBe(1024)
    expect(created.chunkOverlap).toBe(64)
    expect(created.workspacePath).toBe('/repo')
    expect(created.projectId).toBe('proj-X')
    expect(created.description).toBe('A custom collection')
  })

  it('returns null for getCollection on an unknown id', () => {
    expect(getCollection('does-not-exist')).toBeNull()
  })
})

// ──────────────────── listing ────────────────────

describe('listCollections ordering', () => {
  it('returns collections newest-first by updatedAt', async () => {
    const a = createCollection({ name: 'A', embedderId: 'e' })
    // Sleep enough to guarantee a strictly-later updatedAt for B than A —
    // the timeline is sorted by updatedAt DESC and we want a stable order.
    await new Promise((r) => setTimeout(r, 2))
    const b = createCollection({ name: 'B', embedderId: 'e' })
    const ids = listCollections().map((c) => c.id)
    expect(ids[0]).toBe(b.id)
    expect(ids[1]).toBe(a.id)
  })

  it('returns an empty array when nothing is stored', () => {
    expect(listCollections()).toEqual([])
  })
})

// ──────────────────── updates ────────────────────

describe('updateCollection', () => {
  it('patches only the fields supplied; bumps updatedAt', async () => {
    const created = createCollection({
      name: 'Original',
      embedderId: 'e',
      chunkSize: 800
    })
    await new Promise((r) => setTimeout(r, 2))
    const updated = updateCollection(created.id, {
      name: 'Renamed',
      chunkSize: 1200
    })
    expect(updated.name).toBe('Renamed')
    expect(updated.chunkSize).toBe(1200)
    expect(updated.embedderId).toBe('e') // untouched
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt)
    expect(updated.createdAt).toBe(created.createdAt)
  })

  it('clears optional scope fields when the patch passes an empty string', () => {
    const created = createCollection({
      name: 'X',
      embedderId: 'e',
      workspacePath: '/repo',
      projectId: 'proj-X'
    })
    const cleared = updateCollection(created.id, {
      workspacePath: '',
      projectId: ''
    })
    expect(cleared.workspacePath).toBeUndefined()
    expect(cleared.projectId).toBeUndefined()
  })

  it('throws when the id does not exist', () => {
    expect(() => updateCollection('phantom', { name: 'no' })).toThrow(
      /no collection with id/i
    )
  })
})

// ──────────────────── deletion ────────────────────

describe('deleteCollection', () => {
  it('returns true on hit, false on miss', () => {
    const created = createCollection({ name: 'X', embedderId: 'e' })
    expect(deleteCollection(created.id)).toBe(true)
    expect(getCollection(created.id)).toBeNull()
    expect(deleteCollection(created.id)).toBe(false)
  })

  it('does not affect sibling collections', () => {
    const a = createCollection({ name: 'A', embedderId: 'e' })
    const b = createCollection({ name: 'B', embedderId: 'e' })
    expect(deleteCollection(a.id)).toBe(true)
    expect(listCollections().map((c) => c.id)).toEqual([b.id])
  })
})

// ──────────────────── memory fallback signal ────────────────────

describe('memory fallback signal', () => {
  it('isUsingMemoryFallback returns true after __forceMemoryFallback', () => {
    expect(isUsingMemoryFallback()).toBe(true)
  })

  it('__resetCollectionStore drops the fallback flag and contents', () => {
    createCollection({ name: 'A', embedderId: 'e' })
    expect(listCollections()).toHaveLength(1)
    __resetCollectionStore()
    // The flag is briefly false until the next CRUD call re-trips it
    // (getDb() throws under the mocked electron and the fallback kicks
    // in again). Snapshot the flag BEFORE calling listCollections so we
    // see the reset effect, not the re-activation.
    expect(isUsingMemoryFallback()).toBe(false)
    expect(listCollections()).toHaveLength(0)
  })
})

// ──────────────────── DB-only contract (documented but skipped) ────────────────────

// The R1 plan also calls for a cascade test (delete a collection, verify
// rag_documents + rag_chunks + rag_chunk_vec rows are gone) and an FTS sync
// trigger test (insert a chunk, verify rag_chunks_fts MATCH returns its
// rowid). Both require a real better-sqlite3 connection, which vitest can't
// load — the project's postinstall rebuilds better-sqlite3 against
// Electron's ABI. Runtime integration smoke covers these paths; the SQL
// contract is documented here so a future test toolchain can drop in.
//
//   - FK cascade chain (set in initSchema):
//       rag_documents.collection_id REFERENCES rag_collections(id) ON DELETE CASCADE
//       rag_chunks.document_id      REFERENCES rag_documents(id) ON DELETE CASCADE
//
//   - FTS sync triggers (set in initSchema):
//       AFTER INSERT  → INSERT into rag_chunks_fts(rowid, text, heading_path)
//       AFTER DELETE  → 'delete' tombstone in rag_chunks_fts
//       AFTER UPDATE  → 'delete' tombstone + INSERT new
//
//   - rag_chunk_vec is NOT cascaded by the FK chain (vec0 is a virtual
//     table outside SQLite's FK plumbing). R5's ingest path adds a
//     rag_chunks-AFTER-DELETE trigger that also DELETEs the matching
//     vec row. Until R5, the only chunk delete path is via collection
//     deletion (which goes through the chunk FK cascade) and ingest
//     replacement (handled in the same R5 transaction).
describe.skip('DB-backed cascade + FTS sync (requires real SQLite)', () => {
  it('deleting a collection cascades to documents + chunks', () => {
    // See comment above for the SQL contract this test would exercise.
  })

  it('inserting a chunk populates rag_chunks_fts via the AFTER INSERT trigger', () => {
    // See comment above for the SQL contract this test would exercise.
  })
})
