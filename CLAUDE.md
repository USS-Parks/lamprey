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
- **Prompts 1–20**: Committed and pushed to main
- **Prompt 21 + ASSETS + visual pass**: Implemented locally (process-level error handlers, SecurityBanner, README/SKILLS/CONTRIBUTING/LICENSE, ASSETS branding, redesigned welcome).
- **Multi-provider revision (post-21)**: provider registry, Gemma + Qwen support, agent roster + pipeline, multi-key UI. Awaiting review and push.
- Read `DEVLOG.md` for detailed build history before making changes

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
1. Follow the build plan (`PLANNING/LAMPREY_HARNESS_FINAL.md`) strictly sequential — no skips
2. Complete each prompt's VERIFICATION step before moving to the next
3. Log each prompt's work in `DEVLOG.md`
4. Never push to GitHub directly — user reviews and pushes
