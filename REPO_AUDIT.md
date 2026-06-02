# Lamprey Harness — Full Repository Audit

**Date:** 2026-06-02 · **Audited at:** `main` (commit `dfc3f6e`) · **Version:** 0.1.26
**Scope:** entire repository — security, correctness, tests/CI, dependencies, documentation, structure.
**Method:** four parallel domain audits (security · code quality · tests/CI/deps · docs/structure) plus repo metrics. Read-only — no code was changed.

> This is an assessment. Nothing here has been fixed. Severities are the auditor's
> judgement; "Medium" items that are *partly mitigated by the approval gate* are
> called out as such.

---

## Executive summary

The codebase is in good shape: ~38k LOC of Electron + React, **0** `TODO/FIXME/HACK` markers, disciplined IPC result handling (`{success,data}|{success,error}`), careful resource teardown, parameterized SQL, a sound permission/approval model, and correct foundational Electron hardening (contextIsolation, sandbox, no nodeIntegration, denied popups). `npm audit` is clean (0 vulns).

The findings cluster into four themes:

1. **Renderer privilege surface** — the preload exposes ungated absolute-path filesystem reads, and the main renderer has no CSP. Individually defensible (first-party renderer), but together they make any renderer XSS a file-exfiltration chain. *Top hardening priority.*
2. **Streaming/connection robustness** — two real defects: the `chatStream` retry double-accumulates partial output, and stdio MCP servers can double-reconnect on crash.
3. **Test/CI coverage gaps** — the entire renderer (69 components, 12 stores) and all 23 IPC handlers are untested; the bundle smokes never run on PRs; the "jsdom component tests" the smoke scripts claim as their complement do not exist.
4. **Documentation drift** — README/CLAUDE.md/CONTRIBUTING/SKILLS are stale relative to the shipped v0.1.26 four-provider code, and `npm run typecheck` silently checks nothing.

None of the security items are trivially *remote*-exploitable given the first-party renderer and sandboxing.

---

## Priority findings (start here)

| ID | Sev | Area | Finding | Fix |
|----|-----|------|---------|-----|
| BUG-1 | **High** | Streaming | `chatStream` retry reuses `fullContent` / `toolCallsAccumulator` across attempts → duplicated/corrupted output on mid-stream retry | Reset accumulators at top of each retry iteration |
| BUG-2 | **High** | MCP | stdio `onerror` **and** `onclose` both trigger reconnect → concurrent double-reconnect race | Single `restarting` flag per server |
| SEC-1 | **High** | Renderer surface | `files.readText/listDir/walkProject` accept arbitrary absolute paths, no workspace confinement; renderer has no CSP | Confine to workspace; add renderer CSP |
| TEST-1 | **High** | Tests | Entire renderer (69 components, 12 stores incl. 373-LOC chat-store) untested; `vitest.config.ts` is node-only so the "jsdom tests" smoke scripts cite don't/can't exist | Add jsdom env + store/component tests, or correct the claims |
| CI-1 | **High** | CI | Unit tests (ci.yml) and bundle smokes (build.yml) never run on the same PR; smokes are main/tags-only → bundler/TDZ regressions invisible pre-merge | Run smokes in a PR job |
| DOC-1 | **High** | Docs | README download/roadmap pinned to **0.1.24**; CLAUDE.md "Current State" says the parity sprint is "awaiting push" (it shipped) | Refresh to 0.1.26 |
| SEC-2 | Medium | Network | `web_open`/`web_find` fetch arbitrary model URLs with no internal-IP blocklist (SSRF: localhost, `169.254.169.254`) — gated by approval, but a sticky "allow network" re-exposes it | Block loopback/link-local/private ranges, re-check on redirect |
| SEC-3 | Medium | Secrets | `keychain` silently falls back to **plaintext** `keys.json` (`plain:<key>`) when safeStorage is unavailable — provider keys + OAuth tokens in cleartext, only a `console.warn` | Surface to UI; refuse/strong-warn |

---

## 1. Security

Overall: foundational Electron hardening is correct; the material gaps are the renderer privilege surface and a few model-controlled-input vectors that are partly mitigated by the approval gate.

**Confirmed sound (no action):**
- `webPreferences` across `main.ts:239`, `artifact-sandbox.ts:92/150`, `browser-manager.ts:138` all set `contextIsolation:true, nodeIntegration:false, sandbox:true, webSecurity:true`. Popups denied (`main.ts:251`).
- The recent `selfApproves` change is correct: `descriptorNeedsApproval` (`permissions-store.ts:79`) returns `false` only for `selfApproves`, set on exactly one tool (`request_permissions`), whose handler does its own approval — gate relocated, not bypassed. Deny-precedence (`permission-policies-store.ts:158`) and fail-safe deny defaults hold.
- SQL is parameterized (`conversation-store.ts`); DOM-tool injection is `JSON.stringify`-encoded (`browser-tools.ts:103`); process spawns are argv-form; tool-facing path traversal is confined (`shell-tool.ts:48`, `apply-patch-tool.ts:49`, unit-tested).

**Findings:**

- **SEC-1 [High]** `preload.ts` + `files.ts:78-125` — `files.readText/listDir/walkProject` take an arbitrary absolute path with only a non-empty-string check, running at main privilege with no workspace confinement. A renderer XSS could read `~/.ssh/id_rsa` and enumerate the disk. **Fix:** reuse `resolvePathWithinWorkspace` (the tool layer already does), or restrict to user-picked paths.
- **SEC-2 [Medium]** `web-tools.ts:226-259` — SSRF: `web_open`/`web_find` fetch model-supplied URLs (scheme-checked only) with `redirect:'follow'`, returning 50 KB to the model. Approval-gated, but a sticky network allow re-opens localhost/cloud-metadata. **Fix:** reject loopback/link-local/RFC1918; re-check after redirects.
- **SEC-3 [Medium]** `keychain.ts:31-45` — silent plaintext fallback (`plain:<key>`) when safeStorage is unavailable; provider keys and Google OAuth tokens (`mcp.ts:123`) land in cleartext with only a warn. **Fix:** surface via the existing `isEncryptionAvailable`; refuse or strongly warn.
- **SEC-4 [Medium]** `artifact-sandbox.ts:16-66` — artifact CSP allows `'unsafe-inline'`/`'unsafe-eval'` and the `jsx` path runs model JSX via Babel. Intended + contained (`connect-src 'none'`, sandboxed view), so acceptable — but document that artifact content is untrusted-but-contained. CSP injected via fragile string-replace of `<head>` (`:18-28`); prefer the header-level CSP only.
- **SEC-5 [Medium]** `worktree.ts:53/72` — renderer-supplied git branch name passed as a positional arg with no `--` terminator/`-` guard → git **option-injection** (e.g. `--upload-pack=`). argv (not shell) so no command injection. **Fix:** validate `^[A-Za-z0-9._/-]+$`, reject leading `-`, insert `--`.
- **SEC-6 [Low]** `files.ts:235-257` — `files:openInVSCode` uses `spawn(..., {shell:true})` with a renderer-supplied `targetPath` → shell metachar injection if the path isn't from the picker. **Fix:** resolve the `code` binary and spawn argv-form (drop `shell:true`).
- **SEC-7 [Low]** `main.ts:295-306` — CSP applied only to `lamprey-artifact` URLs (substring match, `:296`); the main renderer document ships no CSP. With isolation on this is defense-in-depth, but it's the backstop missing behind SEC-1. **Fix:** add a restrictive `default-src` CSP for the renderer; match the artifact scheme precisely.
- **SEC-8 [Low]** `browser-manager.ts:115-129` — `coerceUrl`/`isHttpish` permits `file:` → model-driven `browser_navigate` to `file:///etc/passwd` then read/screenshot (local read vector; tab is sandboxed + gated). **Fix:** restrict model navigation to http/https.
- **SEC-9 [Low]** `mcp.ts:40-146` — Google OAuth flow has no CSRF `state` param and a fixed callback port; first `code`-bearing request is accepted. Low likelihood (local attacker + timing). **Fix:** random `state`, verify on callback.
- **SEC-10 [Low]** `keychain.ts:19` — `keys.json` written without explicit `mode: 0o600`. `shell-tool.ts:140` merges model-supplied `env` over `process.env` (gated; note only). `hooks-runner.ts:40` runs with `shell:true` (user-authored commands only — confirm `hooks:create/update` is UI-only, not tool-reachable).

---

## 2. Correctness & code quality

- **BUG-1 [High]** `providers/registry.ts:544-628` — `chatStream`'s retry loop declares `fullContent`/`toolCallsAccumulator` **outside** the `while (retries...)` loop. A mid-stream failure `continue`s and the new stream *appends* to partial state → duplicated text and malformed tool-call args. **Fix:** reset both at the top of each iteration (or only retry before any delta arrived).
- **BUG-2 [High]** `mcp-manager.ts:411-437` — stdio `transport.onerror` and `transport.onclose` each independently check restart count and call `connectServer`; a crash fires both → concurrent reconnects, and `onerror`'s `cleanupServer` nulls a transport `onclose` may still touch. **Fix:** single per-server `restarting` guard, or reconnect from one event only.
- **BUG-3 [Medium]** `hooks-runner.ts:40-54` — `spawn` pipes stdout/stderr but never drains them; a hook writing >~64 KB blocks forever (zombie + leaked handles). **Fix:** `stdio: 'ignore'` or `.resume()` the streams.
- **BUG-4 [Medium]** `SideChatPanel.tsx:59-79` — the `chat.subscribe` effect lists `streamBuf` in deps, which updates every chunk → the IPC subscription is torn down/recreated on every streamed chunk, and `onDone` reads a stale buffer. **Fix:** depend only on `convId`; read latest via ref/functional setState.
- **BUG-5 [Medium]** `mcp-manager.ts:86-92` — `loadConfigs` catches a corrupt `mcp-servers.json` and silently overwrites it with defaults (user edits destroyed, no log/backup); parse result is returned unvalidated. **Fix:** log + back up before regenerating; validate shape.
- **BUG-6 [Low]** `App.tsx:139-150` — chat/app error listeners registered via `ipcRenderer.on` with no cleanup; separately `useChat`'s `chat.offAll()` (`preload.ts:27`) `removeAllListeners('chat:error')` strips App's toast listener on any `useChat` remount. **Fix:** return unsubscribers (as `tools.onApprovalRequired` does); stop `removeAllListeners` on shared channels.
- **QUAL-1 [Medium]** `chat.ts:135/254` — `agentMode` is **dead plumbing**: `chat-store.ts:219` sends it, `chat.ts` discards it (`void requestedAgentMode`, comment says the pipeline "was removed"), yet the toggle/roster UI (`AgentSettings`, `WorkModePopover`, `MultiAgentRunCard`) persists and ships it — while fan-out actually runs through the separate live `multi_agent_run` tool. Confusing/misleading. **Fix:** re-wire `agentMode` or remove the toggle + IPC field.
- **QUAL-2 [Medium]** Risky `any` casts (most of the ~200 `no-explicit-any` are benign `catch (err: any)`): `mcp-manager.ts:276-288` reads `c.text` off unvalidated MCP content; `chat.ts:360/412/456` cast OpenAI message arrays to `any` — the exact shapes behind the documented "orphan tool reply" 400s. **Fix:** type these two seams properly.
- **QUAL-3 [Low]** `registry.ts:297-312` — `resolveModel` silently routes any **unknown** model id to the DeepSeek provider/client with a 64 K window; a custom Qwen/Gemma id is misrouted. **Fix:** surface unknown ids instead of defaulting provider.
- **QUAL-4 [Low]** `chat.ts` (617 LOC) — `resolveSingleToolCall` (~125 LOC) bundles approval + native/MCP dispatch + memory + plan snapshot + audit + emits. Prime extraction candidate (already flagged large in CLAUDE.md).

---

## 3. Tests & CI

- **TEST-1 [High]** Zero renderer tests: `src/components/**` (69 components) and `src/stores/**` (12 stores, incl. 373-LOC `chat-store`, 306-LOC `ui-store`) have no tests; the only `src/` test covers pure helpers. **And** `vitest.config.ts` hard-codes `environment: 'node'` with no jsdom — so the "jsdom component tests under `src/**/*.test.tsx`" that both smoke scripts cite as their complement **do not and cannot exist** as configured. **Fix:** add a jsdom env (per-glob) + `@testing-library/react`; cover the high-traffic stores first; or correct the smoke-script comments.
- **CI-1 [High]** Unit tests (`ci.yml`) and bundle smokes (`build.yml`) never run together on a PR — smokes only fire on main/tags. The TDZ/bundler class the smokes exist to catch (the v0.1.25 crash) is invisible pre-merge. **Fix:** run `smoke:bundle`/`smoke:renderer` in a cheap PR-triggered build job.
- **TEST-2 [Medium]** No IPC handler is directly tested (`electron/ipc/`, incl. 617-LOC `chat.ts`); core services untested — `providers/registry.ts` (630 LOC, stream parsing/error handling), `mcp-manager.ts` (547), `keychain.ts` (security-sensitive), `database.ts` (migrations). **Fix:** prioritize `registry.ts` and `keychain.ts` round-trip.
- **CI-2 [Medium]** No macOS build in CI (manual only) → mac compilation/packaging breakage uncaught. No coverage reporting/threshold anywhere (`vitest` has no `coverage` block) → no signal on the untested surface. **Fix:** unsigned `macos-latest` build+smoke; add `--coverage` with a baseline.
- **CI-3 [Low]** `build.yml` has no `concurrency` group (ci.yml does) → rapid main pushes pile up duplicate builds.
- **INFO** CI hygiene is otherwise strong: Node 22 pinned everywhere, npm caching on, actions pinned to majors, both tsconfigs typechecked, `if-no-files-found: error`, releases gated to tags with `draft:true`. Smoke scripts are well-designed and honest about limits (though `smoke-renderer`'s `createRoot` string check is minifier-brittle — worth a comment).

---

## 4. Dependencies

`npm audit`: **0 vulnerabilities.** Dep/devDep categorization is correct. Deprecated transitives (`glob`, `rimraf`, `inflight`, …) ride in via build tooling only.

- **DEP-1 [Low]** `@playwright/test` (^1.60.0) is an **unused** devDependency (no import anywhere) — dead weight, or the natural home for the missing e2e/renderer coverage.
- **DEP-2 [Low]** `electron-rebuild` (^3.2.9) is **deprecated** → migrate to `@electron/rebuild` (rename only). Runs on every `postinstall` + in `build.yml`.
- **DEP-3 [Low]** `eslint`/`@eslint/js` ^10 are bleeding-edge (locked 10.4.1); the plugin trio (`import-x`, `react-hooks@7`, `@typescript-eslint@8`) can lag on updates. Works now. **Fix:** drop the `^` to pin the eslint trio against surprise minor bumps.
- **DEP-4 [Info]** `electron` ^35.7.5 (locked) is intentionally held for better-sqlite3 V8 compat (per CLAUDE.md) — justified, but Electron 35 is past active support, so Chromium-patch exposure grows over time. Revisit when better-sqlite3 ships V8 13.

---

## 5. Documentation accuracy

- **DOC-1 [High]** `README.md` (lines ~18-29, 125, 199) — download header, installer/ZIP table, three GitHub release URLs, quick-start link, and the "Built and shipped (v0.1.24)" roadmap header all say **0.1.24**; package.json is 0.1.26 and 0.1.26 shipped. **Fix:** bump all 0.1.24 strings/links.
- **DOC-2 [High]** `CLAUDE.md` "Current State" claims Prompt 21 + multi-provider revision are "implemented locally / awaiting review and push" — the whole parity sprint, persistence, CI, and agentic mode shipped through 0.1.26. **Fix:** rewrite to reflect merged state; point at the parity progress log.
- **DOC-3 [Medium]** `CLAUDE.md` (lines 4, 16) says **"three providers"** — there are four (`registry.ts`: `deepseek | google | dashscope | openrouter`). README is correct; CLAUDE.md and `settings.ts:82` comment omit OpenRouter.
- **DOC-4 [Medium]** `package.json` `"typecheck": "tsc --noEmit"` is a **verified no-op** — root tsconfig has `files: []` + project references, so bare `tsc --noEmit` (not `-b`) checks nothing and exits 0. README/CLAUDE.md correctly tell you to run the two `-p` configs, but `npm run typecheck` gives false confidence. **Fix:** `tsc -b` or chain the two `-p` invocations.
- **DOC-5 [Medium]** `CONTRIBUTING.md:120` — "v0.1 is DeepSeek-only on purpose" is false (four providers shipped); the `electron/services/` description (line ~66) is DeepSeek-only too. **Fix:** drop the policy line; generalize.
- **DOC-6 [Medium]** `SKILLS.md:62` cites a stale **"64K context window"**; registry declares 131072 (Gemma), 262144 (Qwen/OpenRouter), 1,000,000 (DeepSeek V4). **Fix:** drop the figure or make it per-model.
- **INFO** Verified-accurate: MCP defaults (gmail/drive/chrome), Electron 35 badge, slash commands, `src/hooks/` (7 hooks), test counts. The `skills/` ↔ `resources/skills/` mirroring is **by-design and in sync** (confirmed in `skill-loader.ts`: dev reads `<repo>/skills`, prod bootstraps `userData/skills` from `resources/skills` copy-if-missing) — `diff -rq` shows trees identical except dev-only `skills/README.md`. Not a bug.

---

## 6. Structure & dead code

- **STRUCT-1 [Medium]** `src/components/mcp/MCPStatusBar.tsx` and `src/components/model/ModelSwitcher.tsx` are **orphaned** (no importers anywhere). Each is the sole file in its folder. **Fix:** delete (and drop the empty folders), or wire in.
- **STRUCT-2 [Low]** `electron/services/deepseek.ts` is legacy single-provider scaffolding (the `deepseekClient` singleton + DeepSeek-only key IPC) running parallel to the provider registry + multi-key keychain, still imported by `settings.ts`. **Fix:** confirm back-compat need; otherwise retire and route through the registry.
- **INFO** `electron/services/` is large and flat (~80 files) but the `-tool`/`-tool-pack`/`-store` suffix convention is consistent; `electron/ipc/` is clean per-domain. `scripts/` holds one-off icon utilities not wired to npm scripts (intentional dev tooling). `tests/unit/mock-mcp-server.ts` is a helper outside the test globs (expected).

---

## Quick wins (low-effort, high-signal)

1. **DOC-4** Fix `npm run typecheck` → `tsc -b` (one line; removes false-green).
2. **DOC-1/2/3/5/6** Refresh stale version + provider-count docs (text only).
3. **BUG-1** Reset `chatStream` accumulators on retry (small, prevents corrupted output).
4. **DEP-1/2** Remove unused `@playwright/test`; swap `electron-rebuild` → `@electron/rebuild`.
5. **STRUCT-1** Delete the two orphaned components.
6. **CI-1** Add smokes to a PR job (closes the pre-merge bundler-regression hole).

## Appendix — metrics & method

- **Size:** `electron/` ~20.3k LOC, `src/` ~17.9k LOC; 25 test files / ~339 assertions; 0 TODO/FIXME/HACK.
- **Largest files:** `Sidebar.tsx` (1137), `ChatInput.tsx` (974), `Titlebar.tsx` (672), `providers/registry.ts` (630), `ipc/chat.ts` (617).
- **Method:** four parallel sub-agent audits (security, code quality, tests/CI/deps, docs/structure) over the full tree, cross-checked and deduped here. Severities are auditor judgement. No files were modified.
</content>
