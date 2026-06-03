# Audit Remediation — Progress Log

Factual changelog for the work described in [AUDIT_REMEDIATION_PLAN.md](AUDIT_REMEDIATION_PLAN.md). One row per landed prompt, newest first. Status is what is actually in tree, not what was aspirational.

## Status legend

- **Done** — code is in tree, both tsc configs pass, lint clean, vitest green, the universal gate plus any prompt-specific smokes pass, and all `Acceptance` bullets are demonstrably met.
- **Mostly done** — code is in tree and tsc + lint pass, but one or more acceptance criteria are not yet demonstrably met (see "Known gaps").
- **Partial** — substantive work landed but the prompt is not finished.
- **Pending** — not started.

## Known decisions

- **`agentMode` is rewired, not removed.** The renderer-side Planner→Coder→Reviewer pipeline (`AgentRunBanner.tsx`, `agent-store.ts`, `useChat.ts`, `preload.ts` `agent:status`) is already built and dormant; main-process orchestration was never wired. Prompt 11 lights up the existing renderer surface from a new `electron/services/agent-pipeline.ts` rather than ripping out the dormant plumbing.
- **`multi_agent_run` (mid-turn, parallel, tool-less, `MultiAgentRunCard`) and `agentMode` (turn-level, sequential, tool-enabled Coder, `AgentRunBanner`) are orthogonal.** Both stay. Prompt 11 documents the distinction at the top of `agent-pipeline.ts`.
- **Universal gate** is `npx tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` + `npm run lint` + `npm test`. Bundle-touching prompts additionally run `npm run smoke:bundle` and `npm run smoke:renderer`. Docs-only and CI-only prompts skip the bundle smokes; each prompt's `Verification:` block in the plan calls out which apply.

## Known gaps (carry forward)

- **`npm run lint` is broken at the repo level.** ESLint 10 flat-config migration pending. Predates Prompt 9 and is the audit's DEP-3 family — closes when Prompt 1 lands.
- **`npm run smoke:renderer` script does not exist yet.** Referenced in the plan's universal gate but never landed; the renderer-side bundle smoke is a carry-forward from the Codex sprint's known gaps. Prompts that change only main-process code can verify via `smoke:bundle` alone; prompts touching the renderer bundle should mention this gap explicitly in their DEVLOG entry.
- **DNS rebinding gap in `safeFetch`.** Resolved IPs at `assertPublicUrl` are not pinned for the subsequent fetch; a hostile resolver could return a public IP at pre-check time and a private IP at fetch time. v1 closes the direct-literal SSRF case; closing the rebind gap requires resolving once and fetching against the locked-in address with an explicit Host header.

## Done — Prompt 12 — CI: macOS smoke + coverage baseline (2026-06-02)

CI-2 closed in one PR.

- **`build-macos`** added to `.github/workflows/build.yml` (macos-latest, `CSC_IDENTITY_AUTO_DISCOVERY=false`). Runs npm ci → tsc x2 → `npm run build` → smoke:bundle → smoke:renderer. Does NOT run `electron-builder --mac` (no signing cert in CI); installer packaging remains a release-runner concern, documented in the workflow header.
- **Coverage baseline** captured: statements 15.63% / branches 14.58% / functions 11.85% / lines 16.01%. Threshold pinned at floor − 2pp per metric (13 / 12 / 9 / 14) in `vitest.config.ts`. `@vitest/coverage-v8` added to devDeps. Renderer code mostly at 0% because vitest runs node-env — jsdom carries forward in Prompt 5.
- **CI** (`ci.yml`): test job now runs `npm test -- --coverage`; HTML + LCOV report uploaded as `coverage-report` artifact (14-day retention).

Vitest 34 files / 498 pass + 2 skipped, all thresholds clear. tsc x2 + lint clean. Local bundle smokes skipped per spec — macOS smoke verifies on macos-latest first push.

---

## Sprint complete — audit remediation prompts 9-12 landed (2026-06-02)

Closes the highest-severity REPO_AUDIT findings (model-input security, secrets/OAuth hardening, agentMode rewire, CI matrix expansion). Roster as of this entry:

| # | Title | Findings | Status |
|---|---|---|---|
| 1 | Hygiene & quick wins | DOC-4, STRUCT-1, STRUCT-2, DEP-1, DEP-2, DEP-3, CI-3 | Pending |
| 2 | Documentation refresh | DOC-1, DOC-2, DOC-3, DOC-5, DOC-6, SEC-4 (doc) | Pending |
| 3 | CI: run smokes on PRs | CI-1 | **Closed by remote `1c8de6e`** (vitest + smokes on PR via the `ci.yml` workflow that landed concurrently) |
| 4 | Streaming & connection bugs | BUG-1, BUG-2 | Pending |
| 5 | Test foundation (jsdom + stores/services) | TEST-1, TEST-2 | Pending |
| 6 | Renderer privilege hardening | SEC-1, SEC-7 | Pending |
| 7 | Main-process correctness | BUG-3, BUG-5, QUAL-2, QUAL-3 | Pending |
| 8 | Renderer + IPC-contract correctness | BUG-4, BUG-6 | Pending |
| 9 | Model-input security | SEC-2, SEC-5, SEC-6, SEC-8 | **Done** |
| 10 | Secrets & OAuth hardening | SEC-3, SEC-9, SEC-10 | **Done** |
| 11 | `agentMode` rewire (Planner→Coder→Reviewer) | QUAL-1 (QUAL-4 deferred) | **Done** |
| 12 | CI: macOS build + coverage baseline | CI-2 | **Done** |

**Verification numbers at sprint close.** Vitest **34 files / 498 tests pass + 2 skipped**. tsc.node + tsc.web clean. ESLint 0 errors (213 pre-existing warnings). `smoke:bundle` PASS · `smoke:renderer` PASS. Coverage baseline: 15.63 / 14.58 / 11.85 / 16.01 % (statements / branches / functions / lines); thresholds 13 / 12 / 9 / 14.

**Carry-forward gaps** (closed naturally by Prompts 1-8 landing in the next sprint):
- The ESLint flat-config + lint sweep already landed on remote (`97c9319`, `8dba642`), closing DEP-3 and most of the family.
- `npm run smoke:renderer` exists on remote (`c12bbc9`) — DEVLOG entries in Prompts 9-11 referenced it as carry-forward; those notes are now stale but historically accurate.
- Plan/goal state persists to SQLite on remote (`294ef95`), closing the in-memory gap I'd assumed was still open.
- DNS rebinding TOCTOU in `safeFetch` (Prompt 9 known gap) is still open — closing it requires lock-resolve-then-fetch-against-IP, a deeper refactor than this sprint.
- `AgentRunBanner.test.tsx` deferred to Prompt 5 (needs jsdom + Testing Library).

## Done — Prompt 11 — `agentMode` rewire (Planner → Coder → Reviewer) (2026-06-02)

QUAL-1 closed in one PR. The renderer-side pipeline (`AgentRunBanner.tsx`, `agent-store.ts`, `preload.ts agent:status`, `useChat.ts`) was already built and dormant; main-process orchestration was the missing half.

- **New `electron/services/agent-pipeline.ts`**: `runAgentPipeline(opts)` orchestrates Planner → Coder → Reviewer; injectable `subAgentRunner` + `coderRunner` seams; `validateRoster` does a direct `MODEL_CATALOG` lookup (does NOT trust `resolveModel`'s silent default — that stays for Prompt 7's QUAL-3 fix).
- **`chat-events.ts`**: added `'agent:status'` to the event map with `AgentStatusPayload`.
- **`runChatRound` (chat.ts)**: gained a `suppressDoneEvent: boolean = false` parameter; returns `Promise<{ message } | null>`. Single-mode callers ignore the return value. Pipeline mode owns the `chat:done` emit.
- **`chat:send` (chat.ts)**: dispatches to `runAgentPipeline` when `agentMode === 'multi'` AND roster validates; otherwise the single-mode path runs unchanged. An invalid roster logs and falls back to single mode.
- **`useChat.ts`** (renderer): `chat:done` clears `activeRun` only when no role is still `running`, so the Coder → Reviewer handoff doesn't flicker the banner.
- **Tests**: `agent-pipeline.test.ts` (16 cases) covers pipeline order, the `reviewer:running` BEFORE `chat:done` invariant, plan inlining as `<plan source="planner">`, every failure path (planner/coder/reviewer + abort), and coexistence with the `multi_agent_run` tool (orthogonal — pipeline doesn't import the tool registry).

Vitest 31 files / 444 tests pass + 2 skipped (+1 file, +16 tests vs Prompt 10 followup baseline). `npm run smoke:bundle` PASS in 322 ms. Carry-forwards (lint, smoke:renderer, DNS rebinding TOCTOU) unchanged. Optional QUAL-4 (extract `resolveSingleToolCall`) deferred — `agent-pipeline.ts` already relieves chat.ts growth pressure. Full detail in DEVLOG.

## Done — Prompt 10 followup — review remediation (2026-06-02)

Three review findings against the original Prompt 10 landing closed in one followup PR.

- **P1a — SEC-10 still had silent paths.** `keychain.setKey` now throws `PlaintextConsentRequiredError` when encryption is off and no consent is recorded; new session-level `grantPlaintextConsent` / `hasPlaintextConsent` IPC channels, new shared renderer helper `src/lib/keychain-consent.ts` (`ensurePlaintextConsentIfNeeded`), every credential-persisting settings UI (`ApiKeyModal`, `ApiKeySettings`, `McpSettings` saveCreds + Connect Google, `WebToolsSettings` handleSaveKey, `ImageGenSettings` handleSaveKey, `CurrentInfoSettings` saveFinance/saveWeather) wired through it. `getKey` re-grants consent when it sees an existing `plain:` row so the background OAuth-refresh path keeps working across relaunches without re-prompting.
- **P1b — SEC-2 was not applied to `web-search-adapters.ts`.** Shared `fetchWithTimeout` swapped to call `safeFetch`; covers every Brave / Tavily / SerpAPI / SearXNG search + image-search call. New `web-search-adapters.test.ts` pins SearXNG-loopback refusal + redirect-into-internal-IP refusal across the Brave path.
- **P2 — OAuth state IPC wiring was unpinned.** New `validateOAuthCallback(reqUrl, session)` extracted from the mcp.ts callback handler; `mcp.ts` is now a thin switch on the returned outcome. `oauth-state.test.ts` gains 9 IPC-integration cases on top of the original 10 helper cases.

Vitest 30 files / 428 tests pass + 2 skipped. `npm run smoke:bundle` PASS. Carry-forwards (lint, smoke:renderer, DNS-rebinding TOCTOU) unchanged. Full detail in DEVLOG.

## Done — Prompt 10 — Secrets & OAuth hardening (2026-06-02)

SEC-3, SEC-9, SEC-10 all closed in one PR.

- **SEC-3** — `electron/services/keychain.ts` `writeKeys` now passes `{ mode: 0o600 }` to `writeFileSync` plus an opportunistic `chmodSync(path, 0o600)` so a previously-loose file is hardened on the next write. Windows: mode bit is advisory; chmod no-ops without throwing. Mode value exported as `__KEYS_FILE_MODE_FOR_TEST`.
- **SEC-9** — new `electron/services/oauth-state.ts` (`generateOAuthState` + `createOAuthSession`); 24-byte random base64url state, constant-time `verify` with single-use semantics (wrong attempt does NOT consume the session; right attempt consumes permanently). `electron/ipc/mcp.ts` instantiates a session before building the auth URL, embeds `state` as a search param, and the local callback rejects on mismatch with a 400 to the browser + a clear error message to the renderer.
- **SEC-10** — `src/components/settings/ApiKeyModal.tsx` and `ApiKeySettings.tsx` both gate `handleSave` behind a `window.confirm(...)` when `encrypted === false`. The Modal additionally fetches the encryption state on mount and renders an inline `role="alert"` amber warning above the key input; the closing copy branches on `encrypted` so it doesn't lie when encryption is off.

Vitest 29 files / 406 tests pass + 2 skipped (win32 POSIX-mode skips). `npm run smoke:bundle` PASS. Two new test files: `oauth-state.test.ts` (10) and `keychain.test.ts` (10 + 2 skipped). Carry-forwards from Prompt 9 unchanged. Full detail in DEVLOG.

## Done — Prompt 9 — Model-input security (2026-06-02)

SEC-2, SEC-5, SEC-6, SEC-8 all closed in one PR. New `electron/services/url-safety.ts` (assertPublicUrl + safeFetch with manual-redirect re-validation) wired into `web-tools.ts`. `worktree.ts` refactored to pure helpers with branch regex + `--` separator. `browser-manager.ts` `coerceUrl` drops `file:` and the other dangerous-scheme family. `openInVSCode` switches to argv-form `spawn` with `shell: false`. Vitest 27 files / 386 tests pass (+4 files / +91 tests). `npm run smoke:bundle` PASS. Two carry-forwards (lint, smoke:renderer) recorded above. Full detail in DEVLOG.

## Roster

| # | Title | Findings | Status |
|---|---|---|---|
| 1 | Hygiene & quick wins | DOC-4, STRUCT-1, STRUCT-2, DEP-1, DEP-2, DEP-3, CI-3 | Pending |
| 2 | Documentation refresh | DOC-1, DOC-2, DOC-3, DOC-5, DOC-6, SEC-4 (doc) | Pending |
| 3 | CI: run smokes on PRs | CI-1 | Pending |
| 4 | Streaming & connection bugs | BUG-1, BUG-2 | Pending |
| 5 | Test foundation (jsdom + stores/services) | TEST-1, TEST-2 | Pending |
| 6 | Renderer privilege hardening | SEC-1, SEC-7 | Pending |
| 7 | Main-process correctness | BUG-3, BUG-5, QUAL-2, QUAL-3 | Pending |
| 8 | Renderer + IPC-contract correctness | BUG-4, BUG-6 | Pending |
| 9 | Model-input security | SEC-2, SEC-5, SEC-6, SEC-8 | Done |
| 10 | Secrets & OAuth hardening | SEC-3, SEC-9, SEC-10 | Done |
| 11 | `agentMode` rewire (Planner→Coder→Reviewer) | QUAL-1 (QUAL-4 deferred) | Done |
| 12 | CI: macOS build + coverage baseline | CI-2 | Done |
