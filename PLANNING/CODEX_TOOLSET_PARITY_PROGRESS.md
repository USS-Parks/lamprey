# Codex Toolset Parity — Progress Log

Factual changelog for the work described in [CODEX_TOOLSET_PARITY_PLAN.md](CODEX_TOOLSET_PARITY_PLAN.md). One row per session, newest first. Status is what is actually in tree, not what was aspirational.

## Status legend

- **Done** — code is in tree, both tsc configs pass, all acceptance criteria met and verified.
- **Mostly done** — code is in tree and tsc passes, but one or more acceptance criteria are not yet demonstrably met (see "Known gaps").
- **Partial** — substantive work landed but the session is not finished.

## Known gaps (carry forward)

These bite across sessions; track and resolve when work resumes.

- **Plan + goal state is in-memory only.** `plan-goal-store.ts` keeps per-conversation `planSteps` + `goals` in process maps. Lamprey restarts wipe everything; nothing is persisted to disk, no settings UI exists to inspect or clear it, and there is no cross-device sync. The `{ planSteps, goals }` shape maps cleanly onto two small SQLite tables when persistence lands. Source comment now labels this as a provisional gap; same migration path as the resolved permissions-store gap (see Prompt 7 below).
- **Provider settings panels were initially orphaned.** `WebToolsSettings`, `CurrentInfoSettings`, `ImageGenSettings` are now imported and rendered from `SettingsDialog.tsx`. Verified in code; visual smoke not yet recorded.
- **Node REPL packaging path** depends on an `electron-builder` `extraResources` entry copying `resources/mcp` into the packaged app. The dev path is reached via `__dirname/../../resources/mcp/node-repl/server.js`; the production path is `process.resourcesPath/mcp/node-repl/server.js`. A static check that the resource file exists and the builder mapping is present landed in `electron/services/mcp-defaults.test.ts`. End-to-end smoke from a packaged build is still recommended before any release.
- **Apply-patch executor parser/executor tests are in tree** at `electron/services/apply-patch-tool.test.ts` and pass locally (`npx vitest run`).
- **Permission-policy tests** for the sticky per-tool and per-risk decision paths are in tree at `electron/services/permissions-store.test.ts` and pass locally. The `askUser` path (BrowserWindow round-trip) is not exercised — it requires an Electron host.
- **Module naming was cleaned up** in the cleanup pass. The old `tools-sessionNN/index.ts` directories were renamed to product-named files (`apply-patch-tool-pack.ts`, `native-dev-tool-pack.ts`, `browser-tool-pack.ts`, `web-tool-pack.ts`, `current-info-tool-pack.ts`, `image-generation-tool-pack.ts`, `node-repl-default-server.ts`). Imports in `tool-registry.ts` were updated. Source comments that read like diary entries ("Phase N", "Session NN", "Self-registering", "anchor export") were removed.

---

# Codex Agent Discipline sprint (Lamprey Implementation Plan 6.1.26)

Tracks the second sprint described in `Lamprey Implementation Plan 6.1.26.pdf` — agent contract, run-phase state, plan checklist, verification loop, parallel tool execution, and UI process visibility. The first sprint (Sessions 01–12 below) gave the model the *tool surface*; this sprint gives it the *operating discipline*.

## Revised phase order (2026-06-01)

Per user direction, prompt fatigue is a Codex-likeness blocker rather than UX polish — Codex-class agency requires the user to trust routine tool use, which collapses if every launch re-prompts for the same low-level permissions. A new **Phase 4.5 — Persistent Permission Policies** is inserted *before* the verification harness so Phase 5/8 don't multiply launch-time modals.

Revised phase order:

1. Codex Agent Contract
2. Agent Run State
3. Context Gathering Policy
4. Tool Discipline And Audit Clarity
4.5. Persistent Permission Policies *(new)*
4.6. **Production Bundle Smoke** *(new — inserted after the v0.1.25 TDZ hotfix)*
5. Verification Harness
6. UI Process Visibility
7. Prompt/Skill System Upgrade
8. Frontend Browser QA
9. **Parallel Reads And Single-Model Sub-Agents** *(renamed/widened)*
10. Regression And UX Polish

Revised prompt roster (changes in bold):

| # | Title | Status |
|---|---|---|
| 1 | Baseline Audit | Done |
| 2 | Codex Agent Contract | Done |
| 3 | Agent Run State | Done |
| 4 | Plan Checklist UI | Done |
| 5 | Context Preflight | Done |
| 6 | Safer Tool UX | Done |
| **7** | **Persistent Permission Policies** *(new)* | Done |
| **8** | **Production Bundle Smoke CI** *(new — see spec below)* | Done |
| 9 | Verification Loop (was 8) | Done |
| 10 | Frontend Browser QA (was 9) | Pending |
| 11 | **Parallel Tool Reads And Single-Model Sub-Agents** (was 10; renamed + widened — see spec below) | Pending |
| 12 | Final Response Composer (was 11) | Pending |
| 13 | Core Codex Skills (was 12) | Pending |
| 14 | End-to-End Agentic Coding Mode (was 13) | Pending |
| 15 | Regression Pass (was 14) | Pending |

### Prompt 7 spec (carry forward to implementation turn)

Persist approval decisions from `permissions-store.ts` to disk. The current sticky-decision maps stay as the in-memory layer; the new layer is a write-through SQLite table loaded on startup, with the existing in-memory paths preserved as the fallback if persistence fails.

**Policy shape**

```ts
interface PermissionPolicy {
  id: string
  scope: 'conversation' | 'workspace' | 'global'
  subjectKind: 'tool' | 'risk'
  subject: string                 // tool id (e.g. 'shell_command') or risk name ('write'|'network'|'destructive'|'secret')
  decision: 'allow' | 'deny'
  conversationId?: string         // required when scope === 'conversation'
  workspacePath?: string          // required when scope === 'workspace'; canonical resolved path
  createdAt: number               // ms epoch
  updatedAt: number               // ms epoch
}
```

**Resolution levels** (most specific → broadest):

1. conversation + tool
2. conversation + risk
3. workspace + tool
4. workspace + risk
5. global + tool
6. global + risk
7. fallback → modal

**Across matching levels**, `deny` is authoritative over `allow`; specificity decides which matching deny wins, then which matching allow wins if no deny matches. A conversation-level deny on `shell_command` beats a conversation-level allow, and a global `deny destructive` still beats a narrower allow on a destructive tool.

**Risk-policy matching:** a descriptor with `risks: ['write', 'network', 'destructive']` matches any policy whose `subject` is one of those risks. One `deny destructive globally` policy disables `shell_command`, `apply_patch`, and Chrome destructive MCP tools at once.

**Provenance:** add `approval_source` column to `tool_calls` ('modal' | `policy:<id>` | 'none') so the audit log answers "why did this run?" without guessing.

**Settings UI:** new `PermissionsSettings.tsx` panel grouping rows by scope (Conversation / Workspace / Global), per-row Delete, per-section Clear, per-section empty state. Mounted from `SettingsDialog.tsx`.

**Tests:** policy resolution order, deny precedence at same level, persisted reload across simulated app restart, clear-by-conversation, clear-by-id, modal fallback when no policy matches, risk-policy matching against a multi-risk descriptor, workspace canonicalization (worktree-aware).

**Acceptance:**

- Once a user picks "Always allow", the next app launch does not re-prompt.
- Tool-call audit rows record `approval_source` for every gated call.
- Settings panel lists and clears policies.
- If disk persistence fails, in-memory behavior survives the session and the failure is surfaced (toast or banner).
- Deny policies cannot be silently overridden by narrower allows.

### Prompt 8 spec — Production Bundle Smoke CI (carry forward)

Landed alongside the v0.1.25 TDZ hotfix as a permanent guardrail against bundler-specific regressions that vitest cannot observe. Source-tree tests run modules in declared order; the electron-vite production bundler can hoist imports across module boundaries, which is what produced the v0.1.25 launch crash.

**Surface:** a single `npm run smoke:bundle` command that stubs `electron` + `better-sqlite3` at the Node module loader and `require()`s `out/main/index.js`. Exit 0 on clean load, non-zero with a stack trace on any thrown error.

**Files:**

- `scripts/smoke-bundle.cjs` — the smoke runner. CommonJS so it bypasses the TS bundler. Stubs are kept minimal: only the surfaces touched at module-load time across main + IPC + services need to exist. App event handlers (`app.whenReady().then(...)`) never fire because the stubbed promise never resolves, so window creation, MCP startup, and other ready-time side effects don't run — the smoke only tests load-time.
- `package.json` — `"smoke:bundle": "node scripts/smoke-bundle.cjs"` added to `scripts`.
- `CONTRIBUTING.md` — added to the "Required before every PR" list (now five gates instead of four), with a paragraph explaining what class of failure the smoke catches and why source-tree tests can't.
- `.github/workflows/build.yml` — new step on both `build-windows` and `build-linux` jobs after the platform build runs. CI fails fast when the bundle is broken, even after a green install/build step.

**Covers:** ES-module import hoisting that puts a side-effect register call ahead of its target's initialization (the v0.1.25 case). TDZ ReferenceErrors during module evaluation. Missing optional dependencies that crash at top level. Pack registrations that throw because a required module loaded out of order.

**Does not cover:** native module ABI mismatches against the Electron runtime (`better-sqlite3` is stubbed so this question is dodged entirely). Runtime errors that fire from app event handlers — those need an actual Electron launch. Renderer-side bundle issues — out/renderer/ is its own bundle and would need a separate smoke.

**Acceptance:**

- `npm run smoke:bundle` against a known-good `out/main/index.js` exits 0 with a one-line PASS log.
- Reintroducing the v0.1.25 regression (side-effect imports at the bottom of `tool-registry.ts`) causes the smoke to fail with a TDZ ReferenceError stack trace.
- CI on Windows and Linux runs the smoke after the install/build step; a failed smoke blocks the PR.

### Prompt 11 spec — Parallel Tool Reads And Single-Model Sub-Agents (carry forward)

Two layers, kept distinct so the safe read-tool win lands cleanly even if the multi-agent primitive needs iteration.

**Layer 1 — Read-only tool parallelism.** Independent read-only tool calls execute concurrently when the registry marks them safe. Approval behavior preserved. Never parallelize: writes, shell mutations, browser destructive actions (`browser_click` / `browser_type` / form submits), `apply_patch`, `request_permissions`, or any descriptor whose `risks` include `write` / `destructive` / `secret`. Audit records preserved; results returned in stable order matching the model's tool-call array.

**Layer 2 — Single-model multi-agent sub-tasks.** New native primitive `multi_agent_run` fans the *same* selected model into role-prompted sub-agents, gathers their outputs, and hands a structured merged result back to the main assistant for synthesis. Internal orchestration only — the user-facing stream stays single-threaded; the run surfaces as one compact activity card ("Consulted planner, reader, verifier") with expandable details. No multi-agent theater in the chat surface.

Reuse `AGENT_ROLE_PROMPTS` + `buildAgentSystemPrompt` from `system-prompt-builder.ts`. Supported roles for v1: `planner`, `reader`, `verifier`, `reviewer`, `coworker`.

**Task input shape:**

```ts
interface SubAgentTask {
  role: 'planner' | 'reader' | 'verifier' | 'reviewer' | 'coworker'
  prompt: string                   // the role-specific user-prompt
  context: string                  // bounded payload supplied by caller
  outputFormat?: string            // explicit output requirements
}

// multi_agent_run input
interface MultiAgentRunArgs {
  tasks: SubAgentTask[]
  modelOverride?: string           // future setting; defaults to active model
  timeoutMs?: number               // per sub-agent; default 60_000
}
```

**Result shape:**

```ts
interface SubAgentResult {
  role: string
  output: string | null            // null if errored/timed out
  error?: string
  elapsedMs: number
  tokensUsedEstimate?: number
}

interface MultiAgentRunResult {
  results: SubAgentResult[]        // ordered to match input tasks
  totalElapsedMs: number
  synthesisNotes: string           // short hint for the main assistant
}
```

**Each sub-agent receives:**
- the original user request (passed through)
- relevant conversation summary or recent context (caller-supplied)
- role-specific instructions (`buildAgentSystemPrompt(role, ...)`)
- a bounded context payload supplied by the caller
- explicit output-format requirements

**Guardrails (v1):**
- max sub-agents per call: 5
- timeout per sub-agent: 60 s (configurable via `timeoutMs`)
- max context size per sub-agent: 32 KB
- no recursive `multi_agent_run` calls from sub-agents (detected and rejected)
- no tool use inside sub-agents — sub-agents reason on supplied context only; tool routing stays on the main loop
- cancellation propagates: aborting the parent run aborts all in-flight sub-agents
- every sub-agent call recorded in the tool-call audit log (one row per sub-agent, linked by parent `multi_agent_run` call id)

**UI:** single compact `MultiAgentRunCard` in the chat surface — collapsed view shows roles consulted and total elapsed; expanded shows per-role output, error/timeout, elapsed, token estimate. Inherits styling from `ToolUseCard`.

**Tests:**
- concurrent execution: 3 sub-agents finish faster than the sum of their individual durations
- stable result ordering: results array order matches input task order regardless of completion order
- partial failure: one sub-agent errors → others still return; error surfaced in its slot
- timeout: one sub-agent exceeds `timeoutMs` → marked timed-out, others return
- cancellation: parent abort propagates within < 200 ms
- max-roles limit: 6 tasks rejected with clear error
- max context size: oversized `context` rejected with clear error
- recursion guard: sub-agent attempting to call `multi_agent_run` is rejected
- tool-use guard: sub-agent attempting any tool call is rejected
- audit log: every sub-agent has a row with parent linkage

**Acceptance:**
- Layer 1 ships independent of Layer 2 — read-only parallelism works even if Layer 2 is disabled.
- Main assistant stream is never split; only `MultiAgentRunCard` surfaces orchestration.
- All sub-agent calls show in the audit log with parent linkage.
- Guardrails enforced and tested.
- No regression in single-tool / single-agent chat behavior.

## Prompt 7 — Persistent Permission Policies — Done (2026-06-01)

Approval decisions are no longer per-launch. The new `permission_policies`
SQLite table is the source of truth; the in-memory paths inside
`permissions-store.ts` survive as fallbacks that activate only when the disk
layer is unreachable. Tool-call audit rows now record `approval_source` so
the answer to "why did this run without prompting?" is in the table, not a
guess.

### Policy shape

```ts
interface PermissionPolicy {
  id: string
  scope: 'conversation' | 'workspace' | 'global'
  subjectKind: 'tool' | 'risk'
  subject: string                  // tool id or risk name
  decision: 'allow' | 'deny'
  conversationId?: string
  workspacePath?: string            // canonicalized (resolved; lowercased on win32)
  createdAt: number
  updatedAt: number
}
```

Resolution levels (most-specific → broadest):

1. conversation + tool
2. conversation + risk
3. workspace + tool
4. workspace + risk
5. global + tool
6. global + risk
7. → modal

Across all matching levels, `deny` is authoritative over `allow`; specificity
chooses which deny wins, then which allow wins if no deny matches. One global
`deny destructive` row silences `shell_command`, `apply_patch`, and the Chrome
destructive MCP tools at once; a conversation-level allow on `shell_command`
cannot override it.

### Files

- `electron/services/database.ts` — adds `permission_policies` table with
  `(scope, subject_kind, subject)`, `(conversation_id)`, and
  `(workspace_path)` indexes. Adds `approval_source` column to `tool_calls`
  via `safeAddColumn` for older DBs.
- `electron/services/permission-policies-store.ts` *(new)* — pure resolver
  (`resolveDecisionFromPolicies`) plus DB-backed CRUD (`upsertPolicy`,
  `deletePolicy`, `listPolicies`, `clearPoliciesForConversation`,
  `clearPoliciesForScope`). `canonicalWorkspacePath` resolves to absolute,
  lowercases on win32 only. In-memory fallback engages automatically if
  `getDb()` throws (covered by `__forceMemoryFallback` for tests).
- `electron/services/permission-policies-store.test.ts` *(new)* — 22 cases:
  resolution order, tool-vs-risk precedence within a level, deny precedence,
  multi-risk descriptor matching, workspace canonicalization, conversation
  isolation, upsert dedup, clear-by-conversation / clear-by-scope, modal
  fallback when nothing matches.
- `electron/services/permissions-store.ts` — refactored around the policy
  store. New `requestApprovalDetailed` returns `{ decision, source }` so
  `chat.ts` can record provenance. `setRiskPolicy` / `setGlobalPolicy` /
  `listGlobalPolicies` / `clearConversationPolicies` retained as thin
  wrappers over the new persistence layer so the legacy IPC + tests keep
  working. Modal `'always'` scope persists as global; new modal `'workspace'`
  scope persists at the active workspace path resolved via
  `getActiveWorkspace`.
- `electron/services/permissions-store.test.ts` — `beforeEach` now resets
  the policy store + forces memory fallback. All existing 13 cases still
  pass against the new persistence path.
- `electron/services/tool-calls-store.ts` — `LampreyToolCall.approvalSource`
  threaded through `insertToolCall` (with `COALESCE` so updates don't
  clobber an existing source) and through `updateToolCall`'s patch shape.
- `electron/services/tool-registry.ts` — `LampreyToolCall` type extended
  with `approvalSource`; `recordCallEnd` accepts and forwards it.
- `electron/ipc/chat.ts` — calls `requestApprovalDetailed` and threads the
  returned `source` into `recordCallEnd` as `approvalSource`. A non-gated
  call records `'none'`.
- `electron/ipc/permissions.ts` — adds five new handlers:
  `permissions:listPolicies` (returns `{ policies, memoryFallback }`),
  `permissions:addPolicy`, `permissions:deletePolicy`,
  `permissions:clearScope`, `permissions:clearConversation`. The four legacy
  global-only handlers remain and delegate to the new layer.
- `electron/preload.ts` — extends `tools.respondToApproval` scope union to
  include `'workspace'`, and adds `permissions.listPolicies` /
  `addPolicy` / `deletePolicy` / `clearScope` / `clearConversation`.
- `src/lib/types.ts` — `ApprovalScope` extended with `'workspace'`; new
  `PolicyScope`, `PolicySubjectKind`, `PermissionPolicy` mirrors.
- `src/components/tools/ToolApprovalModal.tsx` — scope `<select>` now offers
  "This workspace" and renames "Always (until restart)" to "Always (every
  workspace)" to reflect the new persistent semantics.
- `src/components/settings/PermissionsSettings.tsx` *(new)* — three-section
  panel grouped by scope (Conversation / Workspace / Global). Per-row
  Delete, per-section "Clear all" with native confirm, per-section empty
  state, amber banner when the main process reports memory fallback. Footer
  spells out the resolution order so users don't have to read the source.
- `src/components/settings/SettingsDialog.tsx` — adds the "Permissions" tab
  and mounts `<PermissionsSettings />`.

### Verification

- `tsc --noEmit -p tsconfig.node.json` — pass.
- `tsc --noEmit -p tsconfig.web.json` — pass.
- `npx vitest run` — 17 files / 236 tests pass (up from 16 / 214; this
  prompt adds 1 file / 22 tests).
- `npm run smoke:bundle` — PASS in ~324 ms.

### Acceptance criteria

- ✅ Once a user picks "Always allow", the next app launch does not re-prompt
  (decision lives in `permission_policies` and is consulted by
  `resolveDecision` ahead of the modal).
- ✅ Tool-call audit rows record `approval_source` for every gated call
  (`'modal'` when the user answered live, `'policy:<id>'` when a policy
  matched, `'none'` for non-gated calls, `'auto-deny-timeout'` for 30s
  timeouts, `'no-window'` for headless safety denies).
- ✅ Settings panel lists and clears policies — per row and per scope.
- ✅ If disk persistence fails, in-memory behavior survives the session and
  the failure is surfaced via the amber banner in `PermissionsSettings`.
- ✅ Deny policies cannot be silently overridden by narrower allows —
  precedence enforced in the pure resolver and covered by tests.

### Notes

- Workspace canonicalization is intentionally minimal: `path.resolve()` plus
  lowercasing on Windows. The spec called this "worktree-aware"; in practice
  a worktree path is just another absolute directory, so the same comparator
  works without git introspection. If a user moves a folder, their old
  workspace-scoped policies stop matching — that is correct, since the new
  location is genuinely a different folder.
- The legacy per-tool global IPC channels (`listGlobalPolicies`,
  `setGlobalPolicy`, `clearConversationPolicies`) are kept as thin wrappers
  over the new store. They are still in `preload.ts` because removing them
  is a renderer-side migration that doesn't belong in this prompt — the new
  CRUD surface (`listPolicies` / `addPolicy` / `deletePolicy` / `clearScope`
  / `clearConversation`) is what PermissionsSettings uses.
- `setRiskPolicy(risk, 'conversation', ...)` from `request_permissions` now
  writes through to a persisted row, so granting "network" in one chat
  survives an app restart. Behavior parity with the previous in-memory map
  is preserved; the change is that the grant lasts longer.
- The `'auto-deny-timeout'` and `'no-window'` source labels are not policy
  references but they distinguish a real user answer from a system bail in
  the audit table. A future audit-log UI can colour those rows differently.

## Prompt 8 — Production Bundle Smoke CI — Done (2026-06-01)

Permanent guardrail against the bundler-specific failure class that produced the v0.1.25 launch crash. Source-tree tests (vitest) import modules in their declared order; the electron-vite production bundler can hoist imports across module boundaries, so a clean `npm run build` does not prove a clean app start. The bundle smoke loads the packaged `out/main/index.js` under a stub-electron Node process and catches any thrown error at load time.

### Files

- `scripts/smoke-bundle.cjs` *(new)* — CommonJS runner so it bypasses the TS bundler. Stubs `electron` and `better-sqlite3` at the Node `Module._resolveFilename` / `Module._load` hooks; `app.whenReady()` is a never-resolving Promise so no ready-time side effects (window creation, MCP startup, tray init) ever fire. Exit 0 on clean load with PASS line; exit 1 with a stack trace on any thrown error. Verifies the bundle path exists before attempting the load — if `out/main/index.js` is missing the script tells the user to run `npm run build`.
- `package.json` — `"smoke:bundle": "node scripts/smoke-bundle.cjs"` script.
- `CONTRIBUTING.md` — "Required before every PR" list now has five gates (was four), with a paragraph explaining what class of failure the smoke catches and why vitest cannot.
- `.github/workflows/build.yml` — new "Headless smoke of main bundle" step on both `build-windows` and `build-linux` jobs, immediately after the install/build step. Both runners now fail fast on bundler-class regressions.

### Verification

- `npm run smoke:bundle` against the v0.1.25 main bundle (rebuilt with the tool-pack bootstrap split) — PASS in ~320 ms.
- `tsc --noEmit -p tsconfig.node.json` — clean.
- `tsc --noEmit -p tsconfig.web.json` — clean.
- `npx vitest run` — 16 files / 214 tests pass (unchanged from the hotfix entry).

### Notes

- The smoke does not exercise an actual Electron runtime. Native ABI mismatches against the Electron version (the kind of failure that breaks `better-sqlite3` after an Electron bump) are dodged by stubbing the module entirely. That class is covered by `electron-rebuild` in the install step and by manual launch before release.
- Renderer-side bundle (out/renderer/) has its own potential failure modes (preload/contextBridge wiring, asset paths). A separate renderer smoke is the natural follow-up if a similar bug class is ever seen there.
- The CI step runs *after* `npm run build:win` / `npm run build:linux`. A failing smoke wastes one installer build per failure, but the alternative (running the bundle build twice — once for smoke, once for the installer) is slower in the happy path. Fast-failing on real regressions matters more than optimizing the unhappy path.

## Prompt 9 — Verification Loop — Done (2026-06-02)

Adds a conservative native verification harness so post-edit checks are a first-class tool call instead of model-only prompt discipline.

### Files

- `electron/services/verify-workspace-tool.ts` *(new)* — pure executor. Resolves cwd inside the active workspace, reads package metadata, reuses `inferVerificationCommands`, skips format scripts by default, rejects non-inferred custom commands, caps command count, runs checks sequentially through the shell executor, and returns a JSON report with per-command exit, duration, timeout, output previews, and overall `passed` / `failed` / `skipped` status.
- `electron/services/verify-workspace-tool-pack.ts` *(new)* — registers native `verify_workspace`. Requires approval because project scripts can execute arbitrary code, but the persistent policy layer from Prompt 7 makes that a one-time trust choice.
- `electron/services/tool-packs.ts` — loads the verification pack.
- `electron/services/agent-run-phase.ts` — routes `verify_workspace` to the `verifying` phase so the activity pill says the agent is checking work, not editing.
- `electron/services/system-prompt-builder.ts` — coding and verification instructions now tell the model to call `verify_workspace` after edits, falling back to targeted `shell_command` checks only when the harness cannot infer the right command.
- `electron/services/verify-workspace-tool.test.ts` *(new)* — covers command selection, format-script skip behavior, arbitrary-command rejection, command caps, pass/fail reports, skipped reports, and cwd escape rejection.
- `electron/services/agent-run-phase.test.ts` — pins the `verify_workspace` -> `verifying` mapping.

### Acceptance

- ✅ One native tool runs inferred typecheck/test/lint/check/verify commands after edits.
- ✅ Format scripts are not run unless explicitly requested.
- ✅ Custom command input is restricted to exact inferred commands.
- ✅ Any failed command makes the tool-call audit status `error`; passed or skipped checks return `done` with explicit report status.
- ✅ Verification phase is surfaced through the existing run-phase UI path.

## Startup crash hotfix — tool-pack bootstrap split — Done (2026-06-01)

v0.1.25 packaged build crashed on launch with
`ReferenceError: Cannot access 'toolRegistry' before initialization` at
`out/main/index.js:1`. Classic ES-module circular import + bundler hoisting:
`tool-registry.ts` held the eight bundled tool-pack side-effect imports at the
bottom of the file, but ES module imports are hoisted regardless of source
position. electron-vite's production bundler emitted the pack registrations
above `export const toolRegistry = new ToolRegistry()`, so each pack's
top-level `toolRegistry.registerNative(...)` tripped a TDZ before the
singleton was assigned. Dev mode happened to dodge the hoist; the packaged
build did not.

### Files

- `electron/services/tool-packs.ts` *(new)* — single-purpose bootstrap that
  side-effect-imports the bundled tool packs (apply-patch, native-dev,
  workspace-context, verify-workspace, browser, web, current-info, image-generation, node-repl
  default server). File-level comment documents *why* this lives apart from
  `tool-registry.ts`.
- `electron/services/tool-registry.ts` — the eight side-effect imports at
  the bottom of the file are removed. Comment replaces them with a pointer
  to `tool-packs.ts` and a warning explaining the hoist hazard.
- `electron/ipc/index.ts` — `import '../services/tool-packs'` added at the
  top, ahead of the chat handler import. Loads the packs once at IPC
  registration, after the registry's own module body has completed.
- `electron/services/tool-registry.test.ts` *(new)* — regression guard:
  imports `tool-registry` in isolation and asserts the singleton + inline
  `memory_add` + inline `shell_command` are present. Catches the bug class
  even though it only manifested in the production bundle.

### Verification

- `tsc --noEmit -p tsconfig.node.json` — pass.
- `tsc --noEmit -p tsconfig.web.json` — pass.
- `npx vitest run` — 16 files / 214 tests pass (up from 15 / 211; this pass adds 1 file / 3 tests).

### Notes

- The crash never reproduced in `vitest` because the test runner imports
  source modules directly via esbuild's lazy transform, which executes
  imports in source order. The bug was bundler-specific. The regression test
  pins the contract at the import-shape level (registry singleton is alive
  after import) so any future re-add of side-effect-imports-from-bottom is
  caught even though tests can't observe the hoist directly.
- Native tool registrations that need to happen *before* a chat round can
  reach the registry must go through `tool-packs.ts` — the bootstrap is
  imported once from `electron/ipc/index.ts` and that is the safe spot.
  Adding a new pack: append its side-effect import to `tool-packs.ts`, do
  not touch `tool-registry.ts`.

## Post-Prompt-6 tightening — Batch 2 — Done (2026-06-01)

Second batch of the post-review tightening pass. Trims the agent contract to match wired capability, centralizes chat IPC events behind a typed emitter so missing fields are compile errors, and labels plan/goal state as a provisional gap alongside permissions persistence.

### Contract trim

The Codex Agent Contract previously told the model to do things the harness does not orchestrate — auto-detecting and using a dev server for frontend QA, and rendering docx/xlsx/pptx artifacts for visual verification. The bullets and the `frontend` / `document` role fragments now describe what is actually wired.

- `electron/services/system-prompt-builder.ts` — `verification` section: the "after frontend edits, launch the dev app" bullet is reframed to "when the user has a dev server already running, use the Browser pane … do not assume a dev server when none is reachable"; the artifact-render bullet is removed entirely. `frontend` role fragment now states the harness does not auto-detect or auto-start dev servers and asks the user where the server is running. `document` role fragment now states the harness ships no built-in render helpers for docx/xlsx/pptx/pdf and visual confirmation has to come from the user opening the file. Both fragments still satisfy the existing `system-prompt-builder.test.ts` heading and substring assertions ("browser_screenshot", "typecheck", "jargon", "tsc").

### Event schema centralization

Replaced the stringly-typed `send(channel, data)` helper with a discriminated `emitChatEvent(channel, payload)` so a missing field on a tool-call event surfaces at compile time instead of as a silent "the card doesn't render."

- `electron/services/chat-events.ts` *(new)* — `ChatEventMap` discriminated union over the eight chat-side IPC channels (`chat:chunk` / `chat:done` / `chat:error` / `chat:phase` / `chat:tool-call` / `chat:tool-call-result` / `plan:updated` / `memory:added`) plus the per-channel payload interfaces. Reuses `AgentRunPhase`, `ToolProviderKind`, and `ToolRisk` from existing modules so the type surface stays in sync. `emitChatEvent` is the typed wrapper around `BrowserWindow.webContents.send`.
- `electron/ipc/chat.ts` — every `send('chat:…')` / `send('plan:…')` / `send('memory:…')` call site migrated to `emitChatEvent`. The old `send` helper and its `getMainWindow` partner are removed; `BrowserWindow` import dropped from chat.ts since `emitChatEvent` owns the window lookup. `emitPhase` is now a thin wrapper around `emitChatEvent('chat:phase', …)`.

The renderer mirror in `src/lib/types.ts` is untouched — that side already had the correct shapes; the gap was on the main side. A future consistency pass could derive the renderer types from the same map, but that requires a shared `src/` ⇄ `electron/` module which the project does not currently have.

### Plan / goal provisional labeling

- `electron/services/plan-goal-store.ts` — file header rewritten to the same "KNOWN GAP — provisional in-memory only" framing as the permissions-store comment. Spells out the migration shape (two small SQLite tables) and points at the PROGRESS doc.
- `PLANNING/CODEX_TOOLSET_PARITY_PROGRESS.md` — "Known gaps (carry forward)" section now lists plan + goal state alongside the permissions persistence gap, with the same migration note.

### Verification

- `tsc --noEmit -p tsconfig.node.json` — pass.
- `tsc --noEmit -p tsconfig.web.json` — pass.
- `npx vitest run` — 15 files / 211 tests pass (unchanged; this batch is pure refactor + docs).

### Notes

- `emitChatEvent`'s discriminant catches the most painful schema-drift class (missing required field on an event). It doesn't catch all drift — fields with overly-loose types (e.g. `args: Record<string, unknown>`) still allow mismatched shapes between sender and receiver. The next consolidation step would be deriving the renderer event types from the same map, which needs a shared TS root.
- The contract trim was rendered tighter than ideal because the existing system-prompt-builder tests pin "browser_screenshot" and "typecheck" substrings in the frontend fragment. Stricter wording would have lost those substrings and forced test edits; the current text reads as honest "when a dev server is running" rather than "always do this" without breaking the test contract.
- Plan/goal persistence isn't urgent for v0.1 — the model uses `update_plan` during a single conversation, and the in-memory state is enough for that window. Persistence becomes urgent once the user starts relying on plans across sessions (which the in-memory implementation silently breaks).

## Post-Prompt-6 review pass — Done (2026-06-01)

External code review of Prompts 3–6 caught four regressions/gaps. Fixed in one batch; tests cover the two new pure helpers; the workspace-state file write is exercised only at runtime.

### Fixes

**P1a — Tool-call UI filtered out for every call.** `useChat.ts` filters tool events by `e.conversationId === activeConversationId` (consistent with chunk/done/error filtering), but `chat.ts` was emitting `chat:tool-call` / `chat:tool-call-result` without a conversation id, so the equality check failed and every card was silently dropped. `chat.ts` now stamps both events with `conversationId`, and the renderer types (`ToolCallEvent`, `ToolCallResultEvent`) require it.

**P1b — `workspace_context` did not honor the user-picked workspace.** Three things were broken at once: `workspace-context-tool-pack.ts` hard-bound the root to `process.cwd()`; the `Change folder…` chip in `ChatInput.tsx` only mutated local React state; and there was no persisted source of truth for the active workspace. Fixed end-to-end:

- New `electron/services/workspace-state.ts` persists the active path to `userData/active-workspace.txt` (separate file so it doesn't race settings.json read-modify-writes). 1 s read cache so the chat round doesn't stat per tool call. Falls back to `process.cwd()` when nothing is set, the file is unreadable, or the persisted path no longer exists.
- `files:setWorkdir(path)` and `files:clearWorkdir()` IPC handlers added; `files:getWorkdir` now returns the persisted path via `getActiveWorkspace()`.
- `chat.ts` resolves the active workspace once per `chat:send` and pins it for the whole round (changing the chip mid-stream does not yank cwd out from under in-flight tool calls).
- `ToolExecutionContext.workspacePath` carries the value down to handlers; `shell_command`, `apply_patch`, and `workspace_context` now read `ctx.workspacePath ?? process.cwd()`.
- `ChatInput.tsx`'s `handlePickFolder` calls `setWorkdir` after `pickWorkdir`; the "Use current process folder" reset calls `clearWorkdir` then re-fetches.

**P2 — Failed native tools rendered as success.** The old heuristic only matched `^Error:` and `^Unknown tool:`. Native tools return per-tool prefixes (`view_image error:`, `Shell error:`, `update_goal error:`, `apply_patch error:`) and successful-shell-tool output starts with `Exit: <code>` — a non-zero exit is a real failure with no error-keyword in the body. Extracted the classifier into `electron/services/tool-result-status.ts` (`classifyToolResult`) and covered it with 10 cases. `chat.ts` swapped its inline if/else for the new helper.

**P3 — Stale plan checklist survived active-conversation deletion.** `chat-store.deleteConversation` zeroed `messages` + `activeConversationId` but left `usePlanStore.snapshot`, `runPhase`, and `toolCalls` untouched. Since `PlanChecklist` and `AgentRunBanner` mount unconditionally inside `ChatView`, the deleted conversation's plan + pill bled into the welcome screen. Fixed by clearing all three when the deletion was on the active conversation.

### Files

- `electron/services/workspace-state.ts` *(new)* — `getActiveWorkspace` / `setActiveWorkspace` / `clearActiveWorkspace` / `__resetWorkspaceStateCache`. 1 s cache.
- `electron/services/tool-result-status.ts` *(new)* — `classifyToolResult` shared helper.
- `electron/services/tool-result-status.test.ts` *(new)* — 10 cases.
- `electron/ipc/files.ts` — `getWorkdir` returns persisted path; new `setWorkdir` / `clearWorkdir` handlers.
- `electron/preload.ts` — exposes `files.setWorkdir` / `files.clearWorkdir`.
- `electron/services/tool-registry.ts` — `ToolExecutionContext.workspacePath` added; `shell_command` handler reads from it.
- `electron/services/workspace-context-tool-pack.ts` — handler reads from `ctx.workspacePath`.
- `electron/services/apply-patch-tool-pack.ts` — handler reads from `ctx.workspacePath`.
- `electron/ipc/chat.ts` — workspace resolved at chat:send and threaded through `runChatRound` + `executeNative`; both tool-call events stamped with `conversationId`; classifier swap.
- `src/lib/types.ts` — `conversationId` required on `ToolCallEvent` and `ToolCallResultEvent`.
- `src/components/chat/ChatInput.tsx` — `handlePickFolder` persists via `setWorkdir`; reset path uses `clearWorkdir`.
- `src/stores/chat-store.ts` — `deleteConversation` clears `toolCalls` / `runPhase` / `usePlanStore` when the active chat is deleted.

### Verification

- `tsc --noEmit -p tsconfig.node.json` — pass.
- `tsc --noEmit -p tsconfig.web.json` — pass.
- `npx vitest run` — 11 files / 172 tests pass (up from 10 / 162; this pass adds 1 file / 10 tests).

### Notes

- The reviewer noted vitest failed locally with a Windows `spawn EPERM` while loading `vitest.config.ts`. That's an environmental issue — typically antivirus quarantining the esbuild bundler binary in `node_modules/esbuild/bin/esbuild.exe`. The suite runs cleanly in my environment and is unchanged here.
- The wider P2 fix is still a heuristic — true robustness would migrate native handlers to return `{ result, status }` instead of a plain string. That refactor touches every native pack and was scoped out of this review batch; flagged here as the next debt to pay before too many new tools rely on the string return.
- The 1 s `getActiveWorkspace` cache is to avoid stat-per-tool-call thrash during fast tool loops. If a user externally edits `active-workspace.txt`, the change appears at most 1 s later. Acceptable for v1 — the only writer in tree is `setActiveWorkspace`, which invalidates the cache directly.

## Prompt 6 — Safer Tool UX — Done (2026-06-01)

Rebuilt the tool-call surface so a glance answers "what is this, how risky, how long, did it succeed?" without expanding. Plain-English label from the descriptor `title`, risk badges (`read` / `write` / `network` / `destructive` / `secret`) with tone-coded outlines, live-ticking elapsed time while running, distinct error / denied state styling, compact one-line args summary in the header. Expanded view keeps full JSON args + result preview behind a single click. Width-safe (`min-w-0` + `truncate` on text spans, `break-words` + scrollable max-height on the expanded blocks).

### Backend enrichment

Tool-call events now carry the descriptor metadata so the renderer doesn't have to round-trip back to the registry for label + risks. The result event carries the audit status verbatim so the chat-store can stop hard-coding `'success'` for every terminal call.

### Files

- `electron/ipc/chat.ts` — `chat:tool-call` event now includes `title`, `risks`, `providerKind`, `startedAt` (resolved via `toolRegistry.getById` ahead of the existing `recordCallStart`). `chat:tool-call-result` now includes `status: 'success' | 'error' | 'denied'` mapped from the existing `auditStatus`.
- `src/lib/types.ts` — `ToolCallEvent` extended with optional `title` / `risks` / `providerKind` / `startedAt`. New `ToolCallResultStatus` union. `ToolCallResultEvent.status` added (optional for backwards-compat with cached events).
- `src/stores/chat-store.ts` — `ToolCallState.status` extended with `'denied'`. New optional `title` / `risks` / `providerKind` / `startedAt` fields. `addToolCall` now starts calls at `'running'` (the user sees the spinner immediately rather than briefly seeing a "pending" state that flips before the eye can register it) and propagates the descriptor metadata. `updateToolCall` honors the event's `status` field instead of always writing `'success'`.
- `src/lib/tool-card-helpers.ts` *(new)* — pure formatting helpers: `summarizeArgs` (`"key=value, key=value, +N more"` one-liner, strings quoted+truncated, arrays/objects collapsed by length/key count), `previewResult` (line-cap + char-cap, returns `{ text, truncated }`), `formatElapsed` (matches `StreamStatusLine`'s short form), plus the `RISK_LABEL` and `RISK_TONE` lookups consumed by the card.
- `src/lib/tool-card-helpers.test.ts` *(new)* — 17 cases across the three pure helpers.
- `src/components/chat/ToolUseCard.tsx` *(rewritten)* — collapsed view: provider letter badge, plain-English title (`displayLabel` falls back to the raw tool name when no descriptor matched), MCP server id as muted subtitle, args one-liner, risk badges (max 3 visible to protect narrow widths), elapsed timer (live while `running`, final on terminal), status indicator (spinner / pulse / check / red ✗ / muted ⊘), border tinted by terminal status. Expanded view: full pretty-printed JSON args (scrollable, capped at `max-h-64`), result block with an inline `error` or `denied` chip and tone-coded text, and a small footnote when the full result body exceeds the preview cap.

### Verification

- `tsc --noEmit -p tsconfig.node.json` — pass.
- `tsc --noEmit -p tsconfig.web.json` — pass.
- `npx vitest run` — 10 files / 162 tests pass (up from 9 / 145; this prompt adds 1 file / 17 tests).

### Notes

- The `updateToolCall` "always success" bug was a real bug, not just an aesthetic gap. A `shell_command` that returned `Error: command failed` was previously stored as `status: 'success'`, which made the audit-log filter for failed calls return nothing useful. Fixed as part of this prompt.
- `useLiveElapsed` polls at 500 ms instead of 1000 ms because sub-second tool calls (memory reads, quick lookups) would otherwise sit at "0s" the whole time. Matches the perceptual "feels live" threshold without thrashing React.
- I did **not** add a render-time test for `ToolUseCard` because vitest's `node` environment doesn't ship a DOM. The three pure helpers cover the formatting logic; the JSX is exercised manually in the dev app (still pending the visual-smoke pass flagged at the end of Prompt 4).
- Risk badges are capped at 3 visible — `shell_command` carries `['write','network','destructive']` and that fits exactly. Wider risk vectors will show the first three and silently drop the rest; the full set is still available in the expanded view via the descriptor (and in `tool_calls` audit rows).

## Prompt 5 — Context Preflight — Done (2026-06-01)

Added a native `workspace_context` tool — one read-only call returns cwd, git status summary (branch / ahead / behind / capped change list), `package.json` name/version/scripts, detected frameworks, instruction files, and inferred verification commands. Replaces the "four separate reads" pattern at the start of a coding task. The Codex Agent Contract's context section now points at this tool by name.

### Tool shape

```jsonc
{
  "cwd": "<abs path>",
  "git": {
    "branch": "main",
    "isDirty": true,
    "ahead": 0,
    "behind": 0,
    "changedFiles": [{ "status": "M", "path": "..." }, ...],
    "totalChanged": 12,
    "truncated": false
  },
  "package": { "name": "...", "version": "...", "scripts": { ... } } | null,
  "frameworks": ["react", "electron", "vite", "tailwindcss", "typescript", ...],
  "instructionFiles": ["AGENTS.md", "CLAUDE.md", "README.md"],
  "verificationCommands": ["npm test", "npm run lint", "npx tsc --noEmit -p tsconfig.node.json", ...],
  "notes": []
}
```

### Files

- `electron/services/workspace-context-tool.ts` *(new)* — pure module. Exports: `resolveInsideWorkspace` (path-safety), `readPackageManifest`, `detectFrameworks` (lookup against a stable 21-entry known list, matches deps/devDeps/peerDeps), `findInstructionFiles` (canonicalizes capitalization), `inferVerificationCommands` (scripts + per-root tsconfig fallback when no typecheck script exists, deduped, capped at 8), `parseGitStatusOutput` (porcelain v1 + branch line parser, separable from spawn for tests), and the async `executeWorkspaceContext` composer. 8 KB default cap, 32 KB max, two-stage truncation (drop most changedFiles first, then hard-slice).
- `electron/services/workspace-context-tool-pack.ts` *(new)* — registers `workspace_context` as a `read`-risk native tool, `requiresApproval: false`. Description nudges the model to call it once at the start of a coding task.
- `electron/services/workspace-context-tool.test.ts` *(new)* — 30 cases across `resolveInsideWorkspace`, `readPackageManifest`, `detectFrameworks` (ordering + no-substring-matching), `findInstructionFiles`, `inferVerificationCommands` (scripts + tsconfig branch + suppression when typecheck script exists + 8-cap), `parseGitStatusOutput` (clean / ahead+behind / detached / mixed XY codes / truncation), plus integration cases against a real tempdir workspace (rejects escape, honors `cap_bytes`, nested cwd, no package.json).
- `electron/services/tool-registry.ts` — imports `./workspace-context-tool-pack` alongside the existing packs.
- `electron/services/system-prompt-builder.ts` — Codex Agent Contract `context` section: the misnamed `load_workspace_dependencies` reference is replaced with the accurate `workspace_context` call. `load_workspace_dependencies` (Session 07) remains as the runtime-deps probe tool with its existing scope unchanged.

### Verification

- `tsc --noEmit -p tsconfig.node.json` — pass.
- `tsc --noEmit -p tsconfig.web.json` — pass.
- `npx vitest run` — 9 files / 145 tests pass (up from 8 / 115; this prompt adds 1 file / 30 tests).

### Notes

- `workspace_context` and `load_workspace_dependencies` are intentionally separate. The former is about *workspace orientation* — where am I, what's the git state, how do I verify? The latter is about *runtime probe* — what Node/Python is available to run helpers against? The contract previously conflated them; this prompt fixes the bullet.
- `git` execution is the only impure part of the executor; the porcelain parser is exported separately and exercised in tests without spawning a child process. On a non-git directory `summarizeGitStatus` returns an `error` field on the git object rather than throwing — the model can still read everything else.
- The verification-command inference is deliberately conservative: it surfaces what's in `scripts` plus root tsconfigs when no typecheck script exists. It does not (yet) shell out to `pytest --collect-only` or sniff Cargo/poetry/etc. for non-Node projects. Easy to extend when needed.

## Prompt 4 — Plan Checklist UI — Done (2026-06-01)

Connected the existing `update_plan` / plan-goal-store tool surface (Session 07) to a visible, live, per-conversation checklist that sits above the run-phase pill. Empty plan ⇒ component renders nothing — the UI cost is zero until the model uses the tool. Tool writes broadcast `plan:updated` over IPC so the renderer refreshes without polling.

### Files

- `electron/services/plan-goal-store.ts` — adds public `getPlanSnapshot(conversationId)` and a strictly-monotonic `monoNow()` source for `createdAt` / `updatedAt`. `__resetPlanGoalStore` resets the cursor. `UpdatePlanInput.steps[].text` relaxed to optional at the TS layer (the executor already preserved prior text on update calls; the model-facing JSON schema still requires text for appends).
- `electron/services/plan-goal-store.test.ts` *(new)* — 17 cases covering merge-mode (append, update by id, text preservation, unknown-id append), replace-mode (full wipe, supplied ids honored), snapshot totals + per-conversation isolation + defensive copies, and goals (create / validate empty title / monotonic updatedAt / unknown-id throw / null on missing get / list sorted descending).
- `electron/ipc/plan.ts` *(new)* — `plan:get` handler returning the snapshot. No write handlers — model writes flow through `update_plan` and chat.ts broadcasts the change.
- `electron/ipc/index.ts` — registers the plan handlers.
- `electron/ipc/chat.ts` — after a successful native `update_plan` tool call, parses the JSON snapshot the executor returned and emits `plan:updated` to the renderer. Silent fallback if the shape ever drifts.
- `electron/preload.ts` — new `plan` namespace: `plan.get(conversationId)` invoke + `plan.onUpdated(cb)` listener returning an unsubscribe.
- `src/lib/types.ts` — renderer-side `PlanStep`, `PlanStepStatus`, `PlanSnapshot`, `PlanUpdatedEvent` mirrors.
- `src/stores/plan-store.ts` *(new)* — Zustand store. `loadForConversation` fetches the snapshot, guards against stale fetches when the user switches mid-flight. `applyUpdate` drops events for non-active conversations. `clear` for forced reset.
- `src/stores/chat-store.ts` — `selectConversation` and `createConversation` trigger `loadForConversation` so the plan view follows the active chat.
- `src/hooks/useChat.ts` — subscribes to `plan.onUpdated`, filters by active conversation via the existing `matchesActive` helper, hands the snapshot to the plan store. Unsubscribe wired into the existing cleanup.
- `src/components/chat/PlanChecklist.tsx` *(new)* — compact card. Header reads "Plan · 2/5 done" (`var(--success)` when fully done). Each step renders a status icon (filled accent for in-progress with pulse, success checkmark for done, hollow circle for pending) + the step text (struck-through when done). Renders null when there are no steps.
- `src/components/chat/ChatView.tsx` — mounts `<PlanChecklist />` above the run-phase banner in the input column.

### Verification

- `tsc --noEmit -p tsconfig.node.json` — pass.
- `tsc --noEmit -p tsconfig.web.json` — pass.
- `npx vitest run` — 8 files / 115 tests pass (up from 7 / 98; this prompt adds 1 file / 17 tests).

### Notes

- `updateGoal` mutates the goal in place and returns the same reference — this is pre-existing behavior, not new. The test snapshots `goal.updatedAt` into a local before calling `updateGoal` so it can compare correctly. `applyUpdatePlan` already returns defensive copies via `planSnapshot`, so it does not need this dance.
- `monoNow()` is the right defensive primitive even though the failing test that surfaced it was actually a test-code bug — on Windows, system clock resolution makes Date.now()-based sort orders unreliable across back-to-back calls, and goal lists sorted by `updatedAt` would have non-deterministic order without strict monotonicity.
- The PlanChecklist does not let the user edit the plan from the UI — it is read-only by design. The prompt's "Avoid a large project-management UI" line argues for keeping the surface compact; manual plan editing would be a separate, larger surface. The model owns plan mutations via `update_plan`.

## Prompt 3 — Agent Run State — Done (2026-06-01)

Added a first-class run-phase model to the chat loop and a single-agent **run-phase pill** repurposing the dormant `AgentRunBanner` slot. The pill mirrors plain-English labels — "Reading your message", "Reading project", "Editing", "Checking result", "Wrapping up" — so the user sees what Lamprey is doing without parsing the stream. Multi-agent pipeline rendering preserved behind `mode === 'multi'` as scaffolding for the planned single-model multi-agentic-workflows primitive (Prompt 11 in the current roster).

### Phase model

`AgentRunPhase` = `understanding | gathering_context | planning | acting | verifying | summarizing | done | error`. All eight values defined as a stable type; `planning` and `summarizing` are not auto-emitted yet (Prompts 11 and 13 wire them when the contract role layer and final-response composer land). `verifying` is emitted by the Prompt 9 `verify_workspace` tool.

### Files

- `electron/services/agent-run-phase.ts` *(new)* — `AgentRunPhase` type, `inferPhaseFromDescriptor` helper, `VERIFICATION_TOOLS` set, `ACTING_RISKS` set. No electron imports — pure module suitable for vitest in the node env.
- `electron/services/agent-run-phase.test.ts` *(new)* — 8 cases covering pure-read / read+network / network-only / write / destructive-only / secret / empty-risks / mixed-write-and-read.
- `electron/ipc/chat.ts` — adds `emitPhase(conversationId, phase)` helper, emits `understanding` on user-message save, per-tool phase before approval gate (so the pill reflects the call even if the modal opens), `done` on no-tool-calls onDone, `error` on every error branch (max-rounds, stream error, outer catch).
- `electron/preload.ts` — adds `chat.onPhase(cb)` listener; `chat:phase` added to `chat.offAll()`.
- `src/lib/types.ts` — adds renderer-side `AgentRunPhase` (mirror) and `ChatPhaseEvent`.
- `src/stores/chat-store.ts` — adds `runPhase: AgentRunPhase | null`, `setRunPhase` action, optimistic set to `'understanding'` inside `sendMessage`, clears on `selectConversation` / `createConversation` / `finishStream` / `streamError`.
- `src/hooks/useChat.ts` — subscribes to `onPhase`, filtered by `matchesActive`, maps terminal phases to `null` and transient phases to the live value.
- `src/components/chat/AgentRunBanner.tsx` *(repurposed)* — single-agent branch renders compact `RunPhasePill` with plain-English label, accent dot, `role="status"` for accessibility; multi-agent branch (`mode === 'multi' && activeRun.length > 0`) preserves the original planner→coder→reviewer pipeline view.
- `src/components/chat/ChatView.tsx` — mounts `<AgentRunBanner />` above `<TokenTicker />` in the input column so the pill sits adjacent to the chat input but renders nothing when no run is active.

### Verification

- `tsc --noEmit -p tsconfig.node.json` — pass (no output).
- `tsc --noEmit -p tsconfig.web.json` — pass (no output).
- `npx vitest run` — 7 files / 98 tests pass (up from 6 / 90; this prompt adds 1 file / 8 tests).

### Notes

- `runPhase` is set to `'understanding'` optimistically in `sendMessage` before the IPC round-trip so the pill is visible from the first frame after submit, then the main process's `chat:phase` events drive subsequent transitions.
- The renderer-side `AgentRunPhase` mirror in `src/lib/types.ts` is a duplicated type — the two `tsconfig` roots cannot share types directly (same pattern as `LampreyToolDescriptor` mirrored in tool-registry/types.ts). Keep them in sync if a new phase value lands.
- The `chat.onPhase` listener uses a runtime narrowing (`onPhase` on `window.api.chat` is detected, not assumed) so a stale renderer talking to a refreshed preload doesn't throw. Same defensive pattern as the existing `onAgentStatus` branch.
- Multi-agent banner branch is currently unreachable in normal use (`agentMode` is never `'multi'` post the multi-model-output removal). Kept intentionally per user direction — the `multi_agent_run` primitive (Prompt 11 in the current roster) reuses this slot for the sub-agent fan-out card.

## Prompt 2 — Codex Agent Contract — Done (2026-06-01)

Replaced the one-paragraph default base prompt with a structured 7-section Codex Agent Contract appended to the honest-identity head, plus 6 named role fragments (`coding` / `review` / `planning` / `frontend` / `document` / `non_technical_user`) that callers layer on top. Provider-neutral; preserves the existing honest-model-identity rule; preserves the legacy `AGENT_ROLE_PROMPTS` + `buildAgentSystemPrompt` scaffolding for the planned multi-agentic-workflow primitive (single underlying model, parallel sub-tasks).

### Files

- `electron/services/system-prompt-builder.ts` — new `ContractRole` type, `CONTRACT_SECTIONS` data (intent / context / tools / file_safety / verification / progress / final_response), `ROLE_FRAGMENTS` map, `renderContract()` and `getRoleFragment()` exports. `buildSystemPrompt()` gains an optional `contractRole?: ContractRole` 6th parameter; default base now `${identityHead}\n\n${renderContract()}`. Override path still bypasses the contract verbatim.
- `electron/services/system-prompt-builder.test.ts` — new 21-case vitest suite covering: contract rendering + ordering, identity sentence presence, AGENTS.md / memory / skill ordering, override bypass, role-fragment layering, `buildAgentSystemPrompt` round-trip.

### Verification

- `tsc --noEmit -p tsconfig.node.json` — pass (no output).
- `tsc --noEmit -p tsconfig.web.json` — pass (no output).
- `npx vitest run` — 6 files / 90 tests pass (up from 5 / 69; this prompt adds 1 file / 21 tests).

### Notes

- `chat.ts` call site of `buildSystemPrompt(skillContents, memoryBlock, override, agentsMd, model)` is unchanged — the new `contractRole` param is optional and absent in current calls. The "End-to-End Agentic Coding Mode" prompt (Prompt 14 in the current roster) will wire it from a user setting.
- The contract contains a forward reference to `load_workspace_dependencies` as the workspace-context preflight loader; the existing native dev tool fills that role. Prompt 5 ("Context Preflight") will extend it.

## Prompt 1 — Baseline Audit — Done (2026-06-01)

Read the prior parity sprint output, the new implementation-plan PDF, the system prompt builder, the chat IPC, the tool registry, and the chat UI surface. No edits. Produced an implementation map separating "tool surface already shipped" (Sessions 01–12) from "agent discipline gaps still open" (system prompt is bare, no run-phase state, plan/goal exist as tools but not UI, no verification step in the loop, no parallel scheduling, no final-response composer, no `codex-*` skills, no Agentic Coding toggle, `AgentRunBanner` is dead in single-model mode). Identified Prompt 2 (Codex Agent Contract) as the smallest unblocking next slice — single file, no IPC / UI / permission churn — and surfaced two carry-forward risks for the user: in-memory permission persistence (will compound prompt fatigue as more risk-gated tools land) and the AgentRunBanner repurpose decision.

---

## Session 12 — Node REPL MCP Server — Mostly done (2026-06-01)

Bundles a Node REPL MCP server inside the app and registers it idempotently at startup. Gives the model a persistent VM context with top-level await, captured console, and a require() that walks user-added module paths — through the existing mcp-manager pipeline.

### Files

- `resources/mcp/node-repl/server.js` — standalone MCP server. `vm` module for the persistent sandbox; `module.createRequire` for in-VM require(); top-level await via `(async () => { return (CODE); })()` wrapper. Two-layer timeout (sync via `vm.runInContext({timeout})`, async via `Promise.race`). Output capped at 30 KB stdout + 30 KB result.
- `resources/mcp/node-repl/package.json` — `type: "module"`. No third-party deps.
- `resources/mcp/node-repl/README.md` — usage notes.
- `electron/services/mcp-defaults.ts` — `getNodeReplServerPath()` (dev vs prod path), `getDefaultMcpServers()`, `ensureDefaultMcpServers()` (idempotent).
- `electron/services/node-repl-default-server.ts` (formerly `tools-session12/index.ts`) — side-effect module that awaits `mcpManager.initialize()` then calls `ensureDefaultMcpServers()`.
- `electron/services/mcp-manager.ts` — adds optional `env?: Record<string,string>` to `McpServerConfig`; `connectStdio` merges it on top of `process.env`. New public `addServerIfMissing(config)` and `upsertManagedDefault(config)`.

### Verification

- `tsc --noEmit -p tsconfig.node.json` — pass.
- `tsc --noEmit -p tsconfig.web.json` — pass.
- `node --check resources/mcp/node-repl/server.js` — pass.
- `electron/services/mcp-defaults.test.ts` — pass. Confirms `resources/mcp/node-repl/server.js` and a `type:module` `package.json` are in tree and the `extraResources` mapping in `electron-builder.yml` is present.
- MCP handshake / tools/list / state-persistence checks were performed manually during the original implementation pass; not yet captured in an automated test.

### Gaps

- End-to-end smoke from a packaged build (i.e. that the runtime resolver finds the file under `process.resourcesPath` after `electron-builder`) is still recommended before any release.

---

## Session 11 — Image Generation Provider — Mostly done (2026-06-01)

Three native image tools (`image_generate`, `image_edit`, `image_variation`) behind a pluggable provider abstraction. OpenAI is live; Stability is a stub returning "not implemented".

### Files

- `electron/services/image-gen-providers.ts` — `ImageGenProvider` interface, OpenAI implementation, Stability stub, factory. 25 MB input cap. 60 s AbortController. Key redaction on error.
- `electron/services/image-tools.ts` — pure executors writing into `userData/artifacts/images/`.
- `electron/services/image-generation-tool-pack.ts` (formerly `tools-session11/index.ts`) — descriptors with `requiresApproval: false`.
- `electron/ipc/image-tools.ts` — `imageGen:setProvider`, `:getProvider`, `:test`. Snapshot returns `hasKey: boolean`.
- `src/components/settings/ImageGenSettings.tsx` — provider selector, encrypted key input, model + size defaults, Save / Test buttons. Now imported by `SettingsDialog.tsx`.

### Gaps

- `requiresApproval: false` for image generation was originally annotated as "safe because the user has configured a provider". Cleaned up: now labeled as opt-in via Settings; the source comment in `image-generation-tool-pack.ts` simply states the policy and points at the gap rather than claiming a guarantee.

---

## Session 10 — Finance / Weather / Sports — Mostly done (2026-06-01)

Three native current-information tools — `finance_quote`, `weather_lookup`, `sports_lookup`.

### Files

- `electron/services/current-info-tools.ts` — pure executors. Finnhub `/quote` or Alpha Vantage `GLOBAL_QUOTE`; Open-Meteo (default) or OpenWeatherMap; TheSportsDB `searchteams` / `eventsnext` / `eventslast`. 15 s AbortController.
- `electron/services/current-info-tool-pack.ts` (formerly `tools-session10/index.ts`) — three descriptors, all `risks: ['network','read']`, `requiresApproval: false`.
- `electron/ipc/current-info.ts` — set/get/test handlers.
- `src/components/settings/CurrentInfoSettings.tsx` — three-card panel. Now imported by `SettingsDialog.tsx`.

### Keychain

- `finance:finnhub`, `finance:alphavantage`, `weather:openweather`. Open-Meteo and TheSportsDB are key-free.

---

## Session 09 — Web Tools Adapter Framework — Mostly done (2026-06-01)

Five tools — `web_search`, `web_open`, `web_find`, `image_search`, `time_lookup` — behind a provider-agnostic adapter framework (Brave, Tavily, SerpAPI, SearXNG).

### Files

- `electron/services/web-search-adapters.ts` — `WebSearchAdapter` interface and four implementations. `getWebSearchAdapter()` reads settings + keychain. 15 s AbortController.
- `electron/services/web-tools.ts` — pure executors. `LruPageCache` (cap 10) keyed by URL. `stripHtmlToText` strips `<script>`/`<style>`/`<noscript>`, decodes entities, collapses whitespace. 1 MB body cap on `fetch`, 50 KB returned-text cap. `executeTimeLookup` uses `Intl.DateTimeFormat`. `probeAdapter` for test IPC.
- `electron/services/web-tools.test.ts` — 10 vitest cases.
- `electron/services/web-tool-pack.ts` (formerly `tools-session09/index.ts`) — five descriptors.
- `electron/ipc/web-tools.ts` — `webTools:setProvider`, `:getProvider`, `:testAdapter`, `:deleteKey`.
- `src/components/settings/WebToolsSettings.tsx` — provider list, key input, SearXNG endpoint input, Test button. Now imported by `SettingsDialog.tsx`.

### Verification

- tsc on both configs — pass.
- `npx vitest run` — passes locally (post-cleanup the full suite is 69/69, 5 files).

---

## Session 08 — Browser Automation Tools — Mostly done (2026-06-01)

Seven native `browser_*` tools wrapping browser-manager.

### Files

- `electron/services/browser-tools.ts` — executors. Wraps `webContents.loadURL` / `executeJavaScript` / `findInPage` / `capturePage`. `JSON.stringify` selector + text before injection. 15 s nav timeout, 5 s find timeout. Regex-based sandbox check on `executeBrowserEvaluateReadonly`.
- `electron/services/browser-tool-pack.ts` (formerly `tools-session08/index.ts`) — seven descriptors. Click and type are `requiresApproval: true`.
- `electron/services/browser-manager.ts` — adds `BrowserTabHandle`, `getTab(id)`, `getActiveTab()`.

---

## Session 07 — Native Plan / Goal / Image View / Terminal / Dependencies — Mostly done (2026-06-01)

Eight native developer tools — `view_image`, `read_thread_terminal`, `load_workspace_dependencies`, `request_permissions`, `update_plan`, `get_goal`, `create_goal`, `update_goal`.

### Files

- `electron/services/plan-goal-store.ts` — in-memory per-conversation plan + goals. `applyUpdatePlan` (merge or replace), `createGoal`, `updateGoal`, `getGoal`, `listGoals`. (`getPlan` export removed during cleanup — unused.)
- `electron/services/native-aux-tools.ts` — pure executors. `executeViewImage` (workspace + userData/artifacts boundary, extension allow-list, 20 MB cap), `executeReadThreadTerminal` (PTY buffer tail), `executeLoadWorkspaceDependencies` (Node + Python probe), `executeRequestPermissions` (re-enters `permissionsService.requestApproval`).
- `electron/services/native-dev-tool-pack.ts` (formerly `tools-session07/index.ts`) — eight descriptors.
- `electron/services/pty-manager.ts` — added rolling buffer (cap 200 KB). New exports: `ptyGetBuffer(id)`, `ptyListSessions()`, `PTY_READ_CAP = 50_000`.

### Notes

- `request_permissions` descriptor is `requiresApproval: false` because the handler itself is the approval call (would otherwise double-prompt). Source comment now states this explicitly.

---

## Session 06 — Native apply_patch Tool — Done (2026-06-01)

Codex-style patch envelope, hand-rolled parser + applier.

### Files

- `electron/services/apply-patch-tool.ts` — pure executor (no electron imports). `parsePatch` state machine, `resolvePathWithinWorkspace` traversal guard, `executeApplyPatch(args, workspaceRoot)` returning `{ result: string }`. Errors surface as `Error: <reason>` strings.
- `electron/services/apply-patch-tool.test.ts` — vitest suite added during cleanup pass.
- `electron/services/apply-patch-tool-pack.ts` (formerly `tools-session06/index.ts`) — descriptor, `risks: ['write','destructive']`, `requiresApproval: true`.

---

## Session 05 — Native shell_command Tool — Done (2026-06-01)

PowerShell on Windows, bash elsewhere. Permission-gated; workspace boundary enforced inside the executor too.

### Files

- `electron/services/shell-tool.ts` — pure executor. `resolveCwdWithinWorkspace` boundary primitive, `formatShellResultForModel` text formatter. 30 s default / 600 s ceiling / 30 KB per-stream cap. SIGTERM -> 1 s grace -> SIGKILL.
- `electron/services/shell-tool.test.ts` — 16 vitest cases.
- `vitest.config.ts` — minimal vitest config.
- `electron/services/tool-registry.ts` — adds `NativeToolHandler`, `ToolExecutionContext`, handler map, `executeNative`.
- `electron/ipc/chat.ts` — dispatch branch for native handlers between `memory_add` and the MCP branch.
- `package.json` — adds `test` / `test:watch` scripts.

### Verification

- tsc on both configs — pass.
- `npx vitest run` — passes locally (16/16 in `shell-tool.test.ts`).

---

## Session 04 — Permission and Approval Core — Mostly done (2026-06-01)

Generic risk-driven approval gate. Replaces the Chrome-specific destructive-action block in chat.ts. Cleanup pass relabeled comments to make the in-memory-only persistence and missing settings UI honest.

### Files

- `electron/services/permissions-store.ts` — `permissionsService` singleton. Sticky policies (global + per-conversation). 30 s auto-deny. `respond` / `respondLegacy` / `cancelPending`. `listGlobalPolicies` / `setGlobalPolicy` / `clearConversationPolicies`.
- `electron/ipc/permissions.ts` — five handlers including `tools:respondToApproval` and the `mcp:approveToolCall` legacy shim.
- `src/components/tools/ToolApprovalModal.tsx` — risk badges, scope selector, 30 s countdown. Replaces `ConfirmationModal`.
- `electron/ipc/chat.ts` — removed inline Chrome approval block, removed `pendingConfirmations`, now `descriptor.requiresApproval ? permissionsService.requestApproval(...) : 'allow'`.
- `electron/ipc/index.ts` — registers `registerPermissionsHandlers()`.
- `electron/preload.ts` — adds `tools.onApprovalRequired`, `tools.respondToApproval`, `permissions:` namespace.
- `src/lib/types.ts` — renderer-side approval types.
- `src/App.tsx` — swaps `ConfirmationModal` for `ToolApprovalModal`.
- `CLAUDE.md` — updates stale note about `mcp:approveToolCall` ownership.
- Deleted `src/components/mcp/ConfirmationModal.tsx`.

### Gaps

- Policies do not persist across launches.
- There is no settings UI to inspect/clear them today.
- Source comments were updated in the cleanup pass to label this explicitly rather than calling it a "future policy".

---

## Session 03 — Tool Audit Log — Done (2026-06-01)

`tool_calls` table in better-sqlite3.

### Files

- `electron/services/database.ts` — adds `tool_calls` CREATE + two indexes.
- `electron/services/tool-calls-store.ts` — `insertToolCall` (upsert), `updateToolCall`, `listRecentToolCalls`, `listToolCallsForConversation`, `getToolCall`. Caps `result_preview` at 4 KB.
- `electron/services/tool-registry.ts` — uses tool-calls-store rather than in-memory.
- `electron/ipc/tools.ts` — adds `tools:getCallsForConversation`.
- `electron/preload.ts` — adds `tools.getCallsForConversation(conversationId, limit?)`.
- `src/stores/tools-store.ts` — adds `conversationCalls` + `loadCallsForConversation`.

---

## Session 02 — Tool Registry Skeleton — Done (2026-06-01)

Unified tool registry replaces inline tool assembly in chat.ts.

### Files

- `electron/services/tool-registry.ts` — `ToolRegistry` singleton.
- `electron/ipc/tools.ts` — `tools:list` / `tools:get` / `tools:getRecentCalls`.
- `src/stores/tools-store.ts` — renderer Zustand store.
- `electron/ipc/chat.ts` — removed inline `MEMORY_ADD_TOOL` + inline MCP tools loop; now `toolRegistry.getOpenAITools()`.
- `electron/ipc/index.ts`, `electron/preload.ts`, `src/lib/types.ts` — wire-up.

---

## Session 01 — Baseline Audit — Done (2026-06-01)

Audited the codebase before any parity work. Documented the pre-existing ESLint 10 / flat-config failure as a separate Phase 0 cleanup, not a parity blocker. Full 7-angle research dump landed in [CODEX_TOOLSET_PARITY_RESEARCH.md](CODEX_TOOLSET_PARITY_RESEARCH.md) as the companion artifact for the plan.
