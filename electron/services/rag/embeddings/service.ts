import { randomUUID } from 'crypto'
import {
  DEFAULT_EMBEDDER_ID,
  EMBEDDING_CATALOG,
  getEmbedder,
  type EmbedderInfo
} from './catalog'
import { boundedJsonPreview, recordEvent } from '../../event-log'

// Main-thread façade over the embeddings worker. Owns the queue of pending
// embed requests, batching, and the active-embedder choice.
//
// Worker lifecycle:
//   - Lazy: the worker isn't spawned until the first `setActive` or
//     `embed` call so app startup pays no cost when RAG is unused.
//   - One model loaded at a time. `setActive(newId)` sends a `load`
//     message; subsequent embed calls use the new pipeline.
//   - `dispose()` terminates the worker — used at app shutdown and at the
//     periodic restart point (the plan calls for restart after N=10,000
//     embeddings to dodge any long-run memory growth in onnxruntime).
//
// Why expose the embed function only to main-process callers (not the
// renderer): a renderer with embed access could DoS the worker by spamming
// large batches. The ingest orchestrator (R5) is the only legitimate
// caller; the renderer asks for ingest progress, not raw embeddings.

export type WorkerLike = {
  postMessage(msg: unknown): void
  on(event: 'message', listener: (msg: WorkerOutboundMessage) => void): void
  on(event: 'error', listener: (err: Error) => void): void
  terminate(): Promise<number> | void
}

export interface WorkerFactory {
  (init: { userDataPath: string }): WorkerLike
}

type WorkerOutboundMessage =
  | { type: 'load:done'; id: string }
  | { type: 'embed:done'; id: string; vectors: Float32Array[] }
  | { type: 'error'; id: string; message: string }

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

const BATCH_SIZE = 32

export class EmbeddingsService {
  private worker: WorkerLike | null = null
  private workerFactory: WorkerFactory
  private userDataPath: string
  private pending = new Map<string, Pending>()
  private activeEmbedderId: string = DEFAULT_EMBEDDER_ID
  private downloadEventEmittedFor = new Set<string>()

  constructor(userDataPath: string, workerFactory?: WorkerFactory) {
    this.userDataPath = userDataPath
    this.workerFactory =
      workerFactory ?? ((init) => spawnRealWorker(init.userDataPath))
  }

  /** Currently-selected embedder id (the one a future embed() call will use). */
  getActiveEmbedderId(): string {
    return this.activeEmbedderId
  }

  /**
   * Switch to a different embedder. On first use of a given model, the
   * underlying worker triggers a one-time HF download into the cache dir.
   * Transformers.js doesn't surface byte-level download progress easily;
   * v1 emits `started` + `completed` only.
   */
  async setActive(embedderId: string): Promise<EmbedderInfo> {
    const info = getEmbedder(embedderId)
    if (!info) {
      throw new Error(`setActive: unknown embedder "${embedderId}"`)
    }
    this.activeEmbedderId = embedderId
    await this.ensureWorker()
    const firstLoad = !this.downloadEventEmittedFor.has(embedderId)
    if (firstLoad) {
      this.emitModelEvent('rag.model.download.started', info)
    }
    try {
      await this.send({
        type: 'load',
        modelRef: info.modelRef
      })
      if (firstLoad) {
        this.downloadEventEmittedFor.add(embedderId)
        this.emitModelEvent('rag.model.download.completed', info)
      }
      return info
    } catch (err) {
      this.emitModelEvent('rag.model.download.failed', info, {
        errorPreview: boundedJsonPreview((err as Error)?.message)
      })
      throw err
    }
  }

  /**
   * Embed an array of texts. Batches up to BATCH_SIZE per worker call so
   * the worker can run one forward pass per batch. Returns a Float32Array
   * per input text in the same order.
   */
  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []
    await this.ensureWorker()
    // Ensure the active model is actually loaded — autoload it on first
    // embed so callers don't have to remember the setActive dance.
    if (this.downloadEventEmittedFor.size === 0) {
      await this.setActive(this.activeEmbedderId)
    }
    const out: Float32Array[] = []
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE)
      const vectors = (await this.send({
        type: 'embed',
        texts: batch
      })) as Float32Array[]
      out.push(...vectors)
    }
    return out
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'dispose' })
      } catch {
        // Worker may already be terminated.
      }
      const result = this.worker.terminate()
      if (result && typeof (result as Promise<number>).then === 'function') {
        await (result as Promise<number>)
      }
      this.worker = null
    }
    // Reject any still-pending sends; nothing will resolve them.
    for (const pending of this.pending.values()) {
      pending.reject(new Error('embeddings service disposed'))
    }
    this.pending.clear()
  }

  // ──────────────────── internals ────────────────────

  private async ensureWorker(): Promise<void> {
    if (this.worker) return
    this.worker = this.workerFactory({ userDataPath: this.userDataPath })
    this.worker.on('message', (msg) => this.handleWorkerMessage(msg))
    this.worker.on('error', (err) => {
      // A worker-level error fails every pending request — we have no way
      // to know which one was processing.
      for (const pending of this.pending.values()) {
        pending.reject(err)
      }
      this.pending.clear()
    })
  }

  private handleWorkerMessage(msg: WorkerOutboundMessage): void {
    if (!msg || typeof msg !== 'object') return
    const pending = this.pending.get(msg.id)
    if (!pending) return
    this.pending.delete(msg.id)
    switch (msg.type) {
      case 'load:done':
        pending.resolve(undefined)
        break
      case 'embed:done':
        pending.resolve(msg.vectors)
        break
      case 'error':
        pending.reject(new Error(msg.message))
        break
    }
  }

  private send(msg:
    | { type: 'load'; modelRef: string }
    | { type: 'embed'; texts: string[] }
  ): Promise<unknown> {
    if (!this.worker) {
      return Promise.reject(new Error('worker not initialized'))
    }
    const id = randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ ...msg, id })
    })
  }

  private emitModelEvent(
    type:
      | 'rag.model.download.started'
      | 'rag.model.download.completed'
      | 'rag.model.download.failed',
    info: EmbedderInfo,
    extra: Record<string, unknown> = {}
  ): void {
    try {
      recordEvent({
        type,
        actorKind: 'system',
        severity: type === 'rag.model.download.failed' ? 'error' : 'info',
        entityKind: 'embedder',
        entityId: info.id,
        payload: {
          embedderId: info.id,
          name: info.name,
          modelRef: info.modelRef,
          dimensions: info.dimensions,
          approxBytes: info.approxBytes,
          ...extra
        }
      })
    } catch (err) {
      console.error(`[embeddings] ${type} event failed:`, err)
    }
  }
}

// ──────────────────── real worker spawn ────────────────────

function spawnRealWorker(userDataPath: string): WorkerLike {
  // Late require so test environments can avoid pulling in worker_threads
  // and the compiled worker entry until they actually need to spawn one.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Worker } = require('worker_threads') as typeof import('worker_threads')
  // The compiled worker is bundled by electron-vite alongside the main
  // process; the path resolves from the running file. In dev, electron-vite
  // serves it from the same out/main directory.
  const workerPath = require.resolve('./worker.js') // resolved post-bundle
  const w = new Worker(workerPath, { workerData: { userDataPath } })
  return {
    postMessage: (m: unknown) => w.postMessage(m),
    on: (event: 'message' | 'error', listener: any) => {
      w.on(event, listener)
    },
    terminate: () => w.terminate()
  }
}

// ──────────────────── singleton ────────────────────

let singleton: EmbeddingsService | null = null

export function getEmbeddingsService(userDataPath?: string): EmbeddingsService {
  if (!singleton) {
    if (!userDataPath) {
      throw new Error(
        'getEmbeddingsService: first call must supply userDataPath'
      )
    }
    singleton = new EmbeddingsService(userDataPath)
  }
  return singleton
}

/** Test-only: drop the singleton so the next call rebuilds it. */
export function __resetEmbeddingsService(): void {
  if (singleton) {
    void singleton.dispose()
  }
  singleton = null
}

// Re-export for IPC handler convenience.
export { EMBEDDING_CATALOG, getEmbedder, getDefault, DEFAULT_EMBEDDER_ID } from './catalog'
export type { EmbedderInfo } from './catalog'
