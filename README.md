# Lamprey

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

Lamprey is the transmission for the open-source LLM engine of your choice. It's a desktop coding IDE that grafts Claude Desktop-quality UX onto a Codex-style developer toolset &mdash; streaming markdown, reasoning blocks, skills, MCP servers, autonomous loops, sub-agent orchestration, and session memory welded directly onto a file tree, multi-tab Chromium browser, git diff review, integrated terminal, and side-thread conversations. Plug in DeepSeek, Gemma, Qwen, or anything on OpenRouter. When the next breakthrough model drops, swap the key and the harness adapts. Everything stays local, everything persists in SQLite, and API keys never leave the OS keychain. No subscription, no telemetry, no Token Overlords watching your prompts.

The target user is the developer who looked at Claude Code and Codex and said *"I want exactly this, but I'm not paying per-token forever and I'm not sending my codebase to someone else's servers."* Lamprey is a bring-your-own-keys alternative to the two most capable agentic coding tools on the market, built for people who want the power without the leash. It's ready for next-gen models out of the box &mdash; the harness evolves with the ecosystem, not against it. 100% vibe-coded over nearly 300 sessions in Claude Code and Codex using WhisprFlow.

---

## Download

| Format | Link |
|---|---|
| **Installer** (Windows x64) | [Lamprey-x64.exe](https://github.com/USS-Parks/lamprey/releases/download/v0.15.1/Lamprey-x64.exe) |
| **Portable ZIP** (Windows x64) | [Lamprey-x64.zip](https://github.com/USS-Parks/lamprey/releases/download/v0.15.1/Lamprey-x64.zip) |

Linux and macOS are buildable from source (`npm run build:linux` / `npm run build:mac`).
All releases: [github.com/USS-Parks/lamprey/releases](https://github.com/USS-Parks/lamprey/releases)

---

## Quick start

1. **Download** the installer above and run it.
2. **Get a key.** Easiest: [platform.deepseek.com](https://platform.deepseek.com) &mdash; sign up, create a key, load $5. Lamprey also accepts Google AI Studio, Alibaba DashScope, and OpenRouter keys.
3. **Paste your key** in the first-run modal. It's encrypted with the OS keychain via Electron `safeStorage`.
4. **Type something.** That's it.

---

## What you get

- **Multi-provider chat** &mdash; pick a model per task. Cheap for boilerplate, smart for hard bugs.
- **Codex-style developer panes** &mdash; file tree (`Ctrl+P`), multi-tab browser (`Ctrl+T`), git diff review with "Fix this" per-hunk seeding (`Ctrl+Shift+G`), shell terminal (`` Ctrl+` ``), side-thread chat.
- **Deep Research** &mdash; research-shaped turns fan out across search providers, corroborate claims by independent domain, and kill the report if they detect fabricated citations. `/research <q>` forces it; coding turns are never escalated.
- **Snip** &mdash; an in-process token filter (same idea as [rtk](https://github.com/rtk-ai/rtk)) that strips noisy shell output down to signal before it hits the model context. ~120 built-in YAML filters, hot-reloadable, extensible.
- **Skills + MCP** &mdash; drop a `.md` in your skills directory and it's part of the system prompt. MCP servers via SSE + stdio with Google OAuth support out of the box.
- **Loops** &mdash; set a task on a fixed interval (`/loop 5m <task>`), let the model pace itself (`/loop <task>`), or hand it a mission and a backlog (`/loop --auto <mission>`) and walk away. The model enqueues work, records outcomes, and self-terminates when the mission is complete. Hard ceilings on iterations, wall-clock, and token budget keep it from running away. Off by default &mdash; flip one toggle in Settings to unlock.
- **Sub-agents** &mdash; the model can fan out parallel sub-agents via `multi_agent_run` when the task calls for it. You don't configure this; the model decides when to orchestrate and when to stay single-threaded.
- **Plan mode** &mdash; `Shift+Tab` blocks mutating tools while read-only tools keep working. Approve, reject, or edit the plan in-place.
- **Worktrees, forking, hooks, cron automations, AGENTS.md injection, conversation seeding, reasoning trace viewer, optional SQLCipher encryption** &mdash; see [DEVLOG.md](DEVLOG.md) for the full build history.

---

## Build from source

```bash
git clone https://github.com/USS-Parks/lamprey
cd lamprey
npm install
npm run dev
```

Distributables: `npm run build:win` / `npm run build:linux` / `npm run build:mac`.
Requirements: Node.js 22+, npm 10+, git.

---

## Architecture

```
Renderer (React 19 + Zustand)
  Sidebar | Chat | Right panel (Tools / Artifacts / Home)
       |
       |  window.api (typed contextBridge)
       v
Main process (Node.js)
  Provider registry -> DeepSeek / Google / DashScope / OpenRouter
  MCP manager (SSE + stdio + OAuth)
  better-sqlite3 (WAL, foreign keys)
  Browser manager (WebContentsView per tab)
  Git runner + review/worktree IPC
  Skill loader (chokidar hot reload)
  Keychain (safeStorage)
```

Renderer is sandboxed (`contextIsolation`, no `nodeIntegration`). Keys and OAuth tokens never cross the IPC boundary. Artifacts and browser tabs run in isolated Chromium processes.

---

## Security

- API keys encrypted via Electron `safeStorage` (OS keychain).
- Renderer: sandbox + context isolation + no node integration.
- Artifact sandbox blocks all outbound network and runs in its own process.
- No telemetry. No phone-home. Run it air-gapped if you want.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs welcome at [github.com/USS-Parks/lamprey/issues](https://github.com/USS-Parks/lamprey/issues).

## License

MIT &mdash; see [LICENSE](LICENSE).
