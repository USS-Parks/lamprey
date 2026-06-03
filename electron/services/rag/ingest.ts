import { EventEmitter } from 'events'
import { randomUUID, createHash } from 'crypto'
import { stat } from 'fs/promises'
import { extname, basename } from 'path'
import {
  countChunksForDocument,
  deleteChunksForDocument,
  findDocumentByHash,
  getCollection,
  insertChunks,
  insertDocument,
  updateDocument,
  type DocumentStatus,
  type RagDocument
} from './store'
import { chunk as chunkText, type ChunkInput, type ChunkSourceKind } from './chunker'
import { loadDocument, loadFromBuffer } from './loaders'
import { boundedJsonPreview, recordEvent } from '../event-log'

// Ingest orchestrator. Ties loaders → chunker → embeddings → storage with
// progress events and cancellation. Per LAMPREY_RAG_PLAN.md §3 STEP 1.
//
// Job model:
//   submit(collectionId, files) returns a jobId immediately. The job
//   processes files serially (one at a time) to keep memory bounded — a
//   single ONNX inference batch can be ~250 MB of activation memory; doing
//   multiple files in parallel risks OOM.
//
//   Each file walks a fixed phase progression:
//     queued → loading → chunking → embedding → ready
//   On any phase failure the doc goes to `error` with a redacted reason in
//   `status_detail`. Cancellation between phases transitions to `error`
//   with detail `'cancelled'`.
//
// Spine emission:
//   rag.ingest.started at job submission per file.
//   rag.ingest.completed when status flips to 'ready'.
//   rag.ingest.failed when status flips to 'error' (including cancellation).
//   Each event's correlationId is the jobId so the Activity Timeline can
//   reconstruct one ingest run by id.

export interface IngestFile {
  /** Absolute path on disk. Mutually exclusive with `text`. */
  path?: string
  /** In-memory text content (paste / drag-drop string). */
  text?: string
  /** Display name. For path inputs we default to basename(path). */
  name: string
  /** Source kind override. Defaults to 'file' for path inputs, 'paste' for
   *  text inputs. */
  sourceKind?: ChunkSourceKind
}

export interface IngestProgressEvent {
  jobId: string
  documentId: string
  displayName: string
  phase: DocumentStatus
  /** 0..1 within the current phase. The phase boundaries are also progress
   *  steps; the renderer's progress bar can lerp between them. */
  progress: number
  chunkCount?: number
  error?: string
}

/** Minimum embeddings interface the orchestrator needs. Injecting this lets
 *  tests pass a deterministic stub instead of spawning a real worker. */
export interface EmbeddingsLike {
  embed(texts: string[]): Promise<Float32Array[]>
}

export interface IngestManagerDeps {
  embeddings: EmbeddingsLike
}

interface ActiveJob {
  jobId: string
  controller: AbortController
}

export class IngestManager extends EventEmitter {
  private deps: IngestManagerDeps
  private jobs = new Map<string, ActiveJob>()

  constructor(deps: IngestManagerDeps) {
    super()
    this.deps = deps
  }

  /**
   * Queue files for ingest into a collection. Returns the jobId immediately;
   * the actual work runs async and emits 'progress' / 'done' / 'error'
   * events as it proceeds. A single jobId covers all the files in one call.
   */
  submit(collectionId: string, files: IngestFile[]): string {
    if (!collectionId) throw new Error('submit: collectionId is required')
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('submit: files must be a non-empty array')
    }
    const collection = getCollection(collectionId)
    if (!collection) throw new Error(`submit: unknown collection "${collectionId}"`)
    const jobId = randomUUID()
    const controller = new AbortController()
    this.jobs.set(jobId, { jobId, controller })
    void this.runJob(jobId, collection.id, files, controller.signal).finally(() => {
      this.jobs.delete(jobId)
    })
    return jobId
  }

  /**
   * Cancel an in-flight job. The orchestrator checks the AbortSignal
   * between phases and transitions any active document to status='error'
   * with detail='cancelled'. Returns true on cancel; false if the job had
   * already finished.
   */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false
    job.controller.abort()
    return true
  }

  // ──────────────────── per-job pipeline ────────────────────

  private async runJob(
    jobId: string,
    collectionId: string,
    files: IngestFile[],
    signal: AbortSignal
  ): Promise<void> {
    for (const file of files) {
      await this.runOneFile(jobId, collectionId, file, signal)
    }
  }

  private async runOneFile(
    jobId: string,
    collectionId: string,
    file: IngestFile,
    signal: AbortSignal
  ): Promise<void> {
    const displayName = file.name
    const startedAt = Date.now()

    // 1. Source acquisition + hash.
    let buffer: Buffer
    let sourceKind: ChunkSourceKind
    let sourcePath: string | undefined
    let mtime: number | undefined
    let bytes: number | undefined
    try {
      if (file.path) {
        sourceKind = file.sourceKind ?? 'file'
        sourcePath = file.path
        const stats = await stat(file.path)
        mtime = stats.mtimeMs
        bytes = stats.size
        // Load through the dispatcher later; we still need the raw bytes
        // to hash. `loadDocument` reads the file again — for v1 that's
        // tolerable; the buffer is cached by the OS page cache anyway.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readFile } = require('fs/promises') as typeof import('fs/promises')
        buffer = await readFile(file.path)
      } else if (typeof file.text === 'string') {
        sourceKind = file.sourceKind ?? 'paste'
        buffer = Buffer.from(file.text, 'utf-8')
        bytes = buffer.length
      } else {
        throw new Error('IngestFile must have either `path` or `text`')
      }
    } catch (err) {
      // Bail before we even insert a document row — emit a synthetic
      // ingest.failed event so the renderer's progress UI sees the failure.
      this.emitProgress({
        jobId,
        documentId: '',
        displayName,
        phase: 'error',
        progress: 0,
        error: (err as Error)?.message ?? String(err)
      })
      this.emitJobEvent('rag.ingest.failed', jobId, {
        collectionId,
        displayName,
        sourcePath: file.path,
        durationMs: Date.now() - startedAt,
        errorPreview: boundedJsonPreview((err as Error)?.message ?? String(err))
      })
      return
    }

    const hashSha256 = createHash('sha256').update(buffer).digest('hex')

    // 2. Dedupe by hash.
    const existing = findDocumentByHash(collectionId, hashSha256)
    if (existing && existing.status === 'ready') {
      // Same content already indexed — emit a ready event so the UI shows
      // the existing row and move on.
      this.emitProgress({
        jobId,
        documentId: existing.id,
        displayName: existing.displayName,
        phase: 'ready',
        progress: 1,
        chunkCount: existing.chunkCount
      })
      return
    }

    // 3. Insert the document row in 'loading' status.
    const doc = insertDocument({
      collectionId,
      sourceKind,
      sourcePath,
      displayName,
      bytes,
      hashSha256,
      mtime,
      status: 'loading'
    })
    this.emitJobEvent('rag.ingest.started', jobId, {
      documentId: doc.id,
      collectionId,
      displayName,
      sourceKind,
      bytes
    })
    this.emitProgress({
      jobId,
      documentId: doc.id,
      displayName,
      phase: 'loading',
      progress: 0.1
    })
    if (this.checkCancel(jobId, doc, displayName, startedAt, signal)) return

    // 4. Load.
    let loaded: Awaited<ReturnType<typeof loadDocument>>
    try {
      if (file.path) {
        loaded = await loadDocument(file.path)
      } else {
        const t = loadFromBuffer(file.name, buffer)
        loaded = { kind: 'text', text: t.text, mime: t.mime }
      }
    } catch (err) {
      this.failDoc(jobId, doc, displayName, startedAt, (err as Error)?.message ?? String(err))
      return
    }
    if (this.checkCancel(jobId, doc, displayName, startedAt, signal)) return

    // 5. Chunk.
    updateDocument(doc.id, { status: 'chunking' })
    this.emitProgress({
      jobId,
      documentId: doc.id,
      displayName,
      phase: 'chunking',
      progress: 0.3
    })
    const collection = getCollection(collectionId)
    if (!collection) {
      // Collection deleted out from under us. Treat as cancel.
      this.failDoc(jobId, doc, displayName, startedAt, 'collection removed during ingest')
      return
    }
    const ext = file.path ? extname(file.path).toLowerCase() : extname(file.name).toLowerCase()
    const chunks: ReturnType<typeof chunkText> = []
    try {
      if (loaded.kind === 'paged') {
        // PDF path — one chunker call per page so the page stamp lands.
        for (const page of loaded.pages) {
          const pageChunks = chunkText(
            {
              text: page.text,
              sourceKind,
              mime: loaded.mime,
              extension: ext,
              page: page.page
            } as ChunkInput,
            { chunkSize: collection.chunkSize, chunkOverlap: collection.chunkOverlap }
          )
          // Re-number indices across pages.
          for (const c of pageChunks) {
            chunks.push({ ...c, index: chunks.length })
          }
        }
      } else {
        const input: ChunkInput = {
          text: loaded.text,
          sourceKind,
          mime: loaded.mime,
          extension: ext
        }
        const out = chunkText(input, {
          chunkSize: collection.chunkSize,
          chunkOverlap: collection.chunkOverlap
        })
        chunks.push(...out)
      }
    } catch (err) {
      this.failDoc(jobId, doc, displayName, startedAt, (err as Error)?.message ?? String(err))
      return
    }
    if (chunks.length === 0) {
      // The chunker filtered everything (input below MIN_CHUNK_CHARS, or a
      // PDF with extracted text but only tiny TOC fragments). Mark the doc
      // ready with chunk_count=0 so the UI can show "indexed, no content"
      // without re-trying the ingest on every refresh.
      updateDocument(doc.id, {
        status: 'ready',
        chunkCount: 0,
        ingestedAt: Date.now(),
        statusDetail: 'no extractable content'
      })
      this.emitProgress({
        jobId,
        documentId: doc.id,
        displayName,
        phase: 'ready',
        progress: 1,
        chunkCount: 0
      })
      this.emitJobEvent('rag.ingest.completed', jobId, {
        documentId: doc.id,
        collectionId,
        displayName,
        chunkCount: 0,
        durationMs: Date.now() - startedAt
      })
      return
    }
    if (this.checkCancel(jobId, doc, displayName, startedAt, signal)) return

    // 6. Embed.
    updateDocument(doc.id, { status: 'embedding', chunkCount: chunks.length })
    this.emitProgress({
      jobId,
      documentId: doc.id,
      displayName,
      phase: 'embedding',
      progress: 0.5,
      chunkCount: chunks.length
    })
    let vectors: Float32Array[]
    try {
      vectors = await this.deps.embeddings.embed(chunks.map((c) => c.text))
    } catch (err) {
      this.failDoc(jobId, doc, displayName, startedAt, (err as Error)?.message ?? String(err))
      return
    }
    // Cancel-check BEFORE the vector-count contract check: if the user
    // cancelled mid-embed and the worker happened to return a partial batch,
    // the right user-visible outcome is "cancelled", not "vector count
    // mismatch" — the count error would be misleading.
    if (this.checkCancel(jobId, doc, displayName, startedAt, signal)) return
    if (vectors.length !== chunks.length) {
      this.failDoc(
        jobId,
        doc,
        displayName,
        startedAt,
        `embeddings returned ${vectors.length} vectors for ${chunks.length} chunks`
      )
      return
    }

    // 7. Store in a single transaction (handled inside insertChunks).
    try {
      insertChunks(
        chunks.map((c) => ({
          documentId: doc.id,
          collectionId,
          chunkIndex: c.index,
          startOffset: c.startOffset,
          endOffset: c.endOffset,
          text: c.text,
          headingPath: c.headingPath,
          page: c.page,
          lineStart: c.lineStart,
          lineEnd: c.lineEnd
        })),
        vectors
      )
    } catch (err) {
      this.failDoc(jobId, doc, displayName, startedAt, (err as Error)?.message ?? String(err))
      return
    }

    updateDocument(doc.id, {
      status: 'ready',
      chunkCount: chunks.length,
      ingestedAt: Date.now(),
      statusDetail: null
    })
    this.emitProgress({
      jobId,
      documentId: doc.id,
      displayName,
      phase: 'ready',
      progress: 1,
      chunkCount: chunks.length
    })
    this.emitJobEvent('rag.ingest.completed', jobId, {
      documentId: doc.id,
      collectionId,
      displayName,
      chunkCount: chunks.length,
      durationMs: Date.now() - startedAt
    })
  }

  // ──────────────────── helpers ────────────────────

  private failDoc(
    jobId: string,
    doc: RagDocument,
    displayName: string,
    startedAt: number,
    reason: string
  ): void {
    updateDocument(doc.id, {
      status: 'error',
      statusDetail: truncate(reason, 1024)
    })
    // Roll back any chunks we managed to insert before the failure so the
    // doc row's chunk_count truthfully reflects on-disk state.
    deleteChunksForDocument(doc.id)
    this.emitProgress({
      jobId,
      documentId: doc.id,
      displayName,
      phase: 'error',
      progress: 0,
      error: reason
    })
    this.emitJobEvent('rag.ingest.failed', jobId, {
      documentId: doc.id,
      displayName,
      durationMs: Date.now() - startedAt,
      errorPreview: boundedJsonPreview(reason)
    })
  }

  private checkCancel(
    jobId: string,
    doc: RagDocument,
    displayName: string,
    startedAt: number,
    signal: AbortSignal
  ): boolean {
    if (!signal.aborted) return false
    updateDocument(doc.id, {
      status: 'error',
      statusDetail: 'cancelled'
    })
    deleteChunksForDocument(doc.id)
    this.emitProgress({
      jobId,
      documentId: doc.id,
      displayName,
      phase: 'error',
      progress: 0,
      error: 'cancelled'
    })
    this.emitJobEvent('rag.ingest.failed', jobId, {
      documentId: doc.id,
      displayName,
      durationMs: Date.now() - startedAt,
      cancelled: true
    })
    return true
  }

  private emitProgress(p: IngestProgressEvent): void {
    this.emit('progress', p)
  }

  private emitJobEvent(
    type:
      | 'rag.ingest.started'
      | 'rag.ingest.completed'
      | 'rag.ingest.failed',
    jobId: string,
    payload: Record<string, unknown>
  ): void {
    try {
      recordEvent({
        type,
        actorKind: 'user',
        severity: type === 'rag.ingest.failed' ? 'error' : 'info',
        correlationId: jobId,
        entityKind: 'rag-document',
        entityId:
          typeof payload.documentId === 'string'
            ? (payload.documentId as string)
            : undefined,
        payload: {
          jobId,
          ...payload
        }
      })
    } catch (err) {
      console.error(`[rag-ingest] ${type} event failed:`, err)
    }
  }
}

function truncate(s: string, cap: number): string {
  if (s.length <= cap) return s
  return s.slice(0, cap - 1) + '…'
}

// ──────────────────── singleton ────────────────────

let singleton: IngestManager | null = null

export function getIngestManager(deps?: IngestManagerDeps): IngestManager {
  if (!singleton) {
    if (!deps) {
      throw new Error('getIngestManager: first call must supply deps')
    }
    singleton = new IngestManager(deps)
  }
  return singleton
}

export function __resetIngestManager(): void {
  singleton = null
}

/** Re-export the chunk count helper for IPC convenience. */
export { countChunksForDocument } from './store'
