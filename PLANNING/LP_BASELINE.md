# LP_BASELINE.md — Loop Phase pre-change baseline

Captured 2026-06-14 on worktree `sad-newton-d2e91a`, before any LP-1 code.

## Deliberate past-era extension (declared)

Lamprey's scope is locked to the Claude Code / Opus 4.5 era (2025-11-24 → 2026-01-24) per
`project_era_lock_scope`. The Loop Phase is a **deliberate, documented extension PAST that
lock**, authorized by the user on 2026-06-14. Autonomous loops are a post-era capability; they
ship **off by default** (`loopsEnabled=false`) so the era-faithful default experience is
unchanged. This file + CLAUDE.md (LP-11) record the extension so it is never mistaken for
era-parity drift.

## What already exists (the scheduling half — wired)

| # | Component | Location |
|---|---|---|
| B1 | `loop_wakeups` table (pending/fired/cancelled/error + due/conversation indexes) | `electron/services/schema-init.ts:308` |
| B2 | `scheduleWakeup`/`cancelWakeup`/`listWakeups`/`fireDueWakeups`/`startLoopWakeups` (30s)/`stopLoopWakeups` | `electron/services/loop-runner.ts` |
| B3 | Runner booted on launch / stopped on shutdown | `electron/main.ts:610`, `:674`, `:392` |
| B4 | Model-callable `schedule_wakeup` native tool (risks `['write']`, no approval) | `electron/services/loop-tool-pack.ts` |
| B5 | IPC `loops:schedule` / `loops:cancel` / `loops:list` | `electron/ipc/loops.ts` |
| B6 | Preload `window.api.loops.{schedule,cancel,list,onFired}` | `electron/preload.ts:605` |
| B7 | Renderer: `WakeupPill`, activity-dashboard `'loop'` nodes, status-line pending count, event-log rows | `src/App.tsx:314`, activity store/dashboard, `StatusLine.tsx` |
| B8 | DB-backed schedule/fire/cancel test (skips under native mismatch) | `electron/services/loop-runner.test.ts` |

## The confirmed defect — fired wake-ups never run a turn (G1)

`fireDueWakeups()` (`loop-runner.ts:137–170`) injects a `[scheduled wake-up]` **user** message
and emits `loop:wakeup:fired`. The only reaction is in the renderer at `src/App.tsx:316–326`:

```
window.api.loops.onFired((e) => {
  if (conversationId === activeConversationId) {
    conversation.getMessages(conversationId).then(... setState messages ...)  // RELOAD ONLY
  }
  chat.loadConversations()
})
```

It **reloads the message list — it never calls `chat:send`.** The injected prompt sits
unanswered. Consequences:
- **G1** A fired wake-up never produces an assistant turn. The "loop" doesn't loop.
- **G2** Single-fire only; no recurring entity re-schedules a next iteration.
- **G3** Renderer-coupled + foreground-only (`activeConversationId === conversationId` guard);
  nothing happens headless or with the window closed.
- **G4** No autonomy, no backlog, no ceilings, no settings toggle, no `/loop`, no running-loop
  observation.

## Governance gap

The loop scaffold + cron-automations (`automations-runner.ts`) + workflow runner
(`workflow-runner.ts`) + activity dashboard came from an earlier agentic-infra / "Data Spine"
phase that **CLAUDE.md's Current-State list does not document** (it ends at Unburdening).
LP-11 reconciles CLAUDE.md with the actual tree.

## Target architecture (see LAMPREY_LOOP_PLAN.md §4)

Headless main-process turn runner (closes G1) → recurring `loops` entity + dedicated
`loop_backlog` queue + `loop_runs` audit (migration v17) → controller with the full autonomy
gradient (interval → self-paced → autonomous) → model loop-control tools → hard ceilings +
stall/runaway guards → settings (off by default) + IPC + store → `/loop` command → running-loop
observation + backlog panel → tests + live smoke playbook → governance/docs/ship.

## Baseline verify state

- `npx tsc --noEmit -p tsconfig.node.json` → exit 0
- `npx tsc --noEmit -p tsconfig.web.json` → exit 0
- (worktree `node_modules` junctioned to primary so the toolchain resolves; build + Bucket run
  from primary per the bucket-from-primary rule.)
