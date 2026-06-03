import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  insertChunks,
  insertDocument
} from './store'
import {
  __forceMemoryFallback as forceEventMemory,
  __resetEventLog,
  listEvents
} from '../event-log'
import { fuseRRF, retrieveWithMeta } from './retrieve'

beforeEach(() => {
  __resetEventLog()
  forceEventMemory()
  __resetCollectionStore()
  __forceMemoryFallback()
})

// ──────────────────── RRF math (pure) ────────────────────

describe('fuseRRF math', () => {
  it('a candidate present in both legs ranks above a candidate present in only one', () => {
    const lex = [{ rowid: 1, chunk_id: 'A', score: -1 }]
    const vec = [
      { rowid: 1, chunk_id: 'A', distance: 0.1 },
      { rowid: 2, chunk_id: 'B', distance: 0.2 }
    ]
    const fused = fuseRRF(lex, vec, 5)
    expect(fused[0].chunkId).toBe('A')
    expect(fused[0].scores.fused).toBeGreaterThan(fused[1].scores.fused)
  })

  it('returns at most topN entries', () => {
    const lex = Array.from({ length: 10 }, (_, i) => ({
      rowid: i + 1,
      chunk_id: `L${i}`,
      score: -i
    }))
    const fused = fuseRRF(lex, [], 3)
    expect(fused).toHaveLength(3)
  })

  it('preserves per-leg rank in the .ranks field', () => {
    const lex = [
      { rowid: 1, chunk_id: 'X', score: -2 },
      { rowid: 2, chunk_id: 'Y', score: -1 }
    ]
    const vec = [{ rowid: 1, chunk_id: 'X', distance: 0.1 }]
    const fused = fuseRRF(lex, vec, 5)
    const x = fused.find((f) => f.chunkId === 'X')!
    expect(x.ranks.lex).toBe(1)
    expect(x.ranks.vec).toBe(1)
    const y = fused.find((f) => f.chunkId === 'Y')!
    expect(y.ranks.lex).toBe(2)
    expect(y.ranks.vec).toBeUndefined()
  })
})

// ──────────────────── memory-fallback retrieval (lex-only) ────────────────────

describe('retrieve (memory fallback, lex-only)', () => {
  it('returns chunks containing the query tokens, scoped to the collection', async () => {
    const c1 = createCollection({ name: 'Alpha', embedderId: 'e' })
    const c2 = createCollection({ name: 'Beta', embedderId: 'e' })
    const doc1 = insertDocument({
      collectionId: c1.id,
      sourceKind: 'paste',
      displayName: 'd1',
      hashSha256: 'h1',
      status: 'ready'
    })
    const doc2 = insertDocument({
      collectionId: c2.id,
      sourceKind: 'paste',
      displayName: 'd2',
      hashSha256: 'h2',
      status: 'ready'
    })
    insertChunks([
      {
        documentId: doc1.id,
        collectionId: c1.id,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 50,
        text: 'lamprey routes per-model to multiple providers'
      },
      {
        documentId: doc1.id,
        collectionId: c1.id,
        chunkIndex: 1,
        startOffset: 50,
        endOffset: 100,
        text: 'unrelated content about coffee and toast'
      },
      {
        documentId: doc2.id,
        collectionId: c2.id,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 50,
        text: 'lamprey appears in this OTHER collection too'
      }
    ])

    const info = await retrieveWithMeta({
      query: 'lamprey routes',
      collectionIds: [c1.id]
    })
    expect(info.results.length).toBeGreaterThan(0)
    // Scope: results must only come from c1.
    for (const r of info.results) {
      expect(r.collectionId).toBe(c1.id)
    }
    // The top hit is the chunk that contains both tokens.
    expect(info.results[0].text).toContain('lamprey routes')
  })

  it('empty query returns an empty result with zero hits', async () => {
    const c = createCollection({ name: 'X', embedderId: 'e' })
    const info = await retrieveWithMeta({ query: '', collectionIds: [c.id] })
    expect(info.results).toEqual([])
    expect(info.lexHits).toBe(0)
  })

  it('empty collectionIds returns empty', async () => {
    const info = await retrieveWithMeta({ query: 'hello', collectionIds: [] })
    expect(info.results).toEqual([])
  })

  it('emits a rag.query.completed event with scope + counts', async () => {
    const c = createCollection({ name: 'X', embedderId: 'e' })
    const doc = insertDocument({
      collectionId: c.id,
      sourceKind: 'paste',
      displayName: 'd',
      hashSha256: 'h',
      status: 'ready'
    })
    insertChunks([
      {
        documentId: doc.id,
        collectionId: c.id,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 100,
        text: 'the rapid quick brown lamprey hops the fence'
      }
    ])
    await retrieveWithMeta({ query: 'lamprey', collectionIds: [c.id] })
    const events = listEvents({ type: 'rag.query.completed' })
    expect(events).toHaveLength(1)
    const payload = events[0].payload as {
      scopes: string[]
      lexHits: number
      fusedCount: number
    }
    expect(payload.scopes).toEqual([c.id])
    expect(payload.fusedCount).toBeGreaterThan(0)
  })
})
