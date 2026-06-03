import { create } from 'zustand'
import type {
  EmbedderInfo,
  IngestProgressEvent,
  RagCollection,
  RagDocument
} from '@/lib/types'
import { toast } from '@/stores/toast-store'

// RAG store. State is intentionally thin: collections + per-collection
// documents + active ingest progress + the embedder catalogue/active id.
// Citation state and chat attachments land in R11/R12 stores; this one
// stays focused on the Library view's needs.

interface RagState {
  collections: RagCollection[]
  collectionsLoading: boolean
  activeCollectionId: string | null

  documents: Map<string, RagDocument[]>
  documentsLoading: Set<string>

  /** keyed by jobId → latest progress event */
  ingestProgress: Map<string, IngestProgressEvent>

  embedders: EmbedderInfo[]
  activeEmbedderId: string | null

  /** Subscription handle so we can unsubscribe on hot reload / teardown. */
  _progressUnsub: (() => void) | null

  loadCollections: () => Promise<void>
  createCollection: (input: {
    name: string
    description?: string
    embedderId?: string
  }) => Promise<RagCollection | null>
  renameCollection: (id: string, name: string) => Promise<void>
  deleteCollection: (id: string) => Promise<void>
  selectCollection: (id: string | null) => void

  loadEmbedders: () => Promise<void>
  setActiveEmbedder: (id: string) => Promise<void>

  loadDocuments: (collectionId: string) => Promise<void>
  submitIngest: (
    collectionId: string,
    files: Array<{ path?: string; text?: string; name: string }>
  ) => Promise<string | null>
  cancelIngest: (jobId: string) => Promise<void>
  reingestDocument: (documentId: string) => Promise<void>
  deleteDocument: (documentId: string) => Promise<void>

  /** Wire the per-window progress channel. Idempotent. */
  bindProgress: () => void
  unbindProgress: () => void
}

export const useRagStore = create<RagState>((set, get) => ({
  collections: [],
  collectionsLoading: false,
  activeCollectionId: null,

  documents: new Map(),
  documentsLoading: new Set(),

  ingestProgress: new Map(),

  embedders: [],
  activeEmbedderId: null,

  _progressUnsub: null,

  // ──────────────────── collections ────────────────────

  loadCollections: async () => {
    if (!window.api?.rag) return
    set({ collectionsLoading: true })
    const res = await window.api.rag.collection.list()
    if (res?.success) {
      set({
        collections: res.data as RagCollection[],
        collectionsLoading: false
      })
    } else {
      set({ collectionsLoading: false })
      toast.error(res?.error ?? 'Failed to load collections')
    }
  },

  createCollection: async (input) => {
    if (!window.api?.rag) return null
    const embedderId = input.embedderId ?? get().activeEmbedderId ?? 'bge-small-en-v1.5'
    const res = await window.api.rag.collection.create({
      name: input.name,
      description: input.description,
      embedderId
    })
    if (!res?.success) {
      toast.error(res?.error ?? 'Create failed')
      return null
    }
    const created = res.data as RagCollection
    set({
      collections: [created, ...get().collections],
      activeCollectionId: created.id
    })
    return created
  },

  renameCollection: async (id, name) => {
    if (!window.api?.rag) return
    const res = await window.api.rag.collection.update(id, { name })
    if (!res?.success) {
      toast.error(res?.error ?? 'Rename failed')
      return
    }
    set({
      collections: get().collections.map((c) =>
        c.id === id ? (res.data as RagCollection) : c
      )
    })
  },

  deleteCollection: async (id) => {
    if (!window.api?.rag) return
    const res = await window.api.rag.collection.delete(id)
    if (!res?.success) {
      toast.error(res?.error ?? 'Delete failed')
      return
    }
    const docs = new Map(get().documents)
    docs.delete(id)
    set({
      collections: get().collections.filter((c) => c.id !== id),
      activeCollectionId:
        get().activeCollectionId === id ? null : get().activeCollectionId,
      documents: docs
    })
  },

  selectCollection: (id) => {
    set({ activeCollectionId: id })
    if (id) void get().loadDocuments(id)
  },

  // ──────────────────── embedders ────────────────────

  loadEmbedders: async () => {
    if (!window.api?.rag) return
    const [catalog, active] = await Promise.all([
      window.api.rag.embedder.catalog(),
      window.api.rag.embedder.active()
    ])
    if (catalog?.success) {
      set({ embedders: catalog.data as EmbedderInfo[] })
    }
    if (active?.success) {
      set({ activeEmbedderId: (active.data as { id: string }).id })
    }
  },

  setActiveEmbedder: async (id) => {
    if (!window.api?.rag) return
    const res = await window.api.rag.embedder.setActive(id)
    if (!res?.success) {
      toast.error(res?.error ?? 'Failed to switch embedder')
      return
    }
    set({ activeEmbedderId: id })
    toast.success('Embedder switched')
  },

  // ──────────────────── documents ────────────────────

  loadDocuments: async (collectionId) => {
    if (!window.api?.rag) return
    const loading = new Set(get().documentsLoading)
    loading.add(collectionId)
    set({ documentsLoading: loading })
    const res = await window.api.rag.document.list(collectionId)
    const next = new Map(get().documents)
    if (res?.success) {
      next.set(collectionId, res.data as RagDocument[])
    } else {
      toast.error(res?.error ?? 'Failed to load documents')
    }
    const stillLoading = new Set(get().documentsLoading)
    stillLoading.delete(collectionId)
    set({ documents: next, documentsLoading: stillLoading })
  },

  submitIngest: async (collectionId, files) => {
    if (!window.api?.rag) return null
    const res = await window.api.rag.document.ingest(collectionId, files)
    if (!res?.success) {
      toast.error(res?.error ?? 'Ingest submit failed')
      return null
    }
    // Optimistically reload the doc list so the queued/loading row appears
    // immediately. Progress events will mutate the row in-place after.
    void get().loadDocuments(collectionId)
    return (res.data as { jobId: string }).jobId
  },

  cancelIngest: async (jobId) => {
    if (!window.api?.rag) return
    await window.api.rag.document.cancel(jobId)
  },

  reingestDocument: async (documentId) => {
    if (!window.api?.rag) return
    const res = await window.api.rag.document.reingest(documentId)
    if (!res?.success) {
      toast.error(res?.error ?? 'Reingest failed')
      return
    }
    const collectionId = get().activeCollectionId
    if (collectionId) void get().loadDocuments(collectionId)
  },

  deleteDocument: async (documentId) => {
    if (!window.api?.rag) return
    const res = await window.api.rag.document.delete(documentId)
    if (!res?.success) {
      toast.error(res?.error ?? 'Delete failed')
      return
    }
    const collectionId = get().activeCollectionId
    if (collectionId) void get().loadDocuments(collectionId)
  },

  // ──────────────────── progress subscription ────────────────────

  bindProgress: () => {
    if (get()._progressUnsub) return
    if (!window.api?.rag?.document?.onProgress) return
    const unsub = window.api.rag.document.onProgress((raw) => {
      const e = raw as IngestProgressEvent
      const progress = new Map(get().ingestProgress)
      progress.set(e.jobId, e)
      set({ ingestProgress: progress })
      // On terminal phases, refresh the doc list so the table reflects the
      // final state.
      if (e.phase === 'ready' || e.phase === 'error') {
        const collectionId = get().activeCollectionId
        if (collectionId) void get().loadDocuments(collectionId)
      }
    })
    set({ _progressUnsub: unsub })
  },

  unbindProgress: () => {
    const unsub = get()._progressUnsub
    if (unsub) unsub()
    set({ _progressUnsub: null })
  }
}))
