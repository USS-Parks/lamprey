import { app, BrowserWindow, ipcMain } from 'electron'
import {
  addAttachment,
  createCollection,
  deleteCollection,
  deleteDocument,
  getChunk,
  getCollection,
  getDocument,
  listAttachments,
  listCollections,
  listDocuments,
  removeAttachment,
  updateCollection,
  updateDocument,
  type CollectionInput,
  type CollectionPatch
} from '../services/rag/store'
import { recordEvent } from '../services/event-log'
import { isVecAvailable, getVecLoadError } from '../services/rag/vec-loader'
import {
  EMBEDDING_CATALOG,
  getEmbeddingsService
} from '../services/rag/embeddings/service'
import {
  getIngestManager,
  type IngestFile,
  type IngestProgressEvent
} from '../services/rag/ingest'
import { retrieveWithMeta } from '../services/rag/retrieve'

// RAG IPC surface. R1 lands collection CRUD only. Document / query /
// embedder / attachment handlers arrive in later R-prompts.
//
// Every successful collection mutation writes a `rag.collection.*` event so
// the Activity Timeline shows when collections appeared, were renamed, or
// were removed. The producer is here (not in the store) for the same reason
// the project / settings / approval producers are at the IPC / service edge:
// the store doesn't know whether a write came from the renderer or from
// another main-process service (e.g. a future auto-workspace-collection),
// and the event categories are user-facing actions either way.

function emitCollectionEvent(
  type: 'rag.collection.created' | 'rag.collection.updated' | 'rag.collection.deleted',
  collectionId: string,
  extra: Record<string, unknown> = {}
): void {
  try {
    recordEvent({
      type,
      actorKind: 'user',
      projectId:
        typeof extra.projectId === 'string' ? (extra.projectId as string) : undefined,
      workspacePath:
        typeof extra.workspacePath === 'string'
          ? (extra.workspacePath as string)
          : undefined,
      entityKind: 'rag-collection',
      entityId: collectionId,
      payload: {
        collectionId,
        ...extra
      }
    })
  } catch (err) {
    console.error(`[rag] ${type} event failed:`, err)
  }
}

export function registerRagHandlers(): void {
  ipcMain.handle('rag:collection:list', async () => {
    try {
      return { success: true, data: listCollections() }
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message ?? 'rag:collection:list failed'
      }
    }
  })

  ipcMain.handle('rag:collection:create', async (_event, input: unknown) => {
    try {
      const created = createCollection(input as CollectionInput)
      emitCollectionEvent('rag.collection.created', created.id, {
        name: created.name,
        embedderId: created.embedderId,
        workspacePath: created.workspacePath,
        projectId: created.projectId
      })
      return { success: true, data: created }
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message ?? 'rag:collection:create failed'
      }
    }
  })

  ipcMain.handle('rag:collection:update', async (_event, id: unknown, patch: unknown) => {
    try {
      if (typeof id !== 'string' || !id) {
        return { success: false, error: 'id is required' }
      }
      const updated = updateCollection(id, (patch ?? {}) as CollectionPatch)
      emitCollectionEvent('rag.collection.updated', updated.id, {
        name: updated.name,
        embedderId: updated.embedderId,
        projectId: updated.projectId,
        workspacePath: updated.workspacePath
      })
      return { success: true, data: updated }
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message ?? 'rag:collection:update failed'
      }
    }
  })

  ipcMain.handle('rag:collection:delete', async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id) {
        return { success: false, error: 'id is required' }
      }
      // Capture the pre-delete row so the event payload can identify it by
      // name + scope. Without this, the timeline reader would only see an
      // id post-delete and couldn't reconstruct what the user removed.
      const existing = getCollection(id)
      const ok = deleteCollection(id)
      if (ok && existing) {
        emitCollectionEvent('rag.collection.deleted', id, {
          name: existing.name,
          embedderId: existing.embedderId,
          projectId: existing.projectId,
          workspacePath: existing.workspacePath
        })
      }
      return { success: true, data: ok }
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message ?? 'rag:collection:delete failed'
      }
    }
  })

  // Convenience probe for the renderer. R5+'s ingest UI uses this to show
  // a "vector search disabled" banner; R1 just exposes it as a read-only
  // surface.
  ipcMain.handle('rag:status', async () => {
    return {
      success: true,
      data: {
        vecAvailable: isVecAvailable(),
        vecError: getVecLoadError()
      }
    }
  })

  // ──────────────────── R2: embeddings catalogue + selection ────────────────────
  // The renderer can read the catalogue, see which embedder is active, and
  // request a switch. The `embed()` action is deliberately NOT exposed —
  // only the main-process ingest orchestrator (R5) calls it. A renderer
  // with raw embed access could DoS the worker with giant batches.

  ipcMain.handle('rag:embedder:catalog', async () => {
    return { success: true, data: EMBEDDING_CATALOG }
  })

  ipcMain.handle('rag:embedder:active', async () => {
    try {
      const userDataPath = app.getPath('userData')
      const svc = getEmbeddingsService(userDataPath)
      return { success: true, data: { id: svc.getActiveEmbedderId() } }
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message ?? 'rag:embedder:active failed'
      }
    }
  })

  ipcMain.handle('rag:embedder:setActive', async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id) {
        return { success: false, error: 'id is required' }
      }
      const userDataPath = app.getPath('userData')
      const svc = getEmbeddingsService(userDataPath)
      const info = await svc.setActive(id)
      return { success: true, data: info }
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message ?? 'rag:embedder:setActive failed'
      }
    }
  })

  // ──────────────────── R5: documents + ingest ────────────────────

  // Lazy-init the ingest manager + a shared progress fan-out. The ingest
  // manager wraps the embeddings service (which it depends on); we wire
  // the embeddings service in here rather than in the constructor so a
  // headless test environment (no app.getPath) can substitute via the
  // injected-deps API on the singleton.
  let ingestWired = false
  function ensureIngestWired(): ReturnType<typeof getIngestManager> {
    if (!ingestWired) {
      const userDataPath = app.getPath('userData')
      const embeddings = getEmbeddingsService(userDataPath)
      const mgr = getIngestManager({ embeddings })
      mgr.on('progress', (e: IngestProgressEvent) => {
        // Fan progress out to every renderer window. Cheap — the payload
        // is small and the channel is per-event, not per-tick.
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('rag:document:progress', e)
        }
      })
      ingestWired = true
      return mgr
    }
    return getIngestManager()
  }

  ipcMain.handle('rag:document:list', async (_event, collectionId: unknown) => {
    try {
      if (typeof collectionId !== 'string' || !collectionId) {
        return { success: false, error: 'collectionId is required' }
      }
      return { success: true, data: listDocuments(collectionId) }
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message ?? 'rag:document:list failed'
      }
    }
  })

  ipcMain.handle(
    'rag:document:ingest',
    async (_event, collectionId: unknown, files: unknown) => {
      try {
        if (typeof collectionId !== 'string' || !collectionId) {
          return { success: false, error: 'collectionId is required' }
        }
        if (!Array.isArray(files) || files.length === 0) {
          return { success: false, error: 'files must be a non-empty array' }
        }
        const sanitized: IngestFile[] = []
        for (const f of files as IngestFile[]) {
          if (!f || typeof f.name !== 'string' || !f.name) {
            return { success: false, error: 'each file requires a name' }
          }
          if (
            (typeof f.path !== 'string' || !f.path) &&
            typeof f.text !== 'string'
          ) {
            return {
              success: false,
              error: `file "${f.name}": one of {path, text} is required`
            }
          }
          sanitized.push({
            path: f.path,
            text: f.text,
            name: f.name,
            sourceKind: f.sourceKind
          })
        }
        const mgr = ensureIngestWired()
        const jobId = mgr.submit(collectionId, sanitized)
        return { success: true, data: { jobId } }
      } catch (err) {
        return {
          success: false,
          error: (err as Error)?.message ?? 'rag:document:ingest failed'
        }
      }
    }
  )

  ipcMain.handle('rag:document:reingest', async (_event, documentId: unknown) => {
    try {
      if (typeof documentId !== 'string' || !documentId) {
        return { success: false, error: 'documentId is required' }
      }
      const doc = getDocument(documentId)
      if (!doc) return { success: false, error: 'not found' }
      // Reingest must run from the original source — paste-sourced rows
      // can't be re-ingested because the buffer is gone after the first run.
      if (!doc.sourcePath) {
        return {
          success: false,
          error: 'cannot reingest a paste-sourced document'
        }
      }
      // Clear the doc back to queued and drop its chunks; the orchestrator
      // will dedupe by hash but if the source file changed on disk the
      // hash is new, so a fresh document row will be created.
      updateDocument(doc.id, {
        status: 'queued',
        statusDetail: null,
        chunkCount: 0
      })
      const mgr = ensureIngestWired()
      const jobId = mgr.submit(doc.collectionId, [
        { path: doc.sourcePath, name: doc.displayName, sourceKind: doc.sourceKind }
      ])
      return { success: true, data: { jobId } }
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message ?? 'rag:document:reingest failed'
      }
    }
  })

  ipcMain.handle('rag:document:delete', async (_event, documentId: unknown) => {
    try {
      if (typeof documentId !== 'string' || !documentId) {
        return { success: false, error: 'documentId is required' }
      }
      const ok = deleteDocument(documentId)
      return { success: true, data: ok }
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message ?? 'rag:document:delete failed'
      }
    }
  })

  ipcMain.handle('rag:document:cancel', async (_event, jobId: unknown) => {
    try {
      if (typeof jobId !== 'string' || !jobId) {
        return { success: false, error: 'jobId is required' }
      }
      const mgr = ensureIngestWired()
      const ok = mgr.cancel(jobId)
      return { success: true, data: ok }
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message ?? 'rag:document:cancel failed'
      }
    }
  })

  // ──────────────────── R12: chunk fetch (citation preview) ────────────────────

  ipcMain.handle('rag:chunk:get', async (_event, chunkId: unknown) => {
    try {
      if (typeof chunkId !== 'string' || !chunkId) {
        return { success: false, error: 'chunkId is required' }
      }
      const chunk = getChunk(chunkId)
      if (!chunk) return { success: false, error: 'not found' }
      return { success: true, data: chunk }
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message ?? 'rag:chunk:get failed'
      }
    }
  })

  // ──────────────────── R11: conversation attachments ────────────────────

  ipcMain.handle(
    'rag:attachments:list',
    async (_event, conversationId: unknown) => {
      try {
        if (typeof conversationId !== 'string' || !conversationId) {
          return { success: false, error: 'conversationId is required' }
        }
        return { success: true, data: listAttachments(conversationId) }
      } catch (err) {
        return {
          success: false,
          error: (err as Error)?.message ?? 'rag:attachments:list failed'
        }
      }
    }
  )

  ipcMain.handle('rag:attachments:add', async (_event, raw: unknown) => {
    try {
      const input = (raw ?? {}) as {
        conversationId?: unknown
        collectionId?: unknown
        documentId?: unknown
      }
      if (typeof input.conversationId !== 'string' || !input.conversationId) {
        return { success: false, error: 'conversationId is required' }
      }
      const collectionId =
        typeof input.collectionId === 'string' ? input.collectionId : undefined
      const documentId =
        typeof input.documentId === 'string' ? input.documentId : undefined
      return {
        success: true,
        data: addAttachment({
          conversationId: input.conversationId,
          collectionId,
          documentId
        })
      }
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message ?? 'rag:attachments:add failed'
      }
    }
  })

  ipcMain.handle('rag:attachments:remove', async (_event, raw: unknown) => {
    try {
      const input = (raw ?? {}) as {
        conversationId?: unknown
        collectionId?: unknown
        documentId?: unknown
      }
      if (typeof input.conversationId !== 'string' || !input.conversationId) {
        return { success: false, error: 'conversationId is required' }
      }
      const ok = removeAttachment({
        conversationId: input.conversationId,
        collectionId:
          typeof input.collectionId === 'string' ? input.collectionId : undefined,
        documentId:
          typeof input.documentId === 'string' ? input.documentId : undefined
      })
      return { success: true, data: ok }
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message ?? 'rag:attachments:remove failed'
      }
    }
  })

  // ──────────────────── R7: hybrid retrieval ────────────────────

  ipcMain.handle('rag:query:run', async (_event, raw: unknown) => {
    try {
      const input = (raw ?? {}) as {
        query?: unknown
        collectionIds?: unknown
        topN?: unknown
      }
      if (typeof input.query !== 'string' || !input.query.trim()) {
        return { success: false, error: 'query is required' }
      }
      if (
        !Array.isArray(input.collectionIds) ||
        input.collectionIds.length === 0 ||
        !input.collectionIds.every((c) => typeof c === 'string' && c.length > 0)
      ) {
        return { success: false, error: 'collectionIds must be a non-empty string array' }
      }
      // Wire embeddings on demand — the renderer is the entry point, but
      // raw embed access isn't exposed; we make the embed call here using
      // the singleton service.
      const userDataPath = app.getPath('userData')
      const embeddings = getEmbeddingsService(userDataPath)
      const info = await retrieveWithMeta({
        query: input.query,
        collectionIds: input.collectionIds as string[],
        topN: typeof input.topN === 'number' ? input.topN : undefined,
        embed: (texts) => embeddings.embed(texts)
      })
      return { success: true, data: info }
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message ?? 'rag:query:run failed'
      }
    }
  })
}
