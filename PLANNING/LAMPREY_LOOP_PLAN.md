# LAMPREY_LOOP_PLAN.md — Loop Phase (LP-0 … LP-11)

**Status: DRAFT — awaiting explicit user approval. No code changes until green light (STS).**

Drafted 2026-06-14 on worktree `sad-newton-d2e91a` after a five-track exploration of the
chat turn path, the cron-automations spine, the workflow runner, the settings/IPC
conventions, and — decisively — a direct read of the **already-present, half-built loop
scaffold** (`loop-runner.ts`, `loop-tool-pack.ts`, `loop_wakeups` table, `window.api.loops`,
activity/status-line integration).

User decisions on file (2026-06-14):
1. This is a **deliberate, documented extension PAST the Opus 4.5 era-lock** (per
   `project_era_lock_scope`). The plan must document it as such, not smuggle it in.
2. Target = **all the way to autonomous "work-the-backlog" loops**, flawlessly integrated and
   verified/validated before deployment.
3. Re-invocation model = **headless main-process runner** (loops advance with the window
   closed/unfocused; the renderer observes).
4. Backlog model = **dedicated loop-backlog queue** (a new table the loop drains; the model
   can grow it).

---

## §0 Conventions (verify gate + discipline)

Same discipline as the SP / UB / CR phases:

1. **Verify gate per prompt:** `npx tsc --noEmit -p tsconfig.node.json` +
   `npx tsc --noEmit -p tsconfig.web.json` + targeted `npx vitest run <touched modules>`.
2. **Any prompt that touches `electron/ipc/chat.ts`** also runs
   `npm run verify:proof -- --no-tests` (exits 0) — this is LP-1 specifically.
3. **Final phase gate (LP-11):** full `npx vitest run` + `npx electron-vite build` +
   `npm run verify:proof`.
4. **Commit per prompt:** `feat(loops): LP-N <summary>` (or `fix`/`docs`/`refactor` as fits).
   No co-author trailer. No squashing across prompts.
5. **DEVLOG entry per prompt** under a new `## 2026-06-14 — Loop Phase` section, established
   format (files changed + verify gate + honest notes).
6. **No pushes mid-phase.** Push + Bucket land at LP-11 only, and only when the user says so
   (push-when-told rule).
7. **Worktree:** runs on `claude/sad-newton-d2e91a` (current) unless redirected.

**Honest coverage note, stated once:** the existing `loop-runner.test.ts` and every other
better-sqlite3-backed suite **skip** under the NODE_MODULE_VERSION mismatch (vitest's Node ≠
Electron's V8). Therefore the controller/ceiling/autonomy logic in this phase is written
**against an injected runner seam so its tests run as pure logic** (no DB, no native binding)
and do NOT silently skip. DB-touching tests still skip honestly; the manual
`LP_SMOKE_PLAYBOOK.md` (LP-10) is the real integration gate, run live by the user before ship.

---

## §1 Goal

Deliver a **first-class Loop primitive** spanning the full autonomy gradient — **interval →
self-paced → autonomous backlog** — that re-invokes real chat turns **headlessly in the main
process**, drains a **dedicated backlog queue**, is bounded by **hard ceilings** (iterations,
wall-clock, token budget, stall, runaway-rate), is **observable** (running-loop status +
backlog panel), and is **off by default** behind a master toggle, honoring the era-lock's
"power machinery is opt-in, never default" rule.

This is *not* greenfield. It is **close the broken re-invocation seam → promote one-shot
wake-ups into a recurring loop entity → layer ceilings + autonomy + observation on top.**

---

## §2 Baseline evidence (what exists, with locations)

### Already built and wired (the scheduling half of a self-paced loop)
| # | Component | Location |
|---|---|---|
| B1 | `loop_wakeups` table (pending/fired/cancelled/error + due/conversation indexes) | `electron/services/schema-init.ts:308` |
| B2 | `scheduleWakeup` / `cancelWakeup` / `listWakeups` / `fireDueWakeups` / `startLoopWakeups` (30s tick) / `stopLoopWakeups` | `electron/services/loop-runner.ts` |
| B3 | Runner **booted on launch**, stopped on shutdown | `electron/main.ts:610`, `:674`, `:392` |
| B4 | **Model-callable `schedule_wakeup` native tool** (risks `['write']`, no approval) | `electron/services/loop-tool-pack.ts` |
| B5 | IPC `loops:schedule` / `loops:cancel` / `loops:list` | `electron/ipc/loops.ts` |
| B6 | Preload `window.api.loops.{schedule,cancel,list,onFired}` | `electron/preload.ts:605` |
| B7 | Renderer: `WakeupPill`, activity-dashboard `'loop'` nodes (`LoopWakeupSnapshot`, `refreshWakeups`, `cancelWakeup`), status-line pending-count slot, typed event-log rows | `src/App.tsx:314`, activity store/dashboard, `StatusLine.tsx` |
| B8 | DB-backed schedule/fire/cancel test (skips under native mismatch) | `electron/services/loop-runner.test.ts` |

### The confirmed defect (this is why "loops" don't loop today)
| # | Defect | Evidence |
|---|---|---|
| **G1** | **A fired wake-up never runs a turn.** `fireDueWakeups()` injects a `[scheduled wake-up]` **user** message and emits `loop:wakeup:fired`; the renderer reacts at `src/App.tsx:316–326` by **reloading the message list + conversation list — it never calls `chat:send`.** The injected prompt sits unanswered. Today's feature is a *deferred-reminder injector*, not a loop. | `loop-runner.ts:137–170` + `App.tsx:316–326` (read directly) |
| **G2** | **Single-fire only.** Each wake-up is one row; nothing re-schedules a next iteration. No recurring entity. | `loop-runner.ts` (no recurrence) |
| **G3** | **Renderer-coupled + foreground-only.** The only reaction to a fire requires the app open AND that conversation active. No headless execution. | `App.tsx:320` (`activeConversationId === conversationId` guard) |
| **G4** | **No autonomy, no backlog, no ceilings, no settings toggle, no `/loop` command, no running-loop observation.** | absence across tree |

### Governance gap (must be reconciled, not hidden)
The loop scaffold — plus the cron-automations (`automations-runner.ts`), the workflow runner
(`workflow-runner.ts`), background agents, and the activity dashboard — came from an earlier
agentic-infrastructure / "Data Spine" phase that **CLAUDE.md's Current-State list does not
document** (that list ends at Unburdening). LP-11 reconciles CLAUDE.md with the actual tree
and records the deliberate past-era extension.

---

## §3 Scope / Non-goals

**In scope:** the headless turn-runner extraction (fixes G1 for the existing `schedule_wakeup`
tool too); a recurring `loops` entity + `loop_backlog` queue + `loop_runs` audit (migration
v17); a loop controller with the full autonomy gradient; model loop-control tools; hard
ceilings + stall/runaway guards; settings (off by default) + IPC + preload + renderer store;
a `/loop` slash command; running-loop observation + backlog-management panel; tests + a live
smoke playbook; governance/docs/ship.

**Non-goals (explicitly out):**
- **No change to the cron-automations subsystem** (`automations-runner.ts`) — loops and cron
  stay distinct primitives (warm in-session recurrence vs. cold scheduled recurrence). Reuse
  patterns, don't merge.
- **No change to the workflow runner** (`workflow-runner.ts`) — fan-out ≠ loop. A loop *may*
  call `multi_agent_run` from inside an iteration, but the workflow engine is untouched.
- **No new provider/model behavior.** Loops drive the same `runChatRound` path.
- **No auto-on.** The master toggle ships **OFF**; no loop can start without explicit opt-in.
- **No mid-phase push.** No README/version churn until LP-11.
- The `goals` / `plan_steps` backlog sources (the other two options) are **deferred** — the
  dedicated queue is v1; those can layer later behind the same controller.

---

## §4 Target architecture

### 4.1 Data model (migration v17, append-only in `db-migrations.ts`)
- **`loops`** — `id`, `conversation_id`, `mode` (`'interval'|'self_paced'|'autonomous'`),
  `status` (`'running'|'paused'|'stopped'|'done'|'error'`), `instruction`, `model`,
  `interval_seconds` (nullable), `max_iterations`, `max_wallclock_ms`, `token_budget`
  (nullable), `iteration` (default 0), `tokens_used` (default 0), `started_at`,
  `last_iteration_at`, `next_fire_at`, `stop_reason`, `created_at`, `updated_at`.
- **`loop_backlog`** — `id`, `loop_id`, `position`, `task`, `status`
  (`'pending'|'in_progress'|'done'|'skipped'|'error'`), `result`, `created_at`, `started_at`,
  `finished_at`. Index on `(loop_id, status, position)`.
- **`loop_runs`** — `id`, `loop_id`, `iteration`, `backlog_id` (nullable), `started_at`,
  `finished_at`, `status` (`'running'|'done'|'error'|'timeout'`), `tokens_used`,
  `created_at`. Per-iteration audit trail.
- `loop_wakeups` (B1) is **reused** as the self-paced single-fire cadence mechanism.

### 4.2 Headless turn runner (the G1 fix)
Factor `runHeadlessTurn(conversationId, prompt, model, opts)` out of the `chat:send` handler
(`chat.ts:208–520`). The IPC handler becomes a thin wrapper over it (WC-style "both paths
share one implementation"). It: persists the user message, registers an AbortController in
`activeAbortControllers` (so `chat:cancel` **and** loop-cancel both work), runs `runChatRound`
with the full tool-dispatch loop, emits the same stream events (renderer observes if open;
no-ops harmlessly if closed), and resolves with the assistant message. `fireDueWakeups` is
rewired to call it — closing G1 for the pre-existing `schedule_wakeup` tool immediately.

### 4.3 Loop controller (`loop-controller.ts`, new)
`tickLoops(now)` (folded into the existing 30s runner) finds `running` loops with
`next_fire_at <= now` and runs one iteration each, serially per `loopMaxConcurrent`.
`runLoopIteration(loop, deps)` — with `deps.runTurn` injected so tests run pure:
1. **Pre-flight ceilings** → stop with `stop_reason` if `iteration >= max_iterations`,
   `elapsed >= max_wallclock_ms`, or `tokens_used >= token_budget`.
2. **Pull next backlog item** (`status='pending'`, lowest `position`). If none → loop `done`
   (`stop_reason='backlog-empty'`), unless autonomous mode and the model re-enqueues.
3. Mark item `in_progress`; build the iteration prompt = `instruction` + the task + a
   **progress ledger** (iteration N, items remaining, prior outcomes — idempotency guard so
   settled work is not redone).
4. `await deps.runTurn(...)` (→ `runHeadlessTurn`), wrapped in a **per-iteration stall
   watchdog** + wall-clock budget (reuse the stream-inactivity pattern).
5. Record `loop_run`, add tokens to `tokens_used`, increment `iteration`, mark backlog item
   `done`/`error`, compute `next_fire_at` per mode, persist, emit `loop:iteration:*`.
6. **Stop authorities:** user cancel (`status='stopped'`), model self-terminate
   (`loop_control` → `stop`/`mission-complete`, or no reschedule + empty backlog), guard trip.

### 4.4 Autonomy gradient (cadence per mode)
- **interval** — `next_fire_at = now + interval_seconds*1000` (user-clocked; floor-clamped).
- **self_paced** — cadence from the model's `schedule_wakeup` call that turn, else a default;
  the existing tool finally drives a real turn (via 4.2).
- **autonomous** — backlog-driven; short delay while items remain, `done` when drained and
  nothing rescheduled; the model may `loop_enqueue` more work. **Runaway guard:**
  inter-iteration delay clamped to `loopMinIntervalSeconds`.

### 4.5 Model-callable tools (extend `loop-tool-pack.ts`)
- `schedule_wakeup` (exists) — keep.
- `loop_enqueue` — append task(s) to the current loop's backlog (autonomous self-growth).
- `loop_complete_task` — mark the current backlog item done + short result (ledger).
- `loop_control` — `pause` / `stop` / `mission-complete` (model self-terminate).
All gated: meaningful only when `ctx` carries a `loopId`; no-ops/clear errors otherwise.

### 4.6 Settings (off-by-default; `AppSettings` + `DEFAULT_APP_SETTINGS` + renderer mirror + parity test)
`loopsEnabled?: boolean` (**default `false`**), `loopMaxIterations?` (default 25),
`loopMaxWallclockMs?` (default 1_800_000), `loopTokenBudget?` (default 500_000 — `0`/null =
iteration-bounded only), `loopMaxConcurrent?` (default 1), `loopMinIntervalSeconds?` (default
30 — runaway floor). Every entry point (`schedule_wakeup` already excepted as pre-existing,
controller, IPC create, `/loop`) checks `loopsEnabled` and refuses cleanly when off.

### 4.7 Observation
Promote the activity-dashboard + status-line from "pending wake-up count" to a running-loop
entity: `loop · iter N/max · next in T · budget X%`. New **Loops panel** (right-panel pill +
`ui-store` `ToolId` `'loop'`): list loops with status/progress/budget; view/edit the backlog
queue (add / reorder / remove / skip); pause / resume / stop.

---

## §5 Prompt Roster

### **LP-0 — Baseline + extension declaration (docs only)**
- [ ] Write `PLANNING/LP_BASELINE.md`: the B1–B8 inventory, the G1–G4 gaps (with the
  `App.tsx:316–326` re-invocation defect quoted), the §4 target architecture, and the explicit
  **"deliberate documented past-era extension"** statement tying to `project_era_lock_scope`.
  No code.
- Verify: doc renders; no tsc/test impact.

### **LP-1 — Headless turn runner extraction (closes G1)**
- [ ] Factor `runHeadlessTurn(...)` out of the `chat:send` handler in `electron/ipc/chat.ts`;
  the IPC handler calls it. Rewire `fireDueWakeups` (`loop-runner.ts`) to invoke it so a fired
  `schedule_wakeup` wake-up now produces a real assistant turn. AbortController registered for
  cancellability. **Observable:** a scheduled wake-up fires → an assistant reply is persisted
  (not a dangling user message), with the app's active conversation elsewhere or closed.
- Verify: tsc node+web; `npx vitest run` for chat + loop-runner touched suites;
  **`npm run verify:proof -- --no-tests` exits 0** (chat.ts touched).

### **LP-2 — Loop data layer (migration v17 + `loop-store.ts`)**
- [ ] Append migration v17 to `electron/services/db-migrations.ts` creating `loops`,
  `loop_backlog`, `loop_runs` (idempotent `CREATE TABLE IF NOT EXISTS` + indexes). New
  `electron/services/loop-store.ts`: CRUD for loops, backlog (enqueue/next/reorder/mark), runs.
  **Observable:** migration runs once, `user_version` → 17; store round-trips a loop + backlog.
- Verify: tsc node; `npx vitest run` for migration + store tests (DB tests skip honestly under
  native mismatch — pure helpers tested directly).

### **LP-3 — Loop controller core: interval mode + ceilings + stop authorities**
- [ ] New `electron/services/loop-controller.ts`: `tickLoops` + `runLoopIteration` for
  **interval** mode, with an injected `deps.runTurn` seam. Enforce all ceilings
  (iterations/wall-clock/token-budget) + backlog-empty + user-cancel stops; record `loop_runs`.
  Fold `tickLoops` into the existing 30s runner. **Observable (pure test):** a controller with
  a stub runner drains a 3-item backlog serially and halts on each ceiling with the right
  `stop_reason`.
- Verify: tsc node; `npx vitest run electron/services/loop-controller.test.ts` (pure, no skip).

### **LP-4 — Self-paced mode + model loop tools**
- [ ] Tie `schedule_wakeup` into a loop entity for self-paced cadence. Add `loop_enqueue`,
  `loop_complete_task`, `loop_control` to `loop-tool-pack.ts` (gated on `ctx.loopId`).
  **Observable:** model tools mutate backlog/loop state; `loop_control:stop` halts the loop.
- Verify: tsc node; `npx vitest run` for loop-tool-pack tests.

### **LP-5 — Autonomous "work-the-backlog" mode + idempotency + runaway guard**
- [ ] Controller autonomous mode: progress-ledger prompt injection, model `loop_enqueue`
  self-growth, self-terminate on drained backlog, `loopMinIntervalSeconds` runaway clamp.
  **Observable (pure test):** an autonomous loop grows then drains its backlog, does not redo a
  `done` item, and cannot schedule faster than the floor.
- Verify: tsc node; `npx vitest run` for controller autonomous tests.

### **LP-6 — Per-iteration stall watchdog + spill GC hook**
- [ ] Wrap each iteration in a stall watchdog (reuse the stream-inactivity primitive) + a
  per-iteration wall-clock budget; on stall, abort the iteration, record `timeout`, decide
  continue/stop. Call `gcSpillDir()` at loop start for long-runners. **Observable:** a stalled
  iteration aborts cleanly without wedging the loop.
- Verify: tsc node; `npx vitest run` for watchdog tests.

### **LP-7 — Settings + IPC + preload + renderer store**
- [ ] Add the §4.6 keys to `src/lib/types.ts` `AppSettings`,
  `electron/services/default-app-settings.ts`, the `src/stores/settings-store.ts` mirror, and
  the parity test (`default-app-settings.test.ts`). Extend `electron/ipc/loops.ts` with
  `loops:create/update/pause/resume/stop/list/listBacklog/enqueue/reorderBacklog/removeBacklog`
  + preload `window.api.loops.*` + new `src/stores/loops-store.ts`. Every entry point checks
  `loopsEnabled`. **Observable:** with `loopsEnabled=false`, create refuses; parity test green.
- Verify: tsc node+web; `npx vitest run` for settings parity + IPC envelope tests.

### **LP-8 — `/loop` slash command**
- [ ] Built-in `/loop` parse→dispatch in `src/components/chat/ChatInput.tsx`:
  `/loop <task>` (self-paced), `/loop 5m <task>` (interval), `/loop --auto <mission>`
  (autonomous). Gated on `loopsEnabled` (toast if off). **Observable:** each form creates the
  right loop mode; off-toggle shows a clear message.
- Verify: tsc web; `npx vitest run` for the slash-parse test.

### **LP-9 — Observation UI: running-loop status + Loops/backlog panel**
- [ ] Promote activity-dashboard + status-line to the running-loop entity
  (`loop · iter N/max · next in T · budget X%`). Add `'loop'` to `ui-store` `ToolId` + a Loops
  right-panel pill (`RightPanelHome.tsx`) with backlog add/reorder/remove/skip +
  pause/resume/stop. **Observable:** a running loop shows live iteration/budget; backlog edits
  persist.
- Verify: tsc web; `npx vitest run` for any source-lock/era-chrome assertions.

### **LP-10 — Safety hardening + smoke playbook**
- [ ] Consolidate runaway/budget/iteration/stall validation tests; verify the `loopsEnabled`
  gate at every entry point (tool, IPC, slash, controller). Write `PLANNING/LP_SMOKE_PLAYBOOK.md`
  — live manual checks: interval loop runs turns headlessly with the window closed; self-paced
  loop re-enters; autonomous loop drains + self-terminates; each ceiling trips; user-cancel and
  model-stop both halt. **Honest note in the playbook:** DB-backed loop tests skip under the
  native mismatch → the playbook IS the integration gate.
- Verify: tsc node+web; `npx vitest run` (full) green.

### **LP-11 — Governance wrap + ship**
- [ ] Reconcile `CLAUDE.md` Current-State (record the pre-existing agentic-infra layer +
  the new Loop phase + the deliberate past-era extension); update the `project_era_lock_scope`
  memory; DEVLOG phase-complete entry; `package.json` version bump; README per the
  readme-is-part-of-ship rule. **Push + Bucket only when the user says so.**
- Verify: full gate — `npx vitest run` + `npx electron-vite build` + `npm run verify:proof`.

---

## §6 Approval state
- **APPROVED 2026-06-14** by user with decisions (1) past-era extension (2) autonomous
  backlog (3) headless runner (4) dedicated queue. STS authorized + Bucket on completion.
