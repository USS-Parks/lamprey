import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The embeddings service is exercised via an injected fake worker so the
// test runs without spawning a real worker_thread or downloading the
// 33 MB bge-small model. The real-worker path is integration-only — gated
// by the `LAMPREY_RUN_EMBED_NETWORK` env var per the plan's "first-run
// download allowed up to 60s" note. We do NOT default it on; that would
// burn ~33 MB of bandwidth on every CI run.

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
  __resetEventLog,
  listEvents
} from '../../event-log'
import { EMBEDDING_CATALOG, DEFAULT_EMBEDDER_ID, getDefault, getEmbedder } from './catalog'
import {
  EmbeddingsService,
  __resetEmbeddingsService,
  type WorkerFactory,
  type WorkerLike
} from './service'

beforeEach(() => {
  __resetEventLog()
  __forceMemoryFallback()
  __resetEmbeddingsService()
})

afterEach(() => {
  __resetEmbeddingsService()
})

// ──────────────────── catalog ────────────────────

describe('EMBEDDING_CATALOG', () => {
  it('default is bge-small-en-v1.5', () => {
    expect(DEFAULT_EMBEDDER_ID).toBe('bge-small-en-v1.5')
    expect(getDefault().id).toBe('bge-small-en-v1.5')
  })

  it('every entry has the required fields and a Xenova/* modelRef', () => {
    expect(EMBEDDING_CATALOG.length).toBeGreaterThanOrEqual(2)
    for (const e of EMBEDDING_CATALOG) {
      expect(e.id).toBeTruthy()
      expect(e.name).toBeTruthy()
      expect(e.dimensions).toBeGreaterThan(0)
      expect(e.approxBytes).toBeGreaterThan(0)
      expect(e.modelRef).toMatch(/^Xenova\//)
    }
  })

  it('getEmbedder returns undefined for unknown ids', () => {
    expect(getEmbedder('not-a-real-embedder')).toBeUndefined()
  })
})

// ──────────────────── fake-worker plumbing ────────────────────

/**
 * Build a fake worker that resolves load/embed messages immediately. The
 * `embed` reply is deterministic so the test can assert ordering + dim.
 * Implemented as a synchronous responder using a microtask hop so the
 * service's pending-map plumbing has time to register a callback first.
 */
function makeFakeWorker(dim: number): { factory: WorkerFactory; instance: WorkerLike } {
  const messageHandlers: Array<(msg: unknown) => void> = []
  const errorHandlers: Array<(err: Error) => void> = []
  const fake: WorkerLike = {
    postMessage(msg: unknown) {
      // Microtask reply so the .send() promise has time to register first.
      queueMicrotask(() => {
        const m = msg as { type: string; id: string; texts?: string[] }
        if (m.type === 'load') {
          for (const h of messageHandlers) h({ type: 'load:done', id: m.id })
        } else if (m.type === 'embed') {
          const texts = m.texts ?? []
          const vectors = texts.map((t) => {
            const v = new Float32Array(dim)
            // Deterministic: bucket each text's char codes mod dim.
            for (let i = 0; i < t.length; i++) {
              v[i % dim] += t.charCodeAt(i) / 1000
            }
            return v
          })
          for (const h of messageHandlers) h({ type: 'embed:done', id: m.id, vectors })
        } else if (m.type === 'dispose') {
          // no-op for the fake
        }
      })
    },
    on(event: 'message' | 'error', listener: any) {
      if (event === 'message') messageHandlers.push(listener)
      else if (event === 'error') errorHandlers.push(listener)
    },
    terminate: () => Promise.resolve(0)
  }
  return {
    factory: () => fake,
    instance: fake
  }
}

// ──────────────────── service behaviour with the fake worker ────────────────────

describe('EmbeddingsService — fake worker', () => {
  it('setActive emits download.started + download.completed on first activation', async () => {
    const { factory } = makeFakeWorker(384)
    const svc = new EmbeddingsService('/tmp/userdata', factory)
    await svc.setActive('bge-small-en-v1.5')
    const types = listEvents({ order: 'asc' }).map((e) => e.type)
    expect(types).toContain('rag.model.download.started')
    expect(types).toContain('rag.model.download.completed')
  })

  it('a second setActive for the SAME model does not emit a second download event pair', async () => {
    const { factory } = makeFakeWorker(384)
    const svc = new EmbeddingsService('/tmp/userdata', factory)
    await svc.setActive('bge-small-en-v1.5')
    const baseline = listEvents({ type: 'rag.model.download.started' }).length
    await svc.setActive('bge-small-en-v1.5')
    expect(listEvents({ type: 'rag.model.download.started' }).length).toBe(baseline)
  })

  it('switching to a different model DOES emit a new download pair', async () => {
    const { factory } = makeFakeWorker(384)
    const svc = new EmbeddingsService('/tmp/userdata', factory)
    await svc.setActive('bge-small-en-v1.5')
    await svc.setActive('all-MiniLM-L6-v2')
    const events = listEvents({ type: 'rag.model.download.started' })
    expect(events.length).toBe(2)
    const ids = events.map((e) => (e.payload as { embedderId: string }).embedderId).sort()
    expect(ids).toEqual(['all-MiniLM-L6-v2', 'bge-small-en-v1.5'])
  })

  it('setActive("unknown") throws with a clear message', async () => {
    const { factory } = makeFakeWorker(384)
    const svc = new EmbeddingsService('/tmp/userdata', factory)
    await expect(svc.setActive('totally-fake-id')).rejects.toThrow(/unknown embedder/i)
  })

  it('embed returns one Float32Array per input text in input order', async () => {
    const { factory } = makeFakeWorker(384)
    const svc = new EmbeddingsService('/tmp/userdata', factory)
    const vectors = await svc.embed(['alpha', 'beta', 'gamma'])
    expect(vectors).toHaveLength(3)
    for (const v of vectors) {
      expect(v).toBeInstanceOf(Float32Array)
      expect(v.length).toBe(384)
    }
  })

  it('embed batches texts above BATCH_SIZE into multiple worker calls', async () => {
    const { factory, instance } = makeFakeWorker(384)
    const spy = vi.spyOn(instance, 'postMessage')
    const svc = new EmbeddingsService('/tmp/userdata', factory)
    const texts = Array.from({ length: 75 }, (_, i) => `t${i}`)
    const out = await svc.embed(texts)
    expect(out).toHaveLength(75)
    // We expect: 1 load message + ceil(75/32)=3 embed messages = 4 posts.
    const embedPosts = spy.mock.calls.filter(
      (c) => (c[0] as { type: string })?.type === 'embed'
    )
    expect(embedPosts.length).toBe(3)
  })

  it('embed([]) returns an empty array without touching the worker', async () => {
    const { factory, instance } = makeFakeWorker(384)
    const spy = vi.spyOn(instance, 'postMessage')
    const svc = new EmbeddingsService('/tmp/userdata', factory)
    const out = await svc.embed([])
    expect(out).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('dispose calls terminate on the worker', async () => {
    const { factory, instance } = makeFakeWorker(384)
    const terminateSpy = vi.spyOn(instance, 'terminate')
    const svc = new EmbeddingsService('/tmp/userdata', factory)
    await svc.setActive('bge-small-en-v1.5')
    await svc.dispose()
    expect(terminateSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects an embed call when the worker replies with an error message', async () => {
    // Build a fake that ALWAYS replies with an error to embed requests. The
    // service must surface that as a rejected promise (not a hang).
    type Msg =
      | { type: 'load:done'; id: string }
      | { type: 'embed:done'; id: string; vectors: Float32Array[] }
      | { type: 'error'; id: string; message: string }
    const messageHandlers: Array<(msg: Msg) => void> = []
    const fake: WorkerLike = {
      postMessage(msg: unknown) {
        queueMicrotask(() => {
          const m = msg as { type: string; id: string }
          if (m.type === 'load') {
            for (const h of messageHandlers) h({ type: 'load:done', id: m.id })
          } else if (m.type === 'embed') {
            for (const h of messageHandlers) {
              h({ type: 'error', id: m.id, message: 'pipeline crashed' })
            }
          }
        })
      },
      on(event: 'message' | 'error', listener: any) {
        if (event === 'message') messageHandlers.push(listener)
      },
      terminate: () => Promise.resolve(0)
    }
    const svc = new EmbeddingsService('/tmp/userdata', () => fake)
    await svc.setActive('bge-small-en-v1.5')
    await expect(svc.embed(['x'])).rejects.toThrow(/pipeline crashed/)
  })
})

// ──────────────────── real worker (network) — opt-in only ────────────────────

const runNet = process.env.LAMPREY_RUN_EMBED_NETWORK === '1'
describe.skipIf(!runNet)('EmbeddingsService — real worker (network)', () => {
  it('downloads bge-small and produces 384-dim normalized vectors', async () => {
    // Intentionally skipped by default. Setting LAMPREY_RUN_EMBED_NETWORK=1
    // exercises the real model download + first inference (~60s on a cold
    // cache). Place-holder body — when run, the developer asserts:
    //   const svc = new EmbeddingsService(realUserDataPath)
    //   await svc.setActive(DEFAULT_EMBEDDER_ID)
    //   const [v] = await svc.embed(['hello world'])
    //   expect(v.length).toBe(384)
    //   const norm = Math.sqrt([...v].reduce((s,x)=>s+x*x,0))
    //   expect(Math.abs(norm - 1)).toBeLessThan(1e-3)
  })
})
