# Lamprey Local RAG — Plan & Prompt Sequence

**Version:** 1.0 — June 2026
**Working Directory:** `C:\Users\17076\Documents\Claude\Lamprey Harness`
**Status:** Pre-build. Hand the prompt blocks below to Claude Code in order.
**Companion file:** [`LAMPREY_RAG_ROSTER.md`](LAMPREY_RAG_ROSTER.md) — one-line roster of every prompt.

---

## 0. Goals & Non-Goals

### Goals
- **Local-only retrieval.** Embeddings, vector storage, and similarity search all run on-device. No cloud embeddings calls. The user's documents never leave the machine.
- **First-class chat surface.** Users attach a collection (or single file) to a chat turn the same way they attach an artifact context. Citations render inline and are clickable.
- **Hybrid retrieval.** Lexical (SQLite FTS5) + dense (sqlite-vec) fused via Reciprocal Rank Fusion. Lexical alone is brittle on paraphrase; dense alone is brittle on rare proper nouns. RRF beats either alone with no tuning.
- **Agent-aware.** Planner / Coder / Reviewer roles each get an appropriate slice of retrieved context. Coder gets focused code chunks; Planner gets scoped repo/spec excerpts; Reviewer gets the cited sources the assistant claimed to use.
- **Auditable.** All ingest, indexing, query, and rerank operations record events through the existing event spine (`electron/services/event-log.ts`). Activity Timeline can reconstruct every retrieval.
- **No fake polish.** Empty states, ingest failures, missing model files, and corrupt PDFs all surface real status. No mock progress bars.

### Non-Goals (v1)
- No cross-machine sync or shared collections. Local user only.
- No image / multimodal retrieval. Text and code only. (Image embeddings can come in a v2.)
- No agentic web-crawl ingestion. Users add files explicitly. Future skill can hook the `web-tools` pack to ingest a URL on demand, but that's a v2 concern.
- No fine-tuning of the embeddings model in-app. Users can swap to a different ONNX-converted model in Settings, but they bring their own model file.
- No retrieval for the artifact sandbox. Artifacts stay isolated; RAG context flows into the main chat system prompt only.

---

## 1. Prerequisites

These must be done **before** Prompt R1.

1. **Event spine shipped.** `electron/services/event-log.ts` exists and is wired into chat/tool flows. (Confirmed at time of plan authoring — `spine-events-prompt4.test.ts` is green.) RAG events ride this spine; do not build a parallel logger.
2. **Provider registry in place.** `electron/services/providers/registry.ts` `MODEL_CATALOG` exists. RAG borrows the registry pattern for an `EMBEDDING_CATALOG`.
3. **Native module rebuild script works.** `better-sqlite3` already loads its native binary against the pinned Electron 35. We will add `sqlite-vec` the same way — via npm — and rebuild against Electron.
4. **Disk budget.** First-launch model download is ~33 MB for `bge-small-en-v1.5`. The plan caches to `userData/models/` (the only writable production path). If `userData` is on a low-space volume, the user is warned before download.
5. **No conflicting v1 RAG.** This plan **supersedes** Data Spine Prompts 7 and 8 (FTS5 retrieval foundation + provenance UI). The schema introduced here covers both lexical and dense retrieval from day one. Data Spine Prompts 1-6 remain prerequisites; only the retrieval-specific Data Spine Prompts 7-8 are replaced.

---

## 2. Architecture

### 2.1 Process & Data Layout

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Process (Node)                      │
│                                                              │
│  electron/services/rag/                                      │
│  ├── store.ts          ← rag schema, collections/docs/chunks │
│  ├── vec-loader.ts     ← sqlite-vec extension loader         │
│  ├── embeddings/                                             │
│  │   ├── catalog.ts    ← EMBEDDING_CATALOG (parallel to MODEL_CATALOG) │
│  │   ├── worker.ts     ← worker_thread running transformers.js       │
│  │   └── service.ts    ← main-thread façade + queue                  │
│  ├── chunker.ts        ← recursive char splitter + heading-aware     │
│  ├── loaders/                                                        │
│  │   ├── text.ts       ← .md .txt .json .csv + source code           │
│  │   ├── pdf.ts        ← pdf-parse                                   │
│  │   └── docx.ts       ← mammoth                                     │
│  ├── ingest.ts         ← orchestrator (load → chunk → embed → store) │
│  ├── retrieve.ts       ← hybrid query (FTS5 + vec + RRF)             │
│  ├── rerank.ts         ← optional cross-encoder + LLM rerank         │
│  └── context-builder.ts ← assembles <context> blocks + citation IDs  │
│                                                                      │
│  electron/ipc/rag.ts   ← rag:* IPC handlers                          │
│  electron/services/event-log.ts ← rag.* event types (see §2.6)       │
└──────────────────────────────────────────────────────────────────────┘
                                  ↑
                                  │ IPC
                                  │
┌─────────────────────────────────┴──────────────────────────────────┐
│                       Renderer (React 19)                           │
│                                                                     │
│  src/components/library/                                            │
│  ├── LibraryView.tsx      ← top-level library page                  │
│  ├── CollectionList.tsx   ← sidebar of collections                  │
│  ├── DocumentTable.tsx    ← docs in a collection, ingest status     │
│  ├── IngestDropzone.tsx   ← drag-drop + file picker                 │
│  └── IngestProgressCard.tsx ← per-doc progress with cancel          │
│                                                                     │
│  src/components/chat/                                               │
│  ├── ChatInput.tsx        ← + @library mention + attach pill        │
│  ├── ContextAttachBar.tsx ← shows attached collections/files        │
│  ├── CitationChip.tsx     ← inline numbered citation                │
│  └── SourcePreviewPane.tsx ← opens on citation click                │
│                                                                     │
│  src/components/settings/                                           │
│  └── RagSettings.tsx      ← embedder choice, top-K, chunk size...   │
│                                                                     │
│  src/stores/rag-store.ts  ← attached refs, ingest progress, citations│
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Storage (SQLite)

All RAG tables live in the existing `lamprey.db`. No second database file. The sqlite-vec extension is loaded once at startup by `database.ts` (added in R1).

```sql
-- Collections: user-facing grouping (e.g. "Project docs", "Tax 2025")
CREATE TABLE rag_collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  embedder_id TEXT NOT NULL,            -- which embeddings model produced these vectors
  chunk_size  INTEGER NOT NULL DEFAULT 800,
  chunk_overlap INTEGER NOT NULL DEFAULT 100,
  workspace_path TEXT,                  -- optional binding to a workspace
  project_id  TEXT,                     -- optional binding to a project
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Documents: one row per ingested source (file / pasted blob)
CREATE TABLE rag_documents (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES rag_collections(id) ON DELETE CASCADE,
  source_kind   TEXT NOT NULL CHECK(source_kind IN ('file','paste','workspace','skill','memory','planning')),
  source_path   TEXT,                   -- absolute path for files, null for pastes
  display_name  TEXT NOT NULL,
  mime          TEXT,
  bytes         INTEGER,
  hash_sha256   TEXT NOT NULL,          -- content hash for change detection
  mtime         INTEGER,                -- source mtime for files
  status        TEXT NOT NULL CHECK(status IN ('queued','loading','chunking','embedding','ready','error','stale')),
  status_detail TEXT,                   -- error message or progress hint
  chunk_count   INTEGER NOT NULL DEFAULT 0,
  ingested_at   INTEGER,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_rag_documents_collection ON rag_documents(collection_id);
CREATE INDEX idx_rag_documents_status ON rag_documents(status);
CREATE INDEX idx_rag_documents_hash ON rag_documents(hash_sha256);

-- Chunks: the indexable atoms
CREATE TABLE rag_chunks (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL,          -- denormalized for query speed
  chunk_index  INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset   INTEGER NOT NULL,
  heading_path TEXT,                    -- e.g. "Architecture > Storage" for markdown
  page         INTEGER,                 -- for PDFs
  line_start   INTEGER,                 -- for source code
  line_end     INTEGER,
  text         TEXT NOT NULL,
  token_count  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_rag_chunks_document ON rag_chunks(document_id, chunk_index);
CREATE INDEX idx_rag_chunks_collection ON rag_chunks(collection_id);

-- FTS5 mirror for lexical retrieval (BM25)
CREATE VIRTUAL TABLE rag_chunks_fts USING fts5(
  text, heading_path,
  content='rag_chunks', content_rowid='rowid',
  tokenize='porter unicode61 remove_diacritics 2'
);
-- triggers keep FTS in sync with rag_chunks (defined in R1)

-- Vector index (sqlite-vec, dimension matches active embedder)
CREATE VIRTUAL TABLE rag_chunk_vec USING vec0(
  chunk_rowid INTEGER PRIMARY KEY,
  embedding   FLOAT[384]                -- 384 for bge-small / MiniLM; reconfigurable
);

-- Per-message retrieval record (what context we actually used)
CREATE TABLE rag_retrievals (
  id              TEXT PRIMARY KEY,
  message_id      TEXT NOT NULL,        -- assistant message that consumed this context
  conversation_id TEXT NOT NULL,
  query_text      TEXT NOT NULL,
  query_kind      TEXT NOT NULL,        -- 'user-turn' | 'planner-rewrite' | 'agent-followup'
  scopes_json     TEXT NOT NULL,        -- attached collections/files JSON
  results_json    TEXT NOT NULL,        -- ranked chunk_ids + scores + final ranks
  duration_ms     INTEGER,
  created_at      INTEGER NOT NULL,
  correlation_id  TEXT
);
CREATE INDEX idx_rag_retrievals_message ON rag_retrievals(message_id);
CREATE INDEX idx_rag_retrievals_conversation ON rag_retrievals(conversation_id, created_at DESC);
```

**Why all tables share the main DB:** atomic dropping when uninstalling, no second-DB orphan risk, simpler backup, simpler integrity checks, transactional ingest across structured + FTS + vec writes.

### 2.3 Embeddings

**Library:** `@xenova/transformers` (transformers.js). It ships an ONNX runtime backend (`onnxruntime-node` under the hood on Node), handles model download from HuggingFace mirrors with on-disk caching, and works in a `worker_thread` to keep the main loop responsive.

**Default model:** `Xenova/bge-small-en-v1.5` — 384-dim, ~33 MB, strong MTEB scores, MIT-compatible license, normalizable.

**Alternate:** `Xenova/all-MiniLM-L6-v2` — 384-dim, ~23 MB, fastest, slightly weaker on paraphrase. Auto-selected on machines with <8 GB RAM.

**Cache:** `userData/models/transformers/` (writable in production). Models are downloaded on first use; the UI shows a progress bar and the user must confirm the download.

**Worker model:**
- `embeddings/worker.ts` runs in a `worker_thread`.
- Holds one loaded pipeline at a time. Exposes `embed(texts: string[])` and `setModel(id)`.
- Batches incoming requests up to 32 texts per forward pass.
- The main-thread façade (`embeddings/service.ts`) queues calls and resolves promises round-trip.

**Why a worker, not just async:** ONNX inference is CPU-heavy. Without a worker, a 2,000-chunk ingest freezes the main process for tens of seconds and blocks IPC. With a worker, ingest is backgrounded and the UI stays responsive.

**Why not native llama.cpp embeddings:** binary distribution headache (per-arch, per-OS, GPU vs CPU builds) for marginal quality gain. transformers.js trades a small speed hit for zero-config installation across all Lamprey targets.

### 2.4 Chunking

**Default strategy:** recursive character splitter, separators `["\n\n", "\n", ". ", " ", ""]`, target size 800 chars, overlap 100 chars.

**Markdown:** pre-split on heading boundaries (`#`, `##`, `###`), then apply the recursive splitter inside each section. The chunk's `heading_path` is set from the heading stack ("Architecture > Storage > FTS5").

**Source code:** the v1 plan uses the recursive splitter only. Tree-sitter-aware splitting (one chunk per function/class) is noted as a future improvement in R3 but not built — it's the kind of "design for hypothetical requirement" the project's instructions warn against until we have evidence the dumb splitter fails for users.

**PDFs:** chunk by `pdf-parse` page text; if a page exceeds chunk size, recursively split within the page. `page` column is filled.

**Hard ceilings:** any chunk over 2,000 chars is split. Any chunk under 50 chars is discarded as too small to be useful retrieval signal (typically table-of-contents fragments).

### 2.5 Retrieval

**Hybrid scoring:**
1. Lexical: BM25 over `rag_chunks_fts` for the query, top-K (default 30) by FTS rank.
2. Dense: `MATCH` against `rag_chunk_vec` using the query embedding, top-K (default 30) by cosine distance.
3. Reciprocal Rank Fusion: each candidate gets score `1/(60 + rank_lex) + 1/(60 + rank_dense)`. Higher is better. Take top N (default 8) into the context window.

**Why RRF and not weighted sum:** the two scales (BM25 score vs cosine) are not directly commensurable. Tuning a weight is a hyperparameter the user shouldn't have to set. RRF is parameter-light, robust to scale, and used in practice by major hybrid search systems.

**Scoping:** queries always run scoped to the explicit list of `collection_id`s the user attached. No global cross-collection search by default — that would leak unrelated context into the system prompt and bloat tokens.

**Filters:** optional `source_kind` and `source_path LIKE` filters for narrowing within a collection.

**Reranking (R8, optional):**
- **Local cross-encoder:** `Xenova/ms-marco-MiniLM-L-6-v2`. Slow per-pair scoring but high quality. Off by default; toggled in Settings.
- **LLM-as-reranker:** uses the active fast model (DeepSeek V4 Flash by default) with a one-shot rerank prompt. Useful when collections are small and latency budget allows. Off by default.

**Multi-query rewrite (R9, optional):** the Planner agent rewrites the user query into 2-3 alternate phrasings, each is retrieved separately, then results are unioned through RRF. Helps for under-specified prompts. Off by default; toggled per-conversation.

### 2.6 Event Spine Integration

New event types added to `electron/services/event-log.ts` constants (see Data Spine Plan §2):

- `rag.collection.created` / `rag.collection.deleted` / `rag.collection.updated`
- `rag.ingest.started` (payload: doc id, source kind, bytes)
- `rag.ingest.completed` (payload: doc id, chunk count, duration)
- `rag.ingest.failed` (payload: doc id, error category, redacted reason)
- `rag.reindex.started` / `rag.reindex.completed` (collection-scoped)
- `rag.query.completed` (payload: scopes, lex hits, vec hits, fused count, duration, correlation_id)
- `rag.query.failed`
- `rag.rerank.completed` (payload: rerank kind, before/after top-N delta, duration)
- `rag.model.download.started` / `rag.model.download.completed` / `rag.model.download.failed`

Bounded previews only — no full retrieved chunk text in event payloads (chunks live in `rag_chunks`; events reference by id).

### 2.7 Chat Surface

**Attaching context:**
- `@library` in `ChatInput` opens a popover listing collections. Selecting one attaches it for this turn (and is sticky for the conversation until detached).
- `@file <name>` searches across documents in attached collections.
- Drag-drop a file onto the chat input ingests it into a default "Inbox" collection and attaches it for the next turn.
- The `ContextAttachBar` above the input shows attached chips with one-click detach.

**System prompt augmentation:** when collections are attached, the prompt builder (`electron/services/system-prompt-builder.ts`) inserts a `<retrieved_context>` block after `<memory>` and before `<skill>` blocks. Format:

```
<retrieved_context>
  <source id="1" path="docs/architecture.md" lines="42-78">
  ...chunk text...
  </source>
  <source id="2" path="notes/api.md" heading="Auth > Tokens">
  ...chunk text...
  </source>
</retrieved_context>

Instruction: cite sources by id, e.g. [1] or [1, 2]. If no source supports a claim, say so explicitly.
```

The numeric `id` is per-message and ties back to a `rag_retrievals.results_json` entry.

**Citation rendering:** the assistant message is post-processed to convert `[N]` and `[N, M]` patterns into `<CitationChip>` components that:
- Show a tooltip with `display_name` + heading/line range.
- Open the `SourcePreviewPane` on click, with the exact chunk highlighted and surrounding context visible.
- Are persisted in the message metadata so they survive conversation reload.

**No silent attachment:** RAG only runs when the user has explicitly attached at least one collection or file, or has flipped on a per-conversation "Auto-RAG" toggle. The system prompt never silently grows on every turn.

### 2.8 Agent Pipeline Integration

When `agent-pipeline.ts` runs Planner → Coder → Reviewer:

- **Planner** receives a broad top-10 retrieval (favoring overview chunks like headings, READMEs, planning docs). Used to scope the plan to repo facts.
- **Coder** receives a focused top-5 retrieval re-issued against the *plan text* (not the original user prompt) so it gets context for the specific work it's about to do.
- **Reviewer** receives only the chunks the Coder actually cited — so it can verify whether the cited sources support the claims, not re-discover its own context.

Each role's retrieval is recorded as a separate `rag_retrievals` row with `query_kind` set appropriately, and is tied to the same `correlation_id` as the agent run.

### 2.9 Settings

`AppSettings` gains:

```typescript
interface AppSettings {
  // ...existing...
  rag: {
    enabled: boolean;
    defaultEmbedderId: string;        // 'bge-small-en-v1.5' | 'all-MiniLM-L6-v2' | custom
    autoRagInConversations: boolean;  // run retrieval every turn when a collection is attached
    chunkSize: number;
    chunkOverlap: number;
    lexK: number;
    vecK: number;
    fusedTopN: number;
    rerankMode: 'off' | 'local-cross-encoder' | 'llm';
    multiQueryRewrite: boolean;
    citationRequired: boolean;        // model is told it must cite or refuse
  };
}
```

`RagSettings.tsx` surfaces every value with sensible defaults pre-filled. Power users can change them; defaults work out of the box.

### 2.10 IPC Surface

```typescript
window.api.rag = {
  collection: {
    list:    () => Promise<IpcResponse<RagCollection[]>>,
    create:  (input: { name: string; description?: string; embedderId?: string }) => Promise<IpcResponse<RagCollection>>,
    update:  (id: string, patch: Partial<RagCollection>) => Promise<IpcResponse<RagCollection>>,
    delete:  (id: string) => Promise<IpcResponse<void>>,
  },
  document: {
    list:    (collectionId: string) => Promise<IpcResponse<RagDocument[]>>,
    ingest:  (collectionId: string, files: { path?: string; text?: string; name: string }[]) => Promise<IpcResponse<{ jobId: string }>>,
    reingest:(documentId: string) => Promise<IpcResponse<void>>,
    delete:  (documentId: string) => Promise<IpcResponse<void>>,
    cancel:  (jobId: string) => Promise<IpcResponse<void>>,
    onProgress: (cb: (e: IngestProgressEvent) => void) => void,
  },
  query: {
    run:     (input: { query: string; collectionIds: string[]; topN?: number }) => Promise<IpcResponse<RetrievalResult>>,
    forMessage: (messageId: string) => Promise<IpcResponse<RetrievalResult | null>>,
  },
  embedder: {
    catalog: () => Promise<IpcResponse<EmbedderInfo[]>>,
    active:  () => Promise<IpcResponse<EmbedderInfo>>,
    setActive: (id: string) => Promise<IpcResponse<EmbedderInfo>>,
    download: (id: string) => Promise<IpcResponse<{ jobId: string }>>,
    onDownloadProgress: (cb: (e: DownloadProgressEvent) => void) => void,
  },
};
```

Every handler returns the standard `IpcResponse<T>`. Renderer wrappers in `src/lib/ipc-client.ts`.

---

## 3. File Inventory (Net New)

**Main process:**
- `electron/services/rag/store.ts`
- `electron/services/rag/vec-loader.ts`
- `electron/services/rag/embeddings/catalog.ts`
- `electron/services/rag/embeddings/worker.ts`
- `electron/services/rag/embeddings/service.ts`
- `electron/services/rag/chunker.ts`
- `electron/services/rag/loaders/text.ts`
- `electron/services/rag/loaders/pdf.ts`
- `electron/services/rag/loaders/docx.ts`
- `electron/services/rag/ingest.ts`
- `electron/services/rag/retrieve.ts`
- `electron/services/rag/rerank.ts`
- `electron/services/rag/context-builder.ts`
- `electron/ipc/rag.ts`

**Tests (Vitest, colocated):**
- `electron/services/rag/store.test.ts`
- `electron/services/rag/chunker.test.ts`
- `electron/services/rag/embeddings/service.test.ts`
- `electron/services/rag/ingest.test.ts`
- `electron/services/rag/retrieve.test.ts`
- `electron/services/rag/context-builder.test.ts`
- `electron/services/rag/end-to-end.test.ts`

**Renderer:**
- `src/components/library/LibraryView.tsx`
- `src/components/library/CollectionList.tsx`
- `src/components/library/DocumentTable.tsx`
- `src/components/library/IngestDropzone.tsx`
- `src/components/library/IngestProgressCard.tsx`
- `src/components/chat/ContextAttachBar.tsx`
- `src/components/chat/CitationChip.tsx`
- `src/components/chat/SourcePreviewPane.tsx`
- `src/components/settings/RagSettings.tsx`
- `src/stores/rag-store.ts`
- `src/hooks/useRag.ts`

**Modified:**
- `electron/services/database.ts` — load sqlite-vec, run new migrations
- `electron/services/system-prompt-builder.ts` — inject `<retrieved_context>` block
- `electron/services/agent-pipeline.ts` — per-role retrieval calls
- `electron/services/event-log.ts` — add `rag.*` event type constants
- `electron/ipc/index.ts` — register `rag:*` handlers
- `electron/preload.ts` — expose `window.api.rag`
- `src/lib/types.ts` — add RagCollection, RagDocument, RetrievalResult, EmbedderInfo, IngestProgressEvent, etc.
- `src/lib/ipc-client.ts` — typed wrappers
- `src/components/chat/ChatInput.tsx` — `@library` mention + drag-drop ingest
- `src/components/chat/MessageBubble.tsx` (or current equivalent) — citation parsing
- `src/App.tsx` / router — Library route
- `src/lib/AppSettings` — extend with `rag` block
- `README.md`, `DEVLOG.md`

**Dependencies to add:**
- `sqlite-vec` — vector extension for SQLite (precompiled binaries per platform)
- `@xenova/transformers` — embeddings runtime
- `pdf-parse` — PDF text extraction
- `mammoth` — DOCX text extraction

---

## 4. Execution Rules

1. **Sequential.** Run R1 → R14 in order. No skips.
2. **Verification gate.** Each prompt ends with explicit verification steps. Do not start the next prompt until those pass.
3. **DEVLOG entry.** Each prompt's outcome is logged in `DEVLOG.md` (timestamp, what shipped, what verification proved).
4. **TypeScript clean.** Both `tsconfig.node.json` and `tsconfig.web.json` must `tsc --noEmit` clean after every prompt.
5. **Tests stay green.** Existing tests must still pass. New tests must pass before the prompt is considered done.
6. **No GitHub push.** User reviews and pushes.
7. **No co-author trailer** in commits (per project memory).
8. **No fake polish.** If a feature isn't working, the UI says so. No fabricated checkmarks, no "verified" comments where verification didn't run.

---

## 5. Prompt Sequence

Each prompt below is self-contained. Hand it to Claude Code as the entire task message for that step.

---

### PROMPT R1 — RAG Schema, sqlite-vec, Collections

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: Event spine shipped. Multi-provider revision merged.

TASK: Land the SQLite foundation for local RAG. No retrieval yet. No embeddings yet. Just schema, extension loading, and collection CRUD.

STEPS:

1. Add dependencies:
   npm install sqlite-vec
   (sqlite-vec ships precompiled binaries for win/mac/linux x64+arm64.)

2. Create electron/services/rag/vec-loader.ts:
   - Export loadSqliteVec(db: Database.Database): void
   - Calls sqliteVec.load(db) from the sqlite-vec npm package.
   - Wraps in try/catch. If it throws, log a clear error and set a module-level flag isVecAvailable = false.
   - Export isVecAvailable(): boolean.

3. Modify electron/services/database.ts:
   - After opening the SQLite connection and BEFORE running migrations, call loadSqliteVec(db).
   - Log "[db] sqlite-vec loaded" or "[db] sqlite-vec UNAVAILABLE: <reason>".
   - If unavailable, the app still boots — RAG IPC handlers return a clear error in §R5.

4. Add migrations for all RAG tables from §2.2 of LAMPREY_RAG_PLAN.md:
   - rag_collections
   - rag_documents (with status check constraint, indexes)
   - rag_chunks (with indexes)
   - rag_chunks_fts (FTS5 virtual table + sync triggers — AFTER INSERT/UPDATE/DELETE on rag_chunks)
   - rag_chunk_vec (vec0 virtual table, FLOAT[384])
   - rag_retrievals (with indexes)
   - Use a numbered migration consistent with the existing migration style. Make migrations idempotent.

5. Create electron/services/rag/store.ts:
   - createCollection({ name, description?, embedderId, chunkSize?, chunkOverlap?, workspacePath?, projectId? }) -> RagCollection
   - listCollections() -> RagCollection[]
   - getCollection(id) -> RagCollection | null
   - updateCollection(id, patch) -> RagCollection
   - deleteCollection(id) -> void  (cascades to docs + chunks)
   - All timestamps via Date.now(). All ids via crypto.randomUUID().
   - Export TypeScript interfaces matching the renderer-side types.

6. Add types to src/lib/types.ts:
   - RagCollection
   - RagDocument (status enum, all columns)
   - RagChunk (subset for rendering)
   - RetrievalResult (placeholder, expanded in R7)
   - EmbedderInfo (placeholder, expanded in R2)
   - IngestProgressEvent (placeholder, expanded in R5)

7. Wire electron/ipc/rag.ts:
   - 'rag:collection:list' -> store.listCollections()
   - 'rag:collection:create' -> store.createCollection(input)
   - 'rag:collection:update' -> store.updateCollection(id, patch)
   - 'rag:collection:delete' -> store.deleteCollection(id)
   - Each handler returns IpcResponse<T>. Record event-log entries: rag.collection.created/updated/deleted.

8. Expose window.api.rag.collection.{list,create,update,delete} in preload + ipc-client.

9. Add tests in electron/services/rag/store.test.ts:
   - createCollection / getCollection roundtrip
   - listCollections returns expected ordering
   - deleteCollection cascades (insert a doc + chunk + vec row, delete the collection, assert all gone)
   - FTS sync trigger fires (insert a chunk, query FTS for a word, get the chunk rowid back)

VERIFICATION:
   - npx tsc --noEmit -p tsconfig.node.json (zero errors)
   - npx tsc --noEmit -p tsconfig.web.json (zero errors)
   - npx vitest run electron/services/rag/ (all pass)
   - Run the app, open DevTools, run:
       const r = await window.api.rag.collection.create({ name: 'Test', embedderId: 'bge-small-en-v1.5' })
       const list = await window.api.rag.collection.list()
       Both succeed; list contains the new collection.
   - Confirm "[db] sqlite-vec loaded" appears in main-process logs.
   - DEVLOG entry.
```

---

### PROMPT R2 — Local Embeddings Service

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: R1 — schema and collection CRUD shipped.

TASK: Build the local embeddings service. No ingest yet — just the ability to embed text and verify the worker round-trip.

STEPS:

1. Add dependency:
   npm install @xenova/transformers

2. Create electron/services/rag/embeddings/catalog.ts:
   - Export EMBEDDING_CATALOG: EmbedderInfo[]
   - Entries: bge-small-en-v1.5 (default, 384 dims, ~33 MB), all-MiniLM-L6-v2 (384 dims, ~23 MB)
   - Each entry: { id, name, dimensions, modelRef (HF id), approxBytes, license }
   - Export getEmbedder(id) and getDefault().

3. Create electron/services/rag/embeddings/worker.ts:
   - This file runs in a worker_thread (use Node worker_threads).
   - Imports { pipeline, env } from '@xenova/transformers'.
   - Set env.cacheDir = path.join(userDataPath, 'models', 'transformers')
   - Listens for messages: { type: 'load', modelRef } and { type: 'embed', texts, id }.
   - On load: lazy-create the feature-extraction pipeline. Reply 'ready'.
   - On embed: run pipeline(texts, { pooling: 'mean', normalize: true }). Convert tensor to Float32Array[].
     Reply { type: 'embed:done', id, vectors }.
   - On error: { type: 'error', id, message }.
   - The worker accepts userDataPath via initial workerData.

4. Create electron/services/rag/embeddings/service.ts:
   - class EmbeddingsService:
     - constructor(userDataPath): spawns the worker; tracks `activeEmbedderId`.
     - async setActive(id): sends 'load' to worker and awaits 'ready'. Persists choice to settings.
     - async embed(texts: string[]): batches up to 32; sends 'embed' messages with unique ids; returns Float32Array[] aligned to input order.
     - dispose(): worker.terminate().
   - Singleton accessor: getEmbeddingsService().
   - On startup, lazy-init on first IPC call (do not block app startup with a load).

5. Wire IPC in electron/ipc/rag.ts:
   - 'rag:embedder:catalog' -> EMBEDDING_CATALOG
   - 'rag:embedder:active' -> service.activeEmbedderId
   - 'rag:embedder:setActive' -> service.setActive(id) (records rag.model.download.* events if download happens)
   - 'rag:embedder:embed' -> service.embed(texts)  // hidden, used by tests only; not exposed in preload

6. Expose window.api.rag.embedder.{catalog, active, setActive} in preload + ipc-client.
   Do NOT expose embed() to the renderer.

7. Events:
   - On first load of a model, emit rag.model.download.started (with embedder id, approxBytes).
   - When pipeline becomes ready, emit rag.model.download.completed.
   - On worker load error, emit rag.model.download.failed (redacted reason).
   - Transformers.js doesn't surface byte-level download progress easily; for v1, emit started/completed only. Note this limitation in a code comment.

8. Add tests in electron/services/rag/embeddings/service.test.ts:
   - getDefault() returns bge-small-en-v1.5.
   - service.embed(['hello', 'world']) returns 2 Float32Array of length 384, normalized to ~unit length.
   - service.embed(['identical text', 'identical text']) returns two equal vectors.
   - service.setActive('all-MiniLM-L6-v2'); then service.embed(['hello']) returns a 384-dim vector (same dim by coincidence here, but the test asserts dimension matches the catalog entry).
   - This test will download model files on first run. Allow up to 60s timeout. Skip with describe.skip if env var LAMPREY_SKIP_NETWORK=1 is set, but default behavior is to run the test.

VERIFICATION:
   - tsc both configs clean.
   - vitest run electron/services/rag/embeddings/ — passes (allowing for first-run download).
   - In DevTools: const r = await window.api.rag.embedder.catalog(); r.data.length >= 2.
   - userData/models/transformers/ now contains the bge-small model files.
   - DEVLOG entry noting download size, time to first embedding, and pipeline cold-start time.
```

---

### PROMPT R3 — Chunker

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: R2 — embeddings service shipped.

TASK: Build the text chunker. Pure function; no IO; no IPC. Used by the ingest orchestrator in R5.

STEPS:

1. Create electron/services/rag/chunker.ts:
   - Export interface ChunkInput { text: string; sourceKind: 'file'|'paste'|...; mime?: string; }
   - Export interface ChunkOptions { chunkSize: number; chunkOverlap: number; }
   - Export interface ChunkOutput {
       index: number;
       startOffset: number; endOffset: number;
       text: string;
       headingPath?: string;
       page?: number;
       lineStart?: number; lineEnd?: number;
     }
   - Export function chunk(input: ChunkInput, opts: ChunkOptions): ChunkOutput[]

2. Implementation:
   - Default path: recursiveCharSplit using separators ["\n\n", "\n", ". ", " ", ""].
   - If mime === 'text/markdown' OR file extension is .md/.mdx:
     - Pre-split on heading boundaries (# / ## / ### / ####), maintain heading_path stack.
     - Within each section, run recursiveCharSplit.
     - Attach headingPath to each chunk.
   - If mime === 'application/pdf':
     - Treat input as already page-split by the PDF loader (R4). The chunker receives ChunkInput per page with input.page set, and recursive-splits within the page.
   - If sourceKind === 'file' and ext is in CODE_EXTENSIONS (.ts .tsx .js .jsx .py .rs .go .java .rb .cs .cpp .c .h .swift .kt):
     - Track lineStart / lineEnd by counting newlines in text up to each chunk boundary.
     - Otherwise use the recursive splitter with no special handling. (Tree-sitter-aware splitting is a v2 concern; do not build it now.)
   - Enforce hard ceilings:
     - Any chunk over 2000 chars: split with the recursive splitter again with a tighter target (chunkSize/2).
     - Any chunk under 50 chars: drop. Adjust subsequent chunk indices after dropping.

3. Add tests in electron/services/rag/chunker.test.ts:
   - Plain text: 5000-char input, chunkSize 800, overlap 100 — produces 6-7 chunks with overlap visible.
   - Markdown with three H2 sections — chunks get headingPath="Section A" etc; heading boundaries respected.
   - Code file: 200 lines of TypeScript — chunks have lineStart/lineEnd populated and contiguous.
   - Empty input -> empty array.
   - Input shorter than 50 chars -> empty array (per ceiling rule).
   - Input shorter than chunkSize but >50 chars -> one chunk covering full range.
   - 10000-char paragraph (no separators) -> falls through to char-level split, no chunk over 2000 chars.

VERIFICATION:
   - tsc both configs clean.
   - vitest run electron/services/rag/chunker.test.ts — passes.
   - DEVLOG entry with chunker characteristic numbers (chunk sizes, overlap behavior).
```

---

### PROMPT R4 — Document Loaders

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: R3 — chunker shipped.

TASK: Build document loaders for PDF, DOCX, plain text, markdown, and source code. Pure: take a file path or buffer, return normalized text (and per-page records for PDFs).

STEPS:

1. Add dependencies:
   npm install pdf-parse mammoth

2. Create electron/services/rag/loaders/text.ts:
   - export async function loadText(path: string): Promise<{ text: string; mime: string }>
   - Detects MIME by extension. Reads with fs/promises.readFile(path, 'utf8').
   - Rejects (throws) if file is > 25 MB or if it sniffs as binary (NUL bytes in first 4 KB).
   - Allowed extensions: .md .mdx .txt .json .csv .yaml .yml .ts .tsx .js .jsx .py .rs .go .java .rb .cs .cpp .c .h .swift .kt .sh .bash .ps1 .html .css .scss

3. Create electron/services/rag/loaders/pdf.ts:
   - export async function loadPdf(path: string): Promise<{ pages: { page: number; text: string }[]; mime: 'application/pdf' }>
   - Uses pdf-parse with a page-callback to capture per-page text.
   - Strips form-feed characters. Collapses runs of >2 newlines to two.
   - Throws "PDF appears scanned (no extractable text)" if total extracted text is < 100 chars across all pages.
   - Throws "PDF is encrypted" if pdf-parse signals encryption.

4. Create electron/services/rag/loaders/docx.ts:
   - export async function loadDocx(path: string): Promise<{ text: string; mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }>
   - Uses mammoth.extractRawText({ path }).
   - Normalizes Windows line endings to \n.

5. Create electron/services/rag/loaders/index.ts:
   - export async function loadDocument(path: string): Promise<LoadedDocument>
   - LoadedDocument is a discriminated union: { kind: 'text', text, mime } | { kind: 'paged', pages, mime }
   - Dispatches by extension. Rejects clearly for unsupported types.
   - Also export loadFromBuffer(name: string, buffer: Buffer) for paste/in-memory cases (text only — no PDF/DOCX paste support in v1).

6. Add tests in electron/services/rag/loaders/loaders.test.ts:
   - Place small fixtures in electron/services/rag/loaders/__fixtures__/:
     - sample.md, sample.ts, sample.txt
     - sample.pdf (3-page text PDF, ~5 KB)
     - sample.docx (2-paragraph DOCX, ~10 KB)
     - binary.bin (1 KB of NUL bytes)
     - too-large.txt (skipped — generated at test setup as a 30 MB temp file, deleted after)
   - Tests:
     - loadText sample.md returns text matching file content.
     - loadText binary.bin rejects.
     - loadText too-large.txt rejects with size error.
     - loadPdf sample.pdf returns 3 pages, each with text.
     - loadDocx sample.docx returns text containing known paragraphs.
     - loadDocument dispatches correctly for each extension.

VERIFICATION:
   - tsc both configs clean.
   - vitest run electron/services/rag/loaders/ — all green.
   - DEVLOG entry; note any loader quirks discovered.
```

---

### PROMPT R5 — Ingestion Orchestrator + IPC

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: R4 — loaders shipped.

TASK: Build the ingest orchestrator that ties loaders → chunker → embeddings → storage, with progress events and cancellation. Wire IPC.

STEPS:

1. Create electron/services/rag/ingest.ts:
   - export class IngestManager:
     - submit(collectionId, files: { path?: string; text?: string; name: string }[]): jobId
     - cancel(jobId): void
     - on(event, handler): EventEmitter-style for 'progress', 'done', 'error'
   - A job processes files serially (one at a time) to keep memory bounded.
   - For each file:
     a. Compute sha256 of content.
     b. If a document with the same hash exists in this collection, skip (and mark the existing doc 'ready').
     c. Insert rag_documents row with status='loading'.
     d. Call loadDocument(). On failure: set status='error', status_detail=truncated error, emit progress + event.
     e. Set status='chunking'. Chunk according to mime / extension. Apply collection's chunkSize/chunkOverlap.
     f. Set status='embedding'. Embed in batches via embeddings service. Stream progress events every batch.
     g. In a single SQLite transaction: insert all rag_chunks (capture rowids), insert into rag_chunk_vec keyed on chunk rowid, set chunk_count, set status='ready', set ingested_at.
   - Cancellation: ingest checks an AbortSignal between phases. If signaled, set status='error', status_detail='cancelled'.
   - Progress event shape: { jobId, documentId, displayName, phase, progress: 0..1, chunkCount, error? }.
   - Each phase transition records an event-log entry (rag.ingest.started, .completed, .failed).

2. Wire IPC in electron/ipc/rag.ts:
   - 'rag:document:list' -> SELECT from rag_documents where collection_id = ? order by updated_at desc
   - 'rag:document:ingest' -> ingest.submit(collectionId, files) returns { jobId }
   - 'rag:document:reingest' -> set status='queued', delete chunks + vec rows, resubmit single file
   - 'rag:document:delete' -> delete from rag_documents (cascades chunks)
   - 'rag:document:cancel' -> ingest.cancel(jobId)
   - Emit 'rag:document:progress' renderer events from ingest.on('progress', ...)

3. Preload + ipc-client + types:
   - Expose window.api.rag.document.{list,ingest,reingest,delete,cancel,onProgress}.
   - Define IngestProgressEvent in src/lib/types.ts.

4. Add tests in electron/services/rag/ingest.test.ts:
   - Mock embeddings service to return deterministic vectors (e.g. hash of text -> 384 fixed floats) so tests don't depend on the real model.
   - Ingest a small .md file from R4 fixtures -> doc status=ready, chunk_count matches expected.
   - Re-ingest the same file (same hash) -> dedupe path hit, no new rows created.
   - Ingest a malformed PDF (a renamed .bin) -> doc ends in status='error' with a non-empty status_detail.
   - Submit + immediate cancel -> doc ends 'error' with detail 'cancelled'; no orphan chunks.

VERIFICATION:
   - tsc both configs clean.
   - vitest run electron/services/rag/ingest.test.ts — passes.
   - Manually in DevTools:
       const c = await window.api.rag.collection.create({ name: 'Smoke', embedderId: 'bge-small-en-v1.5' })
       await window.api.rag.document.ingest(c.data.id, [{ path: 'C:/path/to/sample.md', name: 'sample.md' }])
       Listen for progress events; final state shows status='ready'.
   - Event timeline (if shipped) shows rag.ingest.started + .completed for the job.
   - DEVLOG entry.
```

---

### PROMPT R6 — Library UI

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: R5 — ingest is functional via IPC.

TASK: Build the Library view in the renderer. Browse collections, see docs, drag-drop to ingest, watch progress.

STEPS:

1. Create src/stores/rag-store.ts (Zustand):
   - State: collections[], collectionsLoading, activeCollectionId, documents (keyed by collectionId), ingestProgress (Map<jobId, IngestProgressEvent>), citations (per messageId)
   - Actions: loadCollections(), createCollection(input), deleteCollection(id), selectCollection(id), loadDocuments(collectionId), submitIngest(files), cancelIngest(jobId), removeDocument(id)
   - Subscribe to window.api.rag.document.onProgress and merge into ingestProgress map.

2. Create components in src/components/library/:
   - LibraryView.tsx — two-pane layout: CollectionList on left, DocumentTable on right. Top toolbar: "New Collection" button, embedder selector showing the active model.
   - CollectionList.tsx — vertical list of collections, doc count, last-updated. New + delete + rename inline.
   - DocumentTable.tsx — columns: name, source kind icon, status badge, chunk count, ingested-at, actions (reingest, delete). Status badge uses theme tokens (success/warning/error).
   - IngestDropzone.tsx — drag-drop region above the table; also has a "Browse" button using <input type=file multiple>. Drops in queue chips that show real-time progress.
   - IngestProgressCard.tsx — per-job card with file name, phase label, progress bar, cancel button. Updates from rag-store.

3. Wire a Library route into the app:
   - If the app uses a tab/sidebar nav structure (check src/components/layout/), add a "Library" entry there. Otherwise add a Library button to the existing left rail. Icon: a stacked-docs glyph from the project's icon set (or 📚 substitute only if no icon set is in use).
   - LibraryView is full-width when active (no chat panel underneath).

4. Empty states (real, not faked):
   - No collections: "No collections yet. Create one to start indexing your files." + "New Collection" button.
   - Collection with no docs: "Drop files here, or click Browse." + IngestDropzone shown prominently.
   - Document in error: red badge + tooltip with the truncated status_detail.

5. Tests:
   - If the project has React Testing Library set up, add src/components/library/LibraryView.test.tsx:
     - Renders empty state when collections list is empty.
     - Clicking "New Collection" calls store.createCollection with the typed name.
     - Drag-drop event triggers submitIngest.
   - If RTL is not set up in this project, skip UI tests; document the gap in DEVLOG.

VERIFICATION:
   - tsc both configs clean.
   - vitest (if applicable) passes.
   - Manual smoke: open Library, create "Test 1", drop in 3 small files, watch them go queued -> loading -> chunking -> embedding -> ready. Click reingest on one. Delete one. Delete the collection.
   - DEVLOG entry with screenshot reference (just filename in the working tree, do not embed).
```

---

### PROMPT R7 — Hybrid Retrieval Service

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: R6 — Library UI works end to end.

TASK: Build the hybrid retrieval service: BM25 + vector similarity fused via Reciprocal Rank Fusion. Persist retrieval records.

STEPS:

1. Create electron/services/rag/retrieve.ts:
   - export interface RetrievalInput {
       query: string;
       collectionIds: string[];
       lexK?: number;     // default 30
       vecK?: number;     // default 30
       topN?: number;     // default 8
       filters?: { sourceKind?: string; pathPrefix?: string };
     }
   - export interface RetrievedChunk {
       chunkId: string;
       documentId: string;
       collectionId: string;
       text: string;
       displayName: string;
       sourcePath?: string;
       headingPath?: string;
       page?: number;
       lineStart?: number; lineEnd?: number;
       scores: { lex?: number; vec?: number; fused: number };
     }
   - export async function retrieve(input: RetrievalInput): Promise<RetrievedChunk[]>

2. Implementation:
   a. Lexical leg: run "SELECT rowid, bm25(rag_chunks_fts) AS score FROM rag_chunks_fts WHERE rag_chunks_fts MATCH ? AND ... ORDER BY score LIMIT ?" scoped to collection_ids by joining rag_chunks. Lower bm25 = better.
   b. Vector leg: embed the query via the embeddings service. Run "SELECT chunk_rowid, distance FROM rag_chunk_vec WHERE embedding MATCH ? AND k = ? AND chunk_rowid IN (rowids-in-scope) ORDER BY distance" using sqlite-vec's KNN syntax. Lower distance = better (cosine).
   c. Combine: for each candidate chunk, compute rrf = 1/(60 + rank_lex) + 1/(60 + rank_vec). Missing leg contributes 0.
   d. Hydrate the top topN chunks: SELECT rag_chunks JOIN rag_documents to get text + metadata.
   e. Return ordered by fused score desc.

3. Persist a rag_retrievals row when called by chat (caller responsibility — retrieve() returns results; the chat handler persists). retrieve() itself is pure-ish (only reads from DB and embedding service).

4. Wire IPC:
   - 'rag:query:run' -> retrieve(input) and persist a rag_retrievals row with a generated id; return { retrievalId, results }.
   - 'rag:query:forMessage' -> SELECT from rag_retrievals where message_id = ?

5. Events:
   - rag.query.completed with payload { scopes, lexHits, vecHits, fusedCount, durationMs, correlationId }.
   - rag.query.failed on error.

6. Tests in electron/services/rag/retrieve.test.ts:
   - Seed: one collection with 50 chunks of synthetic text where ~5 contain a specific rare phrase and ~10 are paraphrases.
   - Use deterministic stub embeddings (consistent vector for known seed texts).
   - Query the rare phrase verbatim -> lex leg surfaces the 5; vec leg also surfaces them; RRF top-N includes all 5.
   - Query a paraphrase -> vec leg surfaces the paraphrases; lex leg has weak hits; RRF still ranks the paraphrases highly.
   - Empty query -> empty result with a clear error or empty array (decide and test consistently).
   - Scope to one collection of two -> results never include chunks from the other.
   - rrf math: assert that a candidate present in both legs ranks above one present in only one, all else equal.

VERIFICATION:
   - tsc both configs clean.
   - vitest run electron/services/rag/retrieve.test.ts — passes.
   - In DevTools: ingest a markdown file, then query a phrase from it, get back chunks with non-zero fused scores and matching text.
   - DEVLOG entry.
```

---

### PROMPT R8 — Optional Reranking

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: R7 — hybrid retrieval works.

TASK: Add an optional rerank pass with two modes (local cross-encoder, LLM-as-reranker). Off by default; toggled in settings.

STEPS:

1. Create electron/services/rag/rerank.ts:
   - export type RerankMode = 'off' | 'local-cross-encoder' | 'llm'
   - export async function rerank(query: string, candidates: RetrievedChunk[], mode: RerankMode): Promise<RetrievedChunk[]>
   - Mode 'off': return candidates unchanged.
   - Mode 'local-cross-encoder':
     - Use @xenova/transformers with model 'Xenova/ms-marco-MiniLM-L-6-v2' via a second worker channel (or extend embeddings/worker.ts to accept a 'rerank' task).
     - Score each (query, chunk.text) pair; reorder by score desc.
     - Cache the loaded reranker model the same way embeddings are cached.
   - Mode 'llm':
     - Build a single prompt: "Given query Q, rank these passages by relevance. Reply with a JSON array of ids in order best-to-worst." Truncate each passage to ~400 chars in the prompt.
     - Use the active "fast" model (look up via provider registry; default deepseek-chat).
     - On parse failure, fall through to candidates unchanged and log a warning.

2. Wire into retrieve:
   - retrieve() reads settings.rag.rerankMode. If not 'off', it pipes its top-(topN * 3) candidates through rerank, then truncates to topN.

3. Settings plumbing:
   - AppSettings.rag.rerankMode wired through settings store.
   - RagSettings.tsx (built in R12) will surface this.

4. Events:
   - rag.rerank.completed with mode, beforeTopIds, afterTopIds, durationMs.

5. Tests in electron/services/rag/rerank.test.ts:
   - With mode 'off': output equals input.
   - With mode 'llm' using a stubbed model adapter returning a fixed ordering: output respects that ordering.
   - With mode 'local-cross-encoder': mark as integration-only (runs the real model); allow LAMPREY_SKIP_NETWORK=1 to skip.

VERIFICATION:
   - tsc both configs clean.
   - vitest run electron/services/rag/rerank.test.ts — passes (cross-encoder test skipped or running).
   - DEVLOG entry with rerank timing observations.
```

---

### PROMPT R9 — Multi-Query Rewrite (Planner-Driven)

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: R8 — rerank works.

TASK: Add optional multi-query rewriting. Off by default. When on, the active Planner model rewrites the user's query into 2-3 alternate phrasings; each is retrieved separately; results are unioned via RRF.

STEPS:

1. Create electron/services/rag/multi-query.ts:
   - export async function rewriteQuery(query: string, planner: ProviderClient): Promise<string[]>
   - Prompt the planner: "Produce 2-3 short alternate phrasings of this query optimized for retrieval. Return JSON array of strings."
   - Parse with strict JSON. On parse failure: return [query] (graceful fall-through).
   - Length cap: reject any rewrite > 200 chars.

2. Modify retrieve.ts:
   - If settings.rag.multiQueryRewrite is true, call rewriteQuery first, then for each variant call the existing retrieve flow (without nesting multi-query), collect all candidates, fuse via RRF across variants (each variant produces its own ranks; final rrf sums 1/(60+rank) across variants).

3. Settings plumbing:
   - AppSettings.rag.multiQueryRewrite.

4. Events:
   - rag.query.completed payload extended to optionally include rewrites: string[].

5. Tests in electron/services/rag/multi-query.test.ts:
   - rewriteQuery with a stubbed planner returning a known JSON array -> parsed correctly.
   - Stub returning malformed JSON -> returns [original query].
   - Stub returning a rewrite over 200 chars -> filtered out.
   - retrieve() with multi-query on and 3 stub variants -> chunks present in two variants rank above chunks in one variant.

VERIFICATION:
   - tsc both configs clean.
   - vitest passes.
   - DEVLOG entry.
```

---

### PROMPT R10 — Context Assembly & Citation Protocol

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: R7-R9 — retrieval, rerank, multi-query all functional.

TASK: Assemble retrieved chunks into a <retrieved_context> block for the system prompt, and define the citation marker protocol (numeric ids tied to a rag_retrievals row).

STEPS:

1. Create electron/services/rag/context-builder.ts:
   - export interface ContextBuildInput {
       chunks: RetrievedChunk[];
       maxTokens: number;       // soft cap; default ~3000
     }
   - export interface ContextBuildOutput {
       block: string;           // the XML block to inject
       sourceMap: { id: number; chunkId: string; documentId: string; displayName: string; locator: string }[];
     }
   - export function buildContext(input): ContextBuildOutput
   - Assigns id = 1..N in fused-score order. Builds:
       <retrieved_context>
         <source id="1" path="..." lines="42-78">...chunk text...</source>
         ...
       </retrieved_context>
       Instruction: Cite sources by id in square brackets, e.g. [1] or [1, 2]. If no source supports a claim, say so explicitly.
   - Token cap: approximate with `Math.ceil(chars / 4)`; drop lowest-ranked sources until under cap.
   - locator: prefer "lines=X-Y" for code, "page=N" for PDFs, "heading=..." for markdown, else "offset=X-Y".

2. Modify electron/services/system-prompt-builder.ts:
   - buildSystemPrompt() accepts an optional retrievalContext: ContextBuildOutput.
   - Inserts the block AFTER <memory> and BEFORE <skill> sections.
   - When no retrieval context, no change to behavior.

3. Modify electron/ipc/chat.ts:
   - In the chat flow, BEFORE calling the provider, check if any RAG collections are attached for this conversation (read from a new conversation_rag_attachments table, see R11) or per-turn override.
   - If yes: call retrieve() with query=user's latest message, scopes=attached, defaults from settings.rag, optionally rerank, optionally multi-query.
   - Call buildContext(); pass output into buildSystemPrompt().
   - Persist a rag_retrievals row with message_id set to the assistant message id (once it exists) — alternatively, generate the assistant message id ahead of streaming and persist now.
   - Forward sourceMap to the renderer via a new IPC event 'chat:retrieval' with { messageId, sourceMap, retrievalId }.

4. Tests in electron/services/rag/context-builder.test.ts:
   - 5 chunks, generous cap -> block contains all 5 with ids 1-5.
   - 20 chunks, tight cap -> block contains only highest-ranked subset; sourceMap matches.
   - Empty chunks -> returns empty string block, empty sourceMap.
   - locator formatting respects each source type.

5. Tests in electron/services/rag/chat-augmentation.test.ts (or modify existing chat tests):
   - Send a chat request with one attached collection -> system prompt includes <retrieved_context> with sources.
   - No attached collections -> system prompt unchanged.

VERIFICATION:
   - tsc both configs clean.
   - vitest passes.
   - In DevTools, send a chat message after attaching a collection. Inspect main-process logs (in dev) to confirm the prompt includes <retrieved_context>. Confirm 'chat:retrieval' event fires with a sourceMap.
   - DEVLOG entry.
```

---

### PROMPT R11 — Chat Attachment UI

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: R10 — context assembly working end-to-end on the backend.

TASK: Surface RAG attachments in the chat input. Users attach a collection or a single file; they see attached chips; they can detach.

STEPS:

1. Schema:
   - Add table conversation_rag_attachments:
       conversation_id TEXT NOT NULL,
       collection_id TEXT,        -- exactly one of these is set
       document_id TEXT,
       attached_at INTEGER NOT NULL,
       PRIMARY KEY (conversation_id, COALESCE(collection_id, ''), COALESCE(document_id, ''))
   - FKs ON DELETE CASCADE.

2. Store/IPC:
   - electron/services/rag/store.ts: addAttachment(conversationId, { collectionId? | documentId? }), removeAttachment(...), listAttachments(conversationId).
   - IPC: 'rag:attachments:list' / 'rag:attachments:add' / 'rag:attachments:remove'.
   - Expose window.api.rag.attachments.{list,add,remove} in preload + ipc-client.

3. Renderer:
   - src/components/chat/ContextAttachBar.tsx — sits above ChatInput when there are attachments. Renders chips per attachment: collection name OR document name. Chip × button removes.
   - Modify src/components/chat/ChatInput.tsx:
     - Add an "@" mention popover. Typing "@library" shows collections; typing "@file" shows documents from attached collections; selecting either calls addAttachment.
     - Add a paperclip icon button that opens the same popover.
     - Drag-drop a file onto the input: ingest to a "Inbox" collection (auto-created if missing), then auto-attach the resulting document. Show a transient toast.
   - Persist attached state per-conversation in rag-store, hydrated from listAttachments() when a conversation loads.

4. Events:
   - No new events. (Attachment state is reconstructable from the table.)

5. Tests:
   - electron/services/rag/store.test.ts: attachment CRUD + cascade tests.
   - Renderer tests (if RTL available): typing "@library" opens the popover; selecting a collection adds a chip; clicking × removes it.

VERIFICATION:
   - tsc both configs clean.
   - vitest passes.
   - Manual: open a conversation, type @library, pick a collection, send "Summarize my notes about X." The assistant response shows citations and the system prompt includes context (verify via main-process log in dev). Detach the collection, send again — citations gone.
   - DEVLOG entry.
```

---

### PROMPT R12 — Citation Rendering & Source Preview Pane

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: R11 — attachments work; assistant messages return with sourceMap.

TASK: Parse [N] markers in assistant messages, render them as clickable citation chips, and open a source preview pane on click.

STEPS:

1. Renderer types:
   - Extend Message in src/lib/types.ts with optional retrieval: { retrievalId: string; sourceMap: SourceMapEntry[] }.
   - SourceMapEntry: { id: number; chunkId: string; documentId: string; displayName: string; locator: string }.

2. Persistence:
   - Add columns to messages table: retrieval_id TEXT NULLABLE.
   - On chat:retrieval event, set the message's retrieval reference.
   - Loading a conversation hydrates message.retrieval by joining rag_retrievals.

3. Renderer parsing:
   - In the message renderer (find MessageBubble or current renderer in src/components/chat/), post-process markdown output to replace [N] and [N, M, K] patterns with <CitationChip id={N} />.
   - Implement as a remark/rehype plugin if react-markdown is in use; otherwise as a DOM-walk after render.
   - Skip replacement inside code blocks (rehype: skip nodes with `inline: false` parent).

4. CitationChip:
   - src/components/chat/CitationChip.tsx — small superscript-style chip showing the number. Tooltip on hover shows displayName + locator. Click opens SourcePreviewPane keyed on chunkId.

5. SourcePreviewPane:
   - src/components/chat/SourcePreviewPane.tsx — slides in from the right (reuse the artifact panel slot if appropriate, or a separate sibling pane).
   - Loads the chunk via a new IPC call rag:chunk:get(chunkId) returning { text, document, headingPath, page, lineStart, lineEnd, neighbors? }.
   - Highlights the chunk text with the same theme accent used for code blocks; shows ±1 neighbor chunks in dimmed text above and below.
   - Footer: "Open source file" button -> if it's a file with a known path, calls window.api... (existing file open IPC, or shell.openPath in main).

6. Tests:
   - Unit tests on the parser: input "Foo bar [1] baz [2, 3] qux." produces three chips at correct positions.
   - Code-block exclusion: input "```js\nconst [1]\n```" produces zero chips.

VERIFICATION:
   - tsc both configs clean.
   - vitest passes.
   - Manual: send a query against an attached collection. Assistant response includes [1] [2] etc. Hover -> tooltip. Click -> preview pane opens with chunk text and surrounding context.
   - DEVLOG entry.
```

---

### PROMPT R13 — RAG Settings + Agent Role Integration

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: R12 — citations render and previews open.

TASK: Build the RAG settings panel and wire RAG into the multi-agent pipeline (Planner / Coder / Reviewer).

STEPS:

1. Settings:
   - Extend AppSettings.rag (already partially extended in earlier prompts; finalize all fields per §2.9).
   - src/components/settings/RagSettings.tsx — sections:
     - "Embeddings model" — dropdown of EMBEDDING_CATALOG with the active selected; "Download" / "Switch" button.
     - "Retrieval" — chunkSize, chunkOverlap, lexK, vecK, fusedTopN (sliders + numeric inputs with sensible ranges and defaults).
     - "Rerank" — radio: off / local cross-encoder / LLM. Description for each.
     - "Multi-query rewrite" — toggle.
     - "Auto-RAG in conversations" — toggle. Help text: "When on, every chat turn in a conversation with attached collections runs retrieval automatically. When off, retrieval runs only on the first attachment and the user can force-refresh per-turn." (Note: the simplest v1 is to leave Auto-RAG always on for attached conversations; this setting is a toggle for future expansion. If unused, hide it behind a `experimental` flag.)
     - "Citation required" — toggle. When on, the system prompt instructs the model to refuse if no source supports a claim.
   - Apply on change (no Save button); each field updates settings store and persists.

2. Agent pipeline integration:
   - Modify electron/services/agent-pipeline.ts:
     - On run start with attached collections, call retrieve() for the planner with the original user query, broad params (lexK=20, vecK=20, topN=10), and pass into buildSystemPrompt for the planner role.
     - After the planner emits its plan, call retrieve() again with the plan text as the query, narrower params (lexK=10, vecK=10, topN=5), pass into the coder role.
     - For the reviewer role: do NOT call retrieve(). Instead, look up the rag_retrievals row from the coder's pass and include those exact sources in the reviewer's context (so the reviewer evaluates the same evidence the coder used).
     - Each call records its own rag_retrievals row with query_kind = 'planner-rewrite' | 'coder-followup' | 'reviewer-fixed'.
     - All three share the chat correlation_id.

3. Tests:
   - electron/services/agent-pipeline.test.ts: extend with a test where one collection is attached and a stub retrieve() is mocked. Assert all three roles see the appropriate context blocks.

VERIFICATION:
   - tsc both configs clean.
   - vitest passes.
   - Manual: in a conversation with an attached collection, switch agent mode to Planner→Coder→Reviewer. Run a query. Check the run banner / inspect logs — three retrieval rows in rag_retrievals tied to the same correlation_id.
   - DEVLOG entry.
```

---

### PROMPT R14 — End-to-End Verification, Docs, Polish

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: R13 — full RAG stack functional including agent pipeline.

TASK: Run end-to-end scenarios. Fix anything that breaks. Write user-facing docs. Update DEVLOG and README.

STEPS:

1. End-to-end test (electron/services/rag/end-to-end.test.ts):
   - Spin up a test SQLite (in-memory or temp file).
   - Create a collection.
   - Ingest one .md, one .pdf, one .ts file (from fixtures).
   - Run a query whose answer is in the .md and another in the .ts.
   - Assert RetrievedChunk results contain the expected source files and the expected text passages.
   - Run buildContext(); assert the block has correct ids.
   - Simulate a chat call: assert system prompt contains <retrieved_context> with the right sources.

2. Manual scenarios:
   - Scenario A: User drops 5 PDFs into a new collection. All ingest successfully. Asking a question returns citations to the correct PDFs with page numbers.
   - Scenario B: User attaches a workspace folder of TypeScript files. Asks "where do we handle tool approval?" The retrieval surfaces files in electron/services/permissions-store.ts and electron/ipc/permissions.ts; the answer cites both.
   - Scenario C: User asks a question with NO relevant content in the collection. With "Citation required" on, the assistant says "No source supports an answer to this." With it off, the assistant answers freely and notes no sources matched.
   - Scenario D: User cancels an in-progress ingest. The doc ends in status='error' with detail 'cancelled'. No orphan vec rows.
   - Scenario E: User deletes a collection. All chunks, vec rows, attachments, and retrieval records referencing it are gone (or referentially clean).
   - Scenario F: Restart the app. All collections, documents, and attached state restore. Run a fresh query — retrieval still works.
   - Scenario G: Open Activity Timeline (if shipped). The chat turn from Scenario B shows rag.query.completed events tied to the chat's correlation_id.

3. Docs:
   - Update README.md with a "Local RAG" section: what it does, how to add a collection, how citations work, where data is stored, privacy claim ("documents never leave the machine").
   - Add docs/local-rag.md (or wherever in-app docs live) with screenshots placeholders and step-by-step usage.
   - Update SKILLS.md only if RAG exposes a skill-callable tool; otherwise no change.
   - DEVLOG: comprehensive entry summarizing R1-R14 work, model sizes, observed retrieval quality on a small benchmark you ran by hand.

4. Polish pass (only what falls naturally out of manual testing):
   - Empty states verified.
   - Error states verified.
   - Drag-drop visual feedback works.
   - Citation chips don't break inside lists, blockquotes, tables.
   - Source preview pane handles long chunks without overflow.

VERIFICATION:
   - All scenarios A-G pass.
   - tsc both configs clean.
   - Full vitest suite passes (not just rag tests).
   - DEVLOG entry. No GitHub push — hand off to user for review.
```

---

## 6. Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| sqlite-vec native binary fails to load on a target arch | Med | Wrap in try/catch (R1); app boots with RAG disabled and a clear banner; investigate, fall back to in-memory cosine over rag_chunks if needed. |
| transformers.js download fails (corporate network, firewall) | Med | Surface a clear "Download failed" status; document a manual-cache path (drop model files into `userData/models/transformers/`); allow custom HF mirror in settings. |
| Embeddings worker leaks memory over long runs | Low–Med | Restart worker after every N=10,000 embeddings; expose a "Restart embedder" debug action in settings. |
| PDF loader fails silently on scanned PDFs | Med | Loader throws an explicit "PDF appears scanned" error (R4); UI surfaces it as a status badge; v2 can add OCR. |
| RAG context blows the model's context window | Med | buildContext enforces a token cap (R10); cap is configurable; chunks are dropped lowest-rank-first. |
| Hybrid retrieval underperforms vs pure dense for niche use cases | Low | RRF is robust; users can set lexK=0 or vecK=0 to disable a leg via advanced settings; document in DEVLOG. |
| Citations break on weird markdown (nested lists, code blocks) | Med | Parser explicitly excludes code blocks; tests cover common edge cases; gracefully fall back to leaving `[N]` text if parsing fails for any node. |
| Reranker LLM call adds noticeable latency | Med | Rerank is off by default; settings panel warns about latency cost; we measure and document the cost in DEVLOG. |
| Agent pipeline retrieval triples API+embed cost | Med | Reviewer reuses Coder's retrieval (R13); Planner/Coder use different scopes; document expected cost increase in DEVLOG and in the Settings UI when enabling multi-agent + RAG together. |

---

## 7. Open Questions (resolve before R1)

1. **Default collection scope** — should every conversation auto-attach a "workspace" collection if a workspace is active? Default proposal: **no**, attaching is always explicit. User can flip a setting to enable auto-attach for workspaces.
2. **Skills as RAG sources?** Skill markdown files are already loaded into the system prompt by the skill loader. Should they also be indexed for retrieval? Default proposal: **no for v1**, because the skill loader's whole-file injection makes RAG redundant. Revisit if skills grow.
3. **Memory entries as RAG sources?** Memory entries are already injected into every system prompt. Same rationale — skip for v1.
4. **Workspace files as RAG sources?** Add a "Index workspace" action in R6 that walks the active workspace and ingests allowed files into an auto-created "Workspace" collection. Resolve: **yes**, ship in R6 as a bonus action if time allows; otherwise defer to a v2 prompt.

---

## 8. Appendix A — Settings Defaults Reference

```typescript
const defaultRagSettings: AppSettings['rag'] = {
  enabled: true,
  defaultEmbedderId: 'bge-small-en-v1.5',
  autoRagInConversations: true,
  chunkSize: 800,
  chunkOverlap: 100,
  lexK: 30,
  vecK: 30,
  fusedTopN: 8,
  rerankMode: 'off',
  multiQueryRewrite: false,
  citationRequired: false,
};
```

---

## 9. Appendix B — Prompt Block Style Notes for Claude Code

- Each prompt is one self-contained instruction. Hand it to Claude Code verbatim.
- Verification gates are mandatory — do not advance to the next prompt with a red verification.
- File creations are explicit; do not invent neighbor files.
- Tests use Vitest (project convention).
- Commit cadence: one commit per prompt minimum, more if a prompt produces logically separate changes. Conventional commit prefixes: `feat(rag): ...`, `chore(rag): ...`, `test(rag): ...`, `docs(rag): ...`.
- No `Co-Authored-By` trailer (per project memory).
- DEVLOG entry per prompt with: timestamp, prompt id (R1..R14), what shipped, what verification proved, what's deferred.
