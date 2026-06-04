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
- **Parity Phase — Three concurrent tracks underway** (started 2026-06-03):
  - **Active plan**: `PLANNING/LAMPREY_PARITY_PLAN.md` — 36 prompts, three tracks + Integration Phase, each track running in its own git worktree session.
  - **Track 1** (8 prompts, A1→B5): Runtime foundation — subagent runner, workflow runner, journaling + resume, model-tier routing.
  - **Track 2** (9 prompts, C1→E4): Tool layer + continuity — lazy tool schemas, hooks-into-dispatch, plan mode, slash commands, chapters, compression, async event bridge, spawn-task.
  - **Track 3** (13 prompts, D1→D4): Memory + verification + scheduling — typed memory + index, FTS session search, preview tools, monitor + bg shell, PR depth, cron UI, self-paced loop, push notifications + cross-session messaging, headless CLI, memory consolidation.
  - **Integration Phase** (6 prompts, H1→H6): runs in a single session after all three tracks merge — activity dashboard, workflow palette, sessions sidebar, hook editor, plan-mode UX, status line + AskUserQuestion UI.
- Read `DEVLOG.md` for detailed build history before making changes. Read `PLANNING/LAMPREY_PARITY_PLAN.md` §0 before starting any track session.

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
1. **Active plan is `PLANNING/LAMPREY_PARITY_PLAN.md`** (original `LAMPREY_HARNESS_FINAL.md` + RAG roster are complete and now reference-only). New sessions on this repo must read §0 of the parity plan before doing anything; it covers track selection, verify gates, cross-track wait protocol, and commit discipline.
2. Each prompt in a track must pass its verify gate (both tsc configs + relevant tests + smoke checks) before being marked `[x]` and committed.
3. Log each prompt's work in `DEVLOG.md` per the format in `PLANNING/LAMPREY_PARITY_PLAN.md` §0 Step 4.
4. Never push to GitHub directly — user reviews and pushes.
5. Parallel track sessions MUST run in separate git worktrees (per `feedback_parallel_session_worktree` memory). Coordinate the three merge-hotspot files (`tool-registry.ts`, `chat.ts`, `system-prompt-builder.ts`) per the parity plan §8 protocol.
