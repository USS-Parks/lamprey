# Lamprey Harness — Claude Code Instructions

## What This Is
Electron desktop AI assistant (React 19, TypeScript, electron-vite) powered by DeepSeek API. See `PLANNING/LAMPREY_HARNESS_FINAL.md` for the full 22-prompt build plan (Prompts 1–21 plus 16A).

## Current State
- **Prompts 1–18**: Committed and pushed to main
- **Prompt 19**: Skipped for now (system tray + global shortcuts + auto-updater can be added as a feature later)
- **Next**: Prompt 20 (Packaging and Distribution)
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
- `mcp:approveToolCall` handler lives in `chat.ts` (not `mcp.ts`) because it resolves confirmation promises
- Branding: display name "Lamprey", desktop icon = green 3D lamprey (`ASSETS/Lamprey Desktop Icon-1.png`), splash screen = `ASSETS/Lamprey New Startup Splash.png` (3s duration)
- `WebContentsView` (Electron 42) replaces deprecated `BrowserView` — uses DIP coordinates (no scaleFactor multiplication needed)
- React 19 has no UMD builds — JSX artifacts use a custom `react-shim.js` for createElement/createRoot
- `react-markdown` v10 requires `pre` passthrough override to prevent double-wrapping CodeBlock components

## Execution Rules
1. Follow the build plan (`PLANNING/LAMPREY_HARNESS_FINAL.md`) strictly sequential — no skips
2. Complete each prompt's VERIFICATION step before moving to the next
3. Log each prompt's work in `DEVLOG.md`
4. Never push to GitHub directly — user reviews and pushes
