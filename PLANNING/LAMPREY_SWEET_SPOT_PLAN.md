# LAMPREY_SWEET_SPOT_PLAN.md — Sweet Spot Phase (SP-0 … SP-12)

**Status: DRAFT — awaiting explicit user approval. No code changes until green light (STS).**

Drafted 2026-06-10 from a four-track deep audit of the v0.12.0 codebase (prompt surfaces,
runtime machinery, defaults/router, UI chrome) on worktree `hardcore-swanson-5561d9`.

---

## §0 Conventions (verify gate + discipline)

Same discipline as L/HY/CR phases:

1. **Verify gate per prompt:** `npx tsc --noEmit -p tsconfig.node.json` + `npx tsc --noEmit -p tsconfig.web.json` + targeted vitest for touched modules. Full `npx vitest run` + `npx electron-vite build` + `npm run verify:proof -- --no-tests` at SP-11.
2. **Commit per prompt:** `fix(sweetspot): SP-N <summary>` (or `feat`/`docs` as fits). No co-author trailer.
3. **DEVLOG entry per prompt** in the established format.
4. **No pushes mid-phase.** Push + Bucket land at SP-12 per the STS convention.
5. Worktree: this phase runs on `claude/hardcore-swanson-5561d9` (current worktree) unless the user redirects.

---

## §1 Goal

Lock Lamprey to its declared target: **functional and aesthetic parity with Claude Code in
the Opus 4.5 era (2025-11-24 → 2026-01-24)** — and make the default experience work the way
that product did: a **single agent** with a thin prompt, its **full tool set**, a verify
loop, and **no machinery chrome** between the user and the model's answer.

Two workstreams, one phase:

- **A. Era fidelity:** the Claude Code of that era had *no* planner→coder→reviewer pipeline
  on by default, *no* proof-gate pill, *no* second-model composer rewriting the reply, *no*
  stage chips. Quality came from the model + read-before-edit + verify. Lamprey's power
  machinery stays available — but **opt-in, not default**.
- **B. Flawless operation:** close every confirmed defect the audit surfaced (defaults sync
  bug, dead watchdog kick, unbounded spill directory, ghost-reply paths, sticky mutation
  flag, missing telemetry IPC, silent test-skip opacity).

**Honest ceiling, stated once:** Lamprey drives DeepSeek V4 / Gemma / Qwen. This phase makes
the *harness* era-identical and defect-free; it cannot make those models produce Opus 4.5
outputs. Everything the harness can contribute — thin prompts, clean tool surfaces, zero
self-inflicted friction — this phase delivers.

---

## §2 Audit evidence (what is actually wrong, with locations)

### Confirmed defects
| # | Defect | Evidence |
|---|---|---|
| D1 | **agentMode default mismatch** — renderer default `'auto'` (`src/stores/settings-store.ts:22`) vs main-process IPC default `'single'` (`electron/ipc/settings.ts:41`). Fresh installs behave differently depending on which path reads first. | Defaults audit |
| D2 | **StageInactivityWatchdog.kick() unwired** — `kick()` exists (`agent-pipeline-safety.ts:206-240`) but is only called from `armStage()`. No call from stream chunks, reasoning events, or tool results. A *progressing* stage trips the stall timer whenever `stageInactivityMs > 0`. Already admitted in CR_AFTER §6. | Pipeline audit |
| D3 | **Spill files never GC'd** — `maybeSpillToolResult()` writes `userData/tool-results/<uuid>.txt` (`tool-result-spill.ts:66-77`); zero deletion call sites anywhere. Directory grows unbounded. | Pipeline audit |
| D4 | **Mutation flag never cleared** — `markMutationAttempted(conversationId)` (chat.ts:1567) is never reset, so one mutating turn arms the proof gate for every later rigor-keyword turn in that conversation. | Pipeline audit |
| D5 | **Ghost-reply paths** — if `buildSystemPrompt()`/`buildDispatchTools()` throws pre-stream, or a multi-agent run throws with **no** mutations, the user message persists with no assistant/system reply; only a toast fires (chat.ts:732-755 outer catch persists nothing). | Pipeline audit |
| D6 | **Router telemetry IPC missing** — CR-3 documented "IPC exposed, surface TBD"; the audit found the ring buffer (`router-telemetry.ts:30-56`) but **no IPC handler at all**. The diagnostic is unreachable. | Pipeline + defaults audits |
| D7 | **Silent test-skip opacity** — the better-sqlite3 NODE_MODULE_VERSION skips (123 suites) are invisible in `verify:proof` output; this is the open v0.9.2 follow-up that already bit once (schema bootstrap P0). | CLAUDE.md history + pipeline audit |

### Era-fidelity divergences (default-on today, no Claude Code analog in the era)
| # | Divergence | Evidence |
|---|---|---|
| E1 | `agentMode` effective default fans out to the planner→coder→reviewer pipeline on build/refactor/long asks. Claude Code of the era: always single agent (+ subagents as tools). | Defaults audit, router rules 2–7 |
| E2 | `proofGate` defaults `'rigor'` — "Untrusted completion"/"Blocked completion" banners with **raw contract ids + receipt ids** rendered to the user (`ProofGateBanner.tsx:101-103`). No era analog. | UI audit |
| E3 | **Composer rewrites the model's final reply** through a second model pass on any tool-using turn (composer gate fires at round ≥ 1, chat.ts:1016-1080). The era product never rewrote the model's answer. Latency + voice distortion + the model's own reply demoted to a `draft` column. | Pipeline audit |
| E4 | `toolSurface` defaults `'lazy'` — model must `tool_search`→unlock beyond a 12-tool core. Era Claude Code sent its full native set every turn. Weak models burn rounds on unlock round-trips. | Defaults audit |
| E5 | Raw harness internals user-visible: "planner/coder/reviewer" lowercase stage names (`AgentRunBanner.tsx:88`), "Planner (orphan)" chip (`MessageBubble.tsx:209-223`), contract/receipt ids (E2), CR-2 system notice rendered as a normal assistant-style bubble. | UI audit |

### Healthy and era-correct (no action)
Panels/substrate aesthetic (P-phase), @file mention, # memory, ESC history, Shift+Tab mode
cycle, inline approval chips, tool-card auto-collapse, status-line context %, chapters,
ReasoningBlock, lineage chip, Snip filter, RAG, Skills/Connectors/Plugins surface, Deep
Research (claude.ai-era analog), timeouts panel. Prompt surfaces are already thin
(coding-mode 4,039 B; reviewer 695 B) with byte guards locked — keep, do not regrow.

---

## §3 Scope / Non-goals

**In scope:** defaults realignment to era behavior; the seven defects; UI label/chrome
cleanup; playbook re-grade; docs + ship.

**Non-goals (explicitly out):**
- **No feature removal.** Multi-agent, proof harness, composer, lazy surface, reasoning
  trace, research — all stay in the codebase as opt-in power features. This phase moves
  *defaults and gates*, not functionality. (Lowest risk; zero capability nerf.)
- No new post-era Claude features (adaptive thinking analogs, effort params, etc.).
- No provider/model changes, no DB migrations beyond what defects require (none expected).
- F8 `apply_patch` reliability and AskUserQuestion option-cap stay deferred (per CR plan §3).

---

## §4 Decision register (stances taken — amend before STS if you disagree)

| # | Decision | Stance | Rationale |
|---|---|---|---|
| K1 | `agentMode` default | **`'single'`** (everywhere; fixes D1 by unifying on one shared constant) | Era fidelity. Claude Code never auto-fanned to a pipeline. `'auto'`/`'multi'` remain one click away in Settings → Agents. Router + its CR-4 lock tests stay intact for auto mode. |
| K2 | `proofGate` default | **`'off'`** | Era fidelity; with K1 the rigor signal rarely fires anyway. `'rigor'`/`'always'` stay for power users. |
| K3 | Composer default | **`'never'`** unless `agenticCodingMode` is explicitly ON (then honor its `agenticCodingComposer` setting) | The era product's reply was the model's reply. Kills a whole second-model pass per coding turn. |
| K4 | `toolSurface` default | **`'full'`** | Era fidelity + fewer round-trips for weak models. `'lazy'` stays opt-in for MCP-heavy setups. |
| K5 | Machinery UI chrome | Keep components; they already render only when their producers fire. With K1–K3 the default experience shows none of them. Plus: neutral labels + strip raw ids (SP-7). | Cheapest path to an era-clean default screen. |
| K6 | Project conventions block + CR-8/CR-9 coder bullets | **Keep verbatim** | Evidence-backed (LL playbook F1/F7/F9/F13); equivalent to era CLAUDE.md project memory. Not torture. |

---

## §5 Roster

### SP-0 — Baseline snapshot
Write `PLANNING/SP_BASELINE.md`: defaults table (both sources), byte sizes, the §2 tables
verbatim, current vitest pass/skip counts. No code. **Verify:** n/a. Commit docs.

### SP-1 — Single source of truth for defaults + era values
Extract one `DEFAULT_APP_SETTINGS` shared by `src/stores/settings-store.ts` and
`electron/ipc/settings.ts` (closes D1). Set: `agentMode: 'single'`, `proofGate: 'off'`,
`toolSurface: 'full'`. Migration note: only applies to unset keys — existing users'
explicit settings untouched. Update defaults-related tests; add a parity test asserting
renderer and main defaults are identical objects.
**Files:** settings-store.ts, electron/ipc/settings.ts, src/lib/types.ts (doc comments), tests.

### SP-2 — Composer to opt-in (K3)
Composer gate consults `agenticCodingMode && agenticCodingComposer !== 'never'` before
`resolveComposerGate`. Default path: the model's final round text persists as the reply
(stage tag absent). Existing composer tests gain the gating case.
**Files:** electron/ipc/chat.ts (composer gate ~1016), final-response-composer tests.

### SP-3 — Proof-gate dormancy correctness
(a) Clear/scope `mutationAttempted` per turn (key by correlationId or clear at turn start)
— closes D4. (b) With `proofGate: 'off'`, assert no contract synthesis, no receipts scan,
`proofStatus` stays undefined (extend HY5/CR-5 tests).
**Files:** electron/services/proof-rigor.ts, chat.ts wiring, tests.

### SP-4 — Ghost-reply guards (D5)
Outer catch in `chat:send` persists a `role:'system'` message ("This turn failed before a
reply could be generated: <error>") whenever the user message was saved but no
assistant/partial/system row landed this turn. Cover: pre-stream throw, multi-agent
no-mutation throw, instant stream failure with no partial. Tests for each path.
**Files:** electron/ipc/chat.ts (732-755 + helpers), conversation-store test.

### SP-5 — Watchdog kick wiring (D2)
Thread `watchdog.kick` into the pipeline's stream callbacks (chunk/reasoning) and
tool-result completion events so in-stage progress resets the timer. Test:
progressing-stage-does-not-fire; idle-stage-fires.
**Files:** electron/services/agent-pipeline.ts, agent-pipeline-safety.ts, chat.ts arm sites, tests.

### SP-6 — Spill GC (D3)
Startup sweep deleting spill files older than 7 days; delete a conversation's spilled refs
opportunistically when the conversation is deleted; size cap (e.g. 256 MB, oldest-first).
**Files:** electron/services/tool-result-spill.ts (+ main.ts startup hook), tests.

### SP-7 — UI era pass (E5 + K5)
(a) Title-case neutral labels: AgentRunBanner stages → "Planning / Writing code /
Reviewing"; stage chips keep names but Title Case; "Planner (orphan)" → "Plan".
(b) ProofGateBanner: remove raw contractId/receiptIds from visible copy (move to `title`
tooltip); plain-English summary stays. (c) CR-2/SP-4 `role:'system'` rows render as a
muted system-notice style, not an assistant bubble.
**Files:** AgentRunBanner.tsx, MessageBubble.tsx, ProofGateBanner.tsx, MessageList.tsx, styles.

### SP-8 — Router telemetry closure (D6)
Add the missing `router:getRecentDecisions` IPC + preload surface; expose it inside the
existing "After action" right-panel view (one list, no new pill). Router still only runs
under `agentMode: 'auto'`.
**Files:** electron/ipc/ (new handler), preload.ts, After-action component, tests.

### SP-9 — verify:proof skip transparency (D7)
`verify:proof` (and `verify:all`) print an explicit `SKIPPED: <n> suites (better-sqlite3
NODE_MODULE_VERSION mismatch)` line with suite names, exit 0 unchanged. Closes the v0.9.2
follow-up so the next silent test loss is visible at gate time.
**Files:** scripts/verify-proof (or equivalent), test.

### SP-10 — Playbook v0.13.0 re-grade
Update `PLANNING/LL_SMOKE_PLAYBOOK.md`: a default-mode section (Asks 1–5 under fresh
defaults must show **zero** machinery chrome — no banner stages, no pills, no composer
voice), and pin `agentMode: 'auto'` explicitly as the *router-exercise* configuration for
Asks 6–8 (CR-4 lock tests unchanged). Byte guards re-asserted (no prompt regrowth this
phase).
**Files:** PLANNING/LL_SMOKE_PLAYBOOK.md, system-prompt-builder.test.ts guard comments.

### SP-11 — Full gate + governance docs
Full vitest run, both tsc configs, electron-vite build, `verify:proof -- --no-tests`.
DEVLOG phase entry; README "New in 0.13.0"; CLAUDE.md current-state block.

### SP-12 — Ship arc
`package.json` → 0.13.0. `npm run build:win`; move exe + blockmap + zip + latest.yml to
primary `dist/` (per release-artifacts memory). Commit, push to main per STS convention.
Bucket only on the user's word.

---

## §6 Completion criteria

1. Fresh install: "fix this bug" turn shows **only** the model working — tools, reply, no
   banner stages, no pills, no composer rewrite, `proofStatus` undefined. Indistinguishable
   in shape from an era Claude Code turn.
2. All seven defects (D1–D7) closed with a test each.
3. Multi-agent / proof / composer / lazy surface all still function when explicitly enabled
   (existing test suites green — zero capability removal).
4. Full gate green: tsc ×2, vitest (≥ current 2,332 passing, no new skips), build,
   verify:proof exit 0 **with visible skip accounting**.
5. Playbook v0.13.0 criteria recorded; live re-run is the user's post-install step.

## §7 Approval state

**DRAFT.** Reply **"STS"** to execute SP-0 → SP-12 end-to-end (verify + commit per prompt,
no mid-run questions), or amend any §4 decision first and then STS.
