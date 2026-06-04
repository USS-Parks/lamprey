# Lamprey Parity Plan — Three-Track Execution

**Goal:** close the structural gap between Lamprey and Claude Code so Lamprey functions as a worthy open-source peer, with explicit emphasis on (a) **UI-mastery-level control-flow expressiveness** and (b) **cross-session continuity**.

**Execution model:** 36 prompts split across **three concurrent tracks** (run in parallel git worktrees) + one **Integration Phase** (single session, after all tracks merge to main).

**Companion to:** [`LAMPREY_HARNESS_FINAL.md`](LAMPREY_HARNESS_FINAL.md) (original build plan) · [`LAMPREY_RAG_ROSTER.md`](LAMPREY_RAG_ROSTER.md) (RAG add-on) · [`CODEX_TOOLSET_PARITY_PLAN.md`](CODEX_TOOLSET_PARITY_PLAN.md) (prior parity work)

---

## 0. SESSION BOOTSTRAP — READ THIS FIRST

You are a fresh Claude Code session that has been handed this document. Before doing anything else:

### Step 1 — Confirm environment

Verify:
- Working directory is `C:\Users\17076\Documents\Claude\Lamprey Harness` (or a worktree thereof)
- Current branch is **not** `main` (you should be on a track-specific worktree branch; if you are on `main`, halt and ask the user to set up a worktree first)
- `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both pass cleanly *before* you start (baseline must be green)
- Tests pass: `npx vitest run` exits 0

If any of those fail, halt and report. Do not start a track on a broken baseline.

### Step 2 — Ask the user which track

Use `AskUserQuestion` with these three options (header chip: "Track"):

- **Track 1 — Runtime Foundation** *(8 prompts: A1→A2→A3→B1→B2→B3→B4→B5)* — Subagent forking (w/ extensible types), background lifecycle, worktree isolation, deterministic workflow runner with journaling/resume/UI/library, model-tier routing + schema-retry hardening. Owns the runtime substrate.
- **Track 2 — Tool Layer + Continuity** *(9 prompts: C1→C2→C3→C4→E1→E2→E5→E6→E4)* — Lazy tool schemas, hooks-into-dispatch, plan-mode state gate, slash-command system, session chapters + TOC + quick-jumper, auto context compression, async event-to-prompt bridge, spawn-task primitive. Owns the dispatch loop's gating.
- **Track 3 — Memory + Verification + Scheduling** *(13 prompts: D1→D2→D3→E3→F1→F2→F3→F4→G1→G2→G3→G4→D4)* — Typed memory + index + UI, full-text session search + archive, preview verification family, monitor + background-shell primitive, PR review depth, cron UI, self-paced loop, push notifications + cross-session messaging, headless CLI, memory consolidation workflow. Owns the most-parallel-safe surface.

### Step 3 — Execute the chosen track without stopping

Once the user picks a track:

1. **Do not ask further questions** unless a prompt requires a decision only the user can make (an architectural fork the plan doesn't resolve, an external resource that requires their account, or a genuine blocker).
2. **For each prompt in the chosen track, in the listed order:**
   a. Read the "Files (net new / modified)" list. Read the existing files first to ground the change.
   b. Implement the change. Edit existing files in place; create new ones only when the prompt calls for them.
   c. Run the **verify gate** (the "Verify" column). This always includes both tsc configs + relevant unit tests. UI-touching prompts also list manual smoke steps — execute them via the preview tools (`mcp__Claude_Preview__*`) if they touch the renderer; if they're Electron-shell-only and the preview tools can't reach them, write the smoke steps into DEVLOG and explicitly mark as "user-verification-needed" rather than claiming success (see `feedback_no_fake_polish` memory).
   d. If verify fails: fix and retry up to **2 times**. On the third failure, halt the track, write a "blocked" entry to DEVLOG.md with the failure context, and report to the user.
   e. If verify passes: mark the prompt `[x]` in this document via `Edit`, write a DEVLOG.md entry (see Step 4), then commit (do not push — user pushes per CLAUDE.md).
   f. Move to the next prompt.
3. **Cross-track wait gates** — if a prompt's "Blocks on" column lists another track's prompt that hasn't merged yet:
   - First, check `git log main..` for the referenced prompt commit. If found, proceed.
   - If not yet merged, skip that prompt for now, continue with subsequent in-track prompts that have no cross-track dependency, and revisit the skipped prompt at the end of the track.
   - If all remaining prompts are blocked, halt with a "waiting-on-TrackN-PromptX" status and report.
4. **Do not push to GitHub.** Commit per prompt with a clear message (Conventional Commits style — e.g. `feat(workflow): B1 vm-sandboxed workflow runner`). The user reviews and pushes.
5. **When all prompts in the track complete:** write a final track-completion summary in DEVLOG.md listing every shipped prompt with its commit SHA, and announce completion in chat.

### Step 4 — DEVLOG entry format

For each prompt, append a section like:

```markdown
## [Track N — Prompt XY] <Title>  —  <YYYY-MM-DD>

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
- Use the project's commit-message style observable in `git log` (matches the existing `feat(...) / fix(...) / chore(...)` pattern).

---

## 1. Audit Summary (what already exists)

A parity audit of the current `electron/` tree reveals more existing surface than CLAUDE.md indicates. The "Owner Track" column tells you which track will absorb or extend each existing piece:

| Capability | Current state | Gap to Claude Code | Owner Track |
|---|---|---|---|
| Subagent runner | `multi-agent-run-tool.ts` exists (tool-less) | Curated tools, schemas, background lifecycle | **Track 1** |
| Workflow runner | `agent-pipeline.ts` (sync only) | General JS evaluator, resume, combinators | **Track 1** |
| Memory | `memory-store.ts` K/V blobs | Taxonomy + index file | **Track 3** |
| Hooks | `hooks-store.ts` + `hooks-runner.ts` stubs | Not wired into dispatch | **Track 2** |
| Tool schemas | Eager-load (`tool-packs.ts`) | No ToolSearch / deferred | **Track 2** |
| Worktree | `worktree.ts` manual | Auto-per-subagent + cleanup | **Track 1** |
| Cron | `automations-runner.ts` (no UI) | UI + headless dispatch | **Track 3** |
| Plan mode | `plan-goal-store.ts` (data only) | Not a mutating-tool gate | **Track 2** |
| Chapters / TOC | None | Missing entirely | **Track 2** |
| Spawn-task | None | Missing entirely | **Track 2** |
| Compression | None | Missing entirely | **Track 2** |
| Session search / archive | Basic list only | FTS + archive | **Track 3** |
| Preview verification | navigate + screenshot | console/network/inspect/eval | **Track 3** |
| PR depth | OAuth + CRUD | Inline review post, comment threads | **Track 3** |
| Self-paced loop | None | Missing | **Track 3** |
| Headless CLI | None | Missing | **Track 3** |
| Adversarial / judge panel | None | Falls out of workflow patterns | **Track 1** (B4) |

**Non-goals (this plan):** swapping providers, reworking RAG, redesigning the artifact sandbox, multi-machine/shared state.

---

## 2. Architectural Invariants — Locked

These apply across all 30 prompts. Treat as binding.

1. **IPC envelope:** all new IPC follows `{ success: true, data } | { success: false, error }`. No exceptions.
2. **Subagents inherit the IPC tool registry but receive a curated descriptor subset** per spawn. Filtering lives in `electron/services/subagent-runner.ts` (Track 1 creates it).
3. **Workflow + hook sandbox** uses Node's built-in `vm` module — NOT `vm2` or `isolated-vm`. Frozen sandbox exposing only documented APIs. Same sandbox for hooks.
4. **Memory is filesystem-first**, SQLite-second. Markdown files with YAML frontmatter at `userData/lamprey-memory/<project-slug>/`. DB indexes for search; files are canonical.
5. **Workflows journal to disk** (`userData/workflows/<runId>.jsonl`). Resume keys on (prompt + opts) hash.
6. **Hooks block tool calls** synchronously with configurable timeout (default 5s). preToolUse throw blocks dispatch.
7. **Plan mode is a per-conversation flag** (`conversations.plan_mode_active`). Dispatcher checks before invoking any tool tagged `mutates: true` in `tool-registry.ts`.
8. **Lazy tool schemas:** `tools:list` returns stubs `{name, description, tags}`. Full schemas via `tools:resolve(name[])`. New `tools:search` for select/keyword.
9. **Worktree isolation per subagent** is opt-in via `isolation: 'worktree'`. Auto-cleanup if `git diff` is empty.
10. **Session chapters are event-log entries** (`chat.chapter.marked`). Renderer subscribes. No new table beyond the chapters table itself.

System-prompt block order (locked, all tracks adding to `system-prompt-builder.ts` must respect this): `memory_index → skills → retrieved_context → chapters → conversation`.

---

## 3. The Three Tracks — Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ TRACK 1 — Runtime Foundation        8 prompts   ~longest chain  │
│ A1 → A2 → A3 → B1 → B2 → B3 → B4 → B5                           │
│ Owns: subagent-runner (+extensible types), workflow-runner      │
│       (+model-tier routing +schema retry), agent-pipeline       │
├─────────────────────────────────────────────────────────────────┤
│ TRACK 2 — Tool Layer + Continuity   9 prompts                   │
│ C1 → C2 → C3 → C4 → E1 → E2 → E5 → E6 → E4                      │
│ (E6 waits on T1:A2; E4 waits on T1:A3)                          │
│ Owns: tool-registry shape, chat.ts dispatch gates, slash        │
│       commands, chapters, compression, async event bridge,      │
│       spawn-task                                                │
├─────────────────────────────────────────────────────────────────┤
│ TRACK 3 — Memory + Verify + Schedule  13 prompts                │
│ D1 → D2 → D3 → E3 → F1 → F2 → F3 → F4 → G1 → G2 → G3 → G4 → D4  │
│ (G4 waits on T2:E6; D4 waits on T1:B1)                          │
│ Owns: memory taxonomy + index, FTS session search, preview      │
│       tool family, monitor + bg-shell, PR review depth,         │
│       cron UI, loop primitive, push notifications +             │
│       cross-session messaging, headless CLI                     │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
                  (All three tracks merged to main)
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│ INTEGRATION PHASE — UI Mastery     6 prompts   single session   │
│ H1 → H2 → H3 → H4 → H5 → H6                                     │
│ Owns: activity dashboard, workflow palette + author UX,         │
│       sessions sidebar polish, hook editor polish, plan-mode    │
│       UX + spawn-task tray + design pass, status line +         │
│       AskUserQuestion UI                                        │
└─────────────────────────────────────────────────────────────────┘
```

**Merge-collision hotspots (read before starting any track):**

| File | Tracks that edit | Merge protocol |
|---|---|---|
| `electron/services/tool-registry.ts` | T1 (A1), T2 (C1, C3, E1, E4), T3 (F1, G2) | **T2 merges C1 first** (changes descriptor shape). Other tracks rebase their tag additions onto C1's structure. |
| `electron/ipc/chat.ts` | T1 (A1), T2 (C1, C2, C3, E5) | **T2 merges C2 then C3 first** (introduce dispatch-loop gates). T1's A1 subagent-fork wiring rebases on top. T2's E5 compressed-region prompt assembly is last. |
| `electron/services/system-prompt-builder.ts` | T2 (E1), T2 (E5), T3 (D2) | All additions are `<...>` blocks; coordinate insertion order per §2. T3's D2 (memory_index) goes first in prompt order. |

---

## 4. TRACK 1 — Runtime Foundation

**One-line mission:** Build the substrate that lets Lamprey spawn isolated subagents, run deterministic JS workflows over them, and resume those workflows across edits.

### Owner files (Track 1 has primary authorship)
- `electron/services/subagent-runner.ts` (new)
- `electron/services/subagent-types.ts` (new — built-in defaults + filesystem-discovered loader from `userData/subagent-types/<name>.md`)
- `electron/services/multi-agent-run-tool.ts` (refactor)
- `electron/services/workflow-runner.ts` (new)
- `electron/services/workflow-meta.ts` (new)
- `electron/services/workflow-journal.ts` (new)
- `electron/services/workflow-library.ts` (new)
- `electron/services/agent-run-store.ts` (new)
- `electron/services/worktree-runner.ts` (new helper over existing `worktree.ts`)
- `electron/ipc/tasks.ts` (new)
- `electron/ipc/workflows.ts` (new)
- `src/components/workflows/*` (new)
- `src/stores/workflows-store.ts` (new)
- `resources/workflows/*.js` (new — adversarial-verify, judge-panel, loop-until-dry, multi-modal-sweep)

### Files to AVOID editing (other tracks own them)
- `electron/services/tool-registry.ts` — Track 2 owns the lazy-schema refactor. Track 1 only registers new tools by appending; do not refactor descriptor shape.
- `electron/ipc/chat.ts` — Track 2 owns dispatch-loop gating. Track 1's subagent-fork wiring is small and additive; coordinate via the merge hotspot protocol.
- `electron/services/memory-store.ts`, `electron/ipc/memory.ts` — Track 3.
- `electron/services/github-service.ts` — Track 3.
- `electron/services/browser-tools.ts` — Track 3.

### Cross-track dependencies
- **None inbound.** Track 1 is fully independent.
- **Outbound:** Track 3's D4 (memory consolidation workflow) waits on T1's B1. Phase H (H1, H2) waits on T1's A2 + B3.

### Prompt sequence

| # | Prompt | One-liner | Files (net new / modified) | Verify | Blocks on | Status |
|---|---|---|---|---|---|---|
| A1 | **Subagent fork primitive (with extensible types)** | Extract `subagent-runner.ts` from `multi-agent-run-tool.ts`. New API: `forkAgent({ prompt, agentType, allowedTools, schema?, modelId?, parentRunId, isolation? })` returns `{ runId, abort, promise<result> }`. Raw text or schema-validated object via forced tool-call. Per-fork context buffer capped via existing 32KB pattern. **Subagent types are filesystem-discovered**: built-in defaults (Explore/Plan/code-reviewer/general) live in `subagent-types.ts`; user types are loaded from `userData/subagent-types/<name>.md` with YAML frontmatter `{description, allowedTools[], systemPrompt}` (mirrors the skill-loader pattern). | `electron/services/subagent-runner.ts` (new), `electron/services/subagent-types.ts` (built-ins + fs loader), `multi-agent-run-tool.ts` (refactor) | unit: fork Explore with `[grep, glob, read]` returns string · fork with schema returns conforming object · parent's added tool not visible to child · drop a `userData/subagent-types/security-auditor.md` and fork by name → custom system prompt + allowed tools honored · existing `multi-agent-run-tool` tests still green · both tsc configs | — | [x] |
| A2 | **Background agents + async notifications** | Add `runInBackground: true` to `forkAgent`. Track in new `agent_runs` table (`id, parent_conv_id, agent_type, label, status, started_at, finished_at, result_text, error`). Emit `agent:run:notify` event. Add `tasks:list/get/output/stop/update` IPC. | `electron/services/agent-run-store.ts` (new), `electron/ipc/tasks.ts` (new), migration, `subagent-runner.ts` (extend) | spawn background fork returns immediately · `tasks:list` shows `running` · completion fires notify event · `tasks:stop` aborts · result persists · both tsc | A1 | [x] |
| A3 | **Worktree-isolated subagent runs** | Wire `isolation: 'worktree'`. Spawn: `git worktree add userData/worktrees/<runId>`. Result: empty diff → remove; non-empty → return `{worktreePath, branch}`. Reuse `electron/ipc/worktree.ts`. | `subagent-runner.ts` (extend), `electron/services/worktree-runner.ts` (new), `electron/services/git-runner.ts` (extend if needed) | 3 parallel forks with `isolation` → 3 disjoint worktrees · no-op agent → auto-cleaned · file-touching agent → path surfaces in `agent_runs.result_text` · both tsc | A1 | [x] |
| B1 | **Workflow JS evaluator core** | New `electron/services/workflow-runner.ts`. Loads script into Node `vm.Script` with sandbox exposing `agent`, `parallel`, `pipeline`, `phase`, `log`, `workflow`, `args`, `budget`. `agent()` calls `subagent-runner.forkAgent`. Concurrency cap = `min(16, cpus-2)`. Total agent cap = 1000. Mandatory `export const meta = {...}` literal. | `workflow-runner.ts`, `workflow-meta.ts`, `electron/ipc/workflows.ts` (new: `run`, `runInline`, `list`, `stop`), `userData/workflows/scripts/` | unit: 3-stage `pipeline()` runs concurrently across stages · `parallel()` is barrier · stage throw → item dropped to `null` · concurrency cap enforced · `budget.remaining()` Infinity when no target · meta-literal validator rejects template strings · both tsc | A1 | [x] |
| B2 | **Workflow journaling + resume** | Per `agent()` call append `{seq, promptHash, optsHash, label, phase, startedAt, finishedAt, result}` to `userData/workflows/runs/<runId>.jsonl`. `Workflow.run({ resumeFromRunId, script })` compares new script to journal; longest unchanged prefix returns cached; first divergent call onward runs live. | `workflow-runner.ts` (extend), `electron/services/workflow-journal.ts` (new) | edit 4th of 6 `agent()` calls + resume → first 3 cached, 4th–6th re-run · unchanged + same args → 100% hit, <1s finish · journal survives app restart · both tsc | B1 | [x] |
| B3 | **Workflow live progress UI** | New `src/components/workflows/WorkflowsPanel.tsx` + `WorkflowRunCard.tsx`. Subscribes to `agent:run:notify` + new `workflow:progress` event (per agent start/finish + `log()`/`phase()`). Tree: workflow → phase → agent, with status chips, elapsed, token estimate. Re-renders on resume. Sidebar entry "Workflows". | `src/components/workflows/{WorkflowsPanel,WorkflowRunCard,PhaseGroup,AgentChip}.tsx`, `src/stores/workflows-store.ts`, route in `App.tsx` | manual smoke (preview tools): start 10-agent pipeline → tree renders live, chips flip · `log()` appears as narrator line · cancel calls `workflows:stop` → "aborted" · both tsc | B1, A2 | [x] |
| B4 | **Quality workflow patterns library** | Ship built-in workflows in `resources/workflows/`: `adversarial-verify` (3-skeptic refutation), `judge-panel` (N candidates → N judges → synthesize), `loop-until-dry` (K empty rounds), `multi-modal-sweep` (distinct lenses). Invokable via `workflow('adversarial-verify', { claim })`. Surface as "Library" tab in WorkflowsPanel with one-click run. | `resources/workflows/*.js`, `electron/services/workflow-library.ts`, panel "Library" tab | run `adversarial-verify` against known-false claim → `refuted: true` with ≥2/3 · `judge-panel` over 3 plans → single synthesized plan with attribution · `loop-until-dry` against stub empty finder → exits after 2 rounds · both tsc | B1, B3 | [x] |
| B5 | **Workflow model-tier routing + schema-retry hardening** | Document and exercise per-agent `model` override across B4's library workflows: skeptics use cheap tier (Gemma/Qwen-flash/V4 Flash), synthesizers use top tier (V4 Pro). Add explicit schema-validation retry loop in `workflow-runner.ts`: on schema mismatch, re-prompt the agent up to 3× with the validation error appended; surface last error on exhaustion. Track per-tier token spend in `budget` so workflows expose cheap-vs-expensive cost breakdown. New `workflow:tokens` event per-agent for the WorkflowsPanel to render tier-colored chips. | `workflow-runner.ts` (extend), `subagent-runner.ts` (extend retry), `resources/workflows/*.js` (annotate model tiers), `electron/services/workflow-budget.ts` (new — per-tier counters) | run mixed-tier `adversarial-verify` → token counters confirm ≥3× cheaper than all-Pro baseline · forced bad-schema output (stub) → retried 3× with error appended each turn, then surfaces validation error · `budget.byTier` returns per-tier spend · WorkflowsPanel chips tinted by tier · both tsc | B4 | [x] |

### Track 1 completion criteria
- All 8 prompts marked `[x]`
- 8 commits on the track's worktree branch
- `npx tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean
- `npx vitest run` exits 0
- Manual: launch Electron, open Workflows panel, run `adversarial-verify` library entry, watch live tree, confirm result
- DEVLOG.md has 7 prompt entries + one track-completion summary

---

## 5. TRACK 2 — Tool Layer + Continuity

**One-line mission:** Replace eager tool loading with lazy schemas + ToolSearch, wire hooks into the dispatcher, gate mutating tools behind plan mode, and add chapters / compression / spawn-task to the conversation surface.

### Owner files
- `electron/services/tool-registry.ts` (heavy refactor — stubs vs full schemas)
- `electron/services/tool-search.ts` (new)
- `electron/ipc/tools.ts` (extend with `resolve`, `search`)
- `electron/services/mcp-manager.ts` (defer schema fetch)
- `electron/services/hooks-runner.ts` (complete + wire)
- `electron/ipc/hooks.ts` (extend)
- `electron/ipc/chat.ts` (hook invocation, plan-mode gate, compressed-region assembly — coordinate with T1 via merge protocol)
- `electron/ipc/plan.ts` (extend)
- `electron/services/conversation-store.ts` (extend: `plan_mode_active`, `compressed_into`)
- `electron/services/context-compressor.ts` (new)
- `electron/services/chapters-store.ts` (new)
- `electron/ipc/chapters.ts` (new)
- `electron/services/spawn-task.ts` (new)
- `electron/services/slash-commands.ts` (new — filesystem-discovered + built-ins)
- `electron/ipc/slash.ts` (new)
- `electron/services/async-event-bridge.ts` (new — injects task-notification-style structured events into next prompt)
- `electron/services/system-prompt-builder.ts` (additive: chapter mention, compressed-region handling, async-event injection — coordinate with T3 via merge protocol)
- `src/components/settings/HooksSettings.tsx` (new)
- `src/components/chat/{PlanModeBanner,ChapterSidebar,ChapterDivider,ChapterQuickJumper,SpawnTaskChip,SpawnTaskTray,CompressedRegionPill,SlashCommandPalette,SlashCommandHint,AsyncEventToast}.tsx` (new)
- `src/stores/{hooks-store.ts,plan-store.ts,chat-store.ts (chapters slice),slash-commands-store.ts}` (new/extend)

### Files to AVOID editing
- `electron/services/subagent-runner.ts`, `workflow-runner.ts`, anything in `resources/workflows/` — Track 1.
- `electron/services/memory-store.ts`, `electron/ipc/memory.ts` — Track 3.
- `electron/services/github-service.ts`, `browser-tools.ts`, `automations-runner.ts`, `loop-runner.ts` — Track 3.

### Cross-track dependencies
- **E4 (spawn-task) waits on T1:A3** — spawn-task spawns new conversations in fresh worktrees, which requires T1's worktree-runner helper. **Skip E4 to the end of the track; if A3 is still unmerged when you get there, halt with "waiting-on-T1:A3" status.**
- **E6 (async event bridge) waits on T1:A2** — E6 listens for `agent:run:notify` (defined by A2) and injects matching events into the next prompt. **If A2 unmerged when you reach E6, defer E6 and proceed with E4; revisit E6 after A2 lands.**
- C1 (lazy schemas) changes the tool-descriptor shape that T1's A1 and T3's F1/G2 will rebase onto — **C1 must merge before any other track touches `tool-registry.ts`**. If you've completed C1, signal the user; do not block the other tracks longer than needed.
- C4 (slash commands) has a soft dependency on T1:B1 — the `/workflow <name>` built-in command needs the workflow runner to be useful. C4 ships either way; the `/workflow` built-in surfaces a "workflow runner not yet available" error until B1 merges.

### Prompt sequence

| # | Prompt | One-liner | Files (net new / modified) | Verify | Blocks on | Status |
|---|---|---|---|---|---|---|
| C1 | **Lazy tool schemas + ToolSearch** | `tools:list` returns stubs `{name, description, tags}` only. New `tools:resolve([name])` returns full JSONSchema. New `tools:search({ query, max })` supports `select:<names>` + keyword scoring. MCP tools tagged `lazy: true`; schema fetched on first resolve. `electron/ipc/chat.ts` auto-resolves on demand. | `tool-registry.ts` (stub/full split), `tool-search.ts` (new), `electron/ipc/tools.ts` (extend), `mcp-manager.ts` (defer fetch) | wire Gmail + Drive MCP → `tools:list` payload <5KB · `tools:search('select:read,grep')` → 2 full schemas · keyword search ranks by name · first model call to unresolved tool auto-resolves · both tsc · existing tool tests green | — | [x] |
| C2 | **Hooks wired into dispatch + Hooks UI** | Complete `hooks-runner.ts` and wire into `electron/ipc/chat.ts` + tool dispatcher. Five events: `sessionStart`, `promptSubmit`, `preToolUse`, `postToolUse`, `agentStop`. Run in same `vm` sandbox as workflows (mirror Track 1's pattern; do not duplicate the sandbox). `preToolUse` throw blocks call with thrown message surfaced to model. UI: per-event tabs, code editor, enable toggles, test-run button. | `hooks-runner.ts` (complete + wire), `electron/ipc/hooks.ts` (extend), `electron/ipc/chat.ts` (invoke), `src/components/settings/HooksSettings.tsx`, `src/stores/hooks-store.ts` | preToolUse hook throwing on `shell_command` blocks shell · postToolUse hook logs every invocation · disabled hook skipped · UI: create/enable/edit/test/delete works · both tsc | C1 | [x] |
| C3 | **Plan mode state gate** | Add `conversations.plan_mode_active` column. New `plan:enter`/`plan:exit` IPC. Tag mutating tools (`write_file`, `edit_file`, shell, git mutating) with `mutates: true` in `tool-registry.ts`. Dispatcher refuses mutating tools when flag on. Persistent yellow banner with "Exit plan mode" button. Pair with existing `plan-goal-store.ts`. Register `enter_plan_mode` + `exit_plan_mode` tool descriptors so the model can flip the mode itself. | migration, `conversation-store.ts` (extend), `electron/ipc/plan.ts` (extend), `tool-registry.ts` (tag + register), `src/components/chat/PlanModeBanner.tsx`, `src/stores/plan-store.ts` | enter plan mode → `write_file` blocked, `read_file` works · exit → write works · banner persists across reload · plan-goal-store integration intact · model can call `enter_plan_mode` itself · both tsc | C1, C2 | [x] |
| C4 | **Slash command system + built-ins** | Filesystem-discovered slash commands at `userData/slash-commands/<name>.md` with YAML frontmatter `{description, args?, hidden?}` (mirrors skill-loader). Body is the prompt template, with `{{arg}}` interpolation. Built-ins shipped in `resources/slash-commands/`: `/init`, `/review`, `/verify`, `/simplify`, `/loop`, `/plan`, `/workflow <name>`, `/spawn-task`, `/clear`. Renderer `SlashCommandPalette.tsx` (popover above ChatInput when first char is `/`), `SlashCommandHint.tsx` (autocomplete dropdown). IPC `slash:list`, `slash:resolve(name, args)` returns the assembled prompt, dispatched as a normal user turn. | `electron/services/slash-commands.ts` (new), `electron/ipc/slash.ts` (new), `resources/slash-commands/*.md` (built-ins), `src/components/chat/{SlashCommandPalette,SlashCommandHint}.tsx`, `src/stores/slash-commands-store.ts`, `src/components/chat/ChatInput.tsx` (extend for `/` detection) | type `/` in ChatInput → palette appears with built-ins + user commands · `/verify` resolves to the verify prompt + dispatches · drop a custom `userData/slash-commands/release-notes.md` → autocomplete shows it · `{{arg}}` interpolation works · hidden commands don't show in palette but resolve when typed · both tsc | C3 | [x] |
| E1 | **Session chapters** | New IPC `session:markChapter({ title, summary?, anchorMessageId })`. Emits `chat.chapter.marked` spine event. Add `chapters` table `(id, conversation_id, title, summary, anchor_message_id, created_at)`. Register `mark_chapter` tool descriptor. | migration, `chapters-store.ts` (new), `electron/ipc/chapters.ts` (new), `tool-registry.ts` (register), `system-prompt-builder.ts` (mention tool) | model `mark_chapter("Exploration")` → row inserted + event fired · 2nd chapter cleanly · survives restart · listed by `anchor_message_id` · both tsc | C4 | [x] |
| E2 | **Session TOC + nav** | Renderer chapter sidebar (floating in chat view, click-to-scroll). Inline visual divider at chapter boundaries. Hover for summary. `ctrl+g` opens chapter quick-jumper. | `src/components/chat/{ChapterSidebar,ChapterDivider,ChapterQuickJumper}.tsx`, `src/stores/chat-store.ts` (chapters slice) | manual (preview tools): mark 4 chapters → sidebar lists 4, click navigates, dividers render, quick-jumper filters, responsive at narrow widths · both tsc | E1 | [x] |
| E5 | **Auto context compression** | When token count exceeds threshold (default 75% of model ctx, configurable), roll oldest N messages into structured summary `<conversation_summary>` block. Replace in prompt assembly; mark `compressed_into=<summaryMessageId>`. Original preserved on disk. Small "compressed" pill at boundary in chat UI. | `context-compressor.ts` (new), `system-prompt-builder.ts` (handle compressed regions), migration (`compressed_into` col), `src/components/chat/CompressedRegionPill.tsx` | force chat past threshold → compression runs, prompt tokens drop ≥40% · pill renders at boundary · hover shows summary · original expandable in UI · both tsc | C3 | [x] |
| E6 | **Async event-to-prompt bridge** | New `electron/services/async-event-bridge.ts` listens on the event bus for `agent:run:notify`, `loops:wakeup-fired`, `automations:run-completed`, `tasks:spawn-completed`, `sessions:incoming-message` (T3:G4 feeds this last one). When the **owning conversation's next turn assembles**, the bridge injects accumulated events as a `<task-notifications>` system-reminder-style block at the top of the user-message segment so the model reads them and can act. Bridge drains its queue per-conversation on inject. UI: subtle toast (`AsyncEventToast.tsx`) for the user too. | `async-event-bridge.ts` (new), `system-prompt-builder.ts` (additive — inject block), `src/components/chat/AsyncEventToast.tsx`, migration adds `async_events(id, conversation_id, kind, payload_json, created_at, delivered_at?)` | spawn background agent in conv A → finishes after conv A goes idle → next turn in A starts with `<task-notifications>` block · cron task firing in conv B injects a notification on conv B's next turn · drained events not re-injected · toast renders on receipt · both tsc | E5, **T1:A2** | [x] |
| E4 | **Spawn-task primitive** | New IPC `tasks:spawn({ title, prompt, tldr, cwd? })`. Creates new conversation in fresh worktree (auto if same project) with seed prompt + "spawned-from" backlink. Dismissible chip in source chat. Register `spawn_task` tool so model can flag mid-turn. | `spawn-task.ts` (new), `electron/ipc/tasks.ts` (extend — coordinate with T1's `tasks.ts`), `tool-registry.ts` (register), `src/components/chat/{SpawnTaskChip,SpawnTaskTray}.tsx` | model emits `spawn_task` → chip appears · click → new conversation in fresh worktree with seed · dismiss removes chip · backlink resolves both ways · both tsc | E2, **T1:A3** | [x] |

### Track 2 completion criteria
- All 9 prompts `[x]` (E4 may have been deferred to track-end if T1:A3 wasn't yet merged; E6 may have been deferred pending T1:A2)
- 9 commits on track's worktree branch
- Both tsc clean, vitest exits 0
- Manual: enter plan mode, attempt write tool (blocked), exit plan mode (works); type `/` in ChatInput and run `/verify`; mark a chapter, see in sidebar; force a long chat past threshold and see compression pill; spawn a background agent and watch its completion show up as a `<task-notifications>` block in the next turn; trigger spawn-task from model output
- DEVLOG.md has 9 entries + completion summary

---

## 6. TRACK 3 — Memory + Verification + Scheduling

**One-line mission:** Replace untyped memory with file-backed typed taxonomy + always-loaded index, add FTS session search + archive, build the preview-verification tool family, extend PR depth, and ship cron UI + self-paced loop + headless CLI.

### Owner files
- `electron/services/memory-store.ts` (rewrite — file-backed)
- `electron/services/memory-frontmatter.ts` (new)
- `electron/ipc/memory.ts` (extend)
- `electron/services/system-prompt-builder.ts` (additive: memory_index injection — coordinate with T2 via merge protocol)
- `src/components/memory/{MemoryPanel,MemoryEditor,MemoryLinkPicker,MemoryTypeBadge,MemoryLinkGraph}.tsx` (rewrite/new)
- `src/stores/memory-store.ts` (rewrite)
- `electron/services/conversation-store.ts` (FTS index + `archived` col — coordinate with T2's `compressed_into` migration)
- `electron/ipc/conversation.ts` (extend)
- `src/components/layout/{SessionsSidebar,SessionSearchBar}.tsx` (new)
- `src/stores/conversation-store.ts` (extend renderer)
- `electron/services/browser-tools.ts` (heavy extend — preview family)
- `electron/services/dev-server-manager.ts` (new)
- `electron/services/browser-manager.ts` (extend)
- `electron/services/github-service.ts` (extend — review comments, threads)
- `electron/ipc/review.ts` (extend)
- `src/components/github/{PullRequestsPanel,IssuesPanel,PRDiffView,PRStatusChecks,InlineCommentComposer}.tsx` (new)
- `src/stores/github-store.ts` (extend)
- `src/components/automations/{AutomationsPanel,CronEditor,RunHistoryViewer}.tsx` (new)
- `src/stores/automations-store.ts` (extend renderer)
- `electron/services/loop-runner.ts` (new)
- `electron/ipc/loops.ts` (new)
- `electron/services/monitor-service.ts` (new — stream-from-background-process)
- `electron/ipc/monitor.ts` (new)
- `electron/services/shell-tool.ts` (extend — `runInBackground` mode)
- `electron/services/notifications-service.ts` (new — native OS notifications via Electron `Notification`)
- `electron/ipc/notifications.ts` (new)
- `electron/services/cross-session-messaging.ts` (new — routes via T2's async-event-bridge)
- `electron/ipc/sessions-messaging.ts` (new)
- `electron/cli.ts` (new)
- `electron/services/headless-runner.ts` (new)
- `resources/workflows/consolidate-memory.js` (new)

### Files to AVOID editing
- `electron/services/subagent-runner.ts`, `workflow-runner.ts`, anything in `resources/workflows/` *except* `consolidate-memory.js` — Track 1.
- `electron/services/tool-registry.ts` — Track 2 owns the lazy refactor. Track 3 only *appends* new tool descriptors after C1 lands. **Wait for C1 merge before touching this file.**
- `electron/services/hooks-runner.ts`, `electron/ipc/chat.ts` dispatch logic, `plan-goal-store.ts`, `chapters-store.ts`, `context-compressor.ts` — Track 2.

### Cross-track dependencies
- **D4 (memory consolidation workflow) waits on T1:B1.** D4 invokes the workflow runner. **Defer D4 to the end of the track; if B1 unmerged, halt with "waiting-on-T1:B1" status.**
- **G4 (push notifications + cross-session messaging) waits on T2:E6.** Cross-session messaging delivers messages by enqueuing them as `sessions:incoming-message` events that T2:E6's async-event-bridge picks up and injects into the receiving conversation's next turn. **Defer G4 to immediately before D4; if E6 unmerged, halt G4 with "waiting-on-T2:E6" but continue to D4 if T1:B1 is merged.**
- **F1, G2, F4 register new tool descriptors → wait for T2:C1 merge** before editing `tool-registry.ts`. If C1 unmerged when you get to F1, you can still ship F1's `browser-tools.ts` extensions and `dev-server-manager.ts`, then return to descriptor registration after C1.

### Prompt sequence

| # | Prompt | One-liner | Files (net new / modified) | Verify | Blocks on | Status |
|---|---|---|---|---|---|---|
| D1 | **Memory taxonomy + frontmatter migration** | Replace K/V `memory_entries` with file-backed: `userData/lamprey-memory/<projectSlug>/<slug>.md` with YAML frontmatter `{name, description, metadata:{type}}` where `type ∈ {user, feedback, project, reference}`. Existing entries → `type: project`. New IPC `memory:write/list/read/delete`. SQLite mirror for FTS. | migration, `memory-store.ts` (rewrite), `electron/ipc/memory.ts` (extend), `memory-frontmatter.ts` (new) | write `feedback` memory → file with correct frontmatter lands · `memory:list({type: 'feedback'})` returns it · existing migrate cleanly · external file edit reflects on next list · both tsc | — | [x] |
| D2 | **MEMORY.md always-loaded index** | Maintain `userData/lamprey-memory/<projectSlug>/MEMORY.md` 1-line-per-entry, auto-regen on write/delete. On every chat turn, `system-prompt-builder` injects MEMORY.md under `<memory_index>` block (truncated 200 lines). `[[link-name]]` link extraction; broken links → "to-write" sidebar pip. | `memory-store.ts` (regenerate hook), `system-prompt-builder.ts` (inject — additive, coordinate with T2), `src/components/memory/MemoryLinkGraph.tsx` (pip) | write 5 memories → MEMORY.md regen · chat prompt contains `<memory_index>` with 5 · delete one → regen removes line · `[[unknown]]` → pip · both tsc | D1 | [x] |
| D3 | **Memory UI typed view + linking** | Rebuild `MemoryPanel.tsx` with type tabs (User/Feedback/Project/Reference), editor with frontmatter form, `[[link]]` autocomplete, per-entry open/delete/duplicate. Per-type count badges in sidebar. | `src/components/memory/{MemoryPanel,MemoryEditor,MemoryLinkPicker,MemoryTypeBadge}.tsx`, `src/stores/memory-store.ts` | manual (preview tools): create one of each type · edit body + save → persists · type filter works · `[[` autocomplete lists existing · badges accurate · both tsc | D2 | [x] |
| E3 | **Cross-session search + archive** | FTS5 over conversation titles + message bodies + chapter titles. `sessions:archive(id)` flips `archived`. New left-sidebar Sessions panel: Recent / Pinned / Archived tabs, search bar, infinite scroll. | migration (FTS + `archived`), `conversation-store.ts` (extend), `electron/ipc/conversation.ts` (extend), `src/components/layout/{SessionsSidebar,SessionSearchBar}.tsx`, `src/stores/conversation-store.ts` | search verbatim phrase → conversation returned · archive drops from Recent → appears in Archived · pin → Pinned · 100+ convos search <200ms · both tsc | D3 | [x] |
| F1 | **Preview verification depth** | Extend `browser-tools.ts` with `preview_start` (spawns dev server via `pty-manager.ts`), `preview_console_logs`, `preview_network`, `preview_snapshot`, `preview_inspect`, `preview_eval`, `preview_screenshot`, `preview_fill`, `preview_click`, `preview_resize`. Tab lifecycle in `browser-manager.ts`. Register 10 tool descriptors (after T2:C1 lands). | `browser-tools.ts` (heavy extend), `dev-server-manager.ts` (new), `browser-manager.ts` (extend), `tool-registry.ts` (register — wait for C1) | start Vite dev server → up, console captured · network shows fetches · `preview_inspect('#root', ['textContent'])` returns value · `preview_screenshot` returns PNG · stop releases port · both tsc | E3, **T2:C1** for tool registration | [x] (descriptor registration deferred to T2:C1 merge) |
| F2 | **PR comment threading + inline review post** | Extend `github-service.ts`: `getPullRequestReviewComments`, `createPullRequestReview` (with inline `comments[]`), `replyToReviewComment`, `resolveReviewThread`. New `gh_pr_comments`, `gh_pr_review_post` tool descriptors. | `github-service.ts` (extend), `electron/ipc/review.ts` (extend), `tool-registry.ts` (after C1) | fetch comments on real PR · post review w/ 2 inline comments → both render on github.com · reply visible · resolve works · scope error if missing `pull_request:write` · both tsc | F1, **T2:C1** | [x] (descriptor registration deferred to T2:C1 merge) |
| F3 | **PR / Issue browse + actions UI** | New `src/components/github/` panel: PR list (open/drafts/mine/all), Issue list, per-PR diff viewer reusing artifact sandbox, inline comment composer, status checks. Keyboard-driven. GitHub activity feed at top from event-log. | `src/components/github/{PullRequestsPanel,IssuesPanel,PRDiffView,PRStatusChecks,InlineCommentComposer}.tsx`, `src/stores/github-store.ts` (extend) | manual (preview tools): open panel → live PR list · click PR → diff loads + threads inline · post comment → appears on github.com · status checks live-refresh · "browse on github" works · both tsc | F2 | [x] |
| F4 | **Monitor primitive + background shell** | Extend `shell-tool.ts` with `runInBackground: true` option returning `{ processId }` immediately and emitting `shell:bg:exit` on completion. New `monitor-service.ts` with `monitor:start({ processId, untilPattern? })` returning `streamId` + emitting `monitor:line` events line-by-line; `monitor:read(streamId, since?)` polls buffered lines; `monitor:stop(streamId)`. `until` pattern (regex) auto-stops the monitor and fires `monitor:matched` when matched. Register `bash_run_background`, `monitor_start`, `monitor_read`, `monitor_stop` tool descriptors. | `shell-tool.ts` (extend), `monitor-service.ts` (new), `electron/ipc/monitor.ts` (new), `tool-registry.ts` (register — needs T2:C1) | start `npm run dev` in background → returns processId · `monitor_start` with `until: /Local:.*localhost/` → returns matched line and auto-stops · `bash_run_background` of `sleep 5 && echo done` fires `shell:bg:exit` with exit code 0 · monitor buffered lines drainable with `since` cursor · both tsc | F3, **T2:C1** | [x] (descriptor registration deferred to T2:C1 merge) |
| G1 | **Cron UI + lifecycle** | `src/components/automations/AutomationsPanel.tsx`: list / create / edit / delete cron tasks, expression validator with human preview, run-now, last-run viewer, enable toggle. Hook `automations-runner.ts` into `main.ts` startup if not already, with crash-safe restart. | `src/components/automations/{AutomationsPanel,CronEditor,RunHistoryViewer}.tsx`, `src/stores/automations-store.ts`, `electron/main.ts` (ensure runner starts), `electron/ipc/automations.ts` (extend if needed) | create 5-minute task → fires on schedule · run-now triggers immediately · validator rejects invalid · last-run visible · disable stops execution · both tsc | F3 | [x] |
| G2 | **Self-paced loop primitive** | New `loops:schedule({ delaySeconds, prompt, reason })` IPC + `schedule_wakeup` tool. `loop_wakeups` table. 30s tick scans for due rows, posts prompt back into conversation as user message with "scheduled wake-up" pill. Pair with `/loop` slash command. | migration, `loop-runner.ts` (new), `electron/ipc/loops.ts` (new), `tool-registry.ts` (register `schedule_wakeup` — needs C1), `src/components/chat/WakeupPill.tsx` | model `schedule_wakeup(60, ...)` → 60s later prompt re-fires + pill renders · cancel removes pending · stacked wake-ups fire in order · survives app restart (next-tick check on boot) · both tsc | G1, **T2:C1** | [x] |
| G3 | **Headless / remote run mode** | CLI entry `lamprey run <conversationId>` and `lamprey run --automation <id>` boots Electron headlessly, executes one turn or automation, prints structured result to stdout, exits. `--json` or human-readable. Used by cron, spawn-task, external scripts. | `electron/cli.ts` (new), `package.json` bin entry, `electron/main.ts` (argv branch), `headless-runner.ts` (new) | `npm run lamprey -- run --conv <id>` runs one turn + exits 0 · `--json` parseable · errors exit non-zero + `{success: false, error}` on stderr · automations-runner can use it for true isolation · both tsc | G2 | [x] |
| G4 | **Push notifications + cross-session messaging** | New `notifications-service.ts` wraps Electron `Notification` API; `notifications:push({title, body, deepLink?})` IPC + `push_notification` tool descriptor. Deep-link reopens the source conversation when clicked. New `cross-session-messaging.ts`: `sessions:list-active` returns live session IDs; `sessions:sendMessage({targetSessionId, body, fromSessionId})` enqueues an `async_events` row with kind `sessions:incoming-message` for the target conversation. T2:E6's bridge picks it up and injects it as a `<task-notifications>` block on the target session's next turn. Register `send_to_session` tool descriptor so a workflow orchestrator can ping siblings. | `notifications-service.ts` (new), `electron/ipc/notifications.ts` (new), `cross-session-messaging.ts` (new), `electron/ipc/sessions-messaging.ts` (new), `tool-registry.ts` (register both) | model calls `push_notification("Workflow done", "...")` → OS notification fires + deep-links to conv on click · `send_to_session({targetSessionId, body})` from session A → session B's next turn includes `<task-notifications>` with the message · disabled notifications gracefully no-op · both tsc | G3, **T2:E6** | [x] |
| D4 | **Memory consolidation primitive** | Add built-in workflow `consolidate-memory` in `resources/workflows/`. Reads all entries of a type, asks model to merge duplicates + prune index, writes back via `memory:write`. "Consolidate" button per type tab in memory panel runs it with live progress. | `resources/workflows/consolidate-memory.js`, memory panel button | run consolidation against known-duplicate set → duplicates merged, MEMORY.md regen · button shows live progress via WorkflowsPanel · both tsc | D3, **T1:B1** | [x] |

### Track 3 completion criteria
- All 13 prompts `[x]` (G4 + D4 likely deferred to end pending T2:E6 + T1:B1)
- 13 commits on track's worktree branch
- Both tsc clean, vitest exits 0
- Manual: create one memory of each type via panel; FTS search across conversations works; preview tools start a dev server and capture console; `bash_run_background` + `monitor_start` against `npm run dev` returns the localhost line; PR panel loads and posts an inline review on a test PR; cron task fires on schedule; `schedule_wakeup` re-fires after delay; `push_notification` fires OS notification with working deep-link; `send_to_session` from one open conversation surfaces in another's next turn; `lamprey run --conv <id>` works headlessly
- DEVLOG.md has 13 entries + completion summary

---

## 7. INTEGRATION PHASE — UI Mastery (post-merge)

**Trigger:** Tracks 1, 2, 3 all merged to `main`. Do NOT start this phase until all three track-completion summaries appear in DEVLOG.md and `main` is green.

**Execution:** single session, single worktree off `main`. Sequential H1 → H5.

This phase is *not* one of the three concurrent tracks — it requires all panels and substrates produced by 1–3 to exist. If the user picks "Integration" in a fresh session, the bootstrap rules in §0 still apply; only the prompt list differs.

| # | Prompt | One-liner | Files | Verify | Blocks on | Status |
|---|---|---|---|---|---|---|
| H1 | **Activity dashboard — live agent tree** | `src/components/activity/ActivityDashboard.tsx`: live tree of (Conversations × Workflows × Subagents × Cron × Loops × Hooks). Status chips, elapsed, token estimate, abort. Real-time via event-log. Pin to "watching" tray. Top of sidebar; collapsible. | `src/components/activity/{ActivityDashboard,ActivityNode,ActivityTray}.tsx`, `src/stores/activity-store.ts`, `src/components/layout/Sidebar.tsx` (mount) | 1 chat + 1 workflow + 1 bg agent + 1 wake-up + 1 cron → all 5 visible · status flips live · abort works · pin moves to tray, persists | T1:A2, T1:B3, T3:G1, T3:G2 | [x] |
| H2 | **Workflow command palette + author UX** | `ctrl+k` palette listing built-in + saved workflows. "New workflow" → editor pane with scaffolded `meta` literal, Monaco code editor, schema-validation lint, `agent()` autocomplete from live registry, dry-run button (stubs `Math.random`-like vars), save-as-named. | `src/components/workflows/{WorkflowPalette,WorkflowEditor,MetaScaffolder,DryRunPanel}.tsx`, `src/stores/workflows-store.ts` (extend) | `ctrl+k` opens palette · "Adversarial verify" runs from palette · new workflow saves to `userData/workflows/scripts/` + appears in Library · meta-literal validator catches `name: \`...\`` · dry-run shows call shape without spend | T1:B1, T1:B4 | [x] |
| H3 | **Session sidebar + resume polish** | Polish Phase-E Sessions panel: project grouping, last-active timestamp, unread agent-result badge, drag-to-reorder pins, right-click "duplicate / archive / delete," "Resume here" button. Pair w/ workflow-resume: paused-workflow session shows "Resume workflow" button. | `src/components/layout/SessionsSidebar.tsx` (extend), `src/components/sessions/SessionDetailPane.tsx`, `src/stores/conversation-store.ts` | 20 sessions / 3 projects → grouped, sortable · unread badge appears when bg agent finishes after blur · right-click menu works · workflow resume button fires T1:B2 resume | T3:E3, T1:B2 | [x] |
| H4 | **Hook editor + skill manager polish** | Polish HooksSettings: templates (block-shell-in-prod, log-tools-to-memory, auto-format-on-write), per-hook timeout slider, sandbox-error inline display, test-run w/ sample payloads. Sibling `SkillsManager.tsx`: hot-reload status, frontmatter validator, dry-run, marketplace import URL. | `src/components/settings/{HooksSettings,SkillsManager,HookTemplatesGallery,HookTestRunner}.tsx` | apply template → hook created · test-run shows output · skill import accepts URL + validates · hot-reload status updates live | T2:C2 | [x] |
| H5 | **Plan-mode UX + spawn-task tray + cohesive design pass** | Polish T2:C3 plan-mode: sticky yellow banner w/ "Exit & Execute" CTA, plan goals editable inline in side panel, "Approve all" / "Reject", transition animation. Polish T2:E4 spawn-task: persistent right-rail tray, batch-accept, batch-dismiss, link-back. Final design-token audit across all new panels (Activity, Workflows, Sessions, Memory, GitHub, Automations) — shared spacing, type scale, motion. | `src/components/chat/{PlanModeBanner,PlanGoalsPanel,SpawnTaskTray}.tsx`, `src/styles/`, token audit | enter plan mode → banner sticky + animated · inline goal edit persists · exit-and-execute clears + unblocks · spawn-task tray shows 3 pending, batch-accept opens 3 sessions · all panels share spacing/type with chat | T2:C3, T2:E4 | [x] |
| H6 | **Status line + AskUserQuestion-equivalent UI** | New persistent status bar `src/components/layout/StatusLine.tsx` at bottom of main window: active model + tier, active workflow (clickable → WorkflowsPanel), pending wake-ups count, session token spend, RAG attach indicator. Customizable via `userData/statusline.md` (frontmatter `{slots[]}` defining order + format strings). New `agent:askUser({question, header, options:[{label, description, preview?}], multiSelect?})` IPC + chip-style modal (`src/components/chat/AskUserModal.tsx`) that pauses the calling agent until answered. Register `ask_user_question` tool descriptor. Preview content per option supports markdown + code blocks. Workflows can await an answer: `const choice = await agent.askUser({...})`. | `src/components/layout/StatusLine.tsx`, `src/components/chat/AskUserModal.tsx`, `electron/services/ask-user-runtime.ts` (new — promise registry pausing subagents), `electron/ipc/ask-user.ts` (new), `tool-registry.ts` (register), `subagent-runner.ts` + `workflow-runner.ts` (extend with `askUser` helper) | status line renders all 5 slots live · customizing `statusline.md` reorders/relabels · model in workflow calls `ask_user_question` with 3 options → modal appears, user picks "Option 2" → workflow resumes with `{label, header}` · preview content renders markdown when option focused · timeout option (default 30s, configurable) auto-resolves with `null` · both tsc | H5, T1:A1 | [x] |

### Integration completion criteria
- All 6 prompts `[x]`
- Both tsc clean, vitest exits 0
- Full app smoke: launch Electron, exercise every new panel; trigger an `ask_user_question` from a workflow and confirm modal blocks/resumes the workflow correctly
- DEVLOG.md has 6 entries + integration summary
- README updated with Lamprey's new capabilities

---

## 8. Cross-Track Coordination Protocol

When two tracks need to touch the same file, use these rules:

1. **Lock-via-merge order** for the three hotspots (`tool-registry.ts`, `chat.ts`, `system-prompt-builder.ts`):
   - `tool-registry.ts`: T2:C1 lands first (refactor), then T1 + T3 rebase tool registrations onto C1's shape.
   - `chat.ts`: T2:C2 then T2:C3 land first (dispatch-loop gates), then T1:A1 (subagent dispatch), then T2:E5 (compressed-region assembly).
   - `system-prompt-builder.ts`: T3:D2 (memory_index) first, then T2:E1 (chapters mention), then T2:E5 (compressed regions).

2. **Migration ordering**: each migration file numbered sequentially. When two tracks add migrations the same day, the second-to-merge renames its file to the next number. Migrations are additive (no destructive changes to existing tables in this plan).

3. **IPC namespace ownership**: each track owns its namespace fully (T1: `tasks:`, `workflows:`, `agents:`; T2: `tools:`, `hooks:`, `plan:`, `chapters:`, `slash:`, `async-events:`; T3: `memory:`, `sessions:`, `sessions-messaging:`, `preview:`, `monitor:`, `notifications:`, `gh:`, `automations:`, `loops:`; Integration: `statusline:`, `ask-user:`). No track adds to another track's namespace without coordinating.

4. **Renderer route registration**: each track adds its new top-level panel to `App.tsx`'s route table by appending only. The Integration Phase reorders into final layout.

5. **If you discover a true conflict mid-track**: halt the prompt, write a "merge-blocked" entry to DEVLOG, and notify the user. Do not invent workarounds.

---

## 9. Quick-Reference Tables

### New IPC channels by track

| Track | Channels |
|---|---|
| T1 | `tasks:list/get/output/stop/update`, `agents:fork` (internal), `workflows:run/runInline/list/stop/resume`, events `agent:run:notify` + `workflow:progress` + `workflow:tokens` |
| T2 | `tools:resolve`, `tools:search`, `hooks:enable/disable/test`, `plan:enter/exit`, `slash:list/resolve`, `session:markChapter`, `tasks:spawn`, `async-events:list/drain` (internal), events `chat.chapter.marked` + `chat.compressed` + `async-event.injected` |
| T3 | `memory:write/list/read/delete`, `sessions:search/archive/pin`, `sessions:list-active`, `sessions-messaging:sendMessage`, `preview:start/stop/consoleLogs/network/snapshot/inspect/eval/fill/click/resize/screenshot`, `monitor:start/read/stop`, `notifications:push`, `gh:pr:reviewComments/postReview/replyComment/resolveThread`, `automations:run-now`, `loops:schedule/cancel/list`, CLI `lamprey run`, events `memory:index:regenerated` + `shell:bg:exit` + `monitor:line` + `monitor:matched` |
| Integration | `statusline:get/set/customize`, `ask-user:ask/respond`, event `ask-user:awaiting` |

### New SQLite tables / columns by track

| Track | Schema additions |
|---|---|
| T1 | `agent_runs(id, parent_conv_id, agent_type, label, status, started_at, finished_at, result_text, error, isolation_worktree_path?)` |
| T2 | `conversations.plan_mode_active BOOLEAN DEFAULT 0`, `chapters(id, conversation_id, title, summary, anchor_message_id, created_at)`, `messages.compressed_into INTEGER NULL`, `async_events(id, conversation_id, kind, payload_json, created_at, delivered_at?)` |
| T3 | mirror `memory_index(name, type, description, body, updated_at)` + FTS5 vt; `conversations.archived BOOLEAN`; FTS5 over conversations + messages + chapters; `loop_wakeups(id, conversation_id, fire_at, prompt, reason, status)` |

### New model-callable tools by track

| Track | Tools |
|---|---|
| T1 | `subagent_fork` (rare), `workflow_invoke` (fires named workflows) |
| T2 | `mark_chapter`, `spawn_task`, `enter_plan_mode`, `exit_plan_mode` (slash commands are renderer-side, not tools) |
| T3 | `preview_*` family (10 tools), `bash_run_background`, `monitor_start`, `monitor_read`, `monitor_stop`, `push_notification`, `send_to_session`, `gh_pr_review_post`, `gh_pr_comments`, `gh_pr_reply_comment`, `schedule_wakeup` |
| Integration | `ask_user_question` |

### Dependencies introduced

| Package | Purpose | Track |
|---|---|---|
| `vm` (node built-in) | Sandboxed workflow + hook execution | T1:B1, T2:C2 |
| `monaco-editor` (verify if already present) | Workflow + hook editors | T1:B3, T2:C2, Integration:H2/H4 |
| `cron-parser` (already present via automations) | Reused for loop wakeups | T3:G2 |
| `gray-matter` (already present via skill-loader) | Memory frontmatter | T3:D1 |

No new heavy native modules. Sandbox uses Node built-in `vm` — explicitly NOT `vm2` or `isolated-vm`.

---

## 10. Verification Approach

Every prompt has a verify gate. Three universal rules:

1. **Unit + integration tests** under `electron/services/__tests__/` and `src/__tests__/` for any new module — follow existing `*.test.ts` patterns.
2. **Manual smoke verification** for UI-facing prompts — use `mcp__Claude_Preview__*` if the change is renderer-visible. For Electron-shell-only changes the preview tools can't reach (window chrome, tray, native menus), write the smoke checklist into DEVLOG and mark "user-verification-needed" — do not claim success (per `feedback_no_fake_polish` memory).
3. **Both tsconfigs must pass** (`tsc --noEmit -p tsconfig.node.json` AND `-p tsconfig.web.json`) before marking any prompt `[x]`. Non-negotiable.

For Track 1 prompts touching the dispatch loop and Integration Phase prompts touching shared layout, also run the existing chat surface end-to-end after the change lands.

---

## 11. Out-of-Scope (this plan) — Park List

- Skill marketplace + remote install (Integration H4 hints at it; full marketplace is its own plan)
- Cross-machine session sync
- Streaming workflow output (workflows notify-on-complete; per-agent token streams stay in chat surface)
- Computer-use / desktop control MCP
- Multi-tenant / user accounts (single-user desktop)
- Mobile / web client (Electron desktop only)
- Auto-PR-bot mode (Track 3 ships PR *participation*, not unattended *authoring*)
- Anthropic Claude as a provider (catalog stays: DeepSeek / Google / DashScope)
- Reranking workflow outputs with embeddings (RAG owns embeddings)
- Distributed workflow execution (per-machine concurrency cap)

---

## 12. What "done" looks like

After Tracks 1–3 merge and the Integration Phase completes:

- A user authors a JS workflow in `ctrl+k` palette, runs it across 20 subagents in isolated worktrees (cheap-tier readers + top-tier synthesizer), watches the live tree with tier-colored chips, hits "stop," edits a stage, resumes from divergence — all in-app.
- Custom subagent types drop into `userData/subagent-types/` and become invokable by name.
- Custom slash commands drop into `userData/slash-commands/` and appear in the `/` palette alongside built-ins (`/init`, `/review`, `/verify`, `/simplify`, `/loop`, `/plan`, `/workflow`, `/spawn-task`).
- Memory is typed, searchable, always-loaded, cross-referenced, consolidatable on demand.
- Every session has chapters + TOC + full-text search + spawn-off-shoot.
- Long sessions auto-compress instead of dying.
- The model can mark chapters, spawn tasks, schedule wake-ups, invoke named workflows, enter/exit plan mode, push OS notifications, send messages to sibling sessions, monitor background processes, and ask the user a structured question that pauses the workflow until answered.
- Background agent completions, cron firings, wake-ups, and incoming cross-session messages all surface to the model as `<task-notifications>` blocks on the receiving conversation's next turn — agents notice the world has moved.
- Hooks gate every tool call; plan mode gates every mutation; schema retries harden every structured-output call.
- PRs browseable, reviewable, inline-commentable from the panel.
- Status line surfaces active model, active workflow, pending wake-ups, token spend, RAG attach — customizable via `statusline.md`.
- `lamprey run` CLI drives the same engine headlessly.

Lamprey is then structurally at parity with Claude Code — including the distinctive smaller tools (monitor, push notifications, cross-session messaging, slash commands, ask-user, status line, extensible subagent types, tier-aware workflows) — plus multi-provider, locally-RAG'd, fully open-source.

---

*To execute: open this document in a fresh Claude Code session inside a worktree off `main`. The session will read §0, ask which track, and proceed without further prompting.*
