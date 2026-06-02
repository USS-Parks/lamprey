# Codex Toolset Parity — Progress Log

Factual changelog for the work described in [CODEX_TOOLSET_PARITY_PLAN.md](CODEX_TOOLSET_PARITY_PLAN.md). One row per session, newest first. Status is what is actually in tree, not what was aspirational.

## Status legend

- **Done** — code is in tree, both tsc configs pass, all acceptance criteria met and verified.
- **Mostly done** — code is in tree and tsc passes, but one or more acceptance criteria are not yet demonstrably met (see "Known gaps").
- **Partial** — substantive work landed but the session is not finished.

## Known gaps (carry forward)

These bite across sessions; track and resolve when work resumes.

- **Permission persistence is in-memory only.** `permissions-store.ts` stores sticky `conversation`/`always` decisions in maps that reset on app launch. Settings UI to inspect/clear them is not wired. Source comment now labels this as a known gap rather than a "future policy".
- **Provider settings panels were initially orphaned.** `WebToolsSettings`, `CurrentInfoSettings`, `ImageGenSettings` are now imported and rendered from `SettingsDialog.tsx`. Verified in code; visual smoke not yet recorded.
- **Node REPL packaging path** depends on an `electron-builder` `extraResources` entry copying `resources/mcp` into the packaged app. The dev path is reached via `__dirname/../../resources/mcp/node-repl/server.js`; the production path is `process.resourcesPath/mcp/node-repl/server.js`. A static check that the resource file exists and the builder mapping is present landed in `electron/services/mcp-defaults.test.ts`. End-to-end smoke from a packaged build is still recommended before any release.
- **Apply-patch executor parser/executor tests are in tree** at `electron/services/apply-patch-tool.test.ts` and pass locally (`npx vitest run`).
- **Permission-policy tests** for the sticky per-tool and per-risk decision paths are in tree at `electron/services/permissions-store.test.ts` and pass locally. The `askUser` path (BrowserWindow round-trip) is not exercised — it requires an Electron host.
- **Module naming was cleaned up** in the cleanup pass. The old `tools-sessionNN/index.ts` directories were renamed to product-named files (`apply-patch-tool-pack.ts`, `native-dev-tool-pack.ts`, `browser-tool-pack.ts`, `web-tool-pack.ts`, `current-info-tool-pack.ts`, `image-generation-tool-pack.ts`, `node-repl-default-server.ts`). Imports in `tool-registry.ts` were updated. Source comments that read like diary entries ("Phase N", "Session NN", "Self-registering", "anchor export") were removed.

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
