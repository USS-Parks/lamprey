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
  __forceMemoryFallback as forceEventMemory,
  __resetEventLog,
  listEvents
} from '../event-log'
import { rerank } from './rerank'
import type { RetrievedChunk } from './retrieve'

beforeEach(() => {
  __resetEventLog()
  forceEventMemory()
})

function makeChunk(id: string, text: string): RetrievedChunk {
  return {
    chunkId: id,
    documentId: 'doc-' + id,
    collectionId: 'col-X',
    text,
    displayName: id,
    scores: { fused: 0.5 },
    ranks: { lex: 1 }
  }
}

describe('rerank mode=off', () => {
  it('passes candidates through unchanged + emits no rerank event when count <= 1', async () => {
    const out = await rerank({
      query: 'q',
      candidates: [makeChunk('A', 'a')],
      mode: 'off'
    })
    expect(out.map((c) => c.chunkId)).toEqual(['A'])
    // Two-or-fewer short-circuits — no event for a no-op.
    expect(listEvents({ type: 'rag.rerank.completed' })).toHaveLength(0)
  })
})

describe('rerank mode=local-cross-encoder', () => {
  it('reorders candidates by descending score', async () => {
    const out = await rerank(
      {
        query: 'q',
        candidates: [makeChunk('A', 'a'), makeChunk('B', 'b'), makeChunk('C', 'c')],
        mode: 'local-cross-encoder'
      },
      {
        crossEncoderScore: async () => [0.1, 0.9, 0.5]
      }
    )
    expect(out.map((c) => c.chunkId)).toEqual(['B', 'C', 'A'])
    expect(listEvents({ type: 'rag.rerank.completed' })).toHaveLength(1)
  })

  it('emits the event with severity=warning and falls through to input order on dep failure', async () => {
    const candidates = [makeChunk('A', 'a'), makeChunk('B', 'b')]
    const out = await rerank(
      { query: 'q', candidates, mode: 'local-cross-encoder' },
      {
        crossEncoderScore: () => Promise.reject(new Error('encoder down'))
      }
    )
    expect(out.map((c) => c.chunkId)).toEqual(['A', 'B'])
    const events = listEvents({ type: 'rag.rerank.completed' })
    expect(events).toHaveLength(1)
    expect(events[0].severity).toBe('warning')
  })

  it('throws-via-warning when the dep returns wrong length, then preserves input order', async () => {
    const candidates = [makeChunk('A', 'a'), makeChunk('B', 'b')]
    const out = await rerank(
      { query: 'q', candidates, mode: 'local-cross-encoder' },
      {
        crossEncoderScore: async () => [0.5] // wrong length
      }
    )
    expect(out.map((c) => c.chunkId)).toEqual(['A', 'B'])
    expect(listEvents({ type: 'rag.rerank.completed' })[0].severity).toBe('warning')
  })
})

describe('rerank mode=llm', () => {
  it('respects the order returned by the dep', async () => {
    const out = await rerank(
      {
        query: 'q',
        candidates: [makeChunk('A', 'a'), makeChunk('B', 'b'), makeChunk('C', 'c')],
        mode: 'llm'
      },
      {
        llmRerank: async () => ['C', 'A', 'B']
      }
    )
    expect(out.map((c) => c.chunkId)).toEqual(['C', 'A', 'B'])
  })

  it('appends candidates the LLM dropped at the end so no chunk is silently lost', async () => {
    const out = await rerank(
      {
        query: 'q',
        candidates: [makeChunk('A', 'a'), makeChunk('B', 'b'), makeChunk('C', 'c')],
        mode: 'llm'
      },
      {
        llmRerank: async () => ['B'] // C and A are missing
      }
    )
    // B comes first (LLM order); A and C appended in original order.
    expect(out.map((c) => c.chunkId).slice(0, 1)).toEqual(['B'])
    expect(new Set(out.map((c) => c.chunkId))).toEqual(new Set(['A', 'B', 'C']))
  })

  it('falls back to input order on parse failure (dep returns null)', async () => {
    const out = await rerank(
      {
        query: 'q',
        candidates: [makeChunk('A', 'a'), makeChunk('B', 'b')],
        mode: 'llm'
      },
      {
        llmRerank: async () => null
      }
    )
    expect(out.map((c) => c.chunkId)).toEqual(['A', 'B'])
    const events = listEvents({ type: 'rag.rerank.completed' })
    expect(events).toHaveLength(1)
    expect(events[0].severity).toBe('warning')
  })
})

describe('rerank maxCandidates cap', () => {
  it('only sends maxCandidates to the dep AND only returns that many', async () => {
    const candidates = ['A', 'B', 'C', 'D', 'E'].map((id) => makeChunk(id, id))
    let received = 0
    const out = await rerank(
      { query: 'q', candidates, mode: 'local-cross-encoder', maxCandidates: 3 },
      {
        crossEncoderScore: async (_q, list) => {
          received = list.length
          return list.map(() => 0)
        }
      }
    )
    expect(received).toBe(3)
    expect(out).toHaveLength(3)
  })
})
