# Lamprey Reasoning-Trace Phase — Sequential Prompt Roster

**Goal:** close the five reasoning-trace-adjacent gaps surfaced after R7's per-bubble reasoning pill + R8's API-stack rehydration shipped. Five concrete items become eight prompts: (1) silence the Reviewer's `<bash>`-as-prose hallucination via a system-prompt patch, (2) capture + (3) surface **per-stage token cost** so users can decide whether R8 rehydration is worth its tokens, (4) add a first-class `get_conversation_history` model-callable tool so the model can ask "show me turn N's reasoning" by name, (5+6) ship a unified **Reasoning-Trace Viewer** panel in the right sidebar with per-stage expansion + search, (7) wire **audit-trail export** (markdown + CSV) into the viewer so genuine review use-cases can leave the app, and (8) DEVLOG + verify + ship — version bump to **v0.8.1**, local Windows build, artifacts into primary `dist/`, push to `main`.

**Execution model:** **single session, single worktree off `main`, sequential RT1 → RT8.** No track-splits. Branch: `feat/reasoning-trace-phase`. One commit per prompt; user pushes.

**Companion to:** the existing reasoning-preservation work — R7 (per-bubble reasoning pill) + R8 (API stack rehydration toggle). This phase is the polish closer for everything reasoning-trace-shaped that R7/R8 left additive.

---

## 0. SESSION BOOTSTRAP — READ THIS FIRST

You are a fresh Claude Code session handed this document. Before doing anything else:

### Step 1 — Confirm environment

Verify:
- Working directory is `C:\Users\17076\Documents\Claude\Lamprey Harness` (or a worktree thereof).
- Current branch is **not** `main` — set up `feat/reasoning-trace-phase` as a worktree off `main` first if it doesn't exist (per `feedback_parallel_session_worktree` memory).
- `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both pass cleanly *before* you start.
- `npx electron-vite build` exits 0.
- `npx vitest run` is green on the current `main` baseline (record the test count — RT2/RT4/RT7 add tests on top of it).

If any of those fail, halt and report. Do not start on a broken baseline.

### Step 2 — No track question

This is a single linear phase. **Do not ask the user which track** — there is only one path. Confirm with the user that you're starting the Reasoning-Trace Phase and proceed.

### Step 3 — Execute RT1 → RT8 without stopping

1. **Do not ask further questions** unless a prompt requires a decision only the user can make (a real product fork the plan doesn't resolve, or a genuine blocker). Per `feedback_execute_dont_ask`: when the user authorizes STS, every step to deliver it is authorized too.
2. **For each prompt, in order:**
   a. Read the "Files (net new / modified)" list. Read existing files first to ground the change in the real component shape — these prompts touch shipped code.
   b. Implement the change. Edit existing files in place; create new ones only when the prompt calls for them.
   c. Run the **verify gate** (the "Verify" column). Always: both tsc configs + `npx electron-vite build` + the vitest suites listed for that prompt. UI-touching prompts (RT3, RT5, RT6, RT7) also list manual smoke steps — execute them via the preview tools (`mcp__Claude_Preview__*`) when they touch the renderer. Electron-shell-only smoke steps are written into DEVLOG and explicitly marked **"user-verification-needed"** rather than claimed (see `feedback_no_fake_polish` memory).
   d. If verify fails: fix and retry up to **2 times**. On the third failure, halt, write a "blocked" entry to `DEVLOG.md` with the failure context, report to the user.
   e. If verify passes: mark the prompt `[x]` in this document via `Edit`, write a DEVLOG.md entry (see Step 4), then commit (do not push mid-phase — push lives in RT8).
   f. Move to the next prompt.
3. **Do not push to GitHub mid-phase.** One commit per prompt. RT8 does the final push to `main` after the version bump + local Windows build per `feedback_release_artifacts_in_primary_dist` + `feedback_execute_dont_ask` memories.
4. **When RT8 completes:** write a final phase-completion summary in DEVLOG.md listing every shipped prompt with its commit SHA + final test count + `dist/` artifacts list, then announce completion in chat.

### Step 4 — DEVLOG entry format

```markdown
## [Reasoning-Trace — Prompt RTN] <Title>  —  <YYYY-MM-DD>

**Files changed:** <list>
**Verify gate:**
- tsc node ✓
- tsc web ✓
- electron-vite build ✓
- vitest (<scope>): <count> ✓
- <manual smoke steps + result, OR "user-verification-needed: <what to check>">

**Notes:** <anything surprising, deferred, or worth knowing>

**Commit:** <SHA>
```

### Step 5 — Commit discipline

- One commit per prompt. No batching, no amending across prompts.
- Never use `--no-verify`. If a pre-commit hook fails, fix the underlying issue.
- Never add the `Co-Authored-By: Claude` trailer (per `feedback_no_coauthor_trailer` memory).
- Use the project's commit-message style — `feat(reasoning-trace): RT3 per-stage token chips on chat bubble + vitals pill`.

### Step 6 — STS authorization scope (binding)

The user has invoked STS. Per `feedback_sts_convention` + `feedback_execute_dont_ask`:
- Run RT1 → RT8 end-to-end.
- Bump version in `package.json` at RT8 (`0.7.5` → `0.8.1`).
- Run `npm run build:win` at RT8 — produce `.exe` + `.zip` + `.blockmap` + `latest.yml` in the worktree's `dist/`, then move all four artifacts into the **primary repo's** `dist/` per `feedback_release_artifacts_in_primary_dist`.
- Push `feat/reasoning-trace-phase` → `main` (squash or fast-forward as the user prefers; default = fast-forward merge then push `main`). Do **not** attempt to push the `v0.8.1` tag — the remote proxy rejects tag pushes (CLAUDE.md "Where the .exe comes from"). The user creates the tag locally + uploads to GitHub Release.

---

## 1. Audit Summary — what exists vs. what's missing

Mapped against the five user-flagged items:

| # | Item | Current state | Gap | Owner prompt |
|---|---|---|---|---|
| 1 | Reviewer hallucinating inline `<bash>` blocks as prose | `AGENT_ROLE_PROMPTS.reviewer` in `electron/services/system-prompt-builder.ts:300-302` is a two-line generic critique prompt — silent on output format | Reviewer needs an explicit "no pseudo-XML / no fake tool tags / Markdown only" guard, plus an explicit "you have no tools" line (reviewer stage today is text-only but the prompt doesn't say so) | **RT1** |
| 5a | Per-stage token cost — data layer | `chat:streaming-vitals` emits whole-turn `tokensIn`/`tokensOut` via `electron/services/chat-events.ts`; `runMultiAgent` in `electron/ipc/chat.ts` tracks per-stage usage internally but the totals are summed into the turn — per-stage rows aren't persisted | Need a new `message_stage_metrics` table (or columns on `messages`) capturing `{message_id, stage, prompt_tokens, completion_tokens, duration_ms}` + write-through during the pipeline | **RT2** |
| 5b | Per-stage token cost — UI | Streaming-vitals pill shows a single `tokensIn / tokensOut` figure (`StreamingVitalsPill.tsx`); chat bubbles show whole-turn token counts | Vitals pill needs an expansion mode (multi-agent only) showing planner/coder/reviewer rows; chat bubble needs a stage-chip cluster when multi-agent | **RT3** |
| 2 | `get_conversation_history` model-callable tool | No such tool. The model has no way to ask for turn N's reasoning by name — it only ever sees the system + current API stack | New tool descriptor in `electron/services/tool-registry.ts`, IPC handler reads from `conversation-store` / `messages` table, returns `{turn, role, content, reasoning?, stage_metrics?}[]`. Risk tier: low (read-only on own conversation DB) | **RT4** |
| 3a | Reasoning-Trace Viewer panel — shell | Right sidebar in `RightPanelHome.tsx` has 4 rounded pill subpanels; reasoning lives in chat bubbles (R7 pill) but has no inspector surface | New 5th panel card "Reasoning Trace"; expanded drawer shows turn list (vertical, scrollable) | **RT5** |
| 3b | Reasoning-Trace Viewer — per-stage + search | n/a — doesn't exist | Per-turn expansion shows planner / coder / reviewer reasoning side by side or stacked tabs; search box filters by text; stage filter chips | **RT6** |
| 4 | Audit-trail export | Reasoning + tool logs live in SQLite rows and chat UI; no "export this conversation's audit trail" affordance anywhere | "Export audit trail" button on the viewer's expanded drawer header; opens `electron.dialog.showSaveDialog`; formats: `.md` (human-readable, one section per turn × stage) + `.csv` (one row per turn × stage with columns `turn_index, stage, role, model, tokens_in, tokens_out, duration_ms, content_excerpt, reasoning_excerpt`) | **RT7** |
| — | Ship | n/a | Version bump, local Windows build, primary `dist/` move, push `main` | **RT8** |

**Non-goals (this plan):** no new providers, no new model SDKs, no changes to R7's per-bubble pill (it stays untouched — RT5/RT6 sit beside it), no changes to R8's rehydration toggle (RT4's new tool composes with it but doesn't gate it), no new Settings tab, no theme-token changes, no Tailwind / shadcn churn, no skill / connector / plugin surface changes. Every prompt is either a system-prompt edit (RT1), a small DB column + IPC + tool (RT2/RT4), or a localized renderer addition (RT3/RT5/RT6/RT7).

---

## 2. Architectural Invariants — Locked

These apply across all 8 prompts. Treat as binding.

1. **R7 per-bubble pill is untouched.** RT5 + RT6 add a **separate** inspector surface. The chat-bubble pill keeps the same DOM, same click behavior, same expanded-state.
2. **R8 rehydration toggle is untouched.** RT2's per-stage metrics surface helps users *decide* whether to enable R8, but RT4's new tool is not gated by R8 — the tool reads from the DB regardless.
3. **`FloatingEnvironmentCard` is untouched.** It already coexists with 4 right-panel cards; RT5 makes it 5.
4. **No new IPC for the existing reasoning channel.** RT5 + RT6 + RT7 read via the existing `conversations:listMessages` IPC (or its closest equivalent — confirm in RT5). RT4 is the one place a new IPC channel is added (because it's a tool, not a panel).
5. **No schema churn beyond one additive table.** RT2 adds exactly one new table (`message_stage_metrics`) with a `messages.id` FK and no destructive migrations. No column renames, no drops.
6. **No tool-registry changes outside RT4.** RT4 is the only prompt that touches `tool-registry.ts`.
7. **Tools default off-by-default for risk tier ≥ medium.** `get_conversation_history` is read-only on the user's own DB rows for the active conversation → risk tier **low**, `requiresApproval: false`. RT4 must justify that classification in the descriptor's `riskNotes`.
8. **Export is local-only.** RT7 writes to a user-chosen path via `dialog.showSaveDialog`. Never POST or upload anywhere. The .md/.csv contain raw reasoning — that's by-design for audit use, but it's the user's filesystem only.
9. **No reviewer behavior changes beyond the format guard.** RT1 only adds output-format rules. It does not change the critique semantics, the SHIP/FAIL contract, or anything else `runMultiAgent` keys off the reviewer output.
10. **All renderer additions cross the `window.api` guard.** Per CLAUDE.md "Key Decisions" — every new renderer call to `window.api.*` checks for its presence so the app doesn't crash in browser dev mode.
11. **Per `feedback_no_fake_polish`:** any smoke step that can't be exercised via `mcp__Claude_Preview__*` is written into DEVLOG as `user-verification-needed`, never claimed.

---

## 3. The Eight Prompts

### Prompt sequence

| # | Prompt | One-liner | Files (net new / modified) | Verify | Status |
|---|---|---|---|---|---|
| RT1 | **Reviewer prompt-tuning: strip `<bash>`-as-prose hallucination** | Patch `AGENT_ROLE_PROMPTS.reviewer` in `electron/services/system-prompt-builder.ts:300-302`. New body must (a) state explicitly "you have no tools available — do not emit tool calls", (b) forbid pseudo-XML and angle-bracketed pseudo-tags in prose (`<bash>`, `<tool>`, `<run>`, etc.), (c) require all code-like content be fenced Markdown blocks with a language tag, (d) preserve the existing SHIP / FAIL-with-reasons / file:line evidence contract. Add a unit test in `electron/services/system-prompt-builder.test.ts` (new or extended) that snapshots the reviewer prompt and asserts the guard phrases are present. | `electron/services/system-prompt-builder.ts` (lines ~300-302), `electron/services/system-prompt-builder.test.ts` (new or extended) | both tsc · `electron-vite build` · `npx vitest run system-prompt-builder` ✓ · launch + run a multi-agent turn that historically triggered the `<bash>` hallucination, confirm reviewer output is clean Markdown (user-verification-needed if no canned repro exists) | [x] |
| RT2 | **Per-stage token-cost capture: data layer** | (a) Add a new table `message_stage_metrics` in `electron/services/database.ts` `initSchema`: `id TEXT PK, message_id TEXT FK→messages.id ON DELETE CASCADE, stage TEXT CHECK(stage IN ('planner','coder','reviewer','single')) NOT NULL, model TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, duration_ms INTEGER, created_at INTEGER` + index on `message_id`. (b) Add a `saveStageMetrics(messageId, stage, metrics)` helper in a new `electron/services/stage-metrics-store.ts`. (c) Wire `runMultiAgent` / `runAgentPipeline` in `electron/ipc/chat.ts` + `electron/services/agent-pipeline.ts` to call `saveStageMetrics` at every stage boundary — capture `prompt_tokens` + `completion_tokens` from the provider response, `duration_ms` from a wall-clock around the call. (d) Single-stage (non-multi-agent) turns also record one row with `stage='single'` so the per-turn cost surface is uniform. (e) Vitest suite `stage-metrics-store.test.ts` covers insert, FK cascade, and round-trip. | `electron/services/database.ts`, `electron/services/stage-metrics-store.ts` (new), `electron/services/stage-metrics-store.test.ts` (new), `electron/services/agent-pipeline.ts`, `electron/ipc/chat.ts` | both tsc · `electron-vite build` · `npx vitest run stage-metrics` ✓ · `npx vitest run` total green (must equal pre-RT2 count + new tests) · launch + run a single-agent turn → confirm 1 row written · run a multi-agent turn → confirm 3 rows (planner/coder/reviewer) written | [x] |
| RT3 | **Per-stage token-cost UI: vitals pill expansion + chat bubble stage chips** | (a) Extend `StreamingVitalsPill.tsx` (locate via `grep -n "tokensIn\|tokensOut" src/components`): in multi-agent mode, the pill becomes click-to-expand; expanded state shows three rows (planner / coder / reviewer) with `tokens in → tokens out · duration_ms`. Single-agent turns keep the existing single-line pill. (b) Add a `StageTokenChips.tsx` component rendered inside the assistant chat bubble when `message_stage_metrics` has rows for that message id — small chip per stage e.g. `planner 1.2k/340 · 4.1s`. (c) Reads metrics via a new renderer call `window.api.conversations.listStageMetrics(messageId)` (small additive IPC — sole renderer→main call this prompt adds; goes through `electron/ipc/conversations.ts`, exposed in `electron/preload.ts`, mirrored in `src/lib/types.ts`). (d) Per `window.api` guard rule, the chips are optional — if the IPC returns empty or `window.api` is absent, render nothing. | `src/components/chat/StreamingVitalsPill.tsx`, `src/components/chat/StageTokenChips.tsx` (new), `electron/ipc/conversations.ts`, `electron/preload.ts`, `src/lib/types.ts`, `src/components/chat/ChatMessage.tsx` (wire StageTokenChips in) | both tsc · `electron-vite build` · launch via `mcp__Claude_Preview__*` · run a single-agent turn → vitals pill collapsed as today, no stage chips on bubble · run a multi-agent turn → vitals pill expands on click showing 3 rows, bubble shows 3 stage chips · light + dark mode eyeball pass | [ ] |
| RT4 | **`get_conversation_history` model-callable tool** | Add a new tool descriptor to `electron/services/tool-registry.ts`: `name: 'get_conversation_history'`, `riskTier: 'low'`, `requiresApproval: false`, `riskNotes: 'read-only on the active conversation DB rows; never reaches the network'`. Params: `{ conversation_id?: string (default: active), turn_index?: number (single-turn select), limit?: number (default 20, max 200), include_reasoning?: boolean (default true), include_stage_metrics?: boolean (default false), include_tool_calls?: boolean (default false) }`. Implementation reads from `conversation-store` / `messages` table + (when `include_stage_metrics`) the RT2 table; returns a JSON array of `{ turn_index, role, model, content, reasoning?, stage_metrics?, tool_calls? }`. Active-conversation resolution: read from the same store the IPC layer uses; if no active conversation, return `{ error: 'no active conversation' }`. New vitest suite `tool-registry-conversation-history.test.ts`. | `electron/services/tool-registry.ts`, `electron/services/tool-conversation-history.ts` (new — implementation), `electron/services/tool-conversation-history.test.ts` (new), `src/lib/types.ts` (mirror tool result shape if surfaced anywhere) | both tsc · `electron-vite build` · `npx vitest run tool-conversation-history` ✓ · launch + ask the model "use the get_conversation_history tool to summarize my last 3 turns" — model invokes the tool, returns a summary (user-verification-needed if model picks a different path) · tool inventory in DevTools shows the new descriptor with `riskTier: low` | [ ] |
| RT5 | **Reasoning-Trace Viewer panel — shell + per-turn list** | Add a 5th rounded pill subpanel to `src/components/artifacts/RightPanelHome.tsx` titled "Reasoning Trace" (icon: a compact `Footprints` or `History` lucide icon — pick whichever already imports). Clicking opens an expanded drawer (new `src/components/right-panel/ReasoningTraceDrawer.tsx`) sized like the existing drawers (e.g. `Activity`, `Memory`). Drawer body is a vertical scrollable list of turns for the active conversation — one row per assistant turn, showing `turn_index · model · stage count · tokens total · timestamp`. Data source: existing `conversations:listMessages` IPC + RT2's `listStageMetrics`. Per-row click placeholder for RT6 (`onClick` stub logs `selected turn N`). Empty state: "No reasoning yet — start a conversation to populate this view." | `src/components/artifacts/RightPanelHome.tsx`, `src/components/right-panel/ReasoningTraceDrawer.tsx` (new), `src/components/right-panel/index.ts` (new, barrel — only if other right-panel components emerge), `src/lib/types.ts` (any new shared shape) | both tsc · `electron-vite build` · launch · 5th pill renders on right panel · drawer opens + closes · turn list populates from a real conversation · empty-state shows when conversation is empty · light + dark eyeball pass | [ ] |
| RT6 | **Reasoning-Trace Viewer — per-stage expansion + search + stage-filter chips** | Extend `ReasoningTraceDrawer.tsx`: (a) Clicking a turn row toggles a per-turn expansion panel showing three subsections (planner / coder / reviewer) with each stage's reasoning text rendered via the existing `ReasoningBlock` component for visual consistency. Stages with no reasoning render as `(no reasoning recorded for this stage)`. (b) Drawer header gains a search input (`<input type="search">`) that filters turns by free-text match against `content` or `reasoning` — debounced 250ms, case-insensitive. (c) Stage-filter chip cluster (`All / Planner / Coder / Reviewer`) restricts which subsections render in the expansion. (d) URL-style state lives only in component state — no router, no persistence. (e) Reuse `ReasoningBlock` from `src/components/chat/` (R7 component) — do not duplicate. | `src/components/right-panel/ReasoningTraceDrawer.tsx`, `src/components/chat/ReasoningBlock.tsx` (read-only — confirm it accepts a `reasoning` string prop; if not, extract a presentational variant) | both tsc · `electron-vite build` · launch · multi-agent turn expanded → all 3 stages visible · single-agent turn expanded → only the relevant section · search box filters list · stage-filter chips toggle subsections · debounce works (no flicker on rapid typing) · light + dark eyeball pass | [ ] |
| RT7 | **Audit-trail export — markdown + CSV** | Add an "Export audit trail" overflow-menu (or button) to the `ReasoningTraceDrawer` header. Two options: "Markdown (.md)" + "CSV (.csv)". Both open `dialog.showSaveDialog` (main process) via a new IPC channel `reasoning-trace:export` (`electron/ipc/reasoning-trace.ts`, new). Markdown format: one `## Turn N` heading per turn, then `### planner` / `### coder` / `### reviewer` subsections with `**Model:** …`, `**Tokens:** … in / … out`, `**Duration:** …`, then a fenced `reasoning` block + a fenced `content` block. CSV format: one row per (turn, stage) with columns `turn_index, stage, role, model, prompt_tokens, completion_tokens, duration_ms, content_excerpt (first 200 chars), reasoning_excerpt (first 200 chars)`. Export is **active-conversation-only** for v0.8.1. Add a tiny exporter module `electron/services/reasoning-trace-exporter.ts` (new) with `toMarkdown` + `toCsv` pure functions + vitest. Wire renderer → IPC via `window.api.reasoningTrace.export(format)`. | `electron/ipc/reasoning-trace.ts` (new), `electron/services/reasoning-trace-exporter.ts` (new), `electron/services/reasoning-trace-exporter.test.ts` (new), `electron/preload.ts`, `electron/main.ts` (handler registration), `src/lib/types.ts`, `src/components/right-panel/ReasoningTraceDrawer.tsx` | both tsc · `electron-vite build` · `npx vitest run reasoning-trace-exporter` ✓ · launch · export a real multi-agent conversation as .md → opens cleanly in a Markdown viewer · export same as .csv → opens cleanly in Excel/LibreOffice with no malformed rows · cancel-save dialog returns gracefully (no error toast) · CSV escapes commas + quotes + newlines correctly (test covers this) | [ ] |
| RT8 | **DEVLOG + verify + ship** | (a) Write the phase-completion summary in `DEVLOG.md` listing RT1-RT7 with commit SHAs + final vitest count. (b) Bump `package.json` from `0.7.5` → `0.8.1`. Update `CLAUDE.md` "Current State" with a Reasoning-Trace Phase complete bullet (mirror the format of the Panels / Skill Import phases). Update `memory/MEMORY.md` + `memory/project_build_status.md` with the same. (c) Final verify gate: both tsc · `npx electron-vite build` · `npx vitest run` (full suite green) · `npm run lint` (0 errors). (d) Local Windows build: `npm run build:win`. Confirm `.exe` + `.zip` + `.blockmap` + `latest.yml` produced in the worktree's `dist/`. (e) Move all four artifacts into the **primary repo's** `dist/` per `feedback_release_artifacts_in_primary_dist`. (f) Push `feat/reasoning-trace-phase` → `main` (fast-forward merge then `git push origin main`). **Do not push the `v0.8.1` tag** — remote proxy rejects tag pushes; user creates the tag + GitHub Release locally. | `DEVLOG.md`, `package.json`, `CLAUDE.md`, `memory/MEMORY.md`, `memory/project_build_status.md`, `dist/` (artifacts) | both tsc · `electron-vite build` · `npx vitest run` (full suite) ✓ · `npm run lint` 0 errors · `npm run build:win` produces all 4 artifacts · primary `dist/` contains the 4 artifacts · `git log --oneline main` shows the 8 RT commits · `git status` clean | [ ] |

---

## 4. Risks + Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| RT2's schema add creates an `initSchema` migration mismatch on existing DBs | medium | `initSchema` is idempotent (`CREATE TABLE IF NOT EXISTS`); the new table has no FK *requirement* from existing rows. Mitigation: smoke a launch against a pre-existing `lamprey.db` snapshot. |
| RT4's `get_conversation_history` tool surfaces reasoning the user prefers to keep private from the model itself | low | Default `include_reasoning: true` is the right default for the audit use-case the user described, but the tool is callable only when explicitly invoked by the model and never auto-runs. R8 rehydration toggle still governs *implicit* reasoning visibility. |
| RT5/RT6 viewer drawer competes with existing right-panel drawers for vertical space | low | The 4 existing drawers are mutually exclusive (only one open at a time per `RightPanelHome.tsx` interaction model). The 5th drawer joins the same exclusion set. |
| RT7's `.md` export contains raw reasoning that may include PII the user doesn't realize | low | Local-only save dialog. Per the user's audit use-case framing, this is the desired behavior. DEVLOG entry for RT7 should explicitly note "reasoning content is exported verbatim — user controls the destination path." |
| `npm run build:win` fails in the worktree | medium | Per CLAUDE.md, the user's machine is the build host. The build has shipped repeatedly. If it fails, halt at RT8 step (d) and report; do **not** push without artifacts. |
| Vitest count regresses below pre-RT2 baseline | low | Each test-adding prompt explicitly checks the running total. RT8's final verify gate requires `npx vitest run` fully green. |

---

## 5. What this phase explicitly does NOT do

- Does **not** retire or modify R7's per-bubble pill.
- Does **not** modify R8's API stack rehydration toggle.
- Does **not** add a Settings tab for "audit mode" — RT3's vitals expansion + RT5/RT6 viewer are the surfaces.
- Does **not** add cross-conversation export (active conversation only, deferred to a future phase).
- Does **not** add server-side / cloud sync for the audit trail.
- Does **not** rebuild the reviewer's critique semantics — RT1 is format-only.
- Does **not** touch the Snip / Customize / Panels / Skill Import surfaces.
- Does **not** change provider routing or model selection logic.

---

## 6. Acceptance — phase done when

1. All 8 prompts are `[x]` in this document.
2. `DEVLOG.md` has an entry per prompt + a final phase-completion entry.
3. `git log --oneline main` shows 8 commits attributable to this phase.
4. `package.json` reads `"version": "0.8.1"`.
5. Primary repo's `dist/` contains `Lamprey-0.8.1.exe`, `Lamprey-0.8.1.exe.blockmap`, `Lamprey-0.8.1.zip`, `latest.yml`.
6. `npx vitest run` is fully green with at least 3 new test files (RT1, RT2, RT4, RT7 each add or extend a suite).
7. `feat/reasoning-trace-phase` is merged + pushed to `main`. `v0.8.1` tag creation is the user's hand-off.
