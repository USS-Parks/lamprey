# Lamprey Reasoning Audit Phase — Sequential Prompt Roster

**Goal:** stop Lamprey from silently dropping any model-emitted chain-of-thought. After this phase, **every reasoning stream produced by every stage** (Planner, Coder, intermediate tool rounds, Composer, Reviewer) — whether emitted on the provider's native `reasoning_content` channel or inline as `<think>…</think>` — is preserved on disk, surfaced as its own ReasoningBlock pill in the chat, and re-fed into the API stack on follow-up turns so the model can audit its own prior thinking. The user must be able to review and audit the full per-stage thought trail of any past turn, **always**.

**Execution model:** **single session, single worktree off `main`, sequential R1 → R10.** No track-splits. Each prompt builds on the previous one's schema / IPC / DB shape.

**Companion to:** [`LAMPREY_PARITY_PLAN.md`](LAMPREY_PARITY_PLAN.md) (which shipped the pipeline) and [`LAMPREY_LIVE_AUDIT_HARDENING_PLAN.md`](LAMPREY_LIVE_AUDIT_HARDENING_PLAN.md) (event-log audit trail). This phase closes the **per-message reasoning-column** gap left by both.

---

## 0. SESSION BOOTSTRAP — READ THIS FIRST

You are a fresh Claude Code session handed this document. Before doing anything else:

### Step 1 — Confirm environment

Verify:
- Working directory is `C:\Users\17076\Documents\Claude\Lamprey Harness` (or a worktree thereof).
- Current branch is **not** `main` — set up `feat/reasoning-audit` as a worktree off `main` first if it doesn't exist (per `feedback_parallel_session_worktree` memory).
- `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both pass cleanly *before* you start.
- `npx electron-vite build` exits 0.
- `npx vitest run` exits 0 (R1 introduces a schema migration; the existing reasoning + composer test suites must be green before you start so post-prompt regressions are unambiguous).

If any of those fail, halt and report. Do not start on a broken baseline.

### Step 2 — No track question

This is a single linear phase. **Do not ask the user which track** — there is only one path. Confirm with the user that you're starting the Reasoning Audit Phase and proceed.

### Step 3 — Execute R1 → R10 without stopping

1. **Do not ask further questions** unless a prompt requires a decision only the user can make (a real product fork the plan doesn't resolve — e.g. the user has redirected scope mid-phase).
2. **For each prompt, in order:**
   a. Read the "Files (net new / modified)" list. Read existing files first to ground the change in the real code shape — these prompts edit shipped main-process services.
   b. Implement the change. Edit existing files in place; create new files only when the prompt calls for them.
   c. Run the **verify gate** (the "Verify" column). Always: both tsc configs + `npx vitest run` (with the per-prompt added/expanded tests passing) + `npx electron-vite build`. Renderer-touching prompts (R7, R9) also list manual smoke steps; execute them via the preview tools (`mcp__Claude_Preview__*`) where they touch the renderer. Electron-shell-only smoke steps are written into DEVLOG and explicitly marked **"user-verification-needed"** rather than claimed (see `feedback_no_fake_polish` memory).
   d. If verify fails: fix and retry up to **2 times**. On the third failure, halt, write a "blocked" entry to `DEVLOG.md` with the failure context, report to the user.
   e. If verify passes: mark the prompt `[x]` in this document via `Edit`, write a DEVLOG.md entry (see Step 4), then commit (do not push — user pushes per CLAUDE.md and `feedback_push_when_told` memory).
   f. Move to the next prompt.
3. **Do not push to GitHub.** One commit per prompt. The user reviews and pushes.
4. **When all 10 prompts complete:** write a final phase-completion summary in DEVLOG.md listing every shipped prompt with its commit SHA, run a full `npm run build:win` to produce the `.exe` + `.zip` + `.blockmap` + `latest.yml` in primary `dist/` (per `feedback_release_artifacts_in_primary_dist` memory), and announce completion in chat.

### Step 4 — DEVLOG entry format

```markdown
## [Reasoning Audit — Prompt RN] <Title>  —  <YYYY-MM-DD>

**Files changed:** <list>
**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (new/expanded tests: <names>)
- electron-vite build ✓
- <manual smoke steps + result, OR "user-verification-needed: <what to check>">

**Notes:** <anything surprising, deferred, or worth knowing>

**Commit:** <SHA>
```

R5 + R8's entries **must** include a concrete example of the preserved reasoning trail (a screenshot or a quoted DB row) — they are the load-bearing prompts and the rest of the phase amplifies whatever they ship.

### Step 5 — Commit discipline

- One commit per prompt. No batching, no amending across prompts.
- Never use `--no-verify`. If a pre-commit hook fails, fix the underlying issue.
- Never add the `Co-Authored-By: Claude` trailer (per `feedback_no_coauthor_trailer` memory).
- Use the project's commit-message style — e.g. `feat(reasoning): R2 chatOnce returns {content, reasoning}`.

---

## 1. Audit Summary — where reasoning is being dropped today

A direct walk of the streaming + persistence paths against the three live emission paths (provider native channel, inline `<think>` heuristic, multi-round composer rollup) identified eight specific failure modes. Each maps to one or more owner prompts.

| # | Failure mode | Where it happens | Owner prompt |
|---|---|---|---|
| 1 | **`chatOnce` discards reasoning at the SDK boundary.** Only `response.choices[0].message.content` is read; `message.reasoning` and `message.reasoning_content` are never touched. Affects every sub-agent call (Planner + Reviewer) and the Composer's own LLM call. | `electron/services/providers/registry.ts:638-661` | **R2** |
| 2 | **`subAgentRunner` contract is `string`-typed.** Even if `chatOnce` returned reasoning, the runner used by `agent-pipeline.ts` returns plain string. Reasoning can't propagate through `executeMultiAgentRun` / `takeOutput`. | `electron/ipc/chat.ts:521-531`, `electron/services/multi-agent-run-tool.ts` (`takeOutput`) | **R3** |
| 3 | **Planner output is never saved as its own row.** The Planner's text gets folded into the Coder's user prompt as `<plan source="planner">…</plan>` — visible to downstream stages, but no `messages` row exists. There is no Planner Reasoning pill in the chat history, ever. | `electron/services/agent-pipeline.ts:441-449` (plan text never `saveMessage`'d), `buildCoderUserContent()` weaves it inline | **R4** |
| 4 | **Reviewer `saveMessage` omits `reasoning` and `draft`.** Even when the Reviewer emits inline `<think>…</think>` (V4 Pro without thinking mode does — that's why the screenshots show a Reviewer reasoning pill at all), the save call passes neither field. The pill only renders because `splitInlineReasoningWithDraft` runs on `content` server-side. The moment the user switches Reviewer to a native-reasoning model (deepseek-reasoner, V4 Flash thinking mode, DashScope `enable_thinking`), there is no inline block to extract — reasoning is lost. | `electron/services/agent-pipeline.ts:665-671` | **R5** |
| 5 | **Composer-final message carries only the last round's reasoning.** In a multi-round tool turn, intermediate rounds save their own assistant rows with their own `reasoning` (chat.ts:814-822 ✓), but the final composed message at chat.ts:789-798 stores `reasoning: fullReasoning` from the last round only. No unified "everything I thought during this whole turn" artifact exists on the final row. | `electron/ipc/chat.ts:728-798` | **R6** |
| 6 | **Past reasoning is never re-fed to the API on follow-up turns.** When `apiMessages` is rebuilt from DB rows for the next user turn, assistant rows go back in as `{role: 'assistant', content: row.content}`. The `reasoning` column is ignored. The model on the next turn has no programmatic access to its own past chain-of-thought — which is what the *Cascadian Shadow debug-session audit* surfaced as "No session history tool exists." | `electron/ipc/chat.ts` (rehydration path — find `apiMessages` build), `electron/services/conversation-store.ts:583-624` | **R8** |
| 7 | **No `stage` discriminator on saved rows.** Even after R4/R5 land, the renderer has no way to tell Planner/Coder/Reviewer/Composer rows apart at display time — they all read as `role: 'assistant'`. MessageBubble can't show a "Planner" chip next to the model name. | DB schema (`electron/services/database.ts` `messages` table), `MessageRow` type | **R1** (schema) + **R7** (UI) |
| 8 | **Tests don't pin the contract.** `conversation-store-reasoning.test.ts` covers the composer-draft case; no test covers (a) `chatOnce` reasoning round-trip, (b) Planner row save, (c) Reviewer row save with reasoning, (d) per-round reasoning concatenation, (e) reasoning rehydration into the API stack. Any future refactor can silently drop reasoning again. | `electron/services/conversation-store-reasoning.test.ts`, new tests | **R9** |

**Confirmed-still-working paths (do NOT change):**
- Inline `<think>…</think>` extraction in `splitInlineReasoning` / `splitInlineReasoningWithDraft` — this is the only reason the current pipeline shows any Reviewer reasoning at all. R5 *adds* the native-channel path; it does not replace inline extraction.
- The per-round assistant save at chat.ts:814-822 — preserves the round's reasoning even when the composer runs later.
- The `ReasoningBlock` renderer in `src/components/chat/ReasoningBlock.tsx` — unchanged. It just gets called on more rows post-R7.
- `FloatingEnvironmentCard`, the Panels Phase substrate, and every shipped UI surface — this phase touches MessageBubble only.

**Non-goals (this plan):** no new providers, no new tools, no new skills/connectors/plugins, no theme work, no chrome changes outside MessageBubble's optional stage chip, no migration of the Composer or per-stage prompts, no streaming-vitals changes.

---

## 2. Architectural Invariants — Locked

These apply across all 10 prompts. Treat as binding.

1. **Reasoning is data, not chrome.** Every prompt's job is to make sure the byte stream reaches the `reasoning` column. Display is downstream of that.
2. **No silent truncation.** If reasoning has to be capped (e.g. R6's concatenated final), the cap MUST be (a) explicit (named constant), (b) honest (the final row includes a `[truncated for length — N kb omitted]` marker), (c) wide (≥ 64 kb default — chain-of-thought is the most audit-load-bearing thing the model produces). Per `feedback_no_fake_polish`: silent truncation reads as "covered everything" when it didn't.
3. **Schema migration is forward-only.** R1 adds `stage TEXT` to `messages`. No backfill (existing rows = NULL = "single" semantic). No schema drop. Existing readers see NULL and render unchanged.
4. **Inline `<think>` extraction stays.** R5 / R6 ADD native-channel propagation; they do not remove the inline path. Models that emit `<think>` inline (Gemma, Qwen, V4 Pro without thinking mode) must continue working through `splitInlineReasoningWithDraft`.
5. **`chatOnce` return shape change is internal.** No IPC channel change. The renderer never calls `chatOnce` directly. Only main-process callers (composer, subAgentRunner, tests) destructure the new return shape.
6. **No regression to single-agent mode.** Single-agent runs (no pipeline, composer off) must continue producing exactly one assistant row per turn with reasoning on the existing `reasoning` column. R5/R6/R4 changes are pipeline-conditional or composer-conditional.
7. **R8 (reasoning rehydration into API) is gated.** New setting `includePastReasoningInContext` (default `true`). When off, behavior matches today exactly. Document the token-cost trade-off in the Settings panel copy.
8. **Per `feedback_no_fake_polish`:** if a smoke step cannot be exercised via `mcp__Claude_Preview__*` (e.g. validating a Reviewer reasoning pill round-trip requires the full Electron + API key + multi-agent pipeline running against a real model), it is written into DEVLOG as `user-verification-needed`, never claimed. R5 + R8 are the most likely candidates here.
9. **Default rendering choice for Planner rows is HIDDEN, attached to next Coder/Composer bubble via "Show pipeline trace" toggle.** Per explicit user direction (2026-06-06): R4 saves Planner rows with `stage: 'planner'` exactly as before — the row exists in the DB and is fully audit-accessible — but R7 does NOT render Planner rows as their own bubbles. Instead, MessageList attaches each Planner row to the next downstream Coder/Composer assistant bubble (matched by created_at order within the conversation), and the Coder/Composer bubble grows a small **"Show pipeline trace ▾"** toggle. Click reveals an inline-collapsed panel under the bubble's body containing the attached Planner's ReasoningBlock + plan text. Reviewer rows render as their own bubbles with a "Reviewer" stage chip (visible by default — they're a meaningful second-opinion artifact). Composer rows render as their own bubbles with a muted "Composer" chip. This decision is locked.
10. **Reviewer hallucination of inline `<bash>` blocks is OUT OF SCOPE.** That is a prompt / system-prompt issue (the Reviewer thinks it can call shell from inside its response), not a reasoning-preservation issue. Note in DEVLOG R10 as follow-up work; do not attempt to fix in this phase.

---

## 3. The Ten Prompts

### Prompt sequence

| # | Prompt | One-liner | Files (net new / modified) | Verify | Status |
|---|---|---|---|---|---|
| R1 | **Schema: add `stage` column to `messages`** | `ALTER TABLE messages ADD COLUMN stage TEXT` in the migration runner. No backfill (NULL = "single" semantic). Extend `MessageRow` + the exported `Message` type with optional `stage?: 'planner' \| 'coder' \| 'reviewer' \| 'composer'`. Extend `saveMessage` signature to accept `stage?: string` and pass through to the INSERT. Existing callers ignore it; the column stays NULL for them. Wire through preload + renderer types (`src/lib/types.ts`) but DO NOT yet display anything — R7 owns rendering. | `electron/services/database.ts` (migration), `electron/services/conversation-store.ts` (`saveMessage` + `MessageRow` + `getMessages` map), `electron/preload.ts` (Message type), `src/lib/types.ts` | both tsc · vitest (existing reasoning tests still green) · `electron-vite build` · launch · new conversation works · no visual change · DevTools: db inspector shows new column on next save | [x] |
| R2 | **`chatOnce` returns `{content, reasoning}`** | Change signature from `Promise<string>` to `Promise<{ content: string; reasoning?: string }>`. Read `response.choices[0]?.message?.reasoning` AND `response.choices[0]?.message?.reasoning_content` (some providers use the latter name on non-streamed responses). Return reasoning trimmed; `undefined` when empty. Update the four call sites: (a) composer runner in `chat.ts:754-755`, (b) `subAgentRunner` in `chat.ts:521-531`, (c) any test that mocks chatOnce, (d) `final-response-composer.ts` `composeFinalResponse` runner contract (`Promise<string>` → `Promise<{content, reasoning?}>`; the composer's *own* reasoning gets stashed alongside its output for R6's concat). Add a new vitest case asserting both `message.reasoning` and `message.reasoning_content` are read. | `electron/services/providers/registry.ts` (`chatOnce`), `electron/services/final-response-composer.ts` (runner contract + return shape), `electron/ipc/chat.ts` (two call sites), `electron/services/final-response-composer.test.ts` (new case) | both tsc · vitest (new chatOnce reasoning case green; existing composer tests still green) · `electron-vite build` · single-agent turn against deepseek-reasoner works · single-agent turn against V4-Pro-without-thinking works | [x] |
| R3 | **`subAgentRunner` propagates `{output, reasoning}`** | Update `executeMultiAgentRun`'s task-result shape to include `reasoning?: string`; update `takeOutput` to return `{output, reasoning, error}`. Update `agent-pipeline.ts`'s caller signature `opts.subAgentRunner` from `(messages, model, signal) => Promise<string>` to `Promise<{output: string; reasoning?: string}>`. Update `chat.ts:521-531` to forward the destructured reasoning. **Do not yet save** — R4 + R5 are the save sites. Add a vitest for `takeOutput` confirming reasoning passes through. | `electron/services/multi-agent-run-tool.ts` (+ its test), `electron/services/agent-pipeline.ts` (subAgentRunner type + call-site destructure at planner + reviewer takeOutput), `electron/ipc/chat.ts` (subAgentRunner closure now returns object) | both tsc · vitest (new takeOutput case green) · `electron-vite build` · launch · pipeline turn runs end-to-end with no behavior change yet (reasoning is captured but not persisted — that's R4/R5) | [x] |
| R4 | **Save the Planner as its own row with `stage: 'planner'`** | Add a `convStore.saveMessage` call right after `stageDone('planner', …)` in `agent-pipeline.ts`. Row shape: `role: 'assistant'`, `content: planText`, `model: roster.planner`, `reasoning: <from R3 destructure>`, `stage: 'planner'`. Emit a `chat:planner-message` chat-event so the renderer can stream it in. Renderer-side: just persist it via the existing `chat:done`-like handler. **Do NOT yet show a stage chip** — R7 owns that. Make sure the Planner row's `created_at` is before the Coder row's (R3 saves before Coder runs ✓). Update `executeMultiAgentRun` reviewer-context summarization so it doesn't double-count the Planner row in the summary (it's already in the Coder's user prompt as `<plan source="planner">`). | `electron/services/agent-pipeline.ts` (planner save), `electron/services/chat-events.ts` (new event type or reuse `chat:done`), `electron/ipc/chat.ts` (event subscription if new) | both tsc · vitest (new agent-pipeline test: planner row written) · `electron-vite build` · launch · multi-agent turn produces 2 assistant rows in db (planner + coder) instead of 1 · planner row carries reasoning if model emits it · single-agent turn still produces exactly 1 row · **user-verification-needed:** end-to-end multi-agent turn against deepseek-reasoner as Planner — confirm reasoning saved | [x] |
| R5 | **Save the Reviewer's reasoning** | At `agent-pipeline.ts:665-671`, change the `saveMessage` call to pass `reasoning: takenReasoning` (from R3's destructure) and `stage: 'reviewer'`. Same `draft` handling as the composer path — if the Reviewer body has inline `<think>`, `splitInlineReasoningWithDraft` recovers it; if the native channel populated `taken.reasoning`, that takes precedence (per the existing `splitInlineReasoning` contract). Verify both paths via new vitest: (a) Reviewer emits inline `<think>` → recovered, (b) Reviewer emits native reasoning_content → preserved without inline. | `electron/services/agent-pipeline.ts` (reviewer save), new vitest in `electron/services/agent-pipeline.test.ts` (or extend existing) | both tsc · vitest (new reviewer-reasoning cases green) · `electron-vite build` · launch · **multi-agent turn against V4-Pro (inline) as Reviewer → reasoning pill shows** · **user-verification-needed:** multi-agent turn against deepseek-reasoner as Reviewer (native channel) → reasoning pill shows post-fix, was empty pre-fix | [x] |
| R6 | **Cumulative reasoning concat on composer-final + composer's own reasoning preserved** | When the composer runs (`chat.ts:739-798`), instead of storing `reasoning: fullReasoning` (last round only), build a concatenated string from `roundReasonings` collected across the run: `roundReasonings.filter(Boolean).map((r, i) => '--- round ' + (i+1) + ' ---\n' + r).join('\n\n') + '\n\n--- composer ---\n' + composerReasoning`. Cap the concat at `MAX_REASONING_BYTES = 65536` (named export); if over, truncate with a `\n\n[truncated for length — N kb omitted]` marker (per Invariant §2.2). Store the row with `stage: 'composer'`. Maintain `roundReasonings: string[]` in `runChatRound`'s closure / pass through args. The composer's own reasoning comes from R2's `chatOnce` return. **Intermediate per-round rows still save with their own reasoning** — this is additive, the final row gets the full trail. | `electron/ipc/chat.ts` (round-reasoning collection + final concat), `electron/services/final-response-composer.ts` (export `MAX_REASONING_BYTES` + helper `concatReasoningTrail(rounds, composer)` + tests), `electron/services/final-response-composer.test.ts` (new cases: empty rounds, one round, many rounds, over-cap truncation) | both tsc · vitest (concat helper cases green) · `electron-vite build` · launch · multi-round tool turn → final composed message reasoning pill shows the full round-by-round trail with separators · over-cap turn → truncation marker visible | [x] |
| R7 | **MessageBubble: stage chip + Planner-trace toggle on Coder bubble** | Per Invariant §2.9 (revised 2026-06-06): Planner rows are HIDDEN by default and attached to the next downstream Coder/Composer bubble. Concretely: (a) `MessageList.tsx` walks rows; when it encounters `stage: 'planner'`, it does NOT emit a `<MessageBubble>` for it — instead it stashes the row and passes it as a new `attachedPlannerRow?: Message` prop to the next assistant bubble where `stage` is NULL / `'coder'` / `'composer'`. (b) `MessageBubble.tsx` reads `attachedPlannerRow` — if present, renders a small **"Show pipeline trace ▾"** button under the body content area (above the existing tool-call cards / footer). Click toggles an inline collapsed panel containing the Planner's `ReasoningBlock` + plan text body, styled as a tonal-lift block (no border, per Panels Phase invariants). (c) Reviewer rows render as their own bubbles with a small "Reviewer" chip next to the model name (purple). Composer rows render with a muted "Composer" chip. Coder/single rows get no chip (default). (d) Chip styling matches existing model-pill convention (subtle, not bordered). `ReasoningBlock` itself is unchanged. Light + dark eyeball both pass. **No layout shift** for rows without `attachedPlannerRow` — the toggle only appears when one is attached. | `src/components/chat/MessageBubble.tsx`, `src/components/chat/MessageList.tsx`, `src/lib/types.ts` (if `Message.stage` typing not yet plumbed from R1) | both tsc · `electron-vite build` · preview-tools snapshot: (i) single-agent turn → no chips, no toggle (parity), (ii) multi-agent turn → Coder bubble shows "Show pipeline trace ▾" toggle, click reveals Planner reasoning + plan; Reviewer bubble below carries "Reviewer" chip · light + dark eyeball both pass · `user-verification-needed:` end-to-end real multi-agent turn in Electron behaves per design | [x] |
| R8 | **Re-feed past reasoning to the API on rehydrate (gated)** | Add setting `includePastReasoningInContext: boolean` (default `true`). When rebuilding `apiMessages` from DB rows for the *next* user turn, if the assistant row carries `reasoning` AND the setting is on AND the row's content does NOT already start with `<think>`, prepend `<think>${row.reasoning}</think>\n\n` to the content sent in the API message. This makes the model on the next turn able to see its own prior chain-of-thought (closing the "no session history tool exists" gap surfaced by the Cascadian Shadow audit). Per-stage rows are included on the same rule (Planner row's reasoning → the next Planner turn benefits). Document the token-cost trade-off. Setting persists via `AppSettings`. | `electron/ipc/chat.ts` (apiMessages rebuild), `electron/services/conversation-store.ts` (if buildApiMessages lives there), `src/stores/settings-store.ts` (+ `AppSettings` type), `electron/services/settings-store.ts` (default + load) | both tsc · vitest (new case: rehydrated messages carry `<think>` blocks when setting on, don't when off) · `electron-vite build` · launch · follow-up turn after a multi-agent turn → the new turn's prompt (visible via `chat:reasoning` event log or model-request audit) contains the prior reasoning · toggle off → no `<think>` prepended | [x] |
| R9 | **Tests + Settings UI** | Add a settings panel section "Reasoning audit" with one toggle: "Include past reasoning in API context (uses more tokens)". Wire to `includePastReasoningInContext`. Default-on copy. Also add the comprehensive test suite this phase has been deferring: end-to-end test that simulates a 3-stage pipeline turn against mocked providers (one emitting inline `<think>`, one emitting native `reasoning_content`) and asserts: planner row saved with reasoning, coder row saved with reasoning, reviewer row saved with reasoning, all carry correct `stage` value, final composer row (if composer ran) has cumulative concat. Asserts on DB rows directly via `getMessages`. | `src/components/settings/AgenticCodingSettings.tsx` (or new `ReasoningSettings.tsx`), `electron/services/agent-pipeline.test.ts` (new end-to-end case), `electron/services/conversation-store-reasoning.test.ts` (expanded) | both tsc · vitest (new end-to-end case green; full reasoning suite green) · `electron-vite build` · launch · open Settings → Reasoning audit panel renders · toggle persists across launches | [x] |
| R10 | **Phase wrap: version bump, devlog summary, memory + CLAUDE.md update, .exe build** | Close out the phase. Bump `package.json` `0.7.5 → 0.8.0` (new schema column + new IPC behavior + reasoning preservation = minor bump, not patch). Write `## Reasoning Audit Phase complete` summary in DEVLOG.md listing all 10 prompts with commit SHAs and a concrete before/after example (DB row snippet showing planner reasoning preserved). Update `memory/project_build_status.md` adding a Reasoning Audit row. Update `CLAUDE.md` "Current State" section: add Reasoning Audit bullet citing this plan as reference-only; update execution rule §1 wording to add "Reasoning Audit Phase" to the shipped-phases list. Update `memory/MEMORY.md` Build status line to include Reasoning Audit Phase + v0.8.0. Run `npm run build:win` and move the `.exe` + `.blockmap` + `.zip` + `latest.yml` into the primary repo's `dist/` (per `feedback_release_artifacts_in_primary_dist` and `feedback_execute_dont_ask` memories). Announce ready-for-push to the user. | `package.json`, `DEVLOG.md`, `memory/project_build_status.md`, `CLAUDE.md`, `memory/MEMORY.md`, primary `dist/` populated | both tsc · vitest · `electron-vite build` · `npm run build:win` produces full set in primary `dist/` · `git status` clean after commit · plan officially reference-only · ready for user push | [x] |

### Phase completion criteria

- All 10 prompts marked `[x]`.
- 10 commits on the `feat/reasoning-audit` worktree branch.
- `npx tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean.
- `npx vitest run` exits 0 with the new + expanded tests passing.
- `npx electron-vite build` exits 0.
- **Manual end-to-end smoke (user-verification-needed):** launch Electron, run a multi-agent turn (Planner + Coder + Reviewer) where at least one stage uses a **native-reasoning model** (deepseek-reasoner, V4 Flash thinking mode, or DashScope `enable_thinking`). Confirm in the chat thread: a Planner row with a "Planner" chip and its own Reasoning pill appears; the Coder row carries its existing Reasoning pill; the Reviewer row carries a "Reviewer" chip and its own Reasoning pill. Reload the conversation — all three pills survive. Send a follow-up turn — the model demonstrates awareness of its prior thinking (toggle `includePastReasoningInContext` off and confirm the awareness disappears).
- `DEVLOG.md` has 10 prompt entries + one phase-completion summary with a concrete before/after DB row example.
- `package.json` version is `0.8.0`.
- Primary `dist/` carries the new release artifact set (.exe + .blockmap + .zip + latest.yml).

---

## 4. Quick-Reference Tables

### Reasoning flow by stage (post-phase)

| Stage | Emission path | Captured by | Saved row's `reasoning` | Saved row's `stage` |
|---|---|---|---|---|
| Planner (sub-agent, R3+R4) | native `message.reasoning` OR inline `<think>` | `chatOnce` (R2) → `subAgentRunner` (R3) → `agent-pipeline.ts` save (R4) | yes | `'planner'` (saved row hidden by default; attached to next Coder/Composer bubble behind "Show pipeline trace" toggle per Invariant §2.9) |
| Coder, intermediate rounds | streaming `onReasoning` + `onChunk` inline | `runChatRound` `fullReasoning` accumulator | yes (per round, into the round's own assistant row) | NULL (default = single) |
| Coder, final composed | last-round streaming + composer-rewrite | round trail concatenated (R6) + composer's own from `chatOnce` (R2) | yes — cumulative concat with `--- round N ---` separators, capped at `MAX_REASONING_BYTES` (R6) | `'composer'` (when composer ran) OR NULL |
| Reviewer (sub-agent, R3+R5) | native `message.reasoning` OR inline `<think>` | `chatOnce` (R2) → `subAgentRunner` (R3) → `agent-pipeline.ts` save (R5) | yes | `'reviewer'` |

### Surfaces touched

| Layer | Files touched |
|---|---|
| DB / schema | `electron/services/database.ts` (R1 migration), `electron/services/conversation-store.ts` (R1 saveMessage + getMessages + types) |
| Provider SDK boundary | `electron/services/providers/registry.ts` (R2 chatOnce) |
| Pipeline | `electron/services/agent-pipeline.ts` (R3 subAgentRunner type + R4 planner save + R5 reviewer save), `electron/services/multi-agent-run-tool.ts` (R3 takeOutput) |
| Composer | `electron/services/final-response-composer.ts` (R2 runner contract + R6 concat helper + MAX_REASONING_BYTES) |
| Main-process orchestration | `electron/ipc/chat.ts` (R2 call sites + R3 closure + R6 round trail + R8 rehydration) |
| IPC / preload / types | `electron/preload.ts` (Message type + new chat event if R4 adds one), `src/lib/types.ts` |
| Renderer | `src/components/chat/MessageBubble.tsx` (R7 stage chip), `src/stores/settings-store.ts` (R8 setting), `src/components/settings/*` (R9 panel) |
| Tests | `electron/services/conversation-store-reasoning.test.ts` (expanded), `electron/services/final-response-composer.test.ts` (expanded), `electron/services/multi-agent-run-tool.test.ts` (new takeOutput case), `electron/services/agent-pipeline.test.ts` (new end-to-end multi-agent case) |
| **Explicitly untouched** | `src/components/chat/ReasoningBlock.tsx` (unchanged — gets called on more rows, no internal change), `FloatingEnvironmentCard`, every Panels Phase substrate file, every model-streaming provider adapter beyond `registry.ts` |
| Phase wrap | `package.json`, `DEVLOG.md`, `CLAUDE.md`, `memory/MEMORY.md`, `memory/project_build_status.md`, primary `dist/` |

### What stays as it is (explicit do-not-touch list)

1. **Inline `<think>` extraction** (`splitInlineReasoning` + `splitInlineReasoningWithDraft`). The only reason any Reviewer reasoning shows up today. R5 *adds* the native-channel path; inline stays.
2. **Per-round intermediate assistant saves** at `chat.ts:814-822`. Each round already saves its own reasoning ✓ — R6 adds the cumulative roll-up on the composer-final row; it does NOT delete or alter the per-round rows.
3. **`ReasoningBlock.tsx`** — zero internal changes. R7 only causes it to render on more rows by virtue of more rows having reasoning.
4. **Streaming events** (`chat:reasoning`, `chat:chunk`, `chat:streaming-vitals`) — unchanged. The phase is about persistence and rehydration, not live streaming.
5. **`FloatingEnvironmentCard`** — preserved entirely (carried forward from Panels Phase invariants).
6. **Existing model-streaming provider adapters** (DeepSeek, Gemma, Qwen streaming paths) — unchanged. R2 only touches the non-streamed `chatOnce` SDK call boundary.
7. **The Reviewer hallucinating inline `<bash>` blocks** — OUT OF SCOPE (Invariant §2.10). Note in DEVLOG R10 as follow-up.
8. **`event-log` / `recordEvent` / Live Audit Hardening surface** — that phase covers the cross-cutting event audit trail. This phase covers per-message reasoning columns. The two are complementary; neither touches the other.

---

## 5. Risk / unknown register

Items the implementer should flag in DEVLOG if they surface during a prompt and adjust scope on:

1. **`chatOnce` response shape variance.** Different providers (DeepSeek, OpenRouter, DashScope) may populate `message.reasoning` vs `message.reasoning_content` vs neither inconsistently. R2's test should cover both names; if a provider proves to need a third name, add it.
2. **R6's cap (`MAX_REASONING_BYTES = 65536`).** Chosen as a generous-but-finite ceiling. If real-world multi-round turns routinely exceed this, raise the cap or surface a per-round drill-down in R7's UI. Do NOT silently drop on overflow.
3. **R8's token cost.** Rehydrating reasoning into the API stack inflates context measurably. Setting defaults to `true` per audit-priority; if it makes any real model hit context limits during normal use, the default flips to `false` in a follow-up and the setting is surfaced more prominently in the Settings panel.
4. **R4's "hidden Planner row" decision is locked** (Invariant §2.9, revised 2026-06-06). Planner rows are saved (R4 unchanged) but R7 attaches them to the next Coder/Composer bubble behind a "Show pipeline trace ▾" toggle. If the implementer feels the attachment logic gets messy (e.g. a Planner row whose downstream Coder bubble never lands because the Coder aborted), the fallback is: orphan Planner rows render as their own bubble with the chip after a 2s grace period — not lost. Document any such edge case in DEVLOG R7.
5. **Backwards compatibility on rehydration.** If a user has pre-phase conversations with reasoning columns populated, R8 will start prepending `<think>` blocks to their content on follow-up. This is desired (the whole point of R8) — but worth noting in DEVLOG R8 as a behavioral change for existing data, not a bug.

---

## 6. Out of scope (acknowledged follow-ups)

These were considered and explicitly deferred. Note in DEVLOG R10 as follow-up work.

- **Reviewer hallucinating inline `<bash>` blocks as prose.** System-prompt issue, not reasoning-preservation. Belongs in a prompt-tuning pass.
- **`get_conversation_history` model-callable tool.** Adjacent to R8 (which gives the model access to its prior reasoning via API stack rehydration). A first-class tool would let the model explicitly ask "show me turn N's reasoning" — useful but additive.
- **A unified Reasoning-Trace Viewer panel in the right sidebar.** Could surface every stage's reasoning for a turn in one inspector, with search/export. R7 ships the per-bubble pill; a dedicated viewer is a future polish.
- **Reasoning export / audit-report generation.** Right now reasoning lives in DB rows + chat UI. An "export full audit trail" button (CSV / markdown) would be valuable for genuine review use cases — out of scope here.
- **Per-stage token-cost accounting.** The streaming-vitals pill shows whole-turn tokens; a per-stage breakdown would help cost-aware users decide whether to enable R8's rehydration toggle. Future Settings panel polish.
