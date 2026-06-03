// Embeddings model catalogue. Parallel to MODEL_CATALOG in
// `providers/registry.ts` but for local on-device embedders.
//
// Selection criteria (LAMPREY_RAG_PLAN.md §2.3):
//   - default: bge-small-en-v1.5 — 384 dims, ~33 MB, strong MTEB scores,
//     MIT-compatible license, mean-pool + L2-normalize friendly.
//   - alternate: all-MiniLM-L6-v2 — 384 dims, ~23 MB, fastest, slightly
//     weaker on paraphrase. Auto-selected on machines with <8 GB RAM.

export interface EmbedderInfo {
  id: string
  name: string
  dimensions: number
  approxBytes: number
  /** HF model id passed to transformers.js's `pipeline()`. */
  modelRef: string
  license?: string
  description?: string
}

export const EMBEDDING_CATALOG: readonly EmbedderInfo[] = [
  {
    id: 'bge-small-en-v1.5',
    name: 'BGE Small English v1.5',
    dimensions: 384,
    approxBytes: 33 * 1024 * 1024,
    modelRef: 'Xenova/bge-small-en-v1.5',
    license: 'MIT',
    description:
      'Default embedder. Strong MTEB scores, balanced speed/quality, mean-pool + L2-normalize.'
  },
  {
    id: 'all-MiniLM-L6-v2',
    name: 'all-MiniLM-L6-v2',
    dimensions: 384,
    approxBytes: 23 * 1024 * 1024,
    modelRef: 'Xenova/all-MiniLM-L6-v2',
    license: 'Apache-2.0',
    description:
      'Fastest option; slightly weaker on paraphrase. Auto-selected on low-RAM machines.'
  }
] as const

export const DEFAULT_EMBEDDER_ID = 'bge-small-en-v1.5'

export function getEmbedder(id: string): EmbedderInfo | undefined {
  return EMBEDDING_CATALOG.find((e) => e.id === id)
}

export function getDefault(): EmbedderInfo {
  // The catalogue is non-empty by construction; the bang documents that
  // and lets the renderer call sites treat the return as non-null.
  return EMBEDDING_CATALOG.find((e) => e.id === DEFAULT_EMBEDDER_ID)!
}
