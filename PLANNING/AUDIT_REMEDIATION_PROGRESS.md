# Audit Remediation — Progress Log

Tracks execution of `AUDIT_REMEDIATION_PLAN.md` (remediation of `REPO_AUDIT.md`,
2026-06-02). One row per prompt; one DEVLOG entry per landed prompt.

## Status legend

- **Done** — code in tree, both tsc configs pass, lint clean, vitest green, smokes pass where applicable, all acceptance criteria met.
- **Mostly done** — code in tree and tsc/lint pass, but one or more acceptance criteria not yet demonstrably met (see Known gaps).
- **Partial** — substantive work landed but the prompt is not finished.
- **Pending** — not started.

## Known decisions (carry forward)

- **agentMode (Prompt 11) = rewire, not remove.** Per user direction, the dead `agentMode` toggle/roster is wired to a real sequential Planner→Coder→Reviewer pipeline (reusing the dormant `agent:status` UI + `runChatRound` for the tool-enabled Coder). The `multi_agent_run` tool stays as the orthogonal mid-turn parallel fan-out path.
- **Test foundation (Prompt 5) before the renderer-touching prompts (8, 11).** Their jsdom tests depend on it.

## Known gaps (carry forward)

_None yet — populate as prompts land._

## Roster

| # | Title | Findings | Status |
|---|-------|----------|--------|
| 1 | Hygiene & quick wins | DOC-4, STRUCT-1/2, DEP-1/2/3, CI-3 | Done |
| 2 | Documentation refresh | DOC-1/2/3/5/6, SEC-4 | Done |
| 3 | CI: run smokes on PRs | CI-1 | Done |
| 4 | Streaming & connection bugs | BUG-1, BUG-2 | Done |
| 5 | Test foundation (jsdom + stores/services) | TEST-1, TEST-2 | Done |
| 6 | Renderer privilege hardening | SEC-1, SEC-7 | Pending |
| 7 | Main-process correctness | BUG-3, BUG-5, QUAL-2, QUAL-3 | Pending |
| 8 | Renderer + IPC-contract correctness | BUG-4, BUG-6 | Pending |
| 9 | Model-input security | SEC-2, SEC-5, SEC-6, SEC-8 | Pending |
| 10 | Secrets & OAuth hardening | SEC-3, SEC-9, SEC-10 | Pending |
| 11 | `agentMode` rewire (Planner→Coder→Reviewer) | QUAL-1, (opt) QUAL-4 | Pending |
| 12 | CI: macOS build + coverage baseline | CI-2 | Pending |

## Baseline (at planning time, `main` @ `dfc3f6e`)

- `npx tsc --noEmit -p tsconfig.node.json` / `-p tsconfig.web.json` — pass.
- `npm run lint` — 0 errors (200 intentional `no-explicit-any` warnings).
- `npm test` — 340 tests / 25 files.
- `npm run smoke:bundle` / `smoke:renderer` — PASS.
- `npm run typecheck` — **no-op** (DOC-4; fixed in Prompt 1).

## Prompt entries

## Prompt 5 — Test foundation — Done (2026-06-02)

Closes TEST-1, TEST-2. Renderer test environment + high-risk coverage. Unblocks Prompts 8 and 11.

### Files
- `vitest.config.ts` — react plugin, `@`→`src` alias, setupFiles, v8 coverage block (no threshold yet); `vitest.setup.ts`, `src/jest-dom.d.ts` *(new)*; `.gitignore` +`coverage/`; `package.json` test devDeps.
- `src/components/test-foundation.test.tsx`, `src/stores/{agent,settings,chat}-store.test.ts`, `electron/services/keychain.test.ts` *(all new)*.

### Verification
- `npm run typecheck` — pass. `npm run lint` — 0 errors. `npm test` — 376 tests / 32 files (was 346 / 27; +30). `npx vitest run --coverage` — v8 report produced. Build + both smokes — PASS.

### Acceptance
- ✅ `src/**/*.test.tsx`/jsdom tests run (foundation proof passes); `electron/**` stay node.
- ✅ chat-store / agent-store / settings-store and keychain round-trip are covered.

## Prompt 4 — Streaming & connection bugs — Done (2026-06-02)

Fixes the two High findings with regression tests.

### Files
- `electron/services/providers/registry.ts` — `chatStream` resets `fullContent` + `toolCallsAccumulator` at the top of each retry iteration (BUG-1).
- `electron/services/mcp-manager.ts` — `ServerState.restarting` flag + single `scheduleRestart()` method + `state.transport !== transport` identity guard in `onerror`/`onclose` (BUG-2).
- `electron/services/providers/registry.test.ts` *(new)*, `electron/services/mcp-manager.test.ts` *(new)* — regression tests.

### Verification
- `npm run typecheck` — pass. `npm run lint` — 0 errors. `npm test` — 346 tests / 27 files (was 340 / 25; +6). `npm run build` + `smoke:bundle` + `smoke:renderer` — PASS.

### Acceptance
- ✅ A retried stream yields un-duplicated content and tool-call args.
- ✅ A crash that fires error+close reconnects exactly once; stale-transport events are ignored.

## Prompt 3 — Run bundle smokes on PRs — Done (2026-06-02)

Closes CI-1. CI-only change.

### Files
- `.github/workflows/ci.yml` — new `smoke` job (PR + push): `npm ci --ignore-scripts` → `electron-vite build` → `smoke:bundle` + `smoke:renderer`. Heavy `build.yml` jobs stay main/tags-only.

### Verification
- Workflow YAML valid (jobs: lint, test, smoke). Simulated from a clean `npm ci --ignore-scripts` (Electron binary absent): build exit 0; both smokes PASS.

### Acceptance
- ✅ A PR now runs both bundle smokes; a deliberately broken bundle would fail the PR.

## Prompt 2 — Documentation refresh — Done (2026-06-02)

Docs only; no behavior change. Closes DOC-1/2/3/5/6 and the SEC-4 doc note.

### Files
- `README.md` — download + quick-start links → `/releases/latest` (no published releases exist; the version-pinned `v0.1.24` asset URLs were dead); roadmap "Built and shipped" 0.1.24 → 0.1.26 (DOC-1).
- `CLAUDE.md` — rewrote "Current State"; "three providers" → four incl. keychain list; artifact-sandbox untrusted-but-contained note; fixed the stale `runMultiAgent()` pointer (DOC-2/3, SEC-4).
- `CONTRIBUTING.md` — dropped the "DeepSeek-only" won't-merge line; generalized the services description (DOC-5).
- `SKILLS.md` — 64K figure → per-model ranges (DOC-6).
- `electron/ipc/settings.ts:82` — comment adds openrouter (DOC-3).

### Verification
- `npm run typecheck` — pass. `npm run lint` — 0 errors. `npm test` — 340 tests / 25 files. Smokes not required (only a comment touched in the bundle).

### Acceptance
- ✅ No `0.1.24` strings remain in user-facing docs (historical DEVLOG entries excepted).
- ✅ Docs consistently say four providers; no "DeepSeek-only" claim.
- ✅ Download links resolve to the live Releases page rather than dead version-pinned URLs.

### Note (deviation from the literal prompt)
The plan said "bump 0.1.24 → 0.1.26 strings/links". Because **no GitHub releases/tags exist**, hard-coded version asset URLs would be broken at any version (and the next planned cut is 0.1.27, not 0.1.26). Download links were therefore repointed at `/releases/latest` instead of a version-pinned URL — more robust and never goes stale.

## Prompt 1 — Hygiene & quick wins — Done (2026-06-02)

Low-risk cleanups; no behavior change. Closes DOC-4, STRUCT-1, STRUCT-2, DEP-1/2/3, CI-3.

### Files
- `package.json` — `typecheck` → `tsc --noEmit -p tsconfig.node.json && -p tsconfig.web.json` (DOC-4); removed `@playwright/test` (DEP-1); `electron-rebuild` → `@electron/rebuild` `^3.7.2`, `postinstall` unchanged (DEP-2); pinned the eslint toolchain to exact versions (DEP-3).
- `electron/ipc/settings.ts` — replaced the 3 `deepseekClient` calls with `resetProviderClient('deepseek')` / `validateProviderKey('deepseek')`, merged into the existing registry import (STRUCT-2).
- `electron/services/deepseek.ts` — **deleted** (legacy shim; settings.ts was the only importer).
- `src/components/mcp/MCPStatusBar.tsx`, `src/components/model/ModelSwitcher.tsx` — **deleted** (orphaned; dirs removed) (STRUCT-1).
- `.github/workflows/build.yml` — added a per-ref `concurrency` group (CI-3).
- `package-lock.json` — regenerated.

### Verification
- `npm run typecheck` — pass (now actually checks both configs; previously a no-op).
- `npm run lint` — 0 errors.
- `npm test` — 340 tests / 25 files (unchanged; deletions had no tests).
- `npm run build` + `npm run smoke:bundle` + `npm run smoke:renderer` — PASS.
- `@electron/rebuild` bin = `electron-rebuild` with `-f`/`-w` intact; `npm ci --dry-run` clean.

### Acceptance
- ✅ `npm run typecheck` compiles both subprojects (caught a latent duplicate import on first run).
- ✅ No importer of `deepseek.ts` remains; provider key save/test/delete flows route through the registry.
- ✅ Orphaned components gone; bundle smokes pass.
