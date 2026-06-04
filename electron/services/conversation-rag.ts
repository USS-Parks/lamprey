import { app } from 'electron'
import {
  createCollection,
  getCollection,
  listCollections,
  type RagCollection
} from './rag/store'
import { getEmbeddingsService } from './rag/embeddings/service'
import { DEFAULT_EMBEDDER_ID } from './rag/embeddings/catalog'

// Per-conversation auto-collection helper.
//
// When the user attaches a file larger than INLINE_THRESHOLD_BYTES (see
// file-handler.ts), we route it through the RAG pipeline instead of inlining
// its content into the prompt. Those files all land in a single collection
// scoped to the conversation. The naming convention is:
//
//   "__auto:<conversationId>"
//
// The "__auto:" prefix is the marker that the Library UI uses to optionally
// hide these from the user-facing collection list (clutter avoidance — every
// conversation that ever indexed a file would otherwise show up as a row).
// The collection rows still live in rag_collections so retrieval, citation,
// and the Activity Timeline all work the same way as user-created
// collections.
//
// `ensureConversationCollection` is idempotent: it scans listCollections for
// the prefixed name and returns the existing id on hit, or creates a fresh
// collection on miss. Created collections use the currently active embedder
// (matching what the user would have picked manually) and the default chunk
// size / overlap.

const AUTO_COLLECTION_PREFIX = '__auto:'

export function autoCollectionNameFor(conversationId: string): string {
  return `${AUTO_COLLECTION_PREFIX}${conversationId}`
}

export function isAutoCollectionName(name: string): boolean {
  return name.startsWith(AUTO_COLLECTION_PREFIX)
}

/**
 * Idempotent: returns the conversation's auto-collection, creating it if
 * none exists yet. Safe to call on every file upload — the lookup is one
 * SELECT and the create branch only fires on the first miss.
 *
 * `getEmbeddingsService` requires a userData path; we resolve it from the
 * Electron app singleton. In the rare case the embeddings service isn't
 * initialized yet (very early startup), we fall back to DEFAULT_EMBEDDER_ID
 * so the create call still has a valid embedderId.
 */
export function ensureConversationCollection(conversationId: string): RagCollection {
  if (!conversationId || typeof conversationId !== 'string') {
    throw new Error('ensureConversationCollection: conversationId is required')
  }

  const targetName = autoCollectionNameFor(conversationId)
  const existing = listCollections().find((c) => c.name === targetName)
  if (existing) {
    // Re-fetch to materialize any fields the listCollections projection
    // skipped (none currently, but cheap and future-proof).
    return getCollection(existing.id) ?? existing
  }

  let embedderId = DEFAULT_EMBEDDER_ID
  try {
    const userDataPath = app.getPath('userData')
    embedderId = getEmbeddingsService(userDataPath).getActiveEmbedderId()
  } catch (err) {
    // Embeddings service not ready (or running outside a packaged app for
    // some headless context). Fall through to the default; createCollection
    // requires a non-empty embedderId.
    console.warn(
      '[conversation-rag] could not resolve active embedder, using default:',
      (err as Error)?.message
    )
  }

  return createCollection({
    name: targetName,
    description: `Auto-indexed attachments for conversation ${conversationId}`,
    embedderId
  })
}
