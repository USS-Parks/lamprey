# Lamprey Live Audit Hardening Phase - Plan + Sequential Prompt Roster

> **Status: draft for user review.** Do not execute this roster until the user approves it. This plan is based on the live repository audit performed on 2026-06-05.

**Goal:** close the three ship-readiness findings from the live repo audit without broad refactors: harden JavaScript workflow/hook isolation, prevent plugin-installed connectors from auto-spawning local processes without explicit trust, and restrict main-window external URL opening to safe schemes.

**Why this phase exists:** the current codebase has strong recent hardening work around shell sandboxing, URL safety, keychain consent, and tool approvals. The live audit found a smaller but serious set of remaining gaps at the edges of those systems:

- `vm`-based workflows and JS hooks are described as sandboxed, but exposed host functions make `process` reachable.
- Plugin bundles can include MCP `stdio` connector definitions, and enabled plugin connectors are auto-connected, which can spawn local commands immediately after install/enable.
- Main-window popup handling forwards arbitrary URLs to the OS external opener, while the IPC external-open path already limits itself to HTTP(S).

**Execution model:** single worktree off `main`, sequential H1 -> H6. No track splits unless the user explicitly asks for parallel implementation. H1 defines the shared isolation model; H2 and H3 apply it to workflows and hooks; H4 gates plugin connectors; H5 closes external-open scheme handling; H6 is the verification and documentation tail.

**Companion to:** [`LAMPREY_SANDBOX_PARITY_PLAN.md`](LAMPREY_SANDBOX_PARITY_PLAN.md), [`LAMPREY_CUSTOMIZE_PLAN.md`](LAMPREY_CUSTOMIZE_PLAN.md), and [`LAMPREY_SNIP_PLAN.md`](LAMPREY_SNIP_PLAN.md). Those are reference-only for format and neighboring architecture.

---

## 0. SESSION BOOTSTRAP - READ THIS FIRST

You are a fresh coding session handed this document. Before doing anything else:

### Step 1 - Confirm environment

Verify:

- Working directory is `C:\Users\17076\Documents\Claude\Lamprey Harness` or a worktree thereof.
- Current branch is not `main`. Create a worktree branch such as `feat/live-audit-hardening` off `main` if needed.
- `git status --short --branch` is inspected before editing. Do not revert unrelated user changes.
- Baseline checks pass before H1 starts:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`

If any baseline check fails, halt and report the exact failure. Do not start on a broken baseline.

### Step 2 - Execute H1 -> H6 in order

1. Do not ask further questions unless a prompt requires a decision only the user can make.
2. For each prompt:
   - Read the "Files" list and the nearby existing code before editing.
   - Implement only the prompt's scope.
   - Run the prompt's verify gate.
   - If verify fails: fix and retry up to 2 times. On the third failure, halt, write a blocked DEVLOG entry, and report.
   - If verify passes: mark the prompt `[x]` in this file, append a DEVLOG entry, then commit. Do not push.
3. One commit per prompt. No batching, no amending across prompts unless the user explicitly asks.
4. When all prompts complete: run the phase completion criteria, write the phase-complete DEVLOG entry, and report final status.

### Step 3 - DEVLOG entry format

```markdown
## [Live Audit Hardening - Prompt HN] <Title> - <YYYY-MM-DD>

**Files changed:** <list>
**Verify gate:**
- typecheck OK
- lint OK
- vitest <subset or all> OK (N tests)
- build/smoke/manual checks, or "user-verification-needed: <what to check>"

**Notes:** <anything surprising, deferred, or worth knowing>

**Commit:** <SHA>
```

### Step 4 - Commit discipline

- One commit per prompt.
- Never use `--no-verify`. If a hook fails, fix the underlying issue.
- Never add a `Co-Authored-By` trailer.
- Use the project's commit-message style, for example:
  - `fix(hardening): H1 add isolated script runner`
  - `fix(plugins): H4 require trust before plugin stdio connectors`

---

## 1. Audit Summary - What Exists vs. What Is Missing

| Capability | Current state | Target | Owner prompt |
|---|---|---|---|
| Workflow JS execution | Node `vm` context with documented API, but host timer functions are exposed | Workflow code cannot reach host `process`, `require`, `Function`, `child_process`, or Electron globals | H1, H2 |
| Hook JS execution | Node `vm` context with host `log`, `Date`, `JSON`, `Math` exposed | Hook code cannot escape via host function constructors; JS hook docs match actual isolation | H1, H3 |
| Sandbox regression tests | Tests cover `Math.random` and `Date.now` guards, not host escape vectors | Tests assert every exposed binding fails common escape probes | H1, H2, H3 |
| Plugin connectors | Enabled plugin roots contribute `connectors.json`; stdio connectors auto-connect | Plugin MCP connectors install disabled/untrusted and require explicit user trust before connect | H4 |
| Plugin install from manifest | Manifest `files` can create `connectors.json` and manifest defaults to enabled | Install can still write assets, but connector execution is inert until trusted | H4 |
| External URL opening | `shell:openExternal` IPC restricts to HTTP(S); main-window popup handler does not | One shared allowlist guard limits external opens to HTTP(S) everywhere | H5 |
| Documentation and release notes | No live-audit hardening phase notes yet | README/DEVLOG/plan reflect the shipped hardening and residual risks | H6 |

**Non-goals for this phase:**

- No redesign of the workflow language.
- No removal of workflows, hooks, plugins, or MCP.
- No remote plugin marketplace policy.
- No full OS-level sandbox replacement on Windows.
- No unrelated audit backlog from older plans.

---

## 2. Architectural Invariants - Locked

Treat these as binding across all six prompts.

1. **Do not describe Node `vm` as a security boundary unless escape probes prove it.** If using `vm`, all host callable functions must be wrapped or avoided, string code generation must be disabled where possible, and tests must pin the boundary.
2. **Workflow and hook APIs stay useful.** `agent`, `parallel`, `pipeline`, `phase`, `log`, `workflow`, `memory`, `askUser`, `args`, `budget`, and hook context bindings remain available unless the prompt explicitly replaces them with safer equivalents.
3. **No host functions cross the boundary raw.** Timer/log/helper bindings must not expose constructors that can return host `process`.
4. **Plugin-provided `stdio` connectors are executable capability.** They must be treated closer to shell/network tools than to passive skill markdown.
5. **Install is not trust. Enable is not trust.** A plugin may be installed and enabled for passive assets while its `stdio` connector remains untrusted.
6. **Trusted connector state is auditable and reversible.** Users can see why a connector is blocked, trust it explicitly, and revoke that trust.
7. **External-open allowlist is central.** Main-process popup handling and IPC external-open use the same scheme validation helper.
8. **Verification is evidence-based.** If an Electron UI or platform behavior cannot be fully exercised in the coding session, record `user-verification-needed` rather than claiming it.

---

## 3. The Six Prompts

### Prompt sequence

| # | Prompt | One-liner | Files (net new / modified) | Verify | Status |
|---|---|---|---|---|---|
| H1 | **Isolated script runner + escape probes** | Create a shared script-isolation test harness and runner contract for untrusted JS. Add regression probes for `Function`, host function constructors, timers, `Date`, `log`, `Object.constructor`, `this.constructor`, `process`, `require`, dynamic import, and `child_process`. This prompt may introduce a safer helper such as `electron/services/isolated-script-runner.ts`; it should not yet rewire all production callers unless the helper is simple and low-risk. | `electron/services/isolated-script-runner.ts` (new if useful), `electron/services/isolated-script-runner.test.ts` (new), `electron/services/workflow-runner.test.ts`, `electron/services/hooks-runner.test.ts` | unit: escape probes fail in the shared runner; unit: runner still supports allowed API calls; unit: timeout still interrupts sync infinite loop; typecheck; lint | [ ] |
| H2 | **Workflow sandbox remediation** | Rewire `workflow-runner.ts` to use the H1 isolation model. Replace raw host timers/logging with safe wrappers or a worker/process boundary. Preserve workflow features: top-level async IIFE, `agent`, `parallel`, `pipeline`, `phase`, `workflow`, `memory`, `askUser`, `args`, `budget`, and deterministic guards for `Date.now`, `new Date`, and `Math.random`. Add direct tests proving workflow scripts cannot reach host `process` through timers or any exposed API. | `electron/services/workflow-runner.ts`, `electron/services/workflow-runner.test.ts`, `electron/services/isolated-script-runner.ts` (if H1 created it) | unit: current workflow tests pass; unit: `setTimeout.constructor("return process")()` cannot reach process; unit: allowed workflow API still runs; unit: abort/timeout behavior unchanged; typecheck; lint; `npm test` subset for workflow | [ ] |
| H3 | **Hook sandbox remediation + docs alignment** | Rewire JS hooks to the same isolation boundary. Replace raw `log`, `console`, `Date`, `JSON`, and `Math` exposure with safe context-owned bindings. Decide and document the legacy shell-hook policy: existing shell-language rows may remain as explicitly legacy/executable, but new UI-created hooks stay JS-only unless user explicitly opts into shell execution. Update the settings copy so it does not overpromise isolation. | `electron/services/hooks-runner.ts`, `electron/services/hooks-runner.test.ts`, `src/components/settings/HooksSettings.tsx`, optional `electron/services/database.ts` if legacy policy metadata is needed | unit: current hook tests pass; unit: `log.constructor("return process")()` and `Date.constructor("return process")()` fail; unit: throwing `preToolUse` hook still blocks tool call; jsdom/UI smoke for settings copy if available; typecheck; lint | [ ] |
| H4 | **Plugin connector trust gate** | Treat plugin `connectors.json` entries, especially `stdio`, as executable capabilities. Add trust state for plugin-owned MCP servers. Plugin connectors load as blocked/untrusted by default and do not auto-connect until user trust is granted. Persist trust decisions, show blocked status in connector/customize UI, and add revoke flow. Keep passive plugin assets (skills, slash commands, README) working. | `electron/services/mcp-manager.ts`, `electron/services/plugin-loader.ts`, `electron/ipc/plugins.ts` or `electron/ipc/mcp.ts`, `electron/preload.ts`, `src/components/customize/ConnectorsColumn.tsx`, `src/components/customize/PluginsColumn.tsx`, `src/stores/plugins-store.ts`, tests | unit: plugin `stdio` connector does not instantiate `StdioClientTransport` before trust; unit: trusted connector connects; unit: revoke disconnects and blocks reconnect; unit: passive plugin skills still load; typecheck; lint; targeted tests | [ ] |
| H5 | **External-open scheme hardening** | Add one main-process helper for OS external opens that accepts only HTTP(S). Use it in `mainWindow.webContents.setWindowOpenHandler`, `shell:openExternal`, GitHub/browser doc-link paths where appropriate, and any artifact external-open bridge. Deny `file:`, `javascript:`, `data:`, `view-source:`, custom protocols, and empty/malformed URLs. | `electron/main.ts`, optional `electron/services/external-open.ts` (new), `electron/preload.ts` if type comments change, `electron/ipc/github.ts` if it has a separate opener path, tests | unit: helper accepts `http://` and `https://`; unit: helper rejects dangerous schemes; unit or mock: window-open handler denies and does not call `shell.openExternal` for rejected schemes; typecheck; lint | [ ] |
| H6 | **Phase verify + docs + approval packet** | Run the full verification gate and document the hardening. Add a phase-complete DEVLOG entry, update README/security notes if needed, and leave this plan marked shipped only after all prompts are done. Include a short "approval packet" summary listing what changed, what was tested, and any residual risks. | `DEVLOG.md`, `README.md` or `CLAUDE.md` if needed, `PLANNING/LAMPREY_LIVE_AUDIT_HARDENING_PLAN.md` | `npm run typecheck`; `npm run lint`; `npm test`; `npm run build` or `npx electron-vite build`; user-verification-needed UI smoke if plugin trust UI cannot be fully exercised | [ ] |

---

## 4. Prompt Details

### H1 - Isolated script runner + escape probes

**Goal.** Establish the shared safety contract before touching production callers.

**Work.**

- Add a reusable probe suite that can run against workflow and hook contexts.
- Include the exact escape candidates found during the live audit:
  - `setTimeout.constructor("return typeof process")()`
  - `log.constructor("return typeof process")()`
  - `Date.constructor("return typeof process")()`
- Include broader probes for:
  - `Function("return process")`
  - `this.constructor.constructor(...)`
  - `Object.constructor(...)`
  - `globalThis.process`
  - `require`
  - `import("node:child_process")`
  - `constructor.constructor("return require")`
- If a shared runner is created, its API should accept:
  - script source
  - filename/name for diagnostics
  - timeout
  - allowed bindings
  - optional async completion
- The helper must be usable by both workflows and hooks without introducing Electron imports into pure service tests.

**Acceptance.**

- Escape probes fail with clear errors or return `undefined`, never host `process`.
- Allowed bindings still work in a tiny fixture.
- Timeout behavior is covered.
- No production behavior is changed unless the helper is directly adopted in H1 with tests.

---

### H2 - Workflow sandbox remediation

**Goal.** Make workflow execution match its documented isolation boundary.

**Work.**

- Replace raw host timer exposure in `workflow-runner.ts`.
- Keep workflow-visible delay behavior if possible. If direct timers cannot be safely exposed, provide a safe `sleep(ms)` workflow helper and migrate bundled workflows if any rely on `setTimeout`.
- Keep deterministic blockers for `Date.now`, `new Date`, and `Math.random`.
- Ensure `args` is either deep-cloned or clearly treated as input-only.
- Keep `budget` frozen.
- Add explicit tests that every workflow-exposed binding fails the H1 probes.

**Acceptance.**

- Existing workflow tests continue to pass.
- The live-audit timer escape is closed.
- Agent, parallel, nested workflow, memory, budget, askUser, abort, and timeout tests remain green.

---

### H3 - Hook sandbox remediation + docs alignment

**Goal.** Close the same host escape in hook JS and align UI wording with the actual guarantees.

**Work.**

- Replace raw `log` and `console.*` with safe wrappers that cannot expose host constructors.
- Avoid exposing host `Date`, `JSON`, and `Math` raw if their constructors can escape. Prefer context-owned copies or a safe wrapper subset.
- Confirm `args` mutations still do not escape the caller.
- Keep `preToolUse` throwing behavior as the block mechanism.
- Review shell-language hook support:
  - Existing migrated rows can remain executable if explicitly labeled legacy.
  - New UI-created hooks should remain JS-only unless a separate explicit shell-hook trust flow exists.
- Update `HooksSettings.tsx` text to avoid saying "sandboxed vm" without qualification if Node `vm` remains part of the implementation.

**Acceptance.**

- Hook escape probes fail.
- Existing hook behavior remains: logging works, args snapshot is read-only to caller, `preToolUse` throws can block, `postToolUse` cannot block.
- Settings copy is accurate and understandable.

---

### H4 - Plugin connector trust gate

**Goal.** Prevent plugin install/enable from implicitly executing local connector commands.

**Work.**

- Add a trust state for plugin-owned MCP connectors, keyed by plugin id + connector id and stable across restarts.
- Change `refreshPluginConnectors()` so untrusted plugin connectors are listed as blocked/untrusted and do not call `connectServer`.
- Add trust and revoke operations through IPC/preload.
- Add UI affordances:
  - blocked badge for untrusted plugin connectors
  - "Trust and connect" action with clear warning that `stdio` starts a local process
  - "Revoke trust" action
- Keep plugin skill/slash-command loading unchanged.
- Consider whether SSE plugin connectors also require trust. The default should be yes for consistency, but `stdio` must be the highest-warning case.

**Acceptance.**

- Installing a manifest that writes `connectors.json` does not spawn a process.
- Enabling a plugin does not spawn a `stdio` process until trust is granted.
- Trusting a connector connects it.
- Revoking trust disconnects it and prevents reconnect.
- Passive plugin assets still work.

---

### H5 - External-open scheme hardening

**Goal.** Make every OS external-open path reject unsafe schemes.

**Work.**

- Create a small helper if it keeps logic central, for example:
  - `parseExternalHttpUrl(raw: string): URL | null`
  - `openExternalHttp(raw: string): Promise<boolean>`
- Use it in:
  - `mainWindow.webContents.setWindowOpenHandler`
  - `shell:openExternal` IPC
  - artifact/doc-link external open paths if they bypass the IPC helper
  - GitHub external browser open if it has a separate path
- Deny and log unsafe schemes without throwing user-visible crashes.
- Keep valid HTTP(S) URLs opening normally.

**Acceptance.**

- `https://example.com` and `http://example.com` are allowed.
- `file:///C:/Windows/win.ini`, `javascript:alert(1)`, `data:text/html,...`, `view-source:https://example.com`, and custom schemes are denied.
- Window popup handler no longer calls `shell.openExternal` for rejected schemes.

---

### H6 - Phase verify + docs + approval packet

**Goal.** Close the phase with evidence and a concise review packet.

**Work.**

- Run the full gate:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`
  - `npm run build` or `npx electron-vite build`
- Perform or request manual UI smoke:
  - run a simple workflow
  - run a JS hook test from Settings
  - install or simulate a plugin connector and confirm it is blocked until trusted
  - click an external HTTP(S) doc link
  - try a non-HTTP(S) external link and confirm denial
- Update `DEVLOG.md`.
- Update README/CLAUDE only if user-facing behavior changed enough to document.
- Mark this plan as shipped at the top only after H1-H6 are complete.

**Acceptance.**

- All six prompts are marked `[x]`.
- Full gate is green.
- DEVLOG has H1-H6 entries plus a phase-complete summary.
- Residual risks are explicit and not hidden.

---

## 5. Phase Completion Criteria

- All six prompts marked `[x]`.
- Six commits on the phase branch, one per prompt.
- `npm run typecheck` exits 0.
- `npm run lint` exits 0.
- `npm test` exits 0.
- `npm run build` or `npx electron-vite build` exits 0.
- Escape probes for workflow and hook contexts fail to reach host `process`.
- Plugin `stdio` connector auto-spawn is impossible without explicit trust.
- External-open helper denies non-HTTP(S) schemes in both IPC and popup-handler paths.
- DEVLOG includes H1-H6 entries and a phase-complete summary.
- User receives an approval packet summarizing changed behavior, tests run, and residual risks.

---

## 6. Quick Reference - Primary Files

### Workflow and hooks

```text
electron/services/workflow-runner.ts
electron/services/workflow-runner.test.ts
electron/services/hooks-runner.ts
electron/services/hooks-runner.test.ts
src/components/settings/HooksSettings.tsx
```

### Plugin connector trust

```text
electron/services/plugin-loader.ts
electron/services/mcp-manager.ts
electron/ipc/plugins.ts
electron/ipc/mcp.ts
electron/preload.ts
src/components/customize/ConnectorsColumn.tsx
src/components/customize/PluginsColumn.tsx
src/stores/plugins-store.ts
```

### External URL opening

```text
electron/main.ts
electron/preload.ts
electron/ipc/github.ts
src/components/artifacts/MarkdownRenderer.tsx
src/components/settings/*Settings.tsx
```

### Verification commands

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

**End of draft plan.**
