# Lamprey Harness — Claude Code Instructions

## What This Is
Electron desktop AI assistant (React 19, TypeScript, electron-vite) powered by DeepSeek API. See `PLANNING/LAMPREY_HARNESS_FINAL.md` for the full 21-prompt build plan.

## Current State
- **Prompts 1–7**: Committed and verified
- **Prompt 8**: Code complete, verified, **NOT COMMITTED**
- **Next**: Prompt 9 (Artifact Polish and ToolUseCard)
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

## Key Decisions
- `window.api` guards needed in renderer code — app must not crash outside Electron (browser dev mode)
- `skill-loader.ts` and `mcp-manager.ts` are stubs — dynamically imported with graceful catch in `chat.ts`
- `mcp:approveToolCall` handler lives in `chat.ts` (not `mcp.ts`) because it resolves confirmation promises
- Branding: display name "Lamprey", desktop icon = green 3D lamprey (`ASSETS/Lamprey Desktop Icon-1.png`), splash screen = `ASSETS/Lamprey New Startup Splash.png` (3s duration)

## Execution Rules
1. Follow the build plan (`PLANNING/LAMPREY_HARNESS_FINAL.md`) strictly sequential — no skips
2. Complete each prompt's VERIFICATION step before moving to the next
3. Log each prompt's work in `DEVLOG.md`
4. Never push to GitHub directly — user reviews and pushes
