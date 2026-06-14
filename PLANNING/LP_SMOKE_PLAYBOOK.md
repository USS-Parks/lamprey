# LP_SMOKE_PLAYBOOK.md — Loop Phase live validation

**Why this exists:** every better-sqlite3-backed test in this repo *skips* under vitest's Node
(NODE_MODULE_VERSION ≠ Electron's), so the loop **DB integration** (migration v17, the store,
the IPC handlers, the headless re-invocation) is **not** exercised by `npm test`. The
controller / config / tool / parser LOGIC *is* covered by running pure tests
(`loop-controller.test.ts`, `loop-config.test.ts`, `loop-tool-logic.test.ts`,
`parse-loop-command.test.ts`, `loop-safety.test.ts`, `loops-panel.wiring.test.ts`). **This
playbook is the integration gate** — run it against a real build before trusting loops in
production. Run after first install of the build that ships the Loop Phase.

Prereq: a working provider key (DeepSeek/Qwen/etc.) so turns actually run.

---

## 0. Enable loops (off by default)
1. Settings → (settings.json) set `"loopsEnabled": true`. *(No Settings UI tab yet — edit
   `userData/settings.json` directly; honest gap, see §Gaps.)*
2. Restart Lamprey. Open the right panel → **Loops** pill → panel shows "No loops yet."

**PASS:** with `loopsEnabled` absent/false, `/loop foo` toasts "Loops are off…"; with it true,
the panel opens.

## 1. Interval loop runs turns on a cadence
1. `/loop 1m say the current time and nothing else`
2. A loop appears in the panel: status `running`, mode `interval`, `next ~60s`.
3. Wait ~1 min → an assistant turn answers in the conversation; iteration increments; `next`
   resets.

**PASS:** the injected `[scheduled wake-up]`/iteration prompt actually produces an assistant
reply (this is the G1 fix — pre-LP-1 it never did). **FAIL** if the user message sits
unanswered.

## 2. Headless — runs with the window unfocused / a different conversation active
1. Start an interval loop in conversation A.
2. Switch to conversation B (or minimize the window).
3. Wait for the next fire.

**PASS:** the loop's turn still runs in A (check A's transcript + the panel iteration count).
This proves the LP-1 main-process runner, not renderer-driven re-invocation.

## 3. Self-paced loop
1. `/loop keep summarizing the open file, pausing longer each round`
2. Mode `self_paced`. Each turn the model may call `loop_control(continue, delaySeconds)` to
   set its own next cadence (or `schedule_wakeup`).

**PASS:** cadence is model-chosen; the loop continues until you stop it or it calls
`loop_control(mission_complete)`.

## 4. Autonomous "work the backlog"
1. `/loop --auto find and fix obvious typos in the README, one per iteration`
2. Mode `autonomous`. The backlog seeds with the mission. Expand the backlog in the panel.
3. Over iterations: the model should `loop_enqueue` follow-up tasks and `loop_complete_task`
   each one; the ledger ("Already done (do NOT repeat)…") keeps it from redoing work.
4. When nothing remains it calls `loop_control(mission_complete)` → status `done`.

**PASS:** backlog grows then drains; no completed task is repeated; loop self-terminates.

## 5. Ceilings trip (set low for the test)
Set in `settings.json`: `"loopMaxIterations": 3`, restart, start any loop.

**PASS:** the loop stops at iteration 3 with `stopReason: max-iterations` (panel shows
"stopped: max-iterations"). Repeat conceptually for `loopMaxWallclockMs` / `loopTokenBudget`.

## 6. Stop authorities
- **User:** Pause / Resume / Stop buttons in the panel flip status and halt/restart firing.
- **Model:** a loop that calls `loop_control(stop)` halts itself.
- **Runaway floor:** with `loopMinIntervalSeconds: 30`, a model asking for a 1s cadence is
  clamped to 30s.

**PASS:** all three halt or clamp as described; a stopped loop does not fire again.

## 7. Backlog management persists
1. In the panel, expand a loop's backlog, add a task, remove a pending task.
2. Restart Lamprey, reopen the panel.

**PASS:** the edits survive the restart (migration v17 + loop_backlog persistence).

---

## Gaps (honest, as of phase wrap)
- **No Settings UI tab** for the loop keys yet — edit `settings.json` directly. (`toolSurface` /
  `proofGate` are in the same boat per SP honest gaps.)
- **No status-line slot** for running loop entities (the panel is the surface; the wake-up
  count slot is unrelated).
- **Token budget is approximate** — estimated from prompt+reply text length, not provider usage
  numbers. Iteration + wall-clock are the hard caps.
- **DB-backed unit tests skip** under the native-binding mismatch — this playbook is the
  integration coverage by design.
