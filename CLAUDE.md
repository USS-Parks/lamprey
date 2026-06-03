# Lamprey Harness — Claude Code Instructions

## What This Is
Electron desktop **multi-agent coding harness** (React 19, TypeScript, electron-vite). Routes per-model to four providers — DeepSeek (V4 Pro, V4 Flash, V3, R1), Google (Gemma), Alibaba DashScope (Qwen), and OpenRouter — and can run a Planner → Coder → Reviewer pipeline that assigns a different model to each role. See `PLANNING/LAMPREY_HARNESS_FINAL.md` for the original 22-prompt build plan; the post-Prompt-21 "multi-provider revision" extends it.

## Architecture quick-pointers (multi-provider revision)
- Provider registry + dispatch: `electron/services/providers/registry.ts` — `MODEL_CATALOG`, `chatStream`, `chatOnce`, `validateProviderKey`. Adding a model = append to `MODEL_CATALOG`.
- Agent orchestration: `electron/ipc/chat.ts` `runChatRound()` tool loop; parallel tool-less sub-agents via `electron/services/multi-agent-run-tool.ts` `executeMultiAgentRun()` (the `multi_agent_run` tool). System prompts in `electron/services/system-prompt-builder.ts` (`AGENT_ROLE_PROMPTS`, `buildAgentSystemPrompt`).
- Multi-provider keychain: same `electron/services/keychain.ts` keyed by `deepseek` | `google` | `dashscope` | `openrouter`. IPC: `settings:saveProviderKey` / `:test` / `:delete` / `:list`.
- Agent store: `src/stores/agent-store.ts`. Mode + roster persist via `AppSettings.agentMode` + `agentRoster`.
- UI surfaces: `src/components/settings/ApiKeySettings.tsx` (multi-provider list), `AgentSettings.tsx` (roster + mode), `chat/AgentRunBanner.tsx` (live pipeline status), `chat/ChatInput.tsx` `AgentModeToggle`.

## Current State
- **Original 22-prompt build + multi-provider revision**: shipped — provider registry, Gemma/Qwen/OpenRouter support, agent roster + multi-key UI.
- **Codex toolset parity sprint (Prompts 1–15)**: shipped — see `PLANNING/CODEX_TOOLSET_PARITY_PROGRESS.md`. Native gated tools, persistent permission policies, plan/goal SQLite persistence, verification loop, frontend QA, parallel sub-agents, final-response composer, 7 codex skills, end-to-end agentic coding mode.
- **Code version**: `package.json` is 0.1.26; no published GitHub release yet (builds are cut ad hoc per platform).
- **Active work**: audit remediation — 8 of 12 prompts shipped (P1–P8) on branch `claude/code-quality-review-z3VhL`; P9–P12 pending. Full state + resume notes in `PLANNING/AUDIT_REMEDIATION_PROGRESS.md` ("Session handoff"); findings in `REPO_AUDIT.md`; plan in `PLANNING/AUDIT_REMEDIATION_PLAN.md`.
- Read `DEVLOG.md` for detailed build history before making changes.

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
- **Artifact sandbox**: `WebContentsView` (not deprecated BrowserView) with CSP + sandbox isolation, vendor files in `resources/vendor/`. Artifact content (model-authored HTML/JSX) is treated as **untrusted but contained** — rendered in a sandboxed view with `connect-src 'none'`, no node integration, and no network egress

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
