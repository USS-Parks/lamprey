# Lamprey Harness — Claude Code Instructions

## What This Is
Electron desktop **multi-agent coding harness** (React 19, TypeScript, electron-vite). Routes per-model to three providers — DeepSeek (V4 Pro, V4 Flash, V3, R1), Google (Gemma), and Alibaba DashScope (Qwen) — and can run a Planner → Coder → Reviewer pipeline that assigns a different model to each role. See `PLANNING/LAMPREY_HARNESS_FINAL.md` for the original 22-prompt build plan; the post-Prompt-21 "multi-provider revision" extends it.

## Architecture quick-pointers (multi-provider revision)
- Provider registry + dispatch: `electron/services/providers/registry.ts` — `MODEL_CATALOG`, `chatStream`, `chatOnce`, `validateProviderKey`. Adding a model = append to `MODEL_CATALOG`.
- Agent orchestration: `electron/ipc/chat.ts` `runMultiAgent()`. System prompts in `electron/services/system-prompt-builder.ts` (`AGENT_ROLE_PROMPTS`, `buildAgentSystemPrompt`).
- Multi-provider keychain: same `electron/services/keychain.ts` keyed by `deepseek` | `google` | `dashscope`. IPC: `settings:saveProviderKey` / `:test` / `:delete` / `:list`.
- Agent store: `src/stores/agent-store.ts`. Mode + roster persist via `AppSettings.agentMode` + `agentRoster`.
- UI surfaces: `src/components/settings/ApiKeySettings.tsx` (multi-provider list), `AgentSettings.tsx` (roster + mode), `chat/AgentRunBanner.tsx` (live pipeline status), `chat/ChatInput.tsx` `AgentModeToggle`.

## Current State
- **Prompts 1–20 + 21 + multi-provider revision**: complete (see `memory/project_build_status.md` for per-prompt commit SHAs).
- **RAG add-on (R1–R14)**: complete, audited, hardened (see DEVLOG 2026-06-03 audit entry).
- **Parity Phase (36 prompts + Integration H1–H6)**: complete — see `PLANNING/LAMPREY_PARITY_PLAN.md` and the H1–H6 wrap-up entry in `DEVLOG.md` (2026-06-04).
- **Fluidity Phase (J1–J11)**: complete (2026-06-04) — micro-interaction parity with Claude Code. Merged to `main` as commit `2691730`. See `PLANNING/LAMPREY_FLUIDITY_PLAN.md` and the per-prompt + phase-complete entries in `DEVLOG.md`. Eleven prompts shipped on `feat/fluidity-phase`: ESC + ↑ history, Shift+Tab mode cycle, @file mention, # memory shortcut, inline approval chips, tool-card auto-collapse, inline subagents, status-line context%, notification consolidation, path:line autolinking, right-panel default-collapsed.
- **Deep Research Phase (D1–D12)**: complete (2026-06-05) — first-class research pipeline with auto-trigger, multi-source corroboration, strict-citation markdown reports + downloadable `.md` artifacts. See `PLANNING/LAMPREY_DEEP_RESEARCH_PLAN.md`. Twelve prompts shipped on `feat/deep-research-phase`: DuckDuckGo adapter, provider cascade, intent classifier + `/research` slash + `--no-research` opt-out, query planner, source collector (dedup + domain cap + trust rank), readable-text extractor (`node-html-parser`), claim extraction, multi-source corroboration (RAG embeddings + opposition LLM), strict-citation synthesizer (fabricated-ref guard), orchestrator + IPC + progress events, artifact emission + `ResearchArtifact` UI, `DeepResearchBanner` with live counts + cancel.
- **Snip Phase (K1–K14)**: complete (2026-06-05, v0.4.0) — RTK-style in-process token filter on top of `shell_command`. 120 bundled YAML filters across 15 categories under `resources/snip-filters/`. See `PLANNING/LAMPREY_SNIP_PLAN.md`.
- **Customize Phase (C1–C12)**: complete (2026-06-05, v0.5.0) — first-class Skills / Connectors / Plugins surface in the left sidebar, mirroring Claude Code's Customize panel. Twelve prompts on `claude/determined-pasteur-033123` (worktree): C1 surface scaffolding, C2 Skills column promotion, C3 skill format upgrade (allowedTools/model/autoInvoke + directory-mode), C4 New-skill wizard, C5 Connectors column promotion, C6 Add-connector flow (curated catalog + JSON paste), C7 plugin manifest + loader (green field), C8 plugin IPC + Zustand store, C9 Plugins column UI + 3 bundled starter plugins, C10 install flow (directory + manifest paste + bundled catalog), C11 runtime hookup (skill / slash-command / MCP-connector contribution from enabled plugins), C12 polish + version bump + push. The `'skills'` + `'mcp'` Settings tabs were retired in favor of the unified Customize surface. See `PLANNING/LAMPREY_CUSTOMIZE_PLAN.md`.
- Read `DEVLOG.md` for detailed build history before making changes. Parity + Fluidity + Deep Research + Snip + Customize plans are now reference-only — there is no active plan at the moment.

## Build & Run
```bash
# Dev (requires ELECTRON_EXEC_PATH workaround on this machine)
ELECTRON_EXEC_PATH="C:\Users\17076\Documents\Claude\Lamprey Harness\node_modules\electron\dist\electron.exe" npx electron-vite dev

# TypeScript check (both configs must pass)
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json

# Production build
npx electron-vite build
```

## Where the `.exe`/installer comes from (READ THIS before looking for `dist/`)
**A cloud / Linux session can NOT build or contain the Windows installer.** Do not hunt for `dist/Lamprey-*.exe` here — it will never exist in a remote Linux session.
- `dist/` is electron-builder *output* and is gitignored, so a fresh clone never contains it.
- The signed Windows NSIS `.exe` is produced ONLY by `npm run build:win` on the user's **Windows machine**, or by the **`build.yml` CI** on a `windows-latest` runner.
- **Tag-push path (`v*`)** → CI builds `.exe` (Windows) + `.AppImage` (Linux) and attaches them to a **draft** GitHub release. **Branch-push to `main`** → CI builds the same artifacts but uploads them only as **workflow artifacts** (14-day retention), with NO release.
- **Known environment limit:** this remote git proxy **rejects tag pushes (HTTP 403)** — branch pushes work, tag pushes do not. So from a cloud session: bump + commit + push `main` is doable, but **creating the `v*` tag (and thus the release) must be done by the user** (local `git push origin vX.Y.Z` or the GitHub "Draft a new release" UI).

## Architecture
- **Main process**: `electron/main.ts` → `electron/ipc/` handlers → `electron/services/` business logic
- **Preload**: `electron/preload.ts` — full typed contextBridge API (`window.api`)
- **Renderer**: `src/` — React 19 + Zustand stores + Tailwind CSS 4
- **IPC pattern**: All calls return `{ success: true, data: T } | { success: false, error: string }`
- **Database**: better-sqlite3 at `userData/lamprey.db` (WAL mode, foreign keys)
- **API keys**: Electron safeStorage → `userData/keys.json` (base64-encoded encrypted)
- **Artifact sandbox**: `WebContentsView` (not deprecated BrowserView) with CSP + sandbox isolation, vendor files in `resources/vendor/`

## Key Decisions
- `window.api` guards needed in renderer code — app must not crash outside Electron (browser dev mode)
- `skill-loader.ts` is fully implemented (Prompt 13) with chokidar hot reload, gray-matter frontmatter parsing, and dev/prod path resolution (production bootstraps `userData/skills/` from `resources/skills/`)
- `mcp-manager.ts` is fully implemented (Prompt 10) with SSE + stdio transports, Google OAuth token refresh, and auto-restart
- Tool approval lives in `electron/services/permissions-store.ts` + `electron/ipc/permissions.ts` (Phase 4). The legacy `mcp:approveToolCall` IPC is a thin shim over `permissionsService.respondLegacy`; the modern channel is `tools:approvalRequired` / `tools:respondToApproval`. Approval is gated by descriptor risk metadata on `electron/services/tool-registry.ts`, not by hard-coded server lists
- Branding: display name "Lamprey", desktop icon = green 3D lamprey (`ASSETS/Lamprey Desktop Icon-1.png`), splash screen = `ASSETS/Lamprey New Startup Splash.png` (3s duration)
- `WebContentsView` (Electron 35) replaces deprecated `BrowserView` — uses DIP coordinates (no scaleFactor multiplication needed). Electron is pinned to ^35.7.5 because better-sqlite3 12.10 doesn't yet support V8 13 (Electron 36+). Bump when better-sqlite3 ships V8 13 compat.
- React 19 has no UMD builds — JSX artifacts use a custom `react-shim.js` for createElement/createRoot
- `react-markdown` v10 requires `pre` passthrough override to prevent double-wrapping CodeBlock components

## Execution Rules
1. **All shipped plans (`PLANNING/LAMPREY_HARNESS_FINAL.md`, the RAG roster, `LAMPREY_PARITY_PLAN.md`, `LAMPREY_FLUIDITY_PLAN.md`, and `LAMPREY_DEEP_RESEARCH_PLAN.md`) are reference-only.** When the user starts a new plan, treat its §0 (or equivalent) as the source of truth for verify gates + commit discipline.
2. Each prompt in any active plan must pass its verify gate (both tsc configs + relevant tests + smoke checks) before being marked `[x]` and committed.
3. Log each prompt's work in `DEVLOG.md` per the format in the active plan's §0 Step 4.
4. **Push policy:** the user is the reviewer + pusher. When they explicitly ask to push (any phrasing — "push", "push to main", "push it now"), execute on the first try; the request itself satisfies the review step (see `feedback_push_when_told` memory). Do NOT volunteer pushes the user didn't ask for, and never `--force` without an explicit force-push instruction.
5. Parallel track sessions MUST run in separate git worktrees (per `feedback_parallel_session_worktree` memory). For multi-track plans, coordinate any cross-track merge-hotspot files per the active plan's protocol section.
6. **Plan before work.** For any non-trivial work, the sequence is: (a) draft a robust, comprehensive plan with a sequential numbered prompt roster (same style as the FINAL / PARITY / FLUIDITY / Sandbox / Deep-Research plans), (b) present it for review (inline or as a `PLANNING/*.md`), (c) wait for an explicit green light, (d) then commence. No code changes, builds, or commits until approved. Trivial one-offs (single edits, questions, memory saves, explicit single-command asks) are exempt. See `feedback_plan_before_work` memory.
