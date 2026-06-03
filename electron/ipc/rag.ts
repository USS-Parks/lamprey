import { app, ipcMain } from 'electron'
import {
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
  updateCollection,
  type CollectionInput,
  type CollectionPatch
} from '../services/rag/store'
import { recordEvent } from '../services/event-log'
import { isVecAvailable, getVecLoadError } from '../services/rag/vec-loader'
import {
  EMBEDDING_CATALOG,
  getEmbeddingsService
} from '../services/rag/embeddings/service'

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
}
