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
import { retrieveWithMeta } from './retrieve'
import { rerank } from './rerank'
import { buildContext } from './context-builder'

// End-to-end orchestration test. Wires the engine pieces — store →
// retrieve → rerank → context-builder — without spawning a real
// worker or hitting better-sqlite3, so the test exercises the
// orchestration logic that R10/R13 wire into chat.ts. The runtime-only
// pieces (real FTS5, real sqlite-vec, real embeddings) are smoke-tested
// in production via the user-facing path.

beforeEach(() => {
  __resetEventLog()
  forceEventMemory()
  __resetCollectionStore()
  __forceMemoryFallback()
})

describe('end-to-end orchestration (memory fallback)', () => {
  it('retrieve → rerank → context-builder produces a coherent block', async () => {
    const col = createCollection({ name: 'E2E', embedderId: 'bge-small-en-v1.5' })
    const doc1 = insertDocument({
      collectionId: col.id,
      sourceKind: 'paste',
      displayName: 'architecture.md',
      hashSha256: 'h1',
      status: 'ready'
    })
    const doc2 = insertDocument({
      collectionId: col.id,
      sourceKind: 'paste',
      displayName: 'api.md',
      hashSha256: 'h2',
      status: 'ready'
    })
    insertChunks([
      {
        documentId: doc1.id,
        collectionId: col.id,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 100,
        text: 'Lamprey routes per-model to multiple providers via the registry.',
        headingPath: 'Architecture > Providers'
      },
      {
        documentId: doc1.id,
        collectionId: col.id,
        chunkIndex: 1,
        startOffset: 100,
        endOffset: 200,
        text: 'The data spine records every meaningful state transition.',
        headingPath: 'Architecture > Spine'
      },
      {
        documentId: doc2.id,
        collectionId: col.id,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 100,
        text: 'The API exposes window.api.rag for collections and documents.',
        headingPath: 'API > Surface'
      }
    ])

    // 1. Retrieve — query covers tokens in multiple chunks so rerank has
    //    something to reorder (rerank no-ops with <= 1 candidate).
    const info = await retrieveWithMeta({
      query: 'lamprey api spine',
      collectionIds: [col.id]
    })
    expect(info.results.length).toBeGreaterThanOrEqual(2)

    // 2. Rerank (stub reverses order so the test sees the rerank effect).
    const reranked = await rerank(
      { query: 'lamprey routes', candidates: info.results, mode: 'local-cross-encoder' },
      {
        crossEncoderScore: async (_q, c) => c.map((_, i) => -i)
      }
    )
    expect(reranked.length).toBeGreaterThan(0)

    // 3. Context block.
    const ctx = buildContext({ chunks: reranked.slice(0, 5), maxTokens: 1000 })
    expect(ctx.block).toContain('<retrieved_context>')
    expect(ctx.block).toContain('</retrieved_context>')
    expect(ctx.sourceMap.length).toBeGreaterThan(0)
    expect(ctx.sourceMap[0].id).toBe(1)

    // 4. Event spine got entries from each step.
    const queryEvents = listEvents({ type: 'rag.query.completed' })
    const rerankEvents = listEvents({ type: 'rag.rerank.completed' })
    expect(queryEvents.length).toBeGreaterThanOrEqual(1)
    expect(rerankEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('scopes retrieval to attached collections only — does not leak siblings', async () => {
    const colA = createCollection({ name: 'A', embedderId: 'e' })
    const colB = createCollection({ name: 'B', embedderId: 'e' })
    const docA = insertDocument({
      collectionId: colA.id,
      sourceKind: 'paste',
      displayName: 'a',
      hashSha256: 'a',
      status: 'ready'
    })
    const docB = insertDocument({
      collectionId: colB.id,
      sourceKind: 'paste',
      displayName: 'b',
      hashSha256: 'b',
      status: 'ready'
    })
    insertChunks([
      {
        documentId: docA.id,
        collectionId: colA.id,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 50,
        text: 'lamprey appears in collection A only here'
      },
      {
        documentId: docB.id,
        collectionId: colB.id,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 50,
        text: 'lamprey also appears in collection B'
      }
    ])
    const info = await retrieveWithMeta({
      query: 'lamprey',
      collectionIds: [colA.id]
    })
    expect(info.results.length).toBeGreaterThan(0)
    for (const r of info.results) {
      expect(r.collectionId).toBe(colA.id)
    }
  })
})
