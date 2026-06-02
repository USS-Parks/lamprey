# Lamprey

> A multi-provider, multi-agent coding harness with a Codex-class IDE on top of DeepSeek, Google Gemma, Alibaba Qwen, and OpenRouter.

<p align="center">
  <img src="ASSETS/LAMPREY%20MAI%20LOGO%20FINAL.png" alt="Lamprey" width="220" />
</p>

<p align="center">
  <a href="https://github.com/USS-Parks/lamprey/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/USS-Parks/lamprey?style=flat-square&color=2ea44f" /></a>
  <a href="https://github.com/USS-Parks/lamprey/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" /></a>
  <img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows-0078d4?style=flat-square" />
  <img alt="Electron 35" src="https://img.shields.io/badge/electron-35-47848F?style=flat-square" />
</p>

---

## ⬇ Download v0.1.24

Pick one — the `.exe` is the standard installer, the `.zip` is the portable bundle (unzip and run `Lamprey.exe` directly, no install required).

| Format | File | Size | Direct link |
|---|---|---:|---|
| **NSIS installer** | `Lamprey-0.1.24-x64.exe` | 178 MB | [Download .exe](https://github.com/USS-Parks/lamprey/releases/download/v0.1.24/Lamprey-0.1.24-x64.exe) |
| **Portable ZIP** | `Lamprey-0.1.24-x64.zip` | 225 MB | [Download .zip](https://github.com/USS-Parks/lamprey/releases/download/v0.1.24/Lamprey-0.1.24-x64.zip) |

Or browse all releases → <https://github.com/USS-Parks/lamprey/releases>

**Windows 10/11, x64.** Mac and Linux builds are buildable from source (`npm run build:mac` / `:linux`) but not currently distributed.

---

## What it is

Lamprey is an open-source desktop app that turns a multi-provider chat backend into a working coding IDE. Think *Claude Desktop quality UX × Codex-style developer panes × the freedom to choose your own model.*

It's an Electron app that:

- **Routes per-model** to four providers — DeepSeek (V4 Pro, V4 Flash, V3, R1), Google (Gemma), Alibaba DashScope (Qwen), and OpenRouter for everything else. Bring your own keys.
- **Runs a Planner → Coder → Reviewer pipeline** if you want, with a different model on each role.
- **Ships full Codex-style developer panes** — file tree, Chromium browser, git diff review, integrated terminal, side-thread chat — all reachable from the `+` button at the top of the right panel.
- **Persists everything locally.** SQLite. No telemetry. API keys encrypted with the OS keychain via Electron `safeStorage`.

## What it's for

Solo developers and small teams who want:

- a fast desktop chat that streams,
- the freedom to pick a model per task (cheap for boilerplate, smart for hard bugs),
- a working IDE around the chat — review your own diffs, browse docs in-app, drop into a terminal, fork conversations,
- and a system they can read, modify, and run offline.

It is **not** a SaaS. There is no Lamprey cloud. Your prompts go to whichever provider's key you've added, period.

---

## Feature tour

### Chat surface

- **Streaming markdown** with syntax-highlighted code (Shiki), reasoning blocks (DeepSeek R1), token ticker, and inline thinking/coding animations (the lamprey icon swap).
- **Attachments**: drag-drop or `Ctrl+U` for files, paste images, paste >1 KB code triggers an "attach or inline?" prompt.
- **Side-chat panel** for ephemeral asides — separate conversation thread, own stream, persists across sessions.

### Codex-style developer tools (`+` menu)

Click the oversized `+` button at the top of the right panel (or use the keyboard):

| Tool | Shortcut | What it does |
|---|---|---|
| **Files** | `Ctrl+P` | Project tree + viewer; quick-open palette (fuzzy file search, top-50 results) |
| **Side chat** | — | Secondary chat thread on the active model |
| **Browser** | `Ctrl+T` | Multi-tab Chromium browser. Address bar, back/fwd/reload, search-or-URL detection, in-app pop-ups become new tabs |
| **Review** | `Ctrl+Shift+G` | Git status with staged/unstaged file list, unified diff viewer with +/− coloring, **"Fix this →"** per-hunk button that sends the diff into the chat input |
| **Terminal** | `` Ctrl+` `` | Shell terminal (xterm.js + child_process pipes) — runs git, npm, node, python, anything that doesn't need full TTY semantics |

### Slash commands

Type in the chat input:

- `/compact` — summarize the current conversation with the active model, replace history with the summary (real LLM call, real replacement)
- `/fork` — duplicate the current conversation into a new thread titled `… (fork)`
- `/models` — open Settings → Models
- `/plan` — toggle plan mode (same as Shift+Tab)
- `/fast` — placeholder; flagged as not-yet-wired

### Plan mode

`Shift+Tab` toggles plan mode anywhere in the chat input. When ON: a banner appears above the input and every prompt is prepended with `[PLAN MODE — produce a plan first, list assumptions and steps, then await my confirmation before executing.]`. Works against any provider; no backend change required.

### Worktrees + thread kinds

- Conversations carry a `kind` (`local` / `cloud` / `worktree`) and an optional `worktreePath`.
- Sidebar shows a small `wt` / `cl` badge next to non-local threads.
- The **Worktrees** action in the sidebar opens a manager modal: list `git worktree list`, create with `git worktree add -b <branch> <path>`, remove with `git worktree remove`. After creating, optionally seeds a new conversation tagged to that worktree.

### AGENTS.md

If your repo has `AGENTS.md` (or `agents.md`/`Agents.md`) at its root, Lamprey reads it on every chat send and injects it into the system prompt as `<agents_md>…</agents_md>`. 20 KB cap; cached for 5 seconds. Same idea as Codex's spec — repo-specific instructions the model needs to know that aren't obvious from the code.

### Hooks (Settings → Hooks)

User-defined shell commands that fire on lifecycle events:

- `sessionStart` — once on app launch
- `promptSubmit` — every chat send (context passed via `LAMPREY_HOOK_PROMPT_BODY` env var)
- `agentStop` — every chat completion (context: `LAMPREY_HOOK_CONVERSATION_ID`)
- `preToolUse` / `postToolUse` — registered, not yet wired into the MCP path

Fire-and-forget. Context arrives as `LAMPREY_HOOK_*` env vars. Use for desktop notifications, logging, kicking off side jobs.

### Automations (Settings → Automations)

5-field cron-scheduled prompts. Pure-JS cron parser supports `*`, exact, lists `a,b,c`, ranges `a-b`, step `*/N`. Pick a model, write a prompt, set the schedule, see last-run output collapsed under each entry. Local-only — your computer needs to be running for the schedule to fire.

### Skills + MCP

- **Skills**: hot-reloading markdown system-prompt fragments (chokidar watcher, grey-matter frontmatter, ~150 ms reload). Drop a `.md` in `userData/skills/`, toggle it on, it's part of the system prompt.
- **MCP servers**: SSE + stdio transports. Gmail + Drive (Google OAuth) and Chrome (Playwright) ship by default. Destructive Chrome actions require explicit user approval with a 30-second timeout.

---

## Quick start

1. **Download** the [v0.1.24 installer](https://github.com/USS-Parks/lamprey/releases/download/v0.1.24/Lamprey-0.1.24-x64.exe) and run it.
2. **Get a key.** Easiest: <https://platform.deepseek.com> → sign up → create key → load $5. Lamprey also accepts Google AI Studio (Gemma), Alibaba DashScope (Qwen), and OpenRouter keys.
3. **Paste your key** in the first-run modal. It's stored with `safeStorage` (OS keychain) under `userData/keys.json`.
4. **Type something.** That's it.

Optional: add `AGENTS.md` to your repo to give the assistant repo-specific context on every send.

---

## Build from source

```bash
git clone https://github.com/USS-Parks/lamprey
cd lamprey
npm install              # runs electron-rebuild for better-sqlite3
npm run dev              # launches the dev Electron window

# distributables:
npm run build:win        # NSIS .exe in dist/
npm run build:linux      # AppImage in dist/
npm run build:mac        # .dmg in dist/ — needs Apple Developer signing identity
```

> On Windows, if the dev server fails to find Electron, set `ELECTRON_EXEC_PATH` to your local `node_modules\electron\dist\electron.exe` and re-run `npx electron-vite dev`.

Requirements: Node.js 22+, npm 10+, git. Windows builds also need the Windows SDK if you're rebuilding native modules from scratch.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Renderer (React 19 + Zustand)                                   │
│  Sidebar │ Chat │ Right panel (Tools / Artifact / Home)          │
└────────────────────────────┬─────────────────────────────────────┘
                             │  window.api (typed contextBridge)
┌────────────────────────────▼─────────────────────────────────────┐
│  Main process (Node.js)                                          │
│  ├─ IPC handlers (electron/ipc/*)                                │
│  ├─ Provider registry → DeepSeek / Google / DashScope / OpenRouter│
│  ├─ MCP manager (SSE + stdio + OAuth)                            │
│  ├─ better-sqlite3 store (WAL, FK on)                            │
│  ├─ pty-manager (shell-mode terminal)                            │
│  ├─ browser-manager (WebContentsView per tab)                    │
│  ├─ git-runner + review/worktree IPC                             │
│  ├─ skill loader (chokidar hot reload)                           │
│  ├─ hooks runner + automations runner (cron tick)                │
│  └─ keychain (safeStorage)                                       │
└──────────────────────────────────────────────────────────────────┘
```

- All IPC returns `{ success: true, data: T } | { success: false, error: string }`.
- Renderer is sandboxed: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Keys + OAuth tokens never cross the IPC boundary — they live in main and are referenced by id.
- Artifact and Browser `WebContentsView` instances are isolated from the renderer's V8.

Full architectural plan: [PLANNING/LAMPREY_HARNESS_FINAL.md](PLANNING/LAMPREY_HARNESS_FINAL.md).
Build history: [DEVLOG.md](DEVLOG.md).

---

## Security

- API keys + OAuth tokens encrypted via Electron `safeStorage` (OS keychain). If unavailable, a yellow banner warns you before falling back to plaintext.
- Renderer process: sandbox + context isolation + no node integration.
- Artifact sandbox blocks all outbound network (`connect-src 'none'`) and runs in its own Chromium process.
- Chrome MCP destructive actions (`click`, `fill`, `submit`, `type`, `press`, `select_option`) gated by user approval with 30-second timeout → auto-deny.
- No telemetry. No phone-home. Run it on an air-gapped machine if you want.

---

## Roadmap

Built and shipped (v0.1.24):

- ✅ Multi-provider routing (DeepSeek / Gemma / Qwen / OpenRouter)
- ✅ Planner → Coder → Reviewer agent pipeline
- ✅ Right-panel `+` tools menu (Files / Side chat / Browser / Review / Terminal / Environment / Sources / Artifacts)
- ✅ Chromium Browser pane with tabs
- ✅ Git Review pane with `Fix this →` chat seeding
- ✅ Files tree + `Ctrl+P` fuzzy quick-open
- ✅ Shell terminal (xterm.js + scrollback persistence)
- ✅ Side chat thread with own stream
- ✅ Worktrees + thread kind badges
- ✅ Slash commands (`/compact`, `/fork`, `/models`, `/plan`, `/fast`)
- ✅ Plan mode (Shift+Tab)
- ✅ AGENTS.md loader
- ✅ Hooks (sessionStart / promptSubmit / agentStop)
- ✅ Cron automations
- ✅ Floating Environment card + docked Environment / Sources / Artifacts panels
- ✅ Narrow-viewport drawer for the right panel
- ✅ Codex-style left sidebar: first-class Projects, nested sessions, "Show more", back/forward, Plugins + Automations rows

Codex toolset parity sprint (v0.1.26):

- ✅ Codex Agent contract + live run-phase state (gathering → working → verifying → summarizing)
- ✅ Plan checklist UI driven by the `update_plan` tool; plan + goal state persists to SQLite, with a Plans & Goals settings panel to inspect/clear it
- ✅ Native gated tools: `shell_command`, `apply_patch`, `workspace_context`, `verify_workspace`, `frontend_qa`, plan/goal/image-view/dependencies
- ✅ Tool-call audit log with per-call approval source (Settings → Tools → Recent)
- ✅ Persistent permission policies — sticky allow/deny per tool/risk, SQLite-backed, survives restart (Settings → Permissions)
- ✅ Browser-automation tools + web tools (finance / weather / sports / search adapters)
- ✅ Image-generation provider + Node REPL MCP server + MCP resources / tool search
- ✅ Parallel tool reads and single-model sub-agents via `multi_agent_run` (compact run card)
- ✅ Deterministic final-response composer after tool rounds
- ✅ Seven bundled Codex workflow skills (`codex-plan`, `codex-context`, `codex-debug`, `codex-review`, `codex-verify`, `codex-frontend-qa`, `codex-fan-out`)
- ✅ End-to-end agentic coding mode (input pill + auto-loaded skills)

Next up:

- Reasoning-level selector on the model switcher
- Wire `preToolUse` / `postToolUse` hooks into the MCP path
- Real PTY (node-pty) terminal — pending a path-without-spaces or a switchable native build
- Browser: open-in-system-Chrome toggle, cookie isolation per tab
- Cross-device sync for plan + goal state (persisted locally today)
- macOS distributable in CI (Windows + Linux already build in CI)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the conventional-commit format and one-feature-per-PR rule. Issues and PRs welcome at <https://github.com/USS-Parks/lamprey/issues>.

---

## License

MIT — see [LICENSE](LICENSE).
