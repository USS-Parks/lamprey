import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

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
  __peekMemoryChunks,
  __resetCollectionStore,
  countChunksForDocument,
  createCollection,
  deleteDocument,
  findDocumentByHash,
  getDocument,
  listDocuments
} from './store'
import {
  __forceMemoryFallback as forceEventMemory,
  __resetEventLog,
  listEvents
} from '../event-log'
import { IngestManager, type EmbeddingsLike } from './ingest'

const FIXTURE_MD = join(__dirname, 'loaders', '__fixtures__', 'sample.md')

// Deterministic fake embedder: 384-dim vector derived from text. The vec
// rows are stored as raw buffers in production; the orchestrator's contract
// is just "vectors.length === chunks.length" so deterministic content
// suffices for the orchestrator tests.
const fakeEmbeddings: EmbeddingsLike = {
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(384)
      for (let i = 0; i < t.length; i++) {
        v[i % 384] += t.charCodeAt(i) / 1000
      }
      return v
    })
  }
}

beforeEach(() => {
  __resetEventLog()
  forceEventMemory()
  __resetCollectionStore()
  __forceMemoryFallback()
})

function waitFor<T>(
  predicate: () => T | null | undefined,
  timeoutMs = 2000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const probe = (): void => {
      const v = predicate()
      if (v) return resolve(v)
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error('waitFor: timed out'))
      }
      setTimeout(probe, 10)
    }
    probe()
  })
}

// ──────────────────── happy path ────────────────────

describe('IngestManager — happy path (markdown fixture)', () => {
  it('walks loading → chunking → embedding → ready and persists chunks', async () => {
    const collection = createCollection({
      name: 'Smoke',
      embedderId: 'bge-small-en-v1.5'
    })
    const mgr = new IngestManager({ embeddings: fakeEmbeddings })
    const progressEvents: Array<{ phase: string; chunkCount?: number }> = []
    mgr.on('progress', (e) => progressEvents.push({ phase: e.phase, chunkCount: e.chunkCount }))

    const jobId = mgr.submit(collection.id, [
      { path: FIXTURE_MD, name: 'sample.md' }
    ])
    expect(jobId).toMatch(/[0-9a-f-]{36}/)

    // Wait for the doc to materialize in ready state.
    const finalDoc = await waitFor(() => {
      const docs = listDocuments(collection.id)
      const ready = docs.find((d) => d.status === 'ready')
      return ready ?? null
    })
    expect(finalDoc.status).toBe('ready')
    expect(finalDoc.chunkCount).toBeGreaterThan(0)
    expect(finalDoc.statusDetail).toBeUndefined()

    // The chunk memory mirror has the right number of rows for this doc.
    const chunkCount = countChunksForDocument(finalDoc.id)
    expect(chunkCount).toBe(finalDoc.chunkCount)
    expect(chunkCount).toBe(
      __peekMemoryChunks().filter((c) => c.documentId === finalDoc.id).length
    )

    // Progress events walk the documented phases (each at least once).
    const phases = new Set(progressEvents.map((p) => p.phase))
    expect(phases).toEqual(new Set(['loading', 'chunking', 'embedding', 'ready']))

    // Spine events: started + completed, both correlation-id'd to the jobId.
    const ingestEvents = listEvents({ correlationId: jobId, order: 'asc' })
    expect(ingestEvents.map((e) => e.type)).toEqual([
      'rag.ingest.started',
      'rag.ingest.completed'
    ])
  })
})

// ──────────────────── dedupe on identical hash ────────────────────

describe('IngestManager — dedupe', () => {
  it('a second ingest of the same content emits ready and creates no new doc rows', async () => {
    const collection = createCollection({
      name: 'Dedupe',
      embedderId: 'bge-small-en-v1.5'
    })
    const mgr = new IngestManager({ embeddings: fakeEmbeddings })

    const firstJob = mgr.submit(collection.id, [
      { path: FIXTURE_MD, name: 'sample.md' }
    ])
    const firstDoc = await waitFor(() => {
      const docs = listDocuments(collection.id)
      return docs.find((d) => d.status === 'ready') ?? null
    })
    void firstJob
    const docCountAfterFirst = listDocuments(collection.id).length

    // Second submission with the SAME file → dedupe hits the hash lookup.
    const secondJob = mgr.submit(collection.id, [
      { path: FIXTURE_MD, name: 'sample.md' }
    ])
    void secondJob
    // Wait briefly for the second job to run through.
    await new Promise((r) => setTimeout(r, 60))

    expect(listDocuments(collection.id).length).toBe(docCountAfterFirst)
    expect(findDocumentByHash(collection.id, firstDoc.hashSha256)).not.toBeNull()
  })
})

// ──────────────────── failure path ────────────────────

describe('IngestManager — failure paths', () => {
  it('an unsupported extension produces status="error" with a non-empty status_detail', async () => {
    const collection = createCollection({
      name: 'Failures',
      embedderId: 'bge-small-en-v1.5'
    })
    const dir = mkdtempSync(join(tmpdir(), 'lamprey-ingest-fail-'))
    try {
      const badPath = join(dir, 'bogus.unknownext')
      writeFileSync(badPath, 'some contents')
      const mgr = new IngestManager({ embeddings: fakeEmbeddings })
      mgr.submit(collection.id, [{ path: badPath, name: 'bogus.unknownext' }])
      const errored = await waitFor(() => {
        const docs = listDocuments(collection.id)
        return docs.find((d) => d.status === 'error') ?? null
      })
      expect(errored.statusDetail).toBeTruthy()
      expect(errored.statusDetail!.toLowerCase()).toMatch(/unsupported/)
      // No chunks for an errored doc.
      expect(countChunksForDocument(errored.id)).toBe(0)
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an embedding failure rolls back any partial chunks (count returns to 0)', async () => {
    const collection = createCollection({
      name: 'Embed fail',
      embedderId: 'bge-small-en-v1.5'
    })
    const failingEmbeddings: EmbeddingsLike = {
      embed: () => Promise.reject(new Error('embeddings down'))
    }
    const mgr = new IngestManager({ embeddings: failingEmbeddings })
    mgr.submit(collection.id, [{ path: FIXTURE_MD, name: 'sample.md' }])
    const errored = await waitFor(() => {
      const docs = listDocuments(collection.id)
      return docs.find((d) => d.status === 'error') ?? null
    })
    expect(errored.statusDetail).toContain('embeddings down')
    expect(countChunksForDocument(errored.id)).toBe(0)
    // The orchestrator emits a rag.ingest.failed event.
    const failed = listEvents({ type: 'rag.ingest.failed' })
    expect(failed.length).toBeGreaterThanOrEqual(1)
  })

  it('a vector-count mismatch fails the doc with a clear message', async () => {
    const collection = createCollection({
      name: 'Mismatch',
      embedderId: 'bge-small-en-v1.5'
    })
    const wrongCountEmbeddings: EmbeddingsLike = {
      // Return exactly one vector regardless of input — triggers the
      // contract check for any input that chunks into 2+ pieces.
      embed: () => Promise.resolve([new Float32Array(384)])
    }
    // Write a long enough text file inline to guarantee 2+ chunks.
    const dir = mkdtempSync(join(tmpdir(), 'lamprey-mismatch-'))
    try {
      const longPath = join(dir, 'big.txt')
      const para = 'This is a sentence with enough words to fill content. '.repeat(
        50
      )
      writeFileSync(longPath, `${para}\n\n${para}\n\n${para}`)
      const mgr = new IngestManager({ embeddings: wrongCountEmbeddings })
      mgr.submit(collection.id, [{ path: longPath, name: 'big.txt' }])
      const errored = await waitFor(() => {
        const docs = listDocuments(collection.id)
        return docs.find((d) => d.status === 'error') ?? null
      })
      expect(errored.statusDetail).toMatch(/vectors? for \d+ chunks/i)
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ──────────────────── cancellation ────────────────────

describe('IngestManager — cancellation', () => {
  it('cancel mid-flight transitions the doc to error with detail="cancelled"', async () => {
    const collection = createCollection({
      name: 'Cancel',
      embedderId: 'bge-small-en-v1.5'
    })
    type ResolveFn = (v: Float32Array[]) => void
    const resolverHolder: { fn: ResolveFn | null } = { fn: null }
    const blockingEmbeddings: EmbeddingsLike = {
      embed: (texts) =>
        new Promise<Float32Array[]>((resolve) => {
          resolverHolder.fn = resolve
          // Never auto-resolve — the cancel path is the contract under test.
          void texts
        })
    }
    const mgr = new IngestManager({ embeddings: blockingEmbeddings })
    const jobId = mgr.submit(collection.id, [{ path: FIXTURE_MD, name: 'sample.md' }])
    // Wait until the doc is in the embedding phase (the orchestrator awaits
    // our blocked promise there).
    await waitFor(() => {
      const docs = listDocuments(collection.id)
      return docs.find((d) => d.status === 'embedding') ?? null
    })
    const cancelled = mgr.cancel(jobId)
    expect(cancelled).toBe(true)
    // Unblock the embedding promise so the orchestrator advances and hits
    // the post-await cancel check.
    resolverHolder.fn?.([new Float32Array(384)])
    const errored = await waitFor(() => {
      const docs = listDocuments(collection.id)
      return docs.find((d) => d.status === 'error') ?? null
    })
    expect(errored.statusDetail).toBe('cancelled')
    expect(countChunksForDocument(errored.id)).toBe(0)
  })

  it('cancel on an unknown jobId returns false', () => {
    const mgr = new IngestManager({ embeddings: fakeEmbeddings })
    expect(mgr.cancel('not-a-real-job')).toBe(false)
  })
})

// ──────────────────── delete cascade ────────────────────

describe('IngestManager — delete cascade in memory fallback', () => {
  it('deleteDocument removes the doc AND its chunk rows', async () => {
    const collection = createCollection({
      name: 'Delete',
      embedderId: 'bge-small-en-v1.5'
    })
    const mgr = new IngestManager({ embeddings: fakeEmbeddings })
    mgr.submit(collection.id, [{ path: FIXTURE_MD, name: 'sample.md' }])
    const doc = await waitFor(() => {
      const docs = listDocuments(collection.id)
      return docs.find((d) => d.status === 'ready') ?? null
    })
    expect(countChunksForDocument(doc.id)).toBeGreaterThan(0)
    expect(deleteDocument(doc.id)).toBe(true)
    expect(getDocument(doc.id)).toBeNull()
    expect(countChunksForDocument(doc.id)).toBe(0)
  })
})
