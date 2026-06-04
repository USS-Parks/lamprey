# Lamprey Hybrid Context Plan

> **Goal**: Build the highest-quality context strategy possible by routing
> by **file type**, not by file size. Documents (.pdf, .docx, .md, …) go
> through RAG so the model gets semantically chunked + cited passages.
> Source code in the active workspace is discovered **agentically** via
> native `read_file`, `grep_workspace`, and `glob_workspace` tools —
> matching how Claude Code works. DeepSeek V4 and Gemma tokenize at a
> fraction of Claude's price, so we can afford to send whole files when
> the model decides to read them; the win is in **picking the right
> files** rather than blanket inlining.
>
> Comparison baseline: Claude Code skips RAG entirely. It uses Grep + Glob
> + LSP for code and relies on subagent isolation to keep context bounded.
> Our hybrid keeps Claude Code's agentic posture for code AND gains
> semantic retrieval for documents, where embeddings genuinely help.

## Status quo (as of v0.1.43)

What we have:
- **RAG pipeline** (R1–R14): chunker, embeddings worker, FTS5 + sqlite-vec
  store, hybrid retrieval, optional rerank, multi-query rewrite,
  `<retrieved_context>` block + citation protocol, per-conversation
  attachments, `augmentForChat` integration helper.
- **Auto-RAG routing** (v0.1.43): files >5 MB → per-conversation
  auto-collection; ≤5 MB → inline. Routes by **size only**.
- **Workspace tools**: `shell_command` (PowerShell/bash),
  `workspace_context` (Codex-style preflight summary), `apply_patch`,
  `verify_workspace` (npm scripts), `view_image`, `update_plan`, goal
  tools, browser, web, image-gen.
- **Active workspace state**: `electron/services/workspace-state.ts` —
  resolves the workspace root, persisted per-session.

What's **missing** for the hybrid:
- Native `read_file` (token-aware pagination, no shell roundtrip)
- Native `grep_workspace` (ripgrep-backed, structured output)
- Native `glob_workspace` (fast file discovery by pattern)
- File-type routing (current router is size-only — a 6 MB `.tsx` file
  wrongly goes to RAG today)
- A "research subagent" pattern that isolates exploration in a fresh
  context window
- System-prompt teaching for the new toolset
- UX differentiation: doc-attached corpora vs. workspace code vs. inline
  files all look the same on the chip

---

## Design principles

1. **File type drives routing, not size.** A 50 MB book PDF and a 50 KB
   research note both go through RAG. A 2 KB `.json` and a 12 MB
   `.csv` both go inline (until the model decides not to read them).
2. **The workspace is not attached, it's explored.** Workspace files do
   not appear as chips. The model discovers them via `glob_workspace` →
   `grep_workspace` → `read_file`, the same pattern Claude Code uses.
3. **Native tools beat shell roundtrips.** A native `grep_workspace`
   skips the shell-approval modal and returns structured JSON the model
   can parse without regex on stdout. Bundles ripgrep with the app so
   "no rg on PATH" never blocks.
4. **Documents go through RAG because embeddings genuinely help there.**
   Stable text, semantic structure, repeat queries, citation matters.
5. **Code agentic because embeddings hurt there.** Code changes frequently
   (cache invalidation hell), symbol lookups want literal matches, cross-
   file edges (imports, calls) are graph-like and don't survive chunking.
6. **Cheap tokens are a feature, not a license to spray.** DeepSeek and
   Gemma's pricing means we can comfortably read a 100 KB source file
   without thinking. It does NOT mean we should dump the whole `node_modules`
   tree into every turn. Quality of *selection* still drives quality of *answer*.
7. **Honest UX.** The user should be able to see which path was taken per
   turn: a citation chip if it was RAG, a tool-call card chain if it was
   agentic, an "inlined" badge if the file went in verbatim.

---

## File-type routing matrix (the actual contract)

| Extension | Path | Reason |
|---|---|---|
| `.pdf`, `.docx` | **Always RAG** | Layout-heavy, embedded text + tables, long-form. Semantic chunking + page citation pay off. |
| `.md`, `.mdx`, `.rst`, `.txt`, `.adoc` | **RAG if >50 KB, else inline** | Short notes inline cheaply; long docs benefit from chunking + heading-aware indexing. |
| `.csv`, `.tsv`, `.json`, `.jsonl`, `.yaml`, `.toml`, `.xml` | **Inline if ≤10 MB, else inline-with-warning to 50 MB, else reject** | Structured data — model wants the whole thing, not a chunk. RAG-chunking a CSV hands the model 800-char shards of unrelated rows. |
| `.py`, `.ts`, `.tsx`, `.js`, `.jsx`, `.go`, `.rs`, `.java`, `.kt`, `.swift`, `.cs`, `.rb`, `.php`, `.c`, `.cpp`, `.h`, `.hpp`, `.sh`, `.bash`, `.zsh`, `.ps1`, `.lua`, `.r`, `.sql`, `.html`, `.css`, `.scss`, `.svelte`, `.vue` | **Inline if ≤2 MB, else "use the agentic tools" hint** | Code attached via chip = "the user explicitly wants you to look at THIS file." Inline. Anything bigger is a misclick — the user almost certainly meant "use the workspace tools to explore." |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` | **Always inline (base64, ≤100 MB cap)** | Vision needs the bytes; RAG can't index pixels. |
| Other binary | **Reject with explanation** | No useful path. |

**Routing changes vs. v0.1.43**:
- Size is no longer the primary axis.
- `.pdf` and `.docx` go to RAG regardless of size (used to inline if ≤5 MB).
- Source code files >5 MB no longer go to RAG (used to). They now nudge the
  user toward the agentic tools or reject if implausibly huge.
- `.csv` / `.json` / `.yaml` get their own "structured data" lane.

---

## Prompt sequence (H1 → H10)

Strict sequential order. Each prompt is a self-contained landable unit;
DEVLOG entry per prompt; verification step before moving on.

### H1 — Native `read_file` tool

**Goal.** A token-aware file reader the model calls without going through
the shell-approval modal.

**Deliverables.**
- `electron/services/read-file-tool-pack.ts` — registers `read_file`.
- Inputs: `path: string`, `offset?: number` (1-based line), `limit?: number`
  (default 2000 lines), `pages?: string` (for `.pdf` only, e.g. `"1-5"`).
- Output: file content with line-number prefixes (cat -n format), plus a
  `PARTIAL view` marker if the file is truncated.
- Workspace-bounded: path must resolve inside the active workspace root
  (or be an absolute path that does). Reject `..` traversal.
- `risks: ['read']`, `requiresApproval: false`, `parallelizable: true`.
- Soft cap: 256 KB of returned content per call (model can paginate via
  `offset`/`limit`). Hard cap: 2 MB before the call refuses.
- PDF handling: use the existing `pdf-parse` path, but only return the
  requested page range — no full-document tokenization.

**Verification.** Unit tests: reads a fixture file with `offset`/`limit`,
caps oversize, refuses traversal, paginates a PDF. Hand-test: model can
read `electron/main.ts` chunk-by-chunk in dev.

---

### H2 — Native `grep_workspace` tool (bundled ripgrep)

**Goal.** Structured grep that returns JSON instead of stdout text. No
shell approval, no PATH dependence.

**Deliverables.**
- Bundle ripgrep binary as an `extraResource` (`resources/vendor/rg/`,
  platform-specific subdirs). Update `electron-builder.yml`.
- `electron/services/grep-workspace-tool-pack.ts` — registers
  `grep_workspace`.
- Inputs: `pattern: string`, `glob?: string`, `type?: string` (e.g. "ts",
  "py"), `output_mode?: "files_with_matches" | "content" | "count"`,
  `head_limit?: number` (default 250), `-i?`, `-n?`, `-A?`, `-B?`, `-C?`,
  `multiline?` — mirrors the Claude Code tool exactly so the model's
  pretraining intuitions transfer.
- Output: structured (path + line + match snippet for `content` mode;
  array of paths for `files_with_matches`).
- Workspace-scoped. Respects `.gitignore` by default; flag to opt out.
- `risks: ['read']`, `requiresApproval: false`, `parallelizable: true`.
- Output capped at 250 KB; truncates with a `…and N more matches` line.

**Verification.** Unit: parses ripgrep JSON output, handles zero matches,
honors `head_limit`. Hand: model finds every call site of a function in
the Lamprey codebase in one tool call.

---

### H3 — Native `glob_workspace` tool

**Goal.** Fast file discovery without spinning up a shell.

**Deliverables.**
- `electron/services/glob-workspace-tool-pack.ts` — registers
  `glob_workspace`.
- Input: `pattern: string` (e.g. `"src/**/*.tsx"`), `cwd?: string`,
  `case_sensitive?: boolean`.
- Output: array of paths, sorted by modification time descending (most
  recently changed first — the right default for "what did the user
  recently work on?").
- Workspace-scoped. Skips `node_modules`, `.git`, `dist`, `out`,
  `coverage` by default (reuses `SKIP_DIRS` from `files.ts`).
- Cap: 1000 paths returned. `risks: ['read']`,
  `requiresApproval: false`, `parallelizable: true`.

**Verification.** Unit: matches `**`, sorts by mtime, excludes
defaults. Hand: model lists every `*.test.ts` in the repo.

---

### H4 — File-type routing in `file-handler.ts`

**Goal.** Replace size-only routing with the matrix above. This is the
breaking change vs. v0.1.43.

**Deliverables.**
- Refactor `processOne` in `electron/services/file-handler.ts`:
  - Extract a `decideRoute(name, size): RouteDecision` helper. Return
    one of: `'inline'`, `'rag'`, `'inline-warn'` (user gets toast: "big
    inline, ~X tokens"), `'rag-warn'` (user gets toast: "very large doc,
    indexing may take a minute"), `'reject'` (explanation).
  - The `'rag'` decision still returns `kind: 'rag-pending'` so the
    existing auto-attach flow keeps working unchanged.
- New attachment kind: none needed — `'rag-pending'`, `'text'`, `'pdf'`,
  `'image'`, `'binary'` all still apply.
- Update `INLINE_THRESHOLD_BYTES` → per-type thresholds (constants table).
- Update the renderer's "warn" path to surface the toast.

**Migration note.** Existing user files in inline mode will keep working.
Existing per-conversation RAG collections for already-ingested 6 MB
`.tsx` files become benign-but-pointless data; they're not deleted,
just not used (the next attach of a `.tsx` won't go RAG).

**Verification.** Unit: every entry in the routing matrix has a test case
asserting the right decision. Hand: drop a 12 MB `.tsx` and confirm it
inlines (not RAGs); drop a 50 KB `.pdf` and confirm it RAGs (not inlines).

---

### H5 — Per-type inline thresholds in Settings

**Goal.** Expose the routing thresholds in `Settings → RAG & Context` so
power users can tune them per provider.

**Deliverables.**
- `AppSettings.contextRouting`: optional override map of
  `{[extension]: {inline_max_kb?: number, force?: 'inline' | 'rag'}}`.
- New `src/components/settings/ContextRoutingSettings.tsx`: table of
  extensions with current threshold + override controls. Profile presets:
  "DeepSeek (cheap tokens, generous inline)", "Claude (conservative
  inline)", "Local model (very conservative)".
- `file-handler` reads the overrides at decision time. Missing entries
  fall through to defaults.

**Verification.** Unit: override hits before default. Hand: bump `.csv`
inline cap to 50 MB via Settings, drop a 30 MB `.csv`, confirm inline.

---

### H6 — Document RAG quality upgrades

**Goal.** Now that RAG only sees documents, invest in extraction +
chunking quality where it pays off.

**Deliverables.**
- **PDF**: swap `pdf-parse` for `unpdf` or evaluate `mupdf-js`. Today's
  parser produces character-spaced output for PDFs with positioned
  glyphs (`V C O D E A N A L Y S I S R E P O R T`). Mitigation if no
  library swap is feasible: post-process to collapse single-letter words
  separated by single spaces when ≥4 in a row.
- **DOCX**: confirm `mammoth` output is heading-aware; if not, post-process
  to mark heading levels with `# `, `## `, etc., so the existing
  markdown chunker picks them up.
- **Markdown heading-aware chunking**: extend
  `electron/services/rag/chunker.ts` to honor headings — never split
  mid-heading-block; carry heading path into chunk metadata
  (`H1 > H2 > H3`) so citations show heading context.
- **Cross-document dedup in retrieve**: when two chunks across two
  documents both score high on a query, prefer the higher-DR (document
  rating: chunk_count + recency + length) one; suppress near-duplicates
  beyond a Jaccard threshold of 0.7.

**Verification.** Unit: chunker tests assert headings stay intact;
dedup test asserts near-dups get filtered. Hand: ingest a real
research paper PDF; confirm citations show heading context like
"§3.2 Methodology, p. 7".

---

### H7 — System-prompt teaching for the new toolset

**Goal.** Tell the model how to use the new tools. Without this, the
model will keep shelling out to `grep` and reading whole files even when
the better tools exist.

**Deliverables.**
- Update `electron/services/system-prompt-builder.ts`:
  - Default system prompt: add a "Workspace exploration" section.
    "When the user has a workspace set, prefer `grep_workspace` over
    `shell_command grep`, prefer `read_file` over `shell_command cat`,
    prefer `glob_workspace` over `shell_command find`. These are
    faster, structured, and don't require approval."
  - "Attached vs. discovered" guidance: "Files attached via the UI
    (visible as chips) are the user's deliberate focus — read them
    fully. Files in the workspace are discovered via tools — use grep
    first to find candidates, then read selectively."
  - Cite-or-explore decision: "If the user asks about an attached
    document, the answer comes from `<retrieved_context>`. If the user
    asks about code, the answer comes from agentic exploration."
- Update `AGENT_ROLE_PROMPTS`: Planner uses workspace tools to scope;
  Coder uses them to read before patching; Reviewer uses them to verify.

**Verification.** Hand: ask the model "what does ChatInput.tsx import?"
in dev mode and confirm it calls `read_file` (not `shell_command cat`).

---

### H8 — Research subagent (`explore` tool)

**Goal.** Match Claude Code's subagent-isolation pattern. Fresh context
window, gets the workspace tools, returns one summary string.

**Deliverables.**
- New native tool `explore`. Input: `question: string`,
  `scope?: 'docs' | 'code' | 'both'`, `max_steps?: number` (default 10).
- Implementation: opens a sub-conversation via the same chat handler
  (not a separate model call — reuses streaming + cancellation + audit).
  The sub-agent has access to `read_file`, `grep_workspace`,
  `glob_workspace`, and (when `scope` includes docs) `rag:query:run` as
  the only tools.
- The sub-agent has its own system prompt: "Answer the user's question
  by exploring. Return a concise final answer with file paths and line
  numbers as citations. No code edits, no shell."
- Output: single string. Parent never sees the sub-agent's tool calls or
  intermediate context — those are visible in the Activity Timeline only.
- New event types: `subagent.started`, `subagent.completed`,
  `subagent.failed`. Correlated by parent + child conversation IDs.
- `risks: ['read']`, `requiresApproval: false`. The subagent's own tool
  calls inherit the parent's approval policy.

**Verification.** Unit: the subagent's tool set is locked to read-only.
Hand: ask the planner "where is the agent run pipeline defined?" and
see it call `explore`, see exploration steps in Activity Timeline, see
the parent get a clean one-paragraph answer with citations.

---

### H9 — UX differentiation

**Goal.** The user should see, at a glance, which context strategy
fired per turn.

**Deliverables.**
- **Attachment chips** keep the v0.1.42–43 design but gain a small
  bottom-right badge: `INLINE`, `RAG`, or `INDEX` (mid-ingest).
- **Citation chips** in assistant messages: source-aware icons. RAG
  citations stay as they are. Code citations from agentic exploration
  get a different icon (`</>`) and link to the file's location in the
  workspace.
- **Workspace explorer side panel**: a small "Recently read" rail
  showing the last 10 files the model has read via `read_file`. Click
  opens the file in VSCode. Helps the user audit what the agent
  actually looked at.
- **Per-turn context footer**: under each assistant message, a tiny
  collapsed-by-default summary: "Used: 2 RAG chunks from `paper.pdf`,
  3 file reads, 1 grep, 0 subagent runs · 4.2K tokens of context."

**Verification.** Hand: send a turn that uses all three context paths;
confirm the footer enumerates them honestly.

---

### H10 — Telemetry, benchmarks, settling

**Goal.** Verify the hybrid actually beats the alternatives on quality
and cost. Without a benchmark we're guessing.

**Deliverables.**
- Telemetry: `chat.context.summary` event per turn with
  `{inline_bytes, rag_chunks, files_read, greps_run, subagent_runs,
  tokens_in, tokens_out}`. Lives in the existing event-log; viewable in
  Activity Timeline.
- Benchmark corpus: `tests/fixtures/hybrid-bench/` — a small PDF, a
  medium Markdown doc, a 20-file source tree, and a `questions.json`
  with golden answers.
- Bench runner: `scripts/bench-hybrid.cjs` — runs each question against
  three modes (RAG-only, agentic-only, hybrid) and compares answer
  similarity + token cost. Output: a CSV that quantifies the win.
- Tune defaults from results. Adjust per-type thresholds in H4/H5 if
  bench shows a clear winner.

**Verification.** Bench ratchets in CI. Hybrid should beat
RAG-only on code questions and tie on document questions; should beat
agentic-only on document questions and tie on simple code questions;
should be within 2× the token cost of the cheaper mode.

---

## What this does NOT do

Explicit non-goals so scope doesn't creep:

- **No local LSP integration.** Claude Code uses LSP for jump-to-def /
  find-references. We could add it later as `lsp_workspace` but it's
  out of scope for the first hybrid pass — `grep_workspace` covers 80%
  of the same need.
- **No automatic workspace-scale embedding.** Embedding the entire
  workspace at watch-mode would be expensive, brittle (every commit
  invalidates), and undermines the agentic-search thesis. Stays out.
- **No GC of orphaned per-conversation collections** (carried forward
  from the v0.1.43 caveat). Worth a follow-up but not part of this plan.
- **No model-aware token-cost UI.** "This will cost ~$0.003" requires
  per-provider per-model token-rate tables that drift. Skipping.
- **No retrieval cache.** Could cache `(query, collection) → chunks` for
  the same conversation, but the bench in H10 should tell us whether
  it's worth it before we build it.

---

## Sequencing rationale

H1–H3 are **foundation** — every later step calls these tools. Land
them first, test them in isolation. They're additive: no behavior
change for existing flows until H4.

H4 is the **routing flip**. Lands once we have the tools to handle the
"code files don't go to RAG anymore" case (because the model can now
read them on demand).

H5 is **user control over H4**. Optional. Could ship without it but the
"DeepSeek vs Claude vs local" presets are valuable.

H6 is **doc-RAG quality** — orthogonal to H1–H4, can land in parallel.

H7 is **prompt teaching** — only meaningful after the tools (H1–H3) and
routing (H4) exist. The model needs accurate guidance about what's
available.

H8 is **the big payoff** — subagent isolation. Could ship without it
(H1–H7 already give us hybrid context), but H8 is what unlocks
Claude-Code-quality workflows on cheap models.

H9 is **trust** — without the UX, the user can't see what the model is
doing and won't trust it. Land before declaring the hybrid "done."

H10 is **the proof** — turns subjective "feels better" into measurable
"X% better on this benchmark." Last because it depends on everything
else stabilizing.

---

## Estimated landed-LOC

Rough order-of-magnitude based on Lamprey's existing patterns:

- H1 read_file: ~250 LOC + ~150 LOC tests
- H2 grep_workspace: ~350 LOC + ~200 LOC tests + ~50 MB bundled rg binary
- H3 glob_workspace: ~150 LOC + ~100 LOC tests
- H4 routing: ~200 LOC refactor + ~150 LOC tests
- H5 settings UI: ~250 LOC component + ~100 LOC tests
- H6 RAG quality: ~400 LOC across loaders/chunker + ~250 LOC tests
- H7 system prompts: ~80 LOC edits, no tests
- H8 explore subagent: ~600 LOC + ~250 LOC tests
- H9 UX: ~400 LOC across 4 components, no tests (jsdom-bound)
- H10 telemetry + bench: ~500 LOC + corpus + runner

Total: ~3,700 LOC + ~1,200 LOC tests + bundled rg (~5 MB compressed).

---

## Open questions to resolve before kicking off

1. **Which ripgrep ABI?** PR-built `rg` for win-x64 / mac-arm64 /
   mac-x64 / linux-x64 covers ~99% of users. Smaller alternative: ship
   a Node implementation (`fast-glob` + `node-grep`) — slower but no
   binary. Recommend bundled rg; fall back to in-process if rg fails to
   spawn (e.g. AV quarantine).
2. **Should `read_file` cost a token-budget check on every call?**
   Today's auto-RAG checks size against `INLINE_THRESHOLD_BYTES`.
   Reading a file via `read_file` is the model's choice — should we
   still cap? Recommend yes, hard cap at 2 MB per call; the model
   paginates if it wants more.
3. **Subagent model.** Should the explore subagent inherit the parent's
   model, or always use a fast cheap model (DeepSeek V4 Flash, Gemma 3
   small)? Recommend a setting: "Subagent model" defaulting to the
   parent's model, with a "Cheaper subagent" toggle.
4. **Cancellation semantics.** If the user cancels the parent turn
   mid-subagent, the subagent must abort. The existing AbortController
   thread through chat.ts should handle this — verify in H8.

---

## Definition of done

The hybrid is "done" when, on the benchmark corpus in H10:

- A workspace question ("what does `ChatInput.tsx` do?") is answered
  via 0 RAG chunks, 1–3 grep calls, 1–2 file reads, no subagent —
  matching Claude Code's posture.
- A document question ("what does the analysis report conclude about
  scoring?") is answered via 3–8 RAG chunks with page citations, 0
  greps, 0 file reads.
- A mixed question ("does the code implement what the spec says?") is
  answered via both: RAG chunks from the spec doc, grep + read on the
  code, optional subagent for synthesis.
- Token cost is within 2× the cheaper of (RAG-only, agentic-only) on
  every question.
- Activity Timeline shows the path taken for every turn.
- 0 lint errors, 0 TS errors, all tests green.

**Status target:** v0.2.0 once all H-prompts land. Reserve 0.1.4x for
incremental landings (H1, H2, H3 each can ship as 0.1.4x).
