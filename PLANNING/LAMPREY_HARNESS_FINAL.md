# Lamprey Harness — Final Build Plan
**Version:** 2.0 — Merged & Reconciled, May 2026
**Working Directory:** `C:\Users\17076\Documents\Claude\Lamprey Harness`
**Status:** Pre-build. Hand this document to Claude Code to begin execution.
**Repo name:** `lamprey-harness`
**App display name:** Lamprey
**License:** MIT

---

## BEFORE YOU TOUCH THE CODE: Prerequisites

These three things will block you if not done first. Do them now, before opening Claude Code.

**1. DeepSeek API Key**
- Create an account at platform.deepseek.com
- Generate an API key and load credits onto the account
- Store the key somewhere safe temporarily — the app will move it to encrypted storage on first run
- Verify the key works: `curl https://api.deepseek.com/v1/models -H "Authorization: Bearer YOUR_KEY"`

**2. Google Cloud OAuth App (blocks Prompt 12 — do this now)**
- Go to console.cloud.google.com
- Create a new project named "Lamprey Harness"
- Enable two APIs: Gmail API and Google Drive API
- Go to APIs & Services > Credentials
- Create an OAuth 2.0 Client ID, type: Desktop app
- Download the credentials JSON — you need `client_id` and `client_secret`
- Estimated time: 90 minutes

**3. Node.js and Environment**
- Node.js 20+: `node --version`
- npm 10+: `npm --version`
- Git: `git --version`
- Create working directory: `mkdir "C:\Users\17076\Documents\Claude\Lamprey Harness"`

---

## 1. What This Is

A production-grade Electron desktop application that delivers Claude Desktop-quality UX — streaming chat, sandboxed artifact rendering, MCP tool integration, a hot-reloaded skill system, and persistent cross-session memory — powered by DeepSeek V4 Pro Max (and switchable models) instead of Anthropic's API.

This is not a wrapper around OpenCode. It talks directly to DeepSeek's API endpoint. The result is a standalone, open source desktop app for Windows, macOS, and Linux.

---

## 2. Architecture

### 2.1 High-Level Process Model

```
┌──────────────────────────────────────────────────────────────┐
│                      Electron Shell                           │
│                                                               │
│  ┌─────────────────────┐    ┌──────────────────────────┐     │
│  │    Main Process      │    │   Renderer (React 19)    │     │
│  │    (Node.js)         │    │                          │     │
│  │                      │    │  - Chat UI               │     │
│  │  - SQLite (db)       │◄──►│  - Artifact Panel        │     │
│  │  - MCP client mgr    │IPC │  - Skill Editor          │     │
│  │  - Skill watcher     │    │  - Model Switcher        │     │
│  │  - API key storage   │    │  - Memory Panel          │     │
│  │  - DeepSeek client   │    │  - Settings              │     │
│  │  - Artifact sandbox  │    │  - MCP Status Bar        │     │
│  └─────────────────────┘    └──────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │           BrowserView (sandboxed)                   │     │
│  │       Artifact rendering — isolated process          │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │                  MCP Layer                           │     │
│  │  Gmail (SSE/remote)  Drive (SSE/remote)             │     │
│  │  Chrome (stdio/local — Playwright child process)    │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │       DeepSeek API  (https://api.deepseek.com/v1)   │     │
│  └─────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Security Boundaries

- `contextIsolation: true` on all BrowserWindows
- `nodeIntegration: false` on all BrowserWindows
- `sandbox: true` on all BrowserWindows
- Artifact BrowserView: fully separate Chromium process, sandbox: true, CSP blocks all external network
- API keys: Electron `safeStorage` (OS-level encryption). Never touch the renderer. Never appear in logs.
- OAuth tokens: Electron `safeStorage`. Never committed to disk unencrypted.
- MCP Chrome server: confirmation dialog required for all destructive actions before execution

### 2.3 Data Flow

```
User Input → React UI → IPC → Main Process → DeepSeek API (SSE stream)
                                    │               ↓
                                    │    Streaming tokens via IPC events
                                    │               ↓
                                    │    React UI renders tokens as they arrive
                                    │               ↓
                                    └──────────────► SQLite persists full message on done
```

---

## 3. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Shell | Electron 35+ | Mature, Claude Desktop uses it, BrowserView for artifacts |
| Renderer | React 19 + TypeScript 5.7 | Standard, large ecosystem |
| Build tooling | electron-vite | Unified main/preload/renderer build, HMR in dev |
| State | Zustand | Minimal boilerplate, sufficient for this complexity |
| Styling | Tailwind CSS 4 | Rapid iteration, consistent design tokens |
| Markdown | react-markdown + remark-gfm | GFM tables, task lists, strikethrough |
| Syntax highlighting | Shiki | Accurate, themeable, tree-sitter based |
| Database | better-sqlite3 | Synchronous API, zero config, full SQLite |
| API keys | Electron safeStorage | OS-level keychain encryption |
| AI client | openai npm package | OpenAI-compatible, pointed at DeepSeek base URL |
| MCP client | @modelcontextprotocol/sdk | Official MCP TypeScript SDK |
| Skill parsing | gray-matter | YAML frontmatter parser for .md skill files |
| Skill watching | chokidar | Cross-platform filesystem watcher, hot reload |
| Packaging | electron-builder | .dmg / .exe / .AppImage |
| Auto-update | electron-updater | GitHub Releases-based |
| Testing | Vitest + Playwright | Unit + E2E |
| Linting | ESLint + Prettier | Code quality |

---

## 4. Directory Structure

```
lamprey-harness/
├── electron/
│   ├── main.ts                        # App entry, window management
│   ├── preload.ts                     # contextBridge typed API surface
│   ├── ipc/
│   │   ├── index.ts                   # Registers all IPC handlers
│   │   ├── chat.ts                    # Chat/completion handlers
│   │   ├── settings.ts                # Settings CRUD
│   │   ├── skills.ts                  # Skill file management
│   │   ├── memory.ts                  # Memory persistence handlers
│   │   └── mcp.ts                     # MCP lifecycle handlers
│   ├── services/
│   │   ├── deepseek.ts                # DeepSeek API client (streaming)
│   │   ├── conversation-store.ts      # SQLite conversation manager
│   │   ├── memory-store.ts            # SQLite memory/facts manager
│   │   ├── skill-loader.ts            # chokidar watcher + gray-matter parser
│   │   ├── mcp-manager.ts             # MCP server orchestration
│   │   ├── keychain.ts                # Encrypted API key + token storage
│   │   └── artifact-sandbox.ts        # BrowserView lifecycle manager
│   └── mcp-servers/
│       ├── gmail.ts                   # Gmail SSE config + OAuth token handler
│       ├── gdrive.ts                  # Drive SSE config + OAuth token handler
│       └── chrome.ts                  # Playwright stdio server config
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Titlebar.tsx
│   │   │   └── StatusBar.tsx
│   │   ├── chat/
│   │   │   ├── ChatView.tsx
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── ChatInput.tsx
│   │   │   ├── StreamingText.tsx
│   │   │   ├── FileDropZone.tsx
│   │   │   ├── AttachmentPreview.tsx
│   │   │   └── ToolUseCard.tsx
│   │   ├── artifacts/
│   │   │   ├── ArtifactPanel.tsx
│   │   │   ├── CodeBlock.tsx
│   │   │   └── MarkdownRenderer.tsx
│   │   ├── skills/
│   │   │   ├── SkillPanel.tsx
│   │   │   └── SkillEditor.tsx
│   │   ├── memory/
│   │   │   └── MemoryPanel.tsx
│   │   ├── model/
│   │   │   └── ModelSwitcher.tsx
│   │   ├── mcp/
│   │   │   ├── MCPStatusBar.tsx
│   │   │   └── ConfirmationModal.tsx
│   │   ├── ui/
│   │   │   └── Toast.tsx
│   │   └── settings/
│   │       ├── SettingsDialog.tsx
│   │       ├── ApiKeySettings.tsx
│   │       ├── McpSettings.tsx
│   │       └── ModelSettings.tsx
│   ├── hooks/
│   │   ├── useIpc.ts
│   │   ├── useChat.ts
│   │   ├── useStreaming.ts
│   │   ├── useSkills.ts
│   │   ├── useMemory.ts
│   │   ├── useMcp.ts
│   │   └── useSettings.ts
│   ├── stores/
│   │   ├── chat-store.ts
│   │   ├── settings-store.ts
│   │   ├── model-store.ts
│   │   └── memory-store.ts
│   ├── lib/
│   │   ├── ipc-client.ts
│   │   └── types.ts
│   └── styles/
│       ├── index.css
│       └── markdown.css
├── skills/
│   ├── README.md
│   ├── direct-voice.md
│   ├── code-review.md
│   └── git-commit.md
├── scripts/
│   └── setup-oauth.ts
├── resources/
│   ├── vendor/
│   │   ├── mermaid.min.js
│   │   └── babel.standalone.min.js
│   ├── icon.png
│   ├── icon.icns
│   └── icon.ico
├── tests/
│   ├── unit/
│   └── e2e/
├── package.json
├── electron-builder.yml
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tailwind.config.ts
├── .eslintrc.cjs
├── .prettierrc
├── .env.example
├── DEVLOG.md
├── SKILLS.md
├── CONTRIBUTING.md
└── README.md
```

---

## 5. Core Subsystem Specifications

### 5.1 DeepSeek API Client

Uses `openai` npm package pointed at DeepSeek's base URL. DeepSeek's API is fully OpenAI-compatible.

```
Base URL: https://api.deepseek.com/v1
Auth:     Bearer token from safeStorage
Models:   deepseek-chat (V3/V4, fast, 64K context, tool use supported)
          deepseek-reasoner (R1, chain-of-thought, 64K context)
```

Streaming via `openai.chat.completions.create({ stream: true })`. Tokens forwarded to renderer via IPC events (`chat:chunk`, `chat:done`, `chat:error`). Tool use passed via `tools[]` OpenAI format. Error handling: 401 immediate fail, 429 retry 3x exponential backoff, network error retry 3x.

### 5.2 Typed IPC System

All shared types in `src/lib/types.ts`. contextBridge exposes fully typed `window.api`. No raw channel strings in the renderer. All IPC calls go through typed wrappers in `src/lib/ipc-client.ts`.

Core types:
```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  conversationId: string;
  model?: string;
  toolCallId?: string;
}
interface Conversation { id: string; title: string; model: string; createdAt: number; updatedAt: number; messageCount: number; }
interface Skill { id: string; name: string; description: string; content: string; filePath: string; enabled: boolean; }
interface MemoryEntry { id: number; content: string; createdAt: number; updatedAt: number; sourceConversationId?: string; }
interface McpServerConfig { id: string; name: string; transport: 'sse' | 'stdio'; url?: string; command?: string; args?: string[]; auth: 'google-oauth' | 'none'; enabled: boolean; status: 'disconnected' | 'connecting' | 'connected' | 'error'; }
interface ModelInfo { id: string; name: string; contextWindow: number; supportsTools: boolean; supportsVision: boolean; }
interface AppSettings { theme: 'dark'; fontSize: number; defaultModel: string; sidebarCollapsed: boolean; artifactPanelWidth: number; minimizeToTray: boolean; autoCheckUpdates: boolean; }
type IpcResponse<T> = { success: true; data: T } | { success: false; error: string };
```

### 5.3 Skill System

**Pattern:** Drop a `.md` file into `skills/`. It becomes a skill immediately. No restart.

**File format:**
```markdown
---
name: Display Name
description: One sentence. When to activate this skill.
---
Everything below frontmatter is injected verbatim into the system prompt.
```

**Hot reload:** chokidar watches skills directory. On add/change/delete: parse with gray-matter, update Map<filename, Skill>, emit `skills:changed` to renderer.

**System prompt assembly order:**
1. Base system prompt
2. `<memory>` block (all MemoryEntry rows)
3. Per active skill: `<skill name="...">` block

**Production path:** Dev uses `./skills/`. Production uses `app.getPath('userData')/skills/`. On first production launch, copy bundled defaults from resources/ to userData/ if directory does not exist.

### 5.4 Artifact Rendering

**Security decision: BrowserView, NOT iframe.** A BrowserView is a fully isolated Chromium process. An iframe in the renderer shares the Electron renderer process and can potentially reach the preload bridge via `window.parent`. For an open source app running arbitrary model-generated code, process isolation is mandatory.

**BrowserView config:**
```typescript
webPreferences: {
  sandbox: true, contextIsolation: true, nodeIntegration: false,
  nodeIntegrationInSubFrames: false, allowRunningInsecureContent: false, webSecurity: true
}
```

**CSP on artifact BrowserView:**
```
default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'self' data:;
```

**Artifact types supported:**
- `html` — full HTML document, CSP injected into head
- `svg` — wrapped in centered HTML document
- `mermaid` — HTML document loading bundled `mermaid.min.js` (file://, no CDN)
- `jsx`/`react` — HTML document loading bundled `babel.standalone.min.js` (file://, no CDN)
- `markdown` — rendered in renderer (no sandbox needed)
- all other code — Shiki syntax highlight + copy button, no execution

**Vendor files** in `resources/vendor/` — file:// references, works offline.

**DPI on Windows:** multiply all BrowserView bounds by `screen.getPrimaryDisplay().scaleFactor`.

### 5.5 MCP Integration

**CRITICAL: Gmail and Drive are remote SSE endpoints, not npm packages.**
`@anthropic/mcp-server-gmail` and `@anthropic/mcp-server-google-drive` are NOT publicly available npm packages. They are hosted SSE endpoints. Access them via `SSEClientTransport` with Bearer OAuth tokens. This is exactly how Claude Desktop's connectors work.

**Server configurations:**

Gmail: `{ transport: 'sse', url: 'https://gmailmcp.googleapis.com/mcp/v1', auth: 'google-oauth' }`
Drive: `{ transport: 'sse', url: 'https://drivemcp.googleapis.com/mcp/v1', auth: 'google-oauth' }`
Chrome: `{ transport: 'stdio', command: 'npx', args: ['@playwright/mcp', '--browser', 'chromium'], auth: 'none' }`

**OAuth token handling:** Before each SSE connection, read access token from safeStorage. If expired, use refresh token to get a new one from `https://oauth2.googleapis.com/token`. Pass `Authorization: Bearer <token>` header to SSEClientTransport.

**Chrome destructive actions requiring confirmation before execution:**
`click`, `fill`, `submit`, `type`, `press`, `select_option`

**Chrome read-only actions (no confirmation):**
`navigate`, `screenshot`, `get_text`, `get_url`, `find_element`, `snapshot`

**MCP tool call flow:**
1. On each chat request, pass all connected server tools to DeepSeek via `tools[]`
2. Parse `tool_calls` in model response
3. For each tool call: show ToolUseCard (pending), run confirmation if needed, callTool(), update card, inject tool result, continue streaming
4. Max 10 tool call rounds per response (prevent infinite loops)

### 5.6 Memory System

**Design: manual-first, model-assisted.** User adds entries explicitly. Model can add entries via a `memory_add` pseudo-tool. No automatic extraction — automatic extraction produces garbage.

**SQLite schema:**
```sql
CREATE TABLE IF NOT EXISTS memory_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source_conversation_id TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, title TEXT, model TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL, model TEXT, tool_call_id TEXT, created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
```

**Memory injection:** Every system prompt includes:
```xml
<memory>
1. [entry content]
2. [entry content]
</memory>
```

**`memory_add` pseudo-tool:** Registered in tools[] on every request. When model calls it, main process writes to memory_entries, sends `memory:added` event to renderer, returns "Saved to memory."

---

## 6. UI Design Specification

**Aesthetic:** Dark, terminal-adjacent, precise. Dense information, clean hierarchy, zero decoration for its own sake.

**Color palette (CSS variables):**
```css
:root {
  --bg-primary:     #0d0d0d;
  --bg-secondary:   #161616;
  --bg-tertiary:    #1f1f1f;
  --border:         #2a2a2a;
  --text-primary:   #e8e8e8;
  --text-secondary: #888888;
  --text-muted:     #444444;
  --accent:         #4a9eff;
  --accent-dim:     #1a3a5c;
  --success:        #3d9e60;
  --warning:        #c47a2a;
  --error:          #c43a3a;
  --code-bg:        #111111;
}
```

### 6.1 User-Selectable ArcGIS-Inspired Color Swatch Themes

Lamprey includes six selectable interface themes inspired by ArcGIS color schemes. These themes do not alter the app layout, typography, security posture or component hierarchy. They only remap CSS color tokens used by the renderer.

Theme selection is available in Settings > Appearance and persists in `AppSettings.themePreset`.

Each theme provides:
- A five-color swatch preview
- A primary accent
- A dim accent for selected user messages and active navigation states
- A warning color
- A success color
- An optional visualization palette for charts, tool cards, status indicators and artifact metadata

The default Lamprey theme remains the dark terminal-adjacent base theme.

**Six ArcGIS-Inspired Lamprey Theme Presets**

These six cover distinct visual moods without becoming noisy: blue, orange, purple, inferno, magma and viridis. They are all grounded in named Esri ramps or ArcGIS Colors schemes. Use the phrase "ArcGIS-inspired" in the app and documentation, not "ArcGIS themes." The presets are based on named Esri color ramps, but Lamprey's UI tokens are adapted for a dark desktop AI harness.

| Lamprey Theme Name | ArcGIS Source Scheme | Swatch |
|---|---|---|
| Lamprey Blue | Blue 3 | `#eff3ff`, `#bdd7e7`, `#6baed6`, `#3182bd`, `#08519c` |
| Lamprey Ember | Esri Orange 1 | `#c65a18`, `#f36f20`, `#f7975e`, `#fbc09b`, `#fdd4ba` |
| Lamprey Violet | Esri Purple 1 | `#57318c`, `#7b5ba9`, `#a085c6`, `#c4afe2`, `#d6c4f1` |
| Lamprey Inferno | Inferno | `#520d8e`, `#bc2e9a`, `#ff5c6a`, `#ffb71b`, `#ffff64` |
| Lamprey Magma | Magma | `#481793`, `#b233b9`, `#ff57a5`, `#ffae85`, `#ffffd1` |
| Lamprey Viridis | Viridis | `#6058be`, `#419ecb`, `#2cdcc6`, `#6fff99`, `#ffff37` |

These values are taken from Esri's published color ramp listings. ArcGIS Pro documentation identifies Inferno, Magma, Plasma and Viridis as scientifically designed schemes intended to reduce data misinterpretation from color.

**TypeScript model additions** (added in Prompt 16A):

Add to `src/lib/types.ts`:
```typescript
export type ThemePresetId =
  | 'lamprey-default'
  | 'arcgis-blue'
  | 'arcgis-ember'
  | 'arcgis-violet'
  | 'arcgis-inferno'
  | 'arcgis-magma'
  | 'arcgis-viridis';

export interface ThemePreset {
  id: ThemePresetId;
  name: string;
  source: string;
  swatch: string[];
  tokens: {
    bgPrimary: string;
    bgSecondary: string;
    bgTertiary: string;
    border: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    accent: string;
    accentDim: string;
    success: string;
    warning: string;
    error: string;
    codeBg: string;
  };
}
```

Update `AppSettings`:
```typescript
interface AppSettings {
  theme: 'dark';
  themePreset: ThemePresetId;
  fontSize: number;
  defaultModel: string;
  sidebarCollapsed: boolean;
  artifactPanelWidth: number;
  minimizeToTray: boolean;
  autoCheckUpdates: boolean;
}
```

**Theme token file** `src/styles/theme-presets.ts`:

Contains the full `THEME_PRESETS: ThemePreset[]` array with all seven presets (Lamprey Default plus six ArcGIS-inspired). Each preset defines all 13 CSS token overrides adapted for dark desktop use. See Prompt 16A for full implementation.

**Typography:**
- UI chrome (labels, nav, buttons): `JetBrains Mono` — bundled
- Chat messages: `IBM Plex Sans`
- Code blocks: `JetBrains Mono`

**Layout:**
```
┌──────────────────────────────────────────────────────────────┐
│  [≡] Lamprey  [Model Switcher▾]                  [⚙ Settings]│ ← Titlebar (48px)
├─────────────┬──────────────────────────┬─────────────────────┤
│             │                          │                     │
│  Sidebar    │       Chat Pane          │   Artifact Panel    │
│  (240px)    │     (flex grow)          │     (420px)         │
│             │                          │                     │
│ [+ New]     │  ┌────────────────────┐  │  [HTML▾] [⧉] [✕]  │
│             │  │  assistant message │  │                     │
│ Today       │  │  (markdown + code) │  │  <BrowserView>      │
│  Chat 1     │  └────────────────────┘  │                     │
│  Chat 2     │  ┌────────────────────┐  │                     │
│             │  │  user message      │  │                     │
│ Yesterday   │  └────────────────────┘  │                     │
│  Chat 3     │                          │                     │
│             │  ┌────────────────────┐  │                     │
│ ──────────  │  │ [Skills▾] [📎]     │  │                     │
│ SKILLS      │  │ Input area         │  │                     │
│ [+]         │  │              [Send]│  │                     │
│ ○ Skill A   │  └────────────────────┘  │                     │
│ ● Skill B   ├──────────────────────────┤                     │
│             │ ●Gmail  ●Drive  ●Chrome  │← MCP status (32px)  │
│ ──────────  └──────────────────────────┘                     │
│ MEMORY      │                                                 │
│ [+] N items │                                                 │
│  1. Entry   │                                                 │
└─────────────┴─────────────────────────────────────────────────┘
```

**Sizing:** Sidebar 240px (collapsible), artifact panel 420px default (resizable), MCP status bar 32px, input auto-grows to 200px max.

---

## 7. Implementation Phases

| Phase | Prompts | What Gets Built |
|---|---|---|
| 0 — Scaffold | 1-2 | electron-vite, React, TypeScript, typed IPC foundation |
| 1 — Core Chat | 3-6 | DeepSeek client, SQLite, streaming chat UI |
| 2 — Rich Rendering | 7-9 | Markdown, Shiki, BrowserView artifact sandbox |
| 3 — MCP | 10-12 | MCP manager, Google OAuth, Gmail + Drive + Chrome |
| 4 — Skills | 13-14 | Skill loader, hot reload, GUI editor |
| 5 — Memory | 15-16 | Memory store, injection, UI polish |
| 5A — Themes | 16A | ArcGIS-inspired color swatch presets, appearance settings |
| 6 — Model Mgmt | 17-18 | Model switcher, per-model config, file attachments |
| 7 — Polish | 19-21 | System tray, shortcuts, packaging, launch prep |


---

## 8. Prompt Roster

Each prompt is a complete, self-contained instruction set for Claude Code. Feed them one at a time. Do not move to the next until VERIFICATION passes. Claude Code writes to DEVLOG.md after each prompt.

---

### PROMPT 1 — Project Initialization

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness

TASK: Initialize the Lamprey Harness Electron + React + TypeScript project using electron-vite.

STEPS:

1. Run: npm create electron-vite@latest . -- --template react-ts
   This scaffolds the electron-vite structure. If it asks to overwrite, confirm yes.

2. Install additional dependencies:
   npm install better-sqlite3 openai @modelcontextprotocol/sdk chokidar gray-matter zustand react-markdown remark-gfm

3. Install additional dev dependencies:
   npm install -D @types/better-sqlite3 @types/node tailwindcss @tailwindcss/vite vitest @playwright/test electron-builder electron-updater

4. Create tailwind.config.ts. Configure Tailwind with the CSS variables from the plan Section 6.

5. Replace default electron/main.ts with a clean version:
   - BrowserWindow (1280x800, backgroundColor: '#0d0d0d')
   - contextIsolation: true, nodeIntegration: false, sandbox: true
   - Loads Vite dev server in dev, built index.html in production
   - app.on('ready') and app.on('window-all-closed') handlers

6. Replace electron/preload.ts with minimal version exposing:
   window.api.ping() => Promise<string>
   (Full typed API comes in Prompt 2)

7. Replace src/App.tsx with three-column placeholder using the CSS variables:
   - Left (240px): sidebar placeholder
   - Center (flex-grow): "Lamprey" text
   - Right (420px): artifact panel placeholder
   Background: var(--bg-primary) / #0d0d0d

8. Add scripts to package.json:
   "build:win": "electron-vite build && electron-builder --win"
   "build:mac": "electron-vite build && electron-builder --mac"
   "build:linux": "electron-vite build && electron-builder --linux"

9. Create .gitignore: node_modules/, dist/, dist-electron/, out/, .env, *.log, lamprey.db

10. Create .env.example: DEEPSEEK_API_KEY=your_key_here

11. Create skills/ directory with:
    - README.md: skill file format documentation
    - direct-voice.md: direct communication style skill (see Section 5.3 for content)
    - code-review.md: code review methodology skill

12. Create resources/vendor/ directory (empty, vendor files added in Prompt 8).

13. git init && git add . && git commit -m "chore: initial scaffold"

14. Create DEVLOG.md with header: "# Lamprey Harness Dev Log"

VERIFICATION: npm run dev. Electron window opens showing three-column placeholder, dark background. No TypeScript errors. No console errors. Log result in DEVLOG.md.
```

---

### PROMPT 2 — Typed IPC Foundation

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: Project scaffold running.

TASK: Build the complete typed IPC layer. This is the foundation everything else builds on. Do not skip or abbreviate it.

STEPS:

1. Create src/lib/types.ts with ALL interfaces from Section 5.2 of the master plan:
   Message, Conversation, Skill, MemoryEntry, McpServerConfig, ModelInfo, AppSettings.
   Also add:
   - IpcResponse<T> = { success: true; data: T } | { success: false; error: string }
   - ChatChunkEvent = { conversationId: string; content: string }
   - ChatDoneEvent = { conversationId: string; message: Message }
   - ToolCallEvent = { callId: string; serverId: string; toolName: string; args: Record<string, unknown> }

2. Expand electron/preload.ts to expose the full typed API via contextBridge:

   window.api = {
     chat: {
       send: (request) => ipcRenderer.invoke('chat:send', request),
       cancel: (conversationId) => ipcRenderer.invoke('chat:cancel', conversationId),
       onChunk: (cb) => ipcRenderer.on('chat:chunk', (_, e) => cb(e)),
       onDone: (cb) => ipcRenderer.on('chat:done', (_, e) => cb(e)),
       onError: (cb) => ipcRenderer.on('chat:error', (_, e) => cb(e)),
       onToolCall: (cb) => ipcRenderer.on('chat:tool-call', (_, e) => cb(e)),
       onToolCallResult: (cb) => ipcRenderer.on('chat:tool-call-result', (_, e) => cb(e)),
       offAll: () => { ['chat:chunk','chat:done','chat:error','chat:tool-call','chat:tool-call-result'].forEach(ch => ipcRenderer.removeAllListeners(ch)) },
     },
     conversation: {
       list: () => ipcRenderer.invoke('conversation:list'),
       get: (id) => ipcRenderer.invoke('conversation:get', id),
       create: (model) => ipcRenderer.invoke('conversation:create', model),
       delete: (id) => ipcRenderer.invoke('conversation:delete', id),
       updateTitle: (id, title) => ipcRenderer.invoke('conversation:updateTitle', id, title),
       getMessages: (id) => ipcRenderer.invoke('conversation:getMessages', id),
     },
     settings: {
       get: () => ipcRenderer.invoke('settings:get'),
       set: (partial) => ipcRenderer.invoke('settings:set', partial),
       saveApiKey: (key) => ipcRenderer.invoke('settings:saveApiKey', key),
       hasApiKey: () => ipcRenderer.invoke('settings:hasApiKey'),
       testApiKey: () => ipcRenderer.invoke('settings:testApiKey'),
       saveGoogleCredentials: (clientId, clientSecret) => ipcRenderer.invoke('settings:saveGoogleCredentials', clientId, clientSecret),
     },
     model: {
       list: () => ipcRenderer.invoke('model:list'),
       getActive: () => ipcRenderer.invoke('model:getActive'),
       setActive: (id) => ipcRenderer.invoke('model:setActive', id),
     },
     skills: {
       list: () => ipcRenderer.invoke('skills:list'),
       create: (skill) => ipcRenderer.invoke('skills:create', skill),
       update: (id, skill) => ipcRenderer.invoke('skills:update', id, skill),
       delete: (id) => ipcRenderer.invoke('skills:delete', id),
       onChanged: (cb) => ipcRenderer.on('skills:changed', (_, skills) => cb(skills)),
     },
     memory: {
       list: () => ipcRenderer.invoke('memory:list'),
       add: (content) => ipcRenderer.invoke('memory:add', content),
       update: (id, content) => ipcRenderer.invoke('memory:update', id, content),
       delete: (id) => ipcRenderer.invoke('memory:delete', id),
       clear: () => ipcRenderer.invoke('memory:clear'),
       export: () => ipcRenderer.invoke('memory:export'),
       import: (entries) => ipcRenderer.invoke('memory:import', entries),
       onAdded: (cb) => ipcRenderer.on('memory:added', (_, entry) => cb(entry)),
     },
     mcp: {
       list: () => ipcRenderer.invoke('mcp:list'),
       getStatus: (id) => ipcRenderer.invoke('mcp:getStatus', id),
       reconnect: (id) => ipcRenderer.invoke('mcp:reconnect', id),
       setupGoogleOAuth: () => ipcRenderer.invoke('mcp:setupGoogleOAuth'),
       approveToolCall: (callId, approved) => ipcRenderer.invoke('mcp:approveToolCall', callId, approved),
       onStatusChanged: (cb) => ipcRenderer.on('mcp:statusChanged', (_, e) => cb(e)),
       onConfirmationRequired: (cb) => ipcRenderer.on('mcp:confirmationRequired', (_, e) => cb(e)),
     },
     artifact: {
       render: (type, content) => ipcRenderer.invoke('artifact:render', type, content),
       hide: () => ipcRenderer.invoke('artifact:hide'),
       resize: (bounds) => ipcRenderer.invoke('artifact:resize', bounds),
       openInWindow: (type, content) => ipcRenderer.invoke('artifact:openInWindow', type, content),
     },
   }

3. Create src/lib/ipc-client.ts — typed wrappers calling window.api.*. No logic. Just typed call-throughs.

4. Create src/hooks/useIpc.ts — React hook wrapping common IPC patterns with loading/error states.

5. Create electron/ipc/index.ts, electron/ipc/chat.ts, electron/ipc/settings.ts, electron/ipc/skills.ts, electron/ipc/memory.ts, electron/ipc/mcp.ts — all as stubs returning { success: true, data: null }.

6. Add a "Test IPC" button in App.tsx that calls window.api.settings.hasApiKey() and renders the boolean.

VERIFICATION: Click Test IPC. Result renders (false). npm run typecheck — zero errors. Log in DEVLOG.md.
```

---

### PROMPT 3 — DeepSeek API Client

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: Typed IPC layer complete, zero TypeScript errors.

TASK: Build the DeepSeek API client and keychain service in the main process.

STEPS:

1. Create electron/services/keychain.ts:
   - setKey(provider, key): encrypts with safeStorage.encryptString, writes to userData/keys.json
   - getKey(provider): decrypts and returns key or null
   - deleteKey(provider): removes from keys.json
   - hasKey(provider): boolean
   - If safeStorage.isEncryptionAvailable() returns false: store as plaintext with warning logged.
     Set a flag isEncryptionAvailable() that the settings UI can query.

2. Create electron/services/deepseek.ts with DeepSeekClient class:
   - constructor(): reads key via keychain.getKey('deepseek'), creates OpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1' })
   - chatStream(messages, model, tools, onChunk, onDone, onError): void
     Uses openai.chat.completions.create({ model, messages, stream: true, tools: tools || undefined })
     Iterates async stream, calls callbacks appropriately
   - chat(messages, model): Promise<string> — non-streaming for testing
   - validateKey(): Promise<boolean> — minimal request to verify key
   - Retry: 3 attempts, exponential backoff (1s/2s/4s) for 429 and network errors. 401: fail immediately.

3. Wire electron/ipc/settings.ts:
   - 'settings:saveApiKey': keychain.setKey('deepseek', key)
   - 'settings:hasApiKey': keychain.hasKey('deepseek')
   - 'settings:testApiKey': deepseekClient.validateKey()
   - 'settings:get' / 'settings:set': read/write userData/settings.json
   - 'settings:saveGoogleCredentials': keychain.setKey('google-client-id', id); keychain.setKey('google-client-secret', secret)

4. Wire electron/ipc/model.ts:
   - 'model:list': return hardcoded array:
     [{ id: 'deepseek-chat', name: 'DeepSeek V3', contextWindow: 65536, supportsTools: true, supportsVision: false },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1', contextWindow: 65536, supportsTools: false, supportsVision: false }]
   - 'model:getActive': reads from settings (default: 'deepseek-chat')
   - 'model:setActive': updates settings

VERIFICATION: In DevTools console:
  await window.api.settings.saveApiKey('YOUR_KEY')
  await window.api.settings.testApiKey()
  Result: { success: true, data: true }
  Log in DEVLOG.md.
```

---

### PROMPT 4 — SQLite Persistence Layer

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: DeepSeek client validates successfully.

TASK: Build the SQLite persistence layer for conversations, messages, and memory.

STEPS:

1. Create electron/services/conversation-store.ts:
   - Initialize better-sqlite3 at app.getPath('userData')/lamprey.db
   - Run all CREATE TABLE IF NOT EXISTS statements from Section 5.6 schema
   - Run PRAGMA foreign_keys = ON
   - Export: createConversation(model), getConversation(id), listConversations(),
     deleteConversation(id), updateConversationTitle(id, title), touchConversation(id),
     saveMessage(msg), getMessages(conversationId), deleteMessages(conversationId)

2. Create electron/services/memory-store.ts:
   - Use the same better-sqlite3 db instance (import from conversation-store.ts)
   - Export: listMemories(), addMemory(content, sourceConversationId?), updateMemory(id, content),
     deleteMemory(id), clearAllMemories(), exportMemories(), importMemories(entries),
     buildMemoryBlock(): string — formats as <memory> XML block

3. Wire electron/ipc/conversation handlers fully:
   'conversation:list', 'conversation:get', 'conversation:create', 'conversation:delete',
   'conversation:updateTitle', 'conversation:getMessages'

4. Wire electron/ipc/memory handlers fully:
   'memory:list', 'memory:add', 'memory:update', 'memory:delete', 'memory:clear',
   'memory:export' (returns JSON string), 'memory:import' (parses JSON string)

VERIFICATION: In DevTools:
  const c = await window.api.conversation.create('deepseek-chat')
  await window.api.conversation.list() // length 1
  await window.api.memory.add('User prefers concise answers')
  await window.api.memory.list() // 1 entry
  Verify lamprey.db exists in userData via file explorer.
  Log in DEVLOG.md.
```

---

### PROMPT 5 — Streaming Chat IPC Bridge

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: SQLite layer verified working.

TASK: Wire the DeepSeek client to the IPC chat handler with streaming, tool call loop, and system prompt assembly.

STEPS:

1. Create electron/services/system-prompt-builder.ts:
   buildSystemPrompt(activeSkillContents: string[], memoryBlock: string): string
   - Base: "You are Lamprey, a helpful AI assistant. Be direct and precise."
   - Append memoryBlock if not empty
   - For each skill content: append <skill name="..."> block
   - Return assembled string

2. Implement electron/ipc/chat.ts fully:
   'chat:send' receives: { conversationId: string, model: string, content: string, activeSkillIds: string[] }
   
   Handler:
   a. If conversationId === 'new': createConversation(model), use new id
   b. Save user message to SQLite
   c. Fetch all messages for conversation
   d. Fetch memory block from memory-store.buildMemoryBlock()
   e. Fetch active skill contents from skill-loader (stub for now — skill-loader added in Prompt 13, handle gracefully if not yet initialized)
   f. Build system prompt
   g. Fetch MCP tools from mcp-manager.getAllTools() (returns [] if MCP not set up — handle gracefully)
   h. Register memory_add pseudo-tool in tools array:
      { type: 'function', function: { name: 'memory_add', description: 'Save a fact about the user to persistent memory.', parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } } }
   i. Call deepseekClient.chatStream(messages, model, tools, onChunk, onDone, onError)
   j. onChunk: webContents.send('chat:chunk', { conversationId, content: token })
   k. onDone(fullContent, toolCalls?):
      - If no tool calls: save assistant message, webContents.send('chat:done', { conversationId, message })
      - If tool calls: enter tool call loop (step 3)
   l. onError: webContents.send('chat:error', { conversationId, error })

3. Tool call loop (max 10 iterations):
   For each tool_call:
   a. webContents.send('chat:tool-call', { callId: tool_call.id, serverId, toolName, args })
   b. If tool is memory_add: call memory-store.addMemory(args.content), webContents.send('memory:added', newEntry)
      webContents.send('chat:tool-call-result', { callId, result: 'Saved to memory.', duration: 0 })
      Continue to next tool call.
   c. If tool requires confirmation (Chrome destructive action): send 'mcp:confirmationRequired',
      await user approval via a stored Promise resolved by 'mcp:approveToolCall' handler.
      If denied: result = 'Action denied by user.'
   d. Else: call mcp-manager.callTool(serverId, toolName, args)
   e. webContents.send('chat:tool-call-result', { callId, result, duration })
   f. Append tool result message, call chatStream again with updated messages
   g. Continue until no more tool calls or max iterations reached

4. 'chat:cancel' handler: AbortController signal to cancel stream. Save partial message with "[cancelled]" note. Send 'chat:done'.

VERIFICATION: In DevTools:
  const c = await window.api.conversation.create('deepseek-chat')
  window.api.chat.onChunk(e => process.stdout.write(e.content))
  window.api.chat.onDone(e => console.log('\nDone:', e.message.content.length, 'chars'))
  await window.api.chat.send({ conversationId: c.data.id, model: 'deepseek-chat', content: 'Say exactly: pong', activeSkillIds: [] })
  Watch chunks. Verify final message in SQLite.
  Log in DEVLOG.md.
```

---

### PROMPT 6 — Basic Chat UI

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: Streaming chat working end-to-end in IPC.

TASK: Build the core chat interface using Zustand and the typed IPC client.

STEPS:

1. Create src/stores/chat-store.ts (Zustand):
   State: conversations, activeConversationId, messages, isStreaming, streamingContent, activeModel
   Actions: loadConversations, selectConversation, createConversation, deleteConversation,
   sendMessage(content, activeSkillIds), cancelStream, setModel

2. Create src/hooks/useChat.ts wrapping chat-store:
   On mount: register chat:onChunk, chat:onDone, chat:onError, chat:onToolCall listeners
   On unmount: call window.api.chat.offAll() to prevent listener leaks

3. Create src/stores/settings-store.ts (Zustand):
   Loads settings on init via window.api.settings.get()
   Exposes: settings, updateSettings(partial)

4. Create src/components/layout/Sidebar.tsx:
   - "New Chat" button
   - Conversation list grouped by Today / Yesterday / This Week / Older
   - Each item: title (40 char max), model badge, relative timestamp
   - Active: accent left border
   - Hover: X delete button with confirmation
   - Collapse toggle

5. Create src/components/chat/ChatView.tsx:
   Welcome screen if no active conversation. MessageList + ChatInput if active.

6. Create src/components/chat/MessageList.tsx:
   Auto-scrolling list of MessageBubble components. Loading skeleton on fetch.

7. Create src/components/chat/MessageBubble.tsx:
   User: right-aligned, var(--accent-dim) background
   Assistant: left-aligned, var(--bg-secondary)
   Plain text for now (Markdown in Prompt 7). Timestamp on hover. Model badge on assistant messages.

8. Create src/components/chat/StreamingText.tsx:
   Renders streamingContent with blinking CSS cursor at end.

9. Create src/components/chat/ChatInput.tsx:
   Auto-resize textarea (1-8 rows). Enter sends, Shift+Enter newlines.
   Send button with spinner. Stop button while streaming.

10. Create src/components/layout/Titlebar.tsx:
    Custom frameless titlebar with drag region. Lamprey wordmark left.
    Basic model dropdown center (full config Prompt 17). Settings gear right (stub).

11. Wire App.tsx: Sidebar + ChatView + artifact placeholder. Load conversations on mount.

12. First-run: on mount, call window.api.settings.hasApiKey(). If false, show API key modal
    (full-screen overlay, masked input, submit calls saveApiKey, dismiss on success).

VERIFICATION: Launch. API key modal if no key stored. New Chat. Type message. Stream renders.
New conversation in sidebar. Switch conversations — messages persist.
Log in DEVLOG.md.
```

---

### PROMPT 7 — Markdown and Code Rendering

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: Streaming chat displaying as plain text.

TASK: Add rich markdown rendering with Shiki syntax highlighting.

STEPS:

1. Create src/components/artifacts/MarkdownRenderer.tsx:
   Wraps react-markdown + remark-gfm. Custom component overrides:
   - code: routes to CodeBlock (fenced) or inline span
   - a: opens via shell.openExternal, not in-app
   - table: wrapper div with overflow-x: auto
   - blockquote: left border var(--accent)

2. Create src/components/artifacts/CodeBlock.tsx:
   - Receives: code, language
   - Detects artifact languages: html, svg, mermaid, jsx, react
   - For artifact languages: collapsed preview card with first 4 lines + "Open artifact" button
     clicking "Open artifact" calls window.api.artifact.render(type, code)
   - For non-artifact: Shiki syntax highlight (one-dark-pro theme)
   - Initialize Shiki as singleton (async, cache after first init)
   - Language badge, copy button (checkmark 2s after copy)

3. Create src/styles/markdown.css:
   Prose spacing for all block elements. Table borders + alternating rows using CSS vars.
   Inline code: monospace, var(--bg-tertiary), rounded. Links: var(--accent).

4. Update MessageBubble.tsx: replace plain text with <MarkdownRenderer content={message.content} />

5. Update StreamingText.tsx: use MarkdownRenderer with blinking cursor appended to raw content.

VERIFICATION: Send: "Write a Python Fibonacci function with markdown explanation, a comparison table, and a mermaid flowchart."
Verify: Python code has Shiki highlighting + copy button.
Table renders with alternating rows.
Mermaid block shows as collapsed artifact card with "Open artifact" button.
Log in DEVLOG.md.
```

---

### PROMPT 8 — BrowserView Artifact Sandbox

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: Markdown and code rendering correct.

TASK: Implement BrowserView artifact sandbox. Highest-risk prompt. Do not rush.

CRITICAL: Use BrowserView (WebContentsView in Electron 28+), NOT iframe. See Section 5.4 for rationale.

STEPS:

1. Bundle vendor files:
   node -e "require('fs').copyFileSync(require.resolve('mermaid/dist/mermaid.min.js'), 'resources/vendor/mermaid.min.js')"
   node -e "require('fs').copyFileSync(require.resolve('@babel/standalone/babel.min.js'), 'resources/vendor/babel.standalone.min.js')"

2. Create electron/services/artifact-sandbox.ts:
   - Manages one BrowserView with webPreferences from Section 5.4
   - render(type: 'html'|'svg'|'mermaid'|'jsx', content: string):
     - Build HTML document string based on type
     - html: inject CSP meta tag into <head>
     - svg: center in HTML document
     - mermaid: HTML doc loading file://vendor/mermaid.min.js
     - jsx: HTML doc loading file://vendor/babel.standalone.min.js + React + ReactDOM
     - Write to temp file in app.getPath('temp')/lamprey-artifact.html
     - view.webContents.loadFile(tempPath)
   - setBounds(rect): sets BrowserView bounds, apply DPI scale factor
   - show() / hide()
   - destroy()

3. Apply CSP via session.defaultSession.webRequest.onHeadersReceived() in main.ts:
   For all artifact BrowserView requests: add
   Content-Security-Policy: default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'self' data:;

4. Wire artifact IPC in electron/ipc/index.ts:
   'artifact:render': artifactSandbox.render(type, content)
   'artifact:hide': artifactSandbox.hide()
   'artifact:resize': artifactSandbox.setBounds(bounds)
   'artifact:openInWindow': new sandboxed BrowserWindow loading temp file

5. Create src/components/artifacts/ArtifactPanel.tsx:
   - Placeholder div the BrowserView floats on top of
   - On mount: report bounds via window.api.artifact.resize(rect)
   - ResizeObserver: on size change, send updated bounds
   - Header bar above the BrowserView (real DOM): artifact type badge, "Open in window" button, "Copy source" button, collapse toggle
   - Drag handle on left edge to resize panel

6. DPI correction in setBounds():
   const { scaleFactor } = screen.getPrimaryDisplay()
   Apply scaleFactor to all bound values.

7. Wire ArtifactPanel into App.tsx right column.
   When CodeBlock's "Open artifact" is clicked, show the panel.

VERIFICATION (run all, document each in DEVLOG.md):
  a. HTML artifact: "Write an HTML page with an animated gradient and centered card."
     Open artifact. Verify renders in BrowserView panel.
  b. SVG artifact: "Write an SVG mountain range illustration."
     Open artifact. Verify renders centered.
  c. Mermaid artifact: disable WiFi. "Write a Mermaid deployment pipeline diagram."
     Open artifact. Verify renders WITHOUT internet.
  d. Security test: "Write HTML that fetches https://httpbin.org/get and displays the response."
     Open artifact. Verify fetch fails silently (no external content loaded).
  e. Drag resize handle. BrowserView follows bounds correctly.
```

---

### PROMPT 9 — Artifact Polish and ToolUseCard

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: BrowserView sandbox working and security-tested.

TASK: Polish artifact detection and build ToolUseCard + ConfirmationModal UI components.

STEPS:

1. Improve artifact detection in CodeBlock.tsx:
   - Add: detect html even without explicit language tag if content starts with <!DOCTYPE or <html
   - Add: detect React artifacts by JSX syntax presence
   - Artifact preview card: language badge, first 4 lines, "Preview" and "Copy" buttons

2. Create src/components/chat/ToolUseCard.tsx:
   Collapsible inline card shown between trigger message and final response.
   - Server icon (Gmail/Drive/Chrome) + tool name + status indicator
   - States: pending (spinner), running (pulsing), success (checkmark + duration ms), error (X + message)
   - Collapsed: "Used Gmail: search_threads (142ms)"
   - Expanded: pretty-printed JSON args + truncated result (200 chars) + "View full" link

3. Create src/components/mcp/ConfirmationModal.tsx:
   - Full-overlay modal, not dismissible by clicking outside
   - Title: "Allow this action?"
   - Server badge + tool name + human-readable description of args
   - "Allow" button (var(--accent)) and "Deny" button
   - 30-second countdown auto-deny
   - On action: calls window.api.mcp.approveToolCall(callId, approved)

4. Wire ToolUseCard into chat-store:
   Add toolCalls: ToolCallState[] to store.
   On 'chat:tool-call' IPC event: append pending entry.
   On 'chat:tool-call-result': update to success/error.

5. Wire ConfirmationModal into App.tsx:
   Listen globally for 'mcp:confirmationRequired'. Show modal with call details.
   On user action: send approval via IPC.

6. Interleave ToolUseCards in MessageList between messages at correct positions.

VERIFICATION:
  In DevTools: mainWindow.webContents.send('chat:tool-call', { callId: '1', serverId: 'gmail', toolName: 'search_threads', args: { query: 'test' } })
  ToolUseCard appears with pending spinner.
  mainWindow.webContents.send('chat:tool-call-result', { callId: '1', result: 'Found 2 threads', duration: 88 })
  Card updates to success with "88ms".
  Log in DEVLOG.md.
```

---

### PROMPT 10 — MCP Client Foundation

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: Artifact sandbox and tool UI complete.

TASK: Build the MCP client manager in the main process.

STEPS:

1. Create electron/services/mcp-manager.ts:
   Manages Map<serverId, McpClient>. Server configs from userData/mcp-servers.json.
   Write defaults on first launch (Gmail SSE, Drive SSE, Chrome stdio).
   
   Methods:
   - initialize(): loads configs, connects enabled servers
   - getServers(): McpServerConfig[] with current status
   - connect(id): SSE or stdio based on config transport field
   - disconnect(id)
   - reconnect(id)
   - listTools(id): Tool[] (cached from last successful connection)
   - getAllTools(): { serverId: string; tools: Tool[] }[]
   - callTool(serverId, toolName, args): Promise<any>
   - onStatusChange(cb): forwards status changes to renderer

2. SSE connection (Gmail + Drive):
   - Read access token from keychain.getKey('google-access-token')
   - If missing: set status 'disconnected', return early
   - If expired (check keychain.getKey('google-token-expiry')): refresh via Google token endpoint
     POST https://oauth2.googleapis.com/token with refresh_token + client credentials
     Store new access_token + expiry
   - Create SSEClientTransport({ url, headers: { Authorization: `Bearer ${token}` } })
   - client.connect() then client.listTools() — cache result
   - On error: retry 3x backoff, then status 'error'

3. stdio connection (Chrome):
   - spawn('npx', ['@playwright/mcp', '--browser', 'chromium'])
   - Spawn options: { stdio: ['pipe','pipe','pipe'], windowsHide: true, env: { ...process.env } }
   - Create StdioClientTransport with the child process streams
   - client.connect() then client.listTools()
   - On crash: restart up to 3 times, then status 'error'
   - On app quit: kill child process

4. Wire electron/ipc/mcp.ts:
   'mcp:list', 'mcp:getStatus', 'mcp:reconnect'
   'mcp:approveToolCall': resolves a stored Promise keyed by callId

5. On any status change: mainWindow.webContents.send('mcp:statusChanged', { serverId, status })

6. Create tests/unit/mock-mcp-server.ts: echo server for testing without real credentials.

VERIFICATION: Start app with mock server registered. MCPStatusBar shows at least one server.
Gmail and Drive show disconnected (OAuth not set up yet — expected).
Chrome Playwright server: shows connecting or connected.
Log in DEVLOG.md.
```

---

### PROMPT 11 — MCP Status UI and Settings

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: MCP manager built and IPC wired.

TASK: Build MCP status bar, settings UI, and connect MCP tools to chat flow.

STEPS:

1. Create src/stores/mcp-store.ts (Zustand):
   servers: McpServerConfig[]. Load on mount. Listen for 'mcp:statusChanged' events.

2. Create src/hooks/useMcp.ts wrapping mcp-store.

3. Create src/components/mcp/MCPStatusBar.tsx:
   32px horizontal bar at bottom of ChatView.
   Per server: colored dot + name. Click: popover with status detail, tools list, Reconnect button, Setup OAuth button.
   All disconnected: "No MCP servers — Click to configure"

4. Create src/components/settings/McpSettings.tsx:
   Tab in SettingsDialog. Lists servers with enable/disable toggle, status, transport badge.
   Google section: client_id + client_secret masked inputs + "Connect Google Account" button.
   "Add Server" form: name, transport type, URL or command+args.

5. Wire "Connect Google Account" to call window.api.mcp.setupGoogleOAuth().
   Show progress indicator during OAuth flow. Show success/failure toast on completion.

6. Update useChat.ts sendMessage():
   Call window.api.mcp.list() to get connected servers.
   Include available tools in the chat:send payload.
   (Main process already fetches from mcp-manager — this is renderer-side awareness.)

7. Update ModelSwitcher.tsx:
   For deepseek-reasoner: tooltip "R1 does not support tool use. MCP tools unavailable while R1 is active."
   When R1 active: MCPStatusBar shows subtle warning.

VERIFICATION: MCPStatusBar visible at bottom of chat. Click a server — popover opens.
Open Settings > MCP: three servers listed. Chrome shows as connected.
Log in DEVLOG.md.
```

---

### PROMPT 12 — Google OAuth and MCP Live Testing

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: MCP UI complete. Chrome Playwright connecting.

PREREQUISITE: You must have Google Cloud OAuth credentials (client_id + client_secret) ready.
If not: stop, complete the Prerequisites section at the top of this plan, then return.

TASK: Implement Google OAuth flow and bring Gmail + Drive MCP servers online.

STEPS:

1. Wire 'mcp:setupGoogleOAuth' IPC handler in electron/ipc/mcp.ts:
   a. Read client_id and client_secret from keychain
   b. Build authorization URL:
      https://accounts.google.com/o/oauth2/v2/auth?client_id=X&redirect_uri=http://localhost:9876&response_type=code&scope=https://mail.google.com/ https://www.googleapis.com/auth/drive&access_type=offline&prompt=consent
   c. shell.openExternal(authUrl)
   d. Start HTTP server on localhost:9876
   e. On callback: extract code from query params
   f. Exchange: POST https://oauth2.googleapis.com/token with { code, client_id, client_secret, redirect_uri: 'http://localhost:9876', grant_type: 'authorization_code' }
   g. Store in keychain: 'google-access-token', 'google-refresh-token', 'google-token-expiry'
   h. Stop HTTP server
   i. Call mcp-manager.connect('gmail') and mcp-manager.connect('gdrive')
   j. Send status updates to renderer

2. Add token refresh in mcp-manager connect() for SSE servers:
   Before connecting: check expiry. If expired or within 5 minutes:
   POST https://oauth2.googleapis.com/token with { refresh_token, client_id, client_secret, grant_type: 'refresh_token' }
   Update stored access_token + expiry.

3. Create scripts/setup-oauth.ts as CLI fallback:
   Prints the auth URL to console. Starts localhost:9876. Exchanges code. Prints tokens.
   User can paste them manually via settings if in-app flow fails.
   Usage: npx ts-node scripts/setup-oauth.ts

VERIFICATION:
  Open Settings > MCP > Google section.
  Enter client_id and client_secret. Click "Save credentials".
  Click "Connect Google Account".
  Browser opens to Google OAuth consent screen.
  Authorize. Return to Lamprey.
  MCPStatusBar: Gmail and Drive show green (connected).
  Send: "Search my Gmail for emails with 'invoice' in the subject from the last 30 days."
  ToolUseCard appears: Gmail search_threads pending then success.
  Model incorporates email results into response.
  Log in DEVLOG.md.
```

---

### PROMPT 13 — Skill System (Loader + Hot Reload)

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: All three MCP servers working.

TASK: Implement the skill system with chokidar hot reload.

STEPS:

1. Create electron/services/skill-loader.ts:
   - Skills directory: dev = path.join(__dirname, '../../skills'), production = path.join(app.getPath('userData'), 'skills')
   - On production first launch: if userData/skills/ doesn't exist, copy bundled skills from resources/skills/
   - Parse each .md file with gray-matter: extract name, description, content
   - Maintain Map<filename, Skill>
   - chokidar.watch(skillsDir) — on add/change: parse + update map. on unlink: remove from map
   - On any change: mainWindow.webContents.send('skills:changed', listSkills())
   - Export: listSkills(), getSkill(id), getSkillContent(id)

2. Wire electron/ipc/skills.ts:
   'skills:list': skill-loader.listSkills()
   'skills:create': write new .md file with frontmatter + content to skillsDir
   'skills:update': overwrite existing .md file
   'skills:delete': unlink .md file

3. Update electron/ipc/chat.ts:
   'chat:send' now accepts activeSkillIds: string[]
   For each id: call skill-loader.getSkillContent(id) and pass to system-prompt-builder

4. Create src/stores/skills-store.ts (Zustand):
   skills: Skill[], activeSkillIds: string[]
   Load on mount. Listen for 'skills:changed' IPC event. toggleSkill(id).

5. Create src/hooks/useSkills.ts wrapping skills-store.

6. Create src/components/skills/SkillPanel.tsx (inside Sidebar):
   "SKILLS" header with "+" button.
   Each skill: toggle checkbox + name + hover tooltip (description).
   Active skills: accent left border.
   Pencil icon: opens SkillEditor. Trash icon: delete with confirmation.
   Empty state: "Drop .md files into the skills/ folder or click + to create one."

7. Populate bundled skills (direct-voice.md, code-review.md, git-commit.md) with content from Section 5.3.

VERIFICATION:
  SkillPanel shows three default skills.
  Toggle "Direct Voice" on. Send a message. Verify response is more declarative.
  While app is running: create new file skills/test.md with valid frontmatter.
  Within 2 seconds: appears in SkillPanel without restart.
  Modify file. SkillPanel updates.
  Delete file. SkillPanel removes it.
  Log in DEVLOG.md.
```

---

### PROMPT 14 — GUI Skill Editor

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: Skill file system and hot reload verified.

TASK: Build the visual skill editor.

STEPS:

1. Create src/components/skills/SkillEditor.tsx:
   Full-panel modal overlay. Two-column layout: form left, preview right.
   
   Form:
   - Name (required, text input)
   - Description (required, textarea)
   - Content (required, monospace textarea, large)
   
   Preview panel shows exactly how the skill will appear in the system prompt:
   <skill name="[name]">
   [content]
   </skill>
   Updates live as user types. "Character count: N" below (warn > 4000).
   
   Buttons: Save, Save & Enable, Duplicate, Delete (with confirmation), Cancel.

2. Filename generation: "Direct Voice" -> "direct-voice.md". Append -2, -3 on collision.

3. Open SkillEditor:
   "+" button in SkillPanel: empty editor.
   Pencil icon on skill row: pre-populated with skill data.

4. Wire: save calls window.api.skills.create() or .update(). Watcher hot-reloads automatically.

5. Wire SkillEditor open/close state in App.tsx.

VERIFICATION:
  Click "+". Fill: name "Bullet Points", description "Forces list format.", content "Format every response as bulleted lists."
  Click "Save & Enable". Send a message. Response is bulleted.
  Click pencil on skill. Edit content. Save. Next response reflects edit.
  Log in DEVLOG.md.
```

---

### PROMPT 15 — Memory System

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: Skill system complete.

TASK: Complete the memory system — injection, model-assisted writing, and UI.

STEPS:

1. Verify electron/services/memory-store.ts from Prompt 4 is complete with buildMemoryBlock().

2. Verify system-prompt-builder.ts injects memory block on every request (from Prompt 5).

3. Verify memory_add pseudo-tool is registered in chat IPC handler (from Prompt 5).

4. Create src/stores/memory-store.ts (Zustand):
   memories: MemoryEntry[]. Load on mount. Listen for 'memory:added' IPC event.
   Actions: addMemory, updateMemory, deleteMemory, clearAll, exportMemories, importMemories.

5. Create src/hooks/useMemory.ts wrapping memory-store.

6. Create src/components/memory/MemoryPanel.tsx (inside Sidebar):
   "MEMORY" header with "+" button and count badge.
   Each entry: number, content (truncated 2 lines), edit button, delete button.
   Edit: inline contenteditable, save on blur or Enter.
   Delete: immediate + undo toast (3 seconds).
   "+" button: input at bottom, Enter to save.
   Empty state: "Tell me something to remember."
   "..." menu: Export JSON, Import JSON, Clear all.

7. Add "Remember this" button to MessageBubble hover state:
   Calls window.api.memory.add(truncated message content). Shows "Saved to memory" toast.

VERIFICATION:
  Send: "For reference, I work in emergency management in Northern California and prefer concise answers."
  Model calls memory_add. MemoryPanel shows new entries.
  Start a NEW conversation. Send: "What do you know about me?"
  Model references the stored facts.
  Add memory manually via "+" button. Verify injected on next send.
  Log in DEVLOG.md.
```

---

### PROMPT 16 — Conversation History Polish and Toast System

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: Memory system working.

TASK: Polish conversation sidebar, add conversation search, keyboard shortcuts, and toast notifications.

STEPS:

1. Polish Sidebar.tsx:
   Conversations grouped by Today / Yesterday / This Week / Older. Sorted by updated_at desc.
   Each item: title (40 chars, ellipsis), model badge, relative timestamp.
   Active: var(--accent) left border. Hover: X delete with confirmation.

2. Auto-title: after first assistant response, set conversation title to first 40 chars of user's first message.
   Settings toggle "AI-generated titles" (default OFF) for model-generated 5-word title.

3. Conversation search (Cmd/Ctrl+K):
   Search input at top of sidebar. Client-side filter by title. Escape clears.

4. Keyboard shortcuts (local, when app focused):
   Cmd/Ctrl+N: new conversation
   Cmd/Ctrl+K: focus sidebar search
   Escape: cancel streaming or close open modal
   Cmd/Ctrl+,: open settings

5. Create src/components/ui/Toast.tsx:
   Stack of auto-dismissing toasts. Types: success, warning, error, info.
   Auto-dismiss 4 seconds. Manual X dismiss.
   Used everywhere: memory saved, skill created, OAuth success, API errors.

6. Empty states throughout:
   No conversations: "Start your first conversation."
   No memories: "Tell me something to remember."
   No skills: "Drop .md files here or click + to create a skill."

VERIFICATION:
  Create 10+ conversations. Date grouping correct.
  Cmd+K search filters list.
  Delete a conversation — toast appears, conversation gone.
  Trigger an API error — error toast appears, app does not crash.
  Log in DEVLOG.md.
```

---

### PROMPT 16A — ArcGIS-Inspired Theme Presets

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: Conversation history polish and toast system complete.

TASK: Add six ArcGIS-inspired color swatch themes as selectable app appearance presets.

STEPS:

1. Update src/lib/types.ts:
   - Add ThemePresetId union type:
     'lamprey-default' | 'arcgis-blue' | 'arcgis-ember' | 'arcgis-violet' | 'arcgis-inferno' | 'arcgis-magma' | 'arcgis-viridis'
   - Add ThemePreset interface with id, name, source, swatch: string[], tokens (all 13 CSS token keys).
   - Add `themePreset: ThemePresetId` to AppSettings.
   - Default value: 'lamprey-default'.

2. Create src/styles/theme-presets.ts:
   Export THEME_PRESETS: ThemePreset[] with seven entries:
   - Lamprey Default (native dark base)
   - Lamprey Blue (ArcGIS Blue 3): accent #6baed6, deep navy backgrounds
   - Lamprey Ember (Esri Orange 1): accent #f36f20, warm charcoal backgrounds
   - Lamprey Violet (Esri Purple 1): accent #a085c6, plum-tinted backgrounds
   - Lamprey Inferno (ArcGIS Inferno): accent #ff5c6a, magenta-dark backgrounds
   - Lamprey Magma (ArcGIS Magma): accent #ff57a5, deep purple backgrounds
   - Lamprey Viridis (ArcGIS Viridis): accent #2cdcc6, teal-dark backgrounds
   Each preset defines all 13 CSS token overrides: bgPrimary, bgSecondary, bgTertiary, border,
   textPrimary, textSecondary, textMuted, accent, accentDim, success, warning, error, codeBg.
   Full token values are specified in Section 6.1 of this plan.

3. Create src/styles/apply-theme.ts:
   Function: applyThemePreset(preset: ThemePreset): void
   Writes all preset tokens to document.documentElement.style:
     --bg-primary, --bg-secondary, --bg-tertiary, --border,
     --text-primary, --text-secondary, --text-muted,
     --accent, --accent-dim, --success, --warning, --error, --code-bg

4. Update settings-store.ts:
   - Load themePreset from settings.
   - On settings load, apply selected preset via applyThemePreset().
   - On settings update, apply selected preset immediately.
   - Persist selected preset to userData/settings.json.

5. Create src/components/settings/AppearanceSettings.tsx:
   - Section title: "Appearance"
   - Show theme cards in a grid.
   - Each card includes:
     - Theme name
     - Source name (smaller, muted text)
     - Five circular swatches in a row
     - Selected state: border using var(--accent)
   - Clicking a card applies and saves the preset.
   - Include small text: "Color presets affect interface tokens only. Layout and accessibility structure remain unchanged."

6. Update SettingsDialog.tsx:
   - Add "Appearance" tab.
   - Mount AppearanceSettings in that tab.

7. Update Titlebar.tsx:
   - Optional compact theme indicator next to Settings gear.
   - Shows selected preset name.
   - Dropdown allows quick switching between presets without opening Settings.

8. Accessibility requirements:
   - Maintain readable contrast on all theme cards.
   - Do not use color alone to communicate MCP status, tool result state or selected conversation.
   - Keep labels, icons or borders alongside status color.
   - Verify keyboard focus ring remains visible in all seven presets.

VERIFICATION:
  Open Settings > Appearance.
  Select each theme.
  Confirm CSS variables update immediately without restart.
  Close and reopen the app.
  Confirm selected theme persists.
  Confirm chat bubbles, sidebar active states, buttons, code blocks, toasts, MCP status and artifact panel all respect theme tokens.
  Confirm focus rings remain visible on keyboard navigation.
  Log result in DEVLOG.md.
```

---

### PROMPT 17 — Model Switcher and Per-Model Configuration

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: History polish and toast system complete.

TASK: Build complete model switcher with per-model config and API key management UI.

STEPS:

1. Complete src/components/model/ModelSwitcher.tsx:
   Dropdown in Titlebar. Shows active model. Lists models with context window + capability badges.
   Active model: checkmark. "Configure models" link opens ModelSettings.

2. Create src/components/settings/ModelSettings.tsx:
   Per-model settings: temperature (0-2), max tokens, top_p (0-1), system prompt override.
   "Set as default" button. "Test model" button (sends "Respond with only the word PONG").
   Future models section grayed out: Ollama (v0.2), Custom endpoint (v0.2).

3. Complete src/components/settings/ApiKeySettings.tsx:
   DeepSeek key: masked input, show/hide toggle. "Test connection" button.
   Storage indicator: "Stored using OS encryption" OR "Warning: stored as plaintext."
   "Delete key" button with confirmation.

4. Model switching mid-conversation:
   Changing model inserts divider: "— Switched to DeepSeek R1 —"
   Model badge on each message bubble shows which model generated it.
   Per-conversation model persists to SQLite conversations.model column.
   On switching conversations: restore that conversation's model.

5. DeepSeek R1 (deepseek-reasoner) think block handling:
   R1 returns <think> block before main response.
   Strip from displayed message. Show collapsed "Reasoning" expander.
   Expander reveals chain of thought on click.

VERIFICATION:
  Switch V3 -> R1 mid-conversation. Divider appears.
  Send a reasoning task. Collapsed "Reasoning" section shows. Expand it.
  Switch back to V3. Model badges show correct model per message.
  Adjust temperature in ModelSettings. Verify new param sent in API call (check network logs).
  Log in DEVLOG.md.
```

---

### PROMPT 18 — File Drag-and-Drop and Attachments

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: Model switcher and per-model config complete.

TASK: Implement file drag-and-drop and clipboard paste.

STEPS:

1. Create src/components/chat/FileDropZone.tsx:
   Overlay on ChatView during drag. Dashed border + "Drop files here" text.
   Accepted types: .txt, .md, .py, .js, .ts, .html, .css, .json, .csv, .pdf, images.
   Max: 10MB per file, 25MB total. On drop: send via 'files:process' IPC.

2. Create electron/services/file-handler.ts:
   processFiles(paths): Promise<ProcessedFile[]>
   Text/code: read as UTF-8 string.
   PDF: extract text with pdf-parse.
   Images: read as base64, check if active model supports vision.
   Binary other: filename + "binary file, content not included."
   Returns: { name, type, content, previewText }

3. Create src/components/chat/AttachmentPreview.tsx:
   Below input, above textarea. File icon + name + size + X remove.
   Image: small thumbnail. "Processing..." state for large files.

4. Wire into sendMessage:
   pendingAttachments: ProcessedFile[] in chat-store.
   On send: append to user message as context. Clear after send.
   Images: vision content blocks if model supports vision.

5. Clipboard paste in ChatInput.tsx:
   Paste event listener on textarea.
   Image in clipboard: process as image attachment.
   Long text (>500 chars) looking like code: offer "Paste as attachment" vs "Paste inline".

6. Paperclip icon button in ChatInput: opens system file picker as alternative to drag-drop.

VERIFICATION:
  Drag a Python file onto chat. AttachmentPreview shows filename + line count.
  Send with "Review this code." File content included in context.
  Drag PNG image with V3 active. Warning toast: "This model does not support images."
  Paste long JSON. Offer appears. Choose "Paste as attachment." Appears in AttachmentPreview.
  Log in DEVLOG.md.
```

---

### PROMPT 19 — System Tray and Keyboard Shortcuts

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: File attachments working.

TASK: System tray, global shortcuts, window persistence, auto-updater.

STEPS:

1. Create electron/services/tray.ts:
   System tray using resources/icon.png.
   Context menu: Show/Hide, New Chat (Cmd/Ctrl+N), separator, Quit.
   Click: toggle window. On window X: minimize to tray if settings.minimizeToTray, else quit.

2. Create electron/services/shortcuts.ts:
   Global: Cmd/Ctrl+Shift+L — show/hide main window.
   Local: already handled (Cmd+N, Cmd+K, Escape, Cmd+,).
   Add: Cmd/Ctrl+Shift+C — copy last assistant message to clipboard.

3. Window state persistence:
   On move/resize: save bounds to settings. On launch: restore (validate within screen bounds).
   Persist: sidebar collapsed, artifact panel width, active model.

4. Create electron/services/updater.ts:
   autoUpdater.setFeedURL({ provider: 'github', owner: 'lamprey-ai', repo: 'lamprey-harness' })
   On launch (if settings.autoCheckUpdates): checkForUpdatesAndNotify()
   On 'update-available': send 'update:available' to renderer.
   Renderer shows notification bar: "Update available — Restart to install."
   "Restart" button: autoUpdater.quitAndInstall()

VERIFICATION:
  X button minimizes to tray (if minimizeToTray enabled in settings).
  Right-click tray: context menu appears. Click Show/Hide: toggles window.
  Cmd/Ctrl+Shift+L from background: window comes to front.
  Resize window, close, reopen: restores position and size.
  Log in DEVLOG.md.
```

---

### PROMPT 20 — Packaging and Distribution

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: All features complete and working in development.

TASK: Configure electron-builder, produce distributable builds.

STEPS:

1. Create electron-builder.yml:
   appId: com.lamprey.harness
   productName: Lamprey
   directories: { output: dist, buildResources: resources }
   files: ["out/**/*", "!node_modules/**/*"]
   extraResources: [{ from: resources/vendor, to: vendor }]
   mac: { category: public.app-category.developer-tools, icon: resources/icon.icns, target: [dmg], hardenedRuntime: true }
   win: { icon: resources/icon.ico, target: [nsis] }
   nsis: { oneClick: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true }
   linux: { icon: resources/icon.png, category: Development, target: [AppImage] }
   publish: { provider: github, owner: lamprey-ai, repo: lamprey-harness }

2. Production path fixes:
   - skills: on first production launch, copy resources/skills/ -> userData/skills/ if not exists
   - vendor files: resolve via path.join(process.resourcesPath, 'vendor', filename)
   - All app.getPath('userData') references: verify consistent throughout codebase

3. Native module rebuild: better-sqlite3 must compile against the Electron Node ABI.
   Add postinstall script: "postinstall": "electron-rebuild -f -w better-sqlite3"

4. Create placeholder icons:
   resources/icon.png (1024x1024): dark circle with white "L" (placeholder, replace before public release)
   Generate resources/icon.icns from PNG.
   Generate resources/icon.ico (16/32/48/256 sizes).

5. Create .github/workflows/build.yml:
   Trigger: push to main, published releases.
   Jobs: build-windows (windows-latest), build-linux (ubuntu-latest).
   Upload .exe and .AppImage as artifacts.
   On version tag: attach to GitHub release draft.
   Mac: document requires Apple Developer account, provide manual build instructions.

VERIFICATION:
  npm run build:win
  Install generated .exe from dist/
  Launch installed Lamprey.exe
  API key prompt (fresh install). Enter key. Send message. Streaming works.
  Skills panel: default skills present.
  Verify userData/skills/ path is correct.
  Log in DEVLOG.md.
```

---

### PROMPT 21 — Security Audit, Polish, and Open Source Launch Prep

```
WORKING DIRECTORY: C:\Users\17076\Documents\Claude\Lamprey Harness
PREVIOUS: Distributable builds produced.

TASK: Final polish, security audit, documentation, open source launch.

STEPS:

1. Error handling audit:
   Every IPC handler: try/catch, return IpcResponse<T>. Renderer: catches all errors, shows Toast.
   Add: process.on('unhandledRejection', (err) => { log error, send toast to renderer })

2. Security audit (run each test, document result in DEVLOG.md):
   a. Network block: HTML artifact fetching https://httpbin.org/get. Verify fails silently.
   b. API key isolation: attempt to access safeStorage in preload.ts. Verify it's not available there.
   c. OAuth tokens: verify no token appears in any IPC response to the renderer.
   d. Chrome confirmation bypass: attempt to call a destructive Chrome tool without approval flag. Verify handler requires the flag.
   e. safeStorage on Linux: simulate unavailability, verify warning banner appears in settings.

3. Performance baseline (measure and log in DEVLOG.md):
   - Cold start to interactive: target < 3 seconds
   - First token to screen: target < 2 seconds
   - RAM at idle: target < 200MB
   - RAM after 20-message conversation: target < 350MB

4. Create README.md:
   One-paragraph description (no marketing). Screenshot of UI.
   Prerequisites section (verbatim from top of this plan).
   Installation: GitHub Releases download OR build from source (npm install && npm run dev).
   API key setup step-by-step.
   Google OAuth setup step-by-step with Google Cloud Console links.
   Skills system: how to write a skill (reference SKILLS.md).
   MCP servers: what's built in, transport types, how to add custom.
   Building locally. Contributing. License: MIT.

5. Create SKILLS.md:
   Complete skill file format specification.
   System prompt injection order explained.
   Best practices.
   The 3 bundled skills with annotations.
   2 community example skills.

6. Create CONTRIBUTING.md:
   Dev setup, npm run lint before PRs, architecture overview (link to this plan),
   conventional commits, one feature per PR, issue templates.

7. Final verification checklist (document each in DEVLOG.md):
   - Fresh Windows install: API key, first chat, streaming, skills, MCP, artifacts all work
   - Skill hot-reload in production build (drop file, appears without restart)
   - Conversations persist across restarts
   - Memory persists across restarts
   - Model switching works, badge shows on each message
   - All three MCP servers connect with Google credentials
   - Artifact sandbox blocks network
   - Auto-update check fires on launch
   - System tray works
   - npm run typecheck: zero errors
   - npm run lint: zero errors
```

---

## 9. Execution Order

```
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21
```

Strictly sequential. No skips. No parallelism. Each VERIFICATION step must pass before the next prompt begins.

---

## 10. Risk Register

**Risk 1: Google MCP endpoint transport — HIGH PROBABILITY if confused**
Gmail and Drive are remote SSE endpoints, NOT npm-installable stdio packages. If you see `@anthropic/mcp-server-gmail` or similar referenced anywhere, that package does not exist publicly. Use SSEClientTransport with Bearer OAuth tokens as specified in Prompts 10 and 12.

**Risk 2: BrowserView bounds on Windows DPI scaling — MEDIUM**
At 125% or 150% display scaling, BrowserView bounds are off by a constant factor. Apply scaleFactor correction in setBounds(). Test early in Prompt 8 before building UI on top.

**Risk 3: DeepSeek tool call format — MEDIUM**
If tool_calls does not appear in the response even when tools[] is passed, implement fallback: scan assistant message text for JSON objects matching { "name": "...", "arguments": {...} }. Test tool calling in Prompt 5 before implementing MCP.

**Risk 4: Playwright stdio on Windows — MEDIUM**
Set { stdio: ['pipe','pipe','pipe'], windowsHide: true } on spawn. If garbled JSON from the Chrome server: the issue is line-ending or encoding corruption. Force UTF-8 encoding on stdio streams.

**Risk 5: better-sqlite3 native module rebuild — LOW probability, HIGH impact**
If NODE_MODULE_VERSION mismatch errors appear: `./node_modules/.bin/electron-rebuild -f -w better-sqlite3`. The postinstall script in Prompt 20 prevents this entirely if added early.

**Risk 6: Electron safeStorage on Linux — LOW**
Returns false without libsecret/gnome-keyring. Fall back to unencrypted storage with a warning banner. Document libsecret dependency in README Linux section.

---

## 11. Out of Scope for v0.1

- No multi-provider abstraction layer (Anthropic, OpenAI, Ollama) — v0.2
- No local model support (Ollama) — v0.2
- No voice input or TTS
- No image generation
- No team/multi-user features
- No cloud sync
- No mobile
- No light theme
- No Windows ARM build
- No Mac notarization (document the unsigned warning workaround in README)
- No plugin marketplace (skills are file-based only)
- No automatic memory extraction (manual + model-assisted only, by design)

---

## 12. File Naming Conventions

- Main process services: `kebab-case.ts` in `electron/services/`
- IPC handler files: `kebab-case.ts` in `electron/ipc/`
- React components: `PascalCase.tsx`
- React hooks: `useCamelCase.ts`
- Zustand stores: `kebab-case-store.ts`
- Skill files: `kebab-case.md`
- IPC channel names: `namespace:action` (e.g. `chat:send`, `mcp:getStatus`, `skills:changed`)
- SQLite tables: `snake_case`
- CSS custom properties: `--kebab-case`
- TypeScript interfaces: `PascalCase` (no `I` prefix)

---

## 13. Claude Code Session Handoff Instructions

Read this entire document before writing a single line of code. Then:

1. Start with PROMPT 1. Do not skip ahead.
2. Complete the VERIFICATION step in each prompt before moving to the next.
3. If VERIFICATION fails: fix it before proceeding. Do not accumulate broken code.
4. After completing each prompt: write one paragraph to DEVLOG.md. What was built. What verification confirmed. Any deviations from this plan and why.
5. If a dependency has changed its API since this plan was written: document the deviation in DEVLOG.md and implement the current API equivalent. The architecture and security decisions here do not change.
6. Never push to GitHub directly. Basho reviews and pushes via PowerShell.
7. Skills directory: dev = `./skills/` in repo root, production = `app.getPath('userData')/skills/`. Both handled from Prompt 13 onward.
8. DEVLOG.md is a build record. Future Claude Code sessions should read it before starting to understand what has already been built and verified.
