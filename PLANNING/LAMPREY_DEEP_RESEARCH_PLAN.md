# Lamprey Deep Research Phase — Sequential Prompt Roster

**Goal:** give Lamprey a **first-class deep research pipeline** that fans out 12–50 source fetches per query, corroborates claims across independent domains, and emits a downloadable, **fully-cited** `.md` artifact — matching or exceeding Claude Code and Codex on research depth and traceability.

**Why this phase exists:** the current state is "two raw tools and pray." `web_search` and `fetch_url` are wired through `web-tools.ts` and the adapter framework in `web-search-adapters.ts`, but there is no orchestrator. The model gets a search tool, calls it once or twice, summarizes the snippets, and emits a paragraph with no traceable citation trail. The user has flagged this as "deficient and prone to fault errors." Closing the gap means building the **research pipeline as a Lamprey service**, not relying on the model to choreograph it.

**Execution model:** **single session, single worktree off `main` (`feat/deep-research-phase`), sequential D1 → D12.** No track-splits — each prompt builds on the previous one's modules.

**Companion to:** [`LAMPREY_FLUIDITY_PLAN.md`](LAMPREY_FLUIDITY_PLAN.md) (J1–J11 fluidity, shipped 2026-06-04). Reuses the J10 `path-autolink` + `MarkdownRenderer` work for citation rendering, the J11 right-panel auto-open for artifact surfacing, and the J9 transcript-notice surface for progress events when appropriate.

---

## 0. SESSION BOOTSTRAP — READ THIS FIRST

You are a fresh Claude Code session handed this document. Before doing anything else:

### Step 1 — Confirm environment

Verify:
- Working directory is `C:\Users\17076\Documents\Claude\Lamprey Harness` (or a worktree thereof).
- Current branch is **not** `main` — set up `feat/deep-research-phase` as a worktree off `main` first if it doesn't exist (per `feedback_parallel_session_worktree` memory).
- `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both pass cleanly *before* you start.
- `npx vitest run` exits 0.

If any of those fail, halt and report. Do not start on a broken baseline.

### Step 2 — No track question

Single linear phase. Confirm with the user that you're starting the Deep Research Phase and proceed straight into D1.

### Step 3 — Execute D1 → D12 without stopping

1. **Do not ask further questions** unless a prompt requires a decision only the user can make (a real architectural fork the plan doesn't resolve, or a genuine blocker).
2. **For each prompt, in order:**
   a. Read the "Files (net new / modified)" list. Read the existing files first to ground the change in the real shape — D1, D5, D10, D11 in particular edit shipped code, not greenfield.
   b. Implement the change. Edit existing files in place; create new ones only when the prompt calls for them.
   c. Run the **verify gate** (the "Verify" column). Always: both tsc configs + relevant unit tests. UI-touching prompts also list manual smoke steps — execute them via the preview tools (`mcp__Claude_Preview__*`) when they touch the renderer. Electron-shell-only smoke steps are written into DEVLOG and explicitly marked **"user-verification-needed"** rather than claimed (see `feedback_no_fake_polish` memory).
   d. If verify fails: fix and retry up to **2 times**. On the third failure, halt, write a "blocked" entry to `DEVLOG.md` with the failure context, report to the user.
   e. If verify passes: mark the prompt `[x]` in this document via `Edit`, write a DEVLOG.md entry (see Step 4), then commit (do not push — user pushes per CLAUDE.md).
   f. Move to the next prompt.
3. **Do not push to GitHub.** One commit per prompt. The user reviews and pushes.
4. **When all 12 prompts complete:** write a final phase-completion summary in DEVLOG.md listing every shipped prompt with its commit SHA, and announce completion in chat.

### Step 4 — DEVLOG entry format

```markdown
## [Deep Research — Prompt DN] <Title>  —  <YYYY-MM-DD>

**Files changed:** <list>
**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest <subset> ✓ (N tests)
- <manual smoke steps + result, OR "user-verification-needed: <what to check>">

**Notes:** <anything surprising, deferred, or worth knowing>

**Commit:** <SHA>
```

### Step 5 — Commit discipline

- One commit per prompt. No batching, no amending across prompts.
- Never use `--no-verify`. If a pre-commit hook fails, fix the underlying issue.
- Never add the `Co-Authored-By: Claude` trailer (per `feedback_no_coauthor_trailer` memory).
- Use the project's commit-message style — `feat(research): D4 query planner`.

---

## 1. Audit Summary — what exists vs. what's missing

| Capability | Current state | Target | Owner prompt |
|---|---|---|---|
| Search providers | Brave / Tavily / SerpAPI / SearXNG adapters | Add **DuckDuckGo** (no-key default), keep all others | **D1** |
| Provider fallback | Single provider per call, hard failure on 429/5xx | Configurable **cascade** with dedup across providers | **D2** |
| Auto-trigger | None — model decides whether to call `web_search` | Intent classifier + heuristic prefilter routes research-worthy turns into the pipeline | **D3** |
| Query expansion | None — single query passed to adapter | **Planner** emits 3–8 sub-queries covering distinct angles | **D4** |
| Source curation | None — first 5 results used verbatim | **Collector** dedupes, canonicalizes, applies domain caps, trust-ranks, scales by depth tier (12 / 25 / 50) | **D5** |
| Content extraction | `fetch_url` returns raw text capped at 50KB | **Extractor** uses a `<main>` / `<article>` / largest-block heuristic to strip nav/footer/ads | **D6** |
| Claim extraction | None — model summarizes from snippets | LLM extracts atomic claims with source spans per page | **D7** |
| Multi-source verification | None | Claims clustered by embedding similarity; ≥2 independent-domain support required for `accepted`; conflicts flagged `disputed` | **D8** |
| Synthesis with citations | Free-form paragraph, no inline cites, no bibliography | Markdown report with `[n, m]` footnotes; every paragraph cites; bibliography section maps numbers → titles + clickable URLs | **D9** |
| Orchestration | None | `runDeepResearch()` service + `research:start`/`research:cancel` IPC + `research:progress` event stream | **D10** |
| Artifact emission | `web_search` results displayed inline only | `.md` written to `userData/artifacts/research/`, registered as artifact, surfaced via `__openArtifact` + Markdown panel | **D11** |
| Progress feedback | None — long runs feel like a black box | `DeepResearchBanner` shows stage + counts + cancel button, sticks above MessageList while a run is active | **D12** |

**Non-goals (this plan):** new chat model providers, new tool categories beyond research, RAG ingestion of research artifacts (that's a future R-series prompt), Slack/Teams sharing of reports, scheduled recurring research runs (CronCreate-style — out of scope), PDF / DOCX extraction (HTML only this phase).

---

## 2. Architectural Invariants — Locked

These apply across all 12 prompts. Treat as binding.

1. **Every network read goes through `safeFetch`** (`url-safety.ts`). No exceptions. The DDG adapter (D1), extractor (D6), and any redirect-following stage must use it. SSRF protections are non-negotiable.
2. **Every claim in the synthesized report has a citation.** D9 synthesizer runs in strict mode: any `[n]` reference that doesn't map to a real source in the curated pool fails the run. No fabricated citations, ever. This is the single most important quality bar of the phase.
3. **Pipeline is provider-agnostic.** D5 collector and D2 cascade work with any combination of `{duckduckgo, brave, tavily, serpapi, searxng}`. Adding a future adapter does not require touching the pipeline.
4. **Cancellation is honored at every stage boundary.** `AbortController` threads from `research:cancel` IPC through orchestrator → planner → collector → extractor → claims → corroborator → synthesizer. No stage runs more than ~3 seconds past an abort signal.
5. **No new SQLite tables.** Sources, claims, and intermediate state live in-memory for the duration of the run. The final `.md` is the only persistent output. (Future phase may add an `archived_research_runs` table; not this phase.)
6. **Auto-trigger never escalates code-edit requests.** D3 prefilter must short-circuit `shouldResearch=false` for prompts that start with `fix`/`write`/`implement`/`refactor`/`add`/`remove`/`rename`, contain a path-like token, or are issued while in plan-mode. Misfires here are the worst-feeling failure mode — they steal context-window from real coding turns.
7. **User can always opt out of auto-trigger.** Settings flag `deepResearch.autoTrigger: false` disables it globally; per-turn opt-out via prefix `--no-research` (parsed and stripped from the prompt before classification). Opt-IN forcing via `/research <query>` slash command (D10 also wires this as a deterministic entry point).
8. **Synthesizer model is the most capable; planner/classifier/claims use the cheapest fast model.** Defaults: `deepseek-v3` for synthesis, `deepseek-v3-flash` (or whichever is the cheapest configured DeepSeek tier) for the rest. User overrides in settings.
9. **No new IPC namespace for renderer-side rendering.** D11 reuses the existing `artifact:render` channel + `window.__openArtifact` global. The research panel is a Markdown artifact; the existing `MarkdownRenderer` (with J10 path-autolink) renders it.
10. **No removal of existing surfaces.** The raw `web_search` and `fetch_url` model tools stay. They're still useful for one-shot lookups that don't warrant the full pipeline. D3 routing decides which path a turn takes.

---

## 3. The Twelve Prompts

### Prompt sequence

| # | Prompt | One-liner | Files (net new / modified) | Verify | Status |
|---|---|---|---|---|---|
| D1 | **DuckDuckGo adapter (no-key default)** | Add `DuckDuckGoAdapter` to `web-search-adapters.ts`. Uses `html.duckduckgo.com/html/` POST endpoint (no API key required). Parses result blocks via a cheap regex-over-HTML extractor (no heavy DOM lib — single-file parser). Maps `freshness` → DDG's `df` param (`d`/`w`/`m`/`y`). SSRF via `safeFetch`. Add `'duckduckgo'` to `WebSearchProviderId` union and the factory branch. Extend `WebToolsSettings.tsx` with a no-key DDG row (label "DuckDuckGo · no key required"). Make DDG the default in `DEFAULT_SETTINGS.searchProvider` for new installs (existing users keep their saved provider). | `electron/services/web-search-adapters.ts`, `electron/services/web-search-adapters.test.ts`, `src/components/settings/WebToolsSettings.tsx` | unit: parse fixture HTML → ≥5 results with title/url/snippet · unit: freshness mapping fixture matrix · unit: `safeFetch` is the only outbound call site · unit: factory returns null when DDG endpoint unreachable (404 fixture) gracefully · jsdom: settings panel shows DDG row, selecting it does not require key entry · both tsc | [ ] |
| D2 | **Adapter cascade + cross-provider dedup** | New `electron/services/research/adapter-cascade.ts` exposing `searchCascade(query, opts, providers)`. Calls providers in declared order; on `429`/`5xx`/empty → next; collects results, dedupes by canonical URL (helper from D5 imported once D5 lands — for D2, use a minimal inline canonicalizer that strips `utm_*`, normalizes trailing slash, lowercases host). Returns merged `{results, providersUsed, errors}`. Add `deepResearch.providerCascade: string[]` to settings (default `["duckduckgo","brave","serpapi"]`). | `electron/services/research/adapter-cascade.ts` (new), `electron/services/research/adapter-cascade.test.ts` (new), `electron/services/settings-helper.ts` (extend defaults) | unit: cascade falls through on simulated 429 to next provider · unit: cascade dedupes identical URLs across providers (canonical-equal) · unit: cascade returns partial results when some providers error and others succeed · unit: empty cascade with no configured providers returns clean error not throw · both tsc | [ ] |
| D3 | **Intent classifier + auto-trigger routing** | New `electron/services/research/intent.ts`. **Stage 1 (heuristic prefilter):** short-circuit `shouldResearch=false` when prompt starts with a code-edit verb (`fix`/`write`/`implement`/`refactor`/`add`/`remove`/`rename`/`debug`/`test`), contains a path-like token (regex from J10's `path-autolink`), is shorter than 8 words AND has no `?`, or plan-mode is active. **Stage 2 (LLM):** if prefilter doesn't short-circuit, call the configured classifier model with a tight system prompt returning `{shouldResearch: bool, depth: 'quick'|'standard'|'exhaustive', confidence: 0..1, reason: string}`. Cache by hash of prompt for the session. Hook into `electron/ipc/chat.ts` BEFORE the agent dispatch: when classifier returns `shouldResearch=true && confidence ≥ 0.6 && settings.deepResearch.autoTrigger`, route to `runDeepResearch()` (D10) instead of normal dispatch. Per-turn opt-out: prefix `--no-research` is parsed off the front of the prompt and forces `shouldResearch=false`. | `electron/services/research/intent.ts` (new), `electron/services/research/intent.test.ts` (new), `electron/ipc/chat.ts` (add routing call), `electron/services/settings-helper.ts` (`deepResearch.autoTrigger` default + `deepResearch.classifierModel`) | unit: prefilter accepts/rejects 20+ labeled fixtures (10 code-edit prompts → reject; 10 research prompts → defer to LLM) · unit: `--no-research` prefix is stripped and forces false · unit: classifier output schema validated; malformed LLM JSON → safe default `shouldResearch=false` · integration: chat.ts dispatch with mock classifier returning true → runDeepResearch path called; returning false → normal path called · cache hit on identical prompt does not re-call LLM · both tsc | [ ] |
| D4 | **Query planner** | New `electron/services/research/planner.ts` exposing `planQueries(question, depth, model)`. Single LLM call: system prompt instructs the model to emit 3–8 sub-queries (depth-scaled: quick=3, standard=5, exhaustive=8) covering distinct angles — factual baseline, recent developments, opposing viewpoints, comparative/alternatives, technical deep-dive. Output schema: `{queries: Array<{q: string, angle: string}>}`. Parser handles malformed JSON (retries once with stricter prompt, then errors). Dedupes near-identical queries (Jaccard token overlap > 0.75 → drop). | `electron/services/research/planner.ts` (new), `electron/services/research/planner.test.ts` (new) | unit: parser handles well-formed JSON · unit: parser retries once on malformed, fails cleanly on second malformed · unit: dedup drops near-identical queries by Jaccard threshold · unit: depth tier maps to expected query count range · unit: angles are not all the same string · both tsc | [ ] |
| D5 | **Source collector — dedup, curate, rank** | New `electron/services/research/collector.ts` exposing `collectSources(planned, depth, cascade)`. Runs planner queries through `searchCascade` in parallel (capped concurrency 4). For all returned results: **canonicalize URL** (drop `utm_*`, `fbclid`, `gclid`, normalize trailing `/`, lowercase host, strip `#anchor`); **dedupe** by canonical URL; **enforce domain cap** (≤3 results per registrable domain); **spam blocklist** (a small hard-coded set: `*.blogspot.com` low-content, known content farms, AI-generated review sites — keep tight, conservative); **trust score** heuristic (boost `.gov` / `.edu` / known major-publisher allowlist; neutral for everything else; no downweighting unless on spam list — false positives are worse than letting noise through). Return top N where N = `{quick: 12, standard: 25, exhaustive: 50}`, numbered `1..N` (citation indices). | `electron/services/research/collector.ts` (new), `electron/services/research/collector.test.ts` (new), `electron/services/research/url-canonicalize.ts` (new — extracted helper so D2 + D5 share it) | unit: canonicalize fixtures (15+ URL variants → expected canonical) · unit: domain cap enforces ≤3 per registrable domain (test with eTLD+1 cases: `*.co.uk`, `*.github.io`) · unit: spam blocklist drops known-bad fixtures, lets neutral pass · unit: trust score is deterministic and stable across runs · unit: top-N truncation respects depth tier · D2 cascade refactored to import the shared canonicalizer · both tsc | [ ] |
| D6 | **Readable-text extractor** | New `electron/services/research/extractor.ts` exposing `extractPage(source)`. For each `CuratedSource`: `safeFetch` HTML body (cap 1 MB), parse with `node-html-parser` (small dependency, no full DOM — verify license + size before adding to `package.json`; accept if minified+gzipped is **under 300 KB**, fall back to a regex+tag-strip pipeline only if it exceeds that threshold). Strip `<script>`, `<style>`, `<nav>`, `<footer>`, `<aside>`, `<form>`. Extract main content via priority order: `<article>`, `<main>`, the `<div>` with the most text content among top-level siblings of `<body>`. Collapse whitespace, cap output at 30 KB per page (lower than `web-tools.ts` 50KB cap to leave room for claim extraction context). Attach `{title, byline?, published_at?, full_text, fetched_at, status}`. Non-200 or extraction-empty → `status: 'failed'`, downstream skips. | `electron/services/research/extractor.ts` (new), `electron/services/research/extractor.test.ts` (new), `package.json` (potentially `node-html-parser` dep) | unit: 5 HTML fixtures (news article, blog, wiki, docs page, content farm) → extracted text matches golden snippet · unit: `<script>`/`<style>` removed · unit: title extraction prefers `<h1>` over `<title>` when both present · unit: byte cap enforced · unit: non-200 returns `status: failed` not throw · unit: SSRF safe — only `safeFetch` used · both tsc · manual smoke (preview, optional): run extractor on a live news article in dev, eyeball the output is readable | [ ] |
| D7 | **Claim extraction (per source)** | New `electron/services/research/claims.ts` exposing `extractClaims(source, model)`. Per extracted page (parallel, concurrency cap 6), one LLM call: system prompt instructs the model to emit atomic factual claims with the original text span. Output schema: `Array<{id: string, text: string, source_n: number, span?: string}>`. `id` is `<source_n>-<i>` for stable cross-reference. `span` is the verbatim sentence the claim is drawn from (used by corroborator for evidence display). Cap 25 claims per source (long pages get truncated, not skipped). Non-factual content (opinions, marketing copy) instructed to be excluded. | `electron/services/research/claims.ts` (new), `electron/services/research/claims.test.ts` (new) | unit: parser handles well-formed claim arrays · unit: id format stable across runs (`<source_n>-<i>`) · unit: claims exceeding cap are truncated, not dropped silently (log + truncate) · unit: empty page → empty array, not throw · unit: malformed LLM output → empty array + log warn · both tsc | [ ] |
| D8 | **Multi-source corroboration** | New `electron/services/research/corroborator.ts` exposing `corroborate(allClaims, sources, embeddingService)`. Cluster claims by semantic similarity (cosine ≥ 0.78 on embeddings — reuse the existing RAG embeddings service `electron/services/rag/embeddings/service.ts`). For each cluster: count **independent registrable domains** supporting it (not URLs — two articles from the same domain count once). **Accepted:** cluster with ≥2 independent-domain support and no contradicting cluster. **Single-source:** cluster with 1 supporting domain. **Disputed:** two clusters with semantically opposed claims (detected by a small follow-up LLM call comparing top-N claim pairs across clusters; cheap because most clusters have no opposing candidates). Output: `ClaimSet = {accepted: Cluster[], singleSource: Cluster[], disputed: DisputeGroup[]}`. | `electron/services/research/corroborator.ts` (new), `electron/services/research/corroborator.test.ts` (new) | unit: clustering deterministic on 3 fixture claim sets · unit: independence counted by registrable domain (`a.example.com` + `b.example.com` → 1 domain) · unit: accepted requires ≥2 domains · unit: disputed detection correctly tags opposing-claim pairs on a fixture · unit: empty input → empty ClaimSet, not throw · unit: embedding service is mockable for tests (interface-injected) · both tsc | [ ] |
| D9 | **Markdown synthesizer (strict-citation)** | New `electron/services/research/synthesizer.ts` exposing `synthesizeReport(question, claimSet, sources, model)`. One LLM call to the most capable configured model. System prompt enforces: (a) every paragraph cites ≥1 source via `[n]` or `[n, m]` footnote refs; (b) accepted claims may be stated factually; (c) single-source claims **must** be prefixed with `According to [n], …`; (d) disputed claims **must** be flagged `[disputed]` with both sides cited; (e) no claim outside the ClaimSet is permitted. **Post-generation validator** (deterministic, non-LLM): scan the report for every `[n]` ref, confirm `n` exists in `sources`; if any ref is fabricated, **fail the run** (don't paper over — surface clearly; this is the quality-bar invariant). Append `## Sources` section: numbered list of `[n] [Title](URL) — accessed YYYY-MM-DD`, sorted by first appearance in the body. Title slug for filename: `research-<kebab-slugify(question)>-<unix-timestamp>.md`. | `electron/services/research/synthesizer.ts` (new), `electron/services/research/synthesizer.test.ts` (new), `electron/services/research/slugify.ts` (new — tiny helper) | unit: validator catches a fabricated citation in a fixture report · unit: validator passes a clean fixture · unit: bibliography is sorted by first-appearance order · unit: slugify handles unicode, punctuation, long inputs · unit: disputed claims in ClaimSet appear in body with `[disputed]` tag · unit: single-source claims have `According to [n]` prefix · unit: every paragraph has ≥1 citation on a fixture · both tsc | [ ] |
| D10 | **Orchestrator + IPC + progress streaming** | New `electron/services/research/index.ts` exposing `runDeepResearch({question, depth, abortSignal, onProgress})`. Wires the pipeline: planner → collector → extractor → claims → corroborator → synthesizer. Threads `AbortSignal` through every stage. Emits progress events at each stage boundary: `{stage, sourcesFound, sourcesFetched, claimsExtracted, claimsAccepted, elapsedMs}`. New `electron/ipc/research.ts` with channels: `research:start` (returns `{runId}`), `research:cancel` (by `runId`), `research:status` (returns last progress snapshot). Progress events stream via existing `chat-events` bridge using event type `research:progress`. Also adds a deterministic entry point: `/research <query>` slash command (parsed in `chat.ts` upstream of intent classifier; forces the pipeline regardless of classifier). | `electron/services/research/index.ts` (new), `electron/services/research/index.test.ts` (new), `electron/ipc/research.ts` (new), `electron/ipc/index.ts` (register), `electron/preload.ts` (expose `window.api.research.{start, cancel, status}`), `src/lib/types.ts` (research result types) | unit: orchestrator with all stages mocked runs end-to-end and emits progress in expected order · unit: cancellation mid-collector aborts within 3s; cancellation mid-synthesizer aborts before next LLM token · unit: `runId` uniqueness across concurrent runs · jsdom: `window.api.research.start()` returns `{success: true, data: {runId}}` · `/research` slash parsing works · both tsc | [ ] |
| D11 | **Artifact emission + chat surfacing** | Extend `electron/services/research/index.ts` final stage: write the synthesized markdown to `userData/artifacts/research/<filename>` (creating the dir if absent). Register as an artifact via the existing `artifact:render` IPC path (markdown type) and stash a manifest entry in a new in-memory `research-artifacts-store.ts` (no SQLite — manifest is rebuilt from disk on app start). The assistant message body posted to chat contains: a 2–3 sentence executive summary (from the synthesizer), a `**Sources:** N (M accepted, K single-source, L disputed)` line, and a markdown link `[Open full report](artifact://research/<filename>)`. Renderer: clicking the link invokes `window.__openArtifact('markdown', <file content>)` which triggers the J11 right-panel auto-open. New `src/components/artifacts/ResearchArtifact.tsx` wraps the existing `MarkdownRenderer` (with J10 path-autolink) plus a Download button (saves the .md to the user's chosen path via existing file-save IPC, fallback to copy-to-clipboard). | `electron/services/research/index.ts` (extend), `electron/services/research-artifacts-store.ts` (new), `electron/ipc/research.ts` (add `research:list`, `research:read`, `research:download` channels), `src/components/artifacts/ResearchArtifact.tsx` (new), `src/components/artifacts/MarkdownRenderer.tsx` (route `artifact://research/...` links) | unit: artifact file written to disk at expected path, content matches synthesizer output · unit: manifest rebuilt from disk on init · unit: chat message contains executive summary + sources line + clickable link · jsdom: clicking link calls `__openArtifact` with correct payload · jsdom: ResearchArtifact renders markdown with clickable bibliography URLs · download button writes file and shows toast on success · both tsc · manual (preview): trigger a small research run, confirm right panel auto-opens with rendered report and bibliography links open in external browser | [ ] |
| D12 | **Live progress banner + cancel button** | New `src/components/chat/DeepResearchBanner.tsx`. Sticky banner pinned above `MessageList` while any research run is active (subscribes to `research:progress` events via the existing event bridge). Shows current stage label (`Planning queries…` / `Searching · 14/25 sources` / `Reading · 8/14 fetched` / `Extracting claims…` / `Corroborating…` / `Synthesizing report…`), a subtle progress bar (determinate where counts exist, indeterminate otherwise), elapsed time, and a `Cancel` button calling `window.api.research.cancel(runId)`. On run completion, banner fades out and the assistant message from D11 takes over. On cancel, the banner shows a `Cancelled — partial results discarded` state for 3s then unmounts. New `src/stores/research-runs-store.ts` tracks the active run id + last progress snapshot per conversation. | `src/components/chat/DeepResearchBanner.tsx` (new), `src/components/chat/MessageList.tsx` (mount the banner), `src/stores/research-runs-store.ts` (new), `src/hooks/useResearchProgress.ts` (new — subscription wrapper) | unit: store updates on each progress event in order · jsdom: banner mounts on first progress event, unmounts on completion · jsdom: cancel button invokes `window.api.research.cancel` with active runId · jsdom: cancel state shows for 3s then unmounts · jsdom: indeterminate progress renders when counts are unknown · both tsc · manual (preview): trigger a research run, confirm banner appears, counts increment, cancel works | [ ] |

### Phase completion criteria

- All 12 prompts marked `[x]`.
- 12 commits on the `feat/deep-research-phase` worktree branch.
- `npx tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean.
- `npx vitest run` exits 0.
- **Manual end-to-end smoke (user-verification-needed):** launch Electron, open a fresh conversation, send a research-worthy prompt (e.g. *"What's the current state of fusion energy commercialization in 2026?"*). Confirm:
  - Intent classifier escalates to the pipeline.
  - `DeepResearchBanner` appears with live counts.
  - Sources fetched count reaches the standard tier (~25) within ~60s.
  - Assistant message contains exec summary + sources line + `[Open full report]` link.
  - Clicking the link opens the right panel with the rendered markdown.
  - Every paragraph in the report has `[n]` citations.
  - Bibliography section lists 12+ entries with clickable URLs.
  - Download button writes a `.md` to a user-chosen location.
  - A second prompt like `"fix the bug in chat-store.ts"` does **not** trigger the pipeline (prefilter dominates).
  - `--no-research what is fusion?` does **not** trigger the pipeline.
  - `/research what is fusion?` **does** trigger it regardless of classifier.
- `DEVLOG.md` has 12 prompt entries + one phase-completion summary.
- `README.md` "Deep Research" subsection added under the existing fluidity wrap-up.

---

## 4. Quick-Reference Tables

### Module layout (new)

```
electron/services/research/
  index.ts              # orchestrator (D10, extended in D11)
  intent.ts             # D3 — auto-trigger
  planner.ts            # D4 — sub-query expansion
  collector.ts          # D5 — dedup + curate + rank
  adapter-cascade.ts    # D2 — multi-provider fallback
  url-canonicalize.ts   # D5 — shared helper
  extractor.ts          # D6 — readable text from HTML
  claims.ts             # D7 — atomic claim extraction
  corroborator.ts       # D8 — multi-source verification
  synthesizer.ts        # D9 — strict-citation markdown report
  slugify.ts            # D9 — filename helper

electron/services/research-artifacts-store.ts   # D11 — manifest

electron/ipc/research.ts                        # D10/D11 — IPC channels

src/components/chat/DeepResearchBanner.tsx      # D12
src/components/artifacts/ResearchArtifact.tsx   # D11
src/stores/research-runs-store.ts               # D12
src/hooks/useResearchProgress.ts                # D12
```

### Surfaces touched (modified)

| Layer | Files |
|---|---|
| Search adapters | `web-search-adapters.ts`, `web-search-adapters.test.ts` |
| Settings | `WebToolsSettings.tsx`, `settings-helper.ts` |
| Chat dispatch | `electron/ipc/chat.ts`, `electron/ipc/index.ts` |
| Preload bridge | `electron/preload.ts` |
| Renderer chat | `src/components/chat/MessageList.tsx` |
| Renderer markdown | `src/components/artifacts/MarkdownRenderer.tsx` (route `artifact://research/...`) |
| Types | `src/lib/types.ts` |
| Possibly added dep | `package.json` (`node-html-parser` — verify size first) |

### Settings additions (one `deepResearch` block in `settings.json`)

```jsonc
"deepResearch": {
  "autoTrigger": true,                                // D3 — auto-classify research-worthy prompts
  "providerCascade": ["duckduckgo", "brave", "serpapi"], // D2 — fallback order
  "depthTier": "auto",                                // D3 — "auto" | "quick" | "standard" | "exhaustive"
  "classifierModel": "deepseek-v3-flash",             // D3/D4/D7 — cheap fast model
  "synthesizerModel": "deepseek-v3"                   // D9 — most capable
}
```

### Pipeline stages + responsibilities

| Stage | Module | Input | Output | LLM? | Cost |
|---|---|---|---|---|---|
| Intent | `intent.ts` | User prompt | `{shouldResearch, depth}` | Maybe (after heuristic) | tiny |
| Planning | `planner.ts` | Question, depth | `Array<{q, angle}>` | Yes | low |
| Collection | `collector.ts` | Sub-queries | `CuratedSource[]` numbered 1..N | No (uses adapters) | API |
| Extraction | `extractor.ts` | Sources | `ExtractedPage[]` w/ full text | No | network |
| Claims | `claims.ts` | Extracted pages | `Claim[]` per source | Yes (parallel) | medium |
| Corroboration | `corroborator.ts` | All claims + embeddings | `ClaimSet {accepted, singleSource, disputed}` | Embeddings + small LLM for opposition detection | medium |
| Synthesis | `synthesizer.ts` | Question, ClaimSet, sources | Markdown report w/ bibliography | Yes (best model) | high |
| Artifact | `index.ts` (D11) | Markdown report | `.md` on disk + chat message | No | — |

### Keyboard / slash reflexes introduced

| Keystroke / token | Behavior | Prompt |
|---|---|---|
| `/research <q>` slash command | Force pipeline regardless of classifier | D10 |
| `--no-research` prompt prefix | Force normal dispatch regardless of classifier | D3 |
| Cancel button on `DeepResearchBanner` | Aborts active run via IPC | D12 |

### What is intentionally NOT in this plan

- **No new chat-model providers.** DeepSeek / Google / DashScope remain the only LLM tiers; research pipeline reuses them.
- **No RAG ingestion of research artifacts.** Future R-series prompt may auto-ingest `.md` reports into RAG store; not this phase.
- **No PDF / DOCX / video extraction.** HTML-only. PDFs in source URLs are dropped at collector stage.
- **No paid research APIs added beyond what's already wired.** Exa, Kagi, You.com — out of scope. Add later behind the same adapter framework if needed.
- **No browser-rendered extraction.** Headless Chromium would catch SPAs, but doubles complexity and adds attack surface. Static-HTML extraction is the bar; SPAs that fail extraction get dropped (logged) rather than escalated.
- **No model-callable `deep_research` tool.** The pipeline is an *orchestrated service*, not a model tool. Models that need research-shaped output get it via the dispatch routing in D3, not by calling a tool.
- **No multi-language UI.** Reports are emitted in the user's prompt language (model handles it). UI strings stay English.
- **No automatic scheduling / cron-style recurring research.** Out of scope; user can invoke `/research` manually or via the existing schedule skill.

### Risk register

| Risk | Mitigation |
|---|---|
| DuckDuckGo HTML scrape breaks when DDG changes their markup | Fall back to next provider in cascade (D2). Parser uses 2 distinct selectors as fallbacks. Unit test fixtures pinned; CI catches regressions. |
| Intent classifier misfires on edge-case prompts (false-positive escalation) | D3 prefilter is conservative — short-circuits on any code-edit-shaped prompt. `--no-research` prefix is the user's escape hatch. Settings flag globally disables. |
| Claim extraction LLM hallucinates claims not in the source | D9 synthesizer validator catches fabricated citation numbers. Claims with empty `span` are flagged for human review in disputed bucket. |
| Synthesizer fabricates a citation `[n]` that doesn't map to a source | **Strict mode fails the run.** Surface to user transparently — no silent fallback. This is the quality-bar invariant; degrading it would defeat the purpose of the phase. |
| Corroboration over-aggressively marks single-domain claims as "disputed" | Disputed requires explicit opposing-claim cluster, not absence of corroboration. Single-source is its own bucket, presented as such in the report. |
| `node-html-parser` dep adds significant bundle size | Verify minified+gzipped size before merging D6. If > 300 KB, fall back to regex-based stripping. (Current upstream package is well under this threshold.) |
| Embedding service call costs balloon on exhaustive runs | Embeddings are local (RAG service uses `transformers.js` worker — no API cost). Per-claim cost is CPU, not API. |
| Long-running synthesizer call blocks main thread | Synthesizer LLM call is async + abortable. Orchestrator does not block; progress events keep the UI responsive. |
| User cancels mid-run, partial sources remain on disk | Orchestrator cleans up partial artifact directory on cancel. Manifest store only registers completed runs. |
| Auto-trigger costs tokens on every chat turn | Heuristic prefilter handles ~80% of turns without LLM call. Classifier model defaults to cheapest tier. Per-turn cost is a few hundred tokens worst case. |
| DDG rate-limits the user when they're doing many runs | Cascade falls through to Brave/SerpAPI. Document in README. |

---

## 5. Sequencing Rationale

The twelve prompts are ordered so each later prompt can assume the earlier ones' modules exist and are tested:

- **D1** lands the new search backend first so the rest of the pipeline has a default that requires zero user config.
- **D2** adds cascade because the rest of the pipeline depends on robust, multi-provider search; building it once means every later stage that needs search reuses it.
- **D3** routes traffic into the pipeline. It depends on D2 because if the pipeline ever runs, search must work; but it does NOT depend on D4–D11 — D3 ships with a routing decision that can call a stub `runDeepResearch` until D10 lands. **Critical:** in D3, the routing call should hand off to a placeholder that returns a "not yet implemented" error; this is fine because auto-trigger defaults to true only after D10 wires the real orchestrator. Until D10, ship D3 with `autoTrigger: false` default and flip the default in D10.
- **D4 → D5 → D6 → D7 → D8 → D9** is the linear pipeline. Each stage's tests can use mocked upstream output, so they don't strictly depend on prior prompts, but committing them in order means the integration test in D10 has all real stages to call.
- **D10** wires it all together with IPC + orchestrator + slash command, and flips `autoTrigger` default to true.
- **D11** adds the artifact emission and chat surfacing — independent of progress UI.
- **D12** adds the progress banner last. It's pure UI; ships independently of pipeline internals.

Each prompt's verify gate is independently exercisable. If a prompt is blocked, the next stage can still be drafted against a mock — but the plan assumes linear execution; halt-and-report is the protocol if a prompt's verify can't pass.

---

## 6. Sign-off

When all 12 prompts are `[x]`, append:

```markdown
## [Deep Research Phase Complete] — <YYYY-MM-DD>

**Prompts completed:** D1 DuckDuckGo adapter, D2 cascade, D3 intent classifier, D4 planner, D5 collector, D6 extractor, D7 claims, D8 corroborator, D9 synthesizer, D10 orchestrator + IPC, D11 artifact emission, D12 progress banner.

**Phase verify:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (N files / N tests)
- production build ✓
- smoke-renderer ✓
- smoke-bundle ✓
- user-verification-needed: full end-to-end smoke per §3 completion criteria.

**Notes:** Lamprey now has a first-class deep research pipeline. A research-worthy prompt fans out 12–50 sources via a configurable provider cascade (DuckDuckGo → Brave → SerpAPI by default), extracts and corroborates claims across independent domains, and emits a strict-citation markdown artifact with a clickable bibliography. Auto-trigger via intent classifier; `/research` for explicit invocation; `--no-research` for opt-out. Matches or exceeds Claude Code / Codex on traceability — every paragraph cites a real fetched source, never a fabricated one.

**Commit range:** <first-sha>..<last-sha>
```
