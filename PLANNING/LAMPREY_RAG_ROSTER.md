# Lamprey Local RAG — Prompt Roster

**Companion to:** [`LAMPREY_RAG_PLAN.md`](LAMPREY_RAG_PLAN.md)
**Status legend:** `[ ]` pending · `[~]` in progress · `[x]` shipped & verified
**Rule:** Sequential. Do not start the next prompt until the current one's verification gate passes.

---

## Prerequisites (already shipped)

- [x] Data Spine Prompts 1-6 (event log, tool/chat/workspace events, persistence boundary cleanup)
- [x] Multi-provider registry (`electron/services/providers/registry.ts`)
- [x] Native module rebuild flow against pinned Electron 35

## Supersedes

- Data Spine **Prompt 7** (FTS5-only Local Retrieval Foundation) — replaced by R1 + R5 + R7
- Data Spine **Prompt 8** (Retrieval Events + Provenance UI) — replaced by R7 events + R12 source preview pane

---

## Phase A — Foundation

| #   | Prompt                            | One-liner                                                          | Files (net new)                                                          | Verify                                                                | Status |
|-----|-----------------------------------|--------------------------------------------------------------------|--------------------------------------------------------------------------|-----------------------------------------------------------------------|--------|
| R1  | Schema, sqlite-vec, Collections   | Land RAG tables (`rag_collections/documents/chunks/_fts/_vec/retrievals`), load sqlite-vec, ship collection CRUD over IPC. | `rag/store.ts`, `rag/vec-loader.ts`, `ipc/rag.ts`, migrations             | tsc clean · store tests green · create+list collection round-trip in DevTools · sqlite-vec loaded log | [ ]    |
| R2  | Local Embeddings Service          | `@xenova/transformers` in a worker_thread; default `bge-small-en-v1.5`; catalog + setActive IPC. | `rag/embeddings/{catalog,worker,service}.ts`                             | embed() returns 384-dim normalized vectors · model cached to userData | [ ]    |
| R3  | Chunker                           | Recursive char splitter with markdown-heading and code-line awareness; hard ceilings. | `rag/chunker.ts` + tests                                                  | Plain/MD/code/PDF-page chunking tests pass                            | [ ]    |

## Phase B — Ingestion

| #   | Prompt                            | One-liner                                                          | Files (net new)                                                          | Verify                                                                | Status |
|-----|-----------------------------------|--------------------------------------------------------------------|--------------------------------------------------------------------------|-----------------------------------------------------------------------|--------|
| R4  | Document Loaders                  | PDF (`pdf-parse`), DOCX (`mammoth`), text/markdown/code with size + binary guards. | `rag/loaders/{text,pdf,docx,index}.ts` + fixtures + tests                 | Loaders tests pass; sample.pdf yields 3 pages; binary.bin rejects     | [ ]    |
| R5  | Ingestion Orchestrator + IPC      | Serial ingest pipeline (load→chunk→embed→store) with progress events, dedupe-by-hash, cancellation. | `rag/ingest.ts`, IPC handlers                                             | Ingest a `.md`; doc status → ready; re-ingest dedupes; cancel works   | [ ]    |
| R6  | Library UI                        | Collections + Documents view, drag-drop ingest, real progress cards. | `components/library/*`, `stores/rag-store.ts`                             | Manual: create collection, drop 3 files, watch real status; empty + error states render | [ ]    |

## Phase C — Retrieval

| #   | Prompt                            | One-liner                                                          | Files (net new)                                                          | Verify                                                                | Status |
|-----|-----------------------------------|--------------------------------------------------------------------|--------------------------------------------------------------------------|-----------------------------------------------------------------------|--------|
| R7  | Hybrid Retrieval                  | BM25 (FTS5) + cosine (sqlite-vec) fused via Reciprocal Rank Fusion; scoped per collection. | `rag/retrieve.ts` + tests                                                 | Verbatim + paraphrase queries both surface seeded chunks; scope honored | [ ]    |
| R8  | Optional Rerank                   | `Xenova/ms-marco-MiniLM-L-6-v2` cross-encoder OR LLM-as-reranker; off by default. | `rag/rerank.ts` + tests                                                   | `mode='off'` no-op; LLM mode reorders per stubbed adapter             | [ ]    |
| R9  | Multi-Query Rewrite               | Planner-driven query rewriting into 2-3 variants; results unioned via RRF. | `rag/multi-query.ts` + tests                                              | Stubbed planner returns variants; final RRF favors chunks present in multiple variants | [ ]    |

## Phase D — Chat Integration

| #   | Prompt                            | One-liner                                                          | Files (net new)                                                          | Verify                                                                | Status |
|-----|-----------------------------------|--------------------------------------------------------------------|--------------------------------------------------------------------------|-----------------------------------------------------------------------|--------|
| R10 | Context Assembly + Citation Protocol | Build `<retrieved_context>` block with numeric source ids; inject into system prompt between memory and skills. | `rag/context-builder.ts`, modified `system-prompt-builder.ts` + `ipc/chat.ts` | Context-builder tests pass; chat with attached collection includes block; `chat:retrieval` event carries sourceMap | [ ]    |
| R11 | Chat Attachment UI                | `@library` / `@file` mention popover; drag-drop ingest; `ContextAttachBar` chips; per-conversation persistence. | `conversation_rag_attachments` table, `components/chat/ContextAttachBar.tsx`, modified `ChatInput.tsx` | Manual: attach collection, see chip, send query, see citations; detach restores no-RAG | [ ]    |
| R12 | Citation Rendering + Source Preview | Parse `[N]` markers into `<CitationChip>`; clicking opens `SourcePreviewPane` with the chunk and neighbors highlighted. | `components/chat/{CitationChip,SourcePreviewPane}.tsx`, `messages.retrieval_id` | Parser tests; manual click-through to preview; code-block exclusion holds | [ ]    |

## Phase E — Polish & Roll-up

| #   | Prompt                            | One-liner                                                          | Files (net new)                                                          | Verify                                                                | Status |
|-----|-----------------------------------|--------------------------------------------------------------------|--------------------------------------------------------------------------|-----------------------------------------------------------------------|--------|
| R13 | RAG Settings + Agent Integration  | `RagSettings.tsx` surfaces every knob; Planner/Coder/Reviewer get role-appropriate retrieval scopes; Reviewer reuses Coder's sources. | `components/settings/RagSettings.tsx`, modified `agent-pipeline.ts`        | Settings persist; 3-role run produces 3 `rag_retrievals` rows under one correlation_id | [ ]    |
| R14 | End-to-End Verification + Docs    | Scenario suite (A-G), README update, `docs/local-rag.md`, comprehensive DEVLOG. | `rag/end-to-end.test.ts`, README + docs                                   | All 7 scenarios pass · full vitest suite green · DEVLOG closed       | [ ]    |

---

## Dependency Graph

```
R1 ──┬─► R2 ──┐
     │         ├─► R5 ──► R6 ──► R7 ──┬─► R8 ──┐
     ├─► R3 ──┤                        ├─► R9 ──┴─► R10 ──► R11 ──► R12 ──► R13 ──► R14
     └─► R4 ──┘                        │
                                       └────────────────────────────────►
```

- R2, R3, R4 can in principle run in parallel after R1, but the plan stays strictly sequential to keep the verification gates simple.
- R8 and R9 can be deferred (skipped initially) — RAG ships usefully at R12 without them. If you do skip, mark them deferred in DEVLOG and revisit before R13's agent integration ships.

---

## Quick-Reference Tables

### New IPC channels added per prompt

| Prompt | Channels |
|--------|----------|
| R1     | `rag:collection:list/create/update/delete` |
| R2     | `rag:embedder:catalog/active/setActive` (`embed` is internal-only) |
| R5     | `rag:document:list/ingest/reingest/delete/cancel`, event `rag:document:progress` |
| R7     | `rag:query:run/forMessage` |
| R10    | event `chat:retrieval` |
| R11    | `rag:attachments:list/add/remove` |
| R12    | `rag:chunk:get` |

### Event types added to the spine

| Phase | Events |
|-------|--------|
| A     | `rag.collection.{created,updated,deleted}`, `rag.model.download.{started,completed,failed}` |
| B     | `rag.ingest.{started,completed,failed}`, `rag.reindex.{started,completed}` |
| C     | `rag.query.{completed,failed}`, `rag.rerank.completed` |

### Dependencies introduced

| Package                  | Purpose                                | Added in |
|--------------------------|----------------------------------------|----------|
| `sqlite-vec`             | Vector index (vec0 virtual table)      | R1       |
| `@xenova/transformers`   | Local embeddings + cross-encoder       | R2       |
| `pdf-parse`              | PDF text extraction                    | R4       |
| `mammoth`                | DOCX text extraction                   | R4       |

---

## Out-of-Scope (v1) — Park List

- Image / multimodal embeddings
- Cross-machine / shared collections
- Agentic web-crawl ingestion via web-tools
- Custom user-uploaded ONNX embedders without a settings entry
- Tree-sitter-aware code chunking (only triggered if dumb splitter proves insufficient on real usage)
- OCR for scanned PDFs
- Re-embedding migration when the user switches embedders (v1 forces re-ingest of affected collections; surface this clearly in the embedder switcher)
