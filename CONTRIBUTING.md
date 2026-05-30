# Contributing to Lamprey

Thanks for the interest. Lamprey is small, opinionated, and the contributor bar is "ship the simplest thing that works." Please read this whole file before opening a PR.

---

## Dev setup

```bash
git clone https://github.com/USS-Parks/lamprey
cd lamprey
npm install              # runs electron-rebuild for better-sqlite3
npm run dev              # launches Electron
```

On the project author's machine, electron-vite needs an explicit binary path. If `npm run dev` exits immediately, try:

```bash
ELECTRON_EXEC_PATH="$(pwd)/node_modules/electron/dist/electron.exe" npx electron-vite dev
```

(Or the equivalent for your platform — that's just the path electron-vite uses to launch the renderer.)

### Required before every PR

```bash
npx tsc --noEmit -p tsconfig.node.json    # main + preload typecheck
npx tsc --noEmit -p tsconfig.web.json     # renderer typecheck
npm run lint                              # ESLint
npx electron-vite build                   # full build, no warnings
```

All four must pass. CI runs these jobs on Windows and Linux — anything red there will block the PR.

---

## Architecture overview

Three processes, one preload bridge:

- `electron/main.ts` — entry. Wires IPC, sets up the artifact CSP, owns the BrowserWindow lifecycle.
- `electron/ipc/` — per-domain IPC handler files (`chat.ts`, `conversation.ts`, `memory.ts`, etc.). Every handler returns `{ success: true, data: T }` or `{ success: false, error: string }`.
- `electron/services/` — business logic (DeepSeek client, SQLite store, MCP manager, skill watcher, artifact sandbox, keychain, tray, updater).
- `electron/preload.ts` — the `window.api` contextBridge. **Never add a raw `ipcRenderer.invoke` in renderer code.**
- `src/` — React 19 renderer. Zustand stores under `src/stores/`, IPC-bound hooks under `src/hooks/`, components grouped by domain.

The full plan, including subsystem specs and decisions, lives in [PLANNING/LAMPREY_HARNESS_FINAL.md](PLANNING/LAMPREY_HARNESS_FINAL.md). Each prompt's commit message and DEVLOG entry explain the why.

---

## Commit messages

Conventional commits. Format:

```
<type>(<scope>): <imperative summary under 72 chars>

<optional body explaining why, wrapped at 72 chars>

Co-Authored-By: ...
```

Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `style`, `ci`.

Examples:

```
feat: memory panel — inline edit, undo delete, JSON export/import
fix(chat): drop role:'system' markers from API history before send
docs: update SKILLS.md with hot-reload directory paths
```

The body should explain **why**, not what — the diff already shows what.

---

## PR scope

**One feature per PR.** Don't fold an unrelated refactor into a feature commit. Don't include tooling changes in a UI PR. If you have two things to do, open two PRs.

If a PR touches more than ~600 lines, break it up. Reviewers can't hold more than that in their head, and big PRs land slower.

---

## What we'll merge

- Bug fixes with a clear repro in the description.
- New skills under `skills/` and `resources/skills/`.
- New MCP server integrations.
- Performance improvements with before/after numbers.
- Documentation improvements (especially examples).

## What we probably won't merge

- Style-only churn (rename / reformat with no behavior change).
- New abstractions added "for future flexibility." If you can't show three call sites today, the abstraction is premature.
- Multi-provider AI client refactors. v0.2 will address provider abstraction; v0.1 is DeepSeek-only on purpose.

---

## Issue templates

Bug reports should include:

- Lamprey version (`Settings → About` or the title of the installer)
- Platform + OS version
- Steps to reproduce
- Observed vs expected behavior
- Console errors (View → Toggle DevTools)

Feature requests should include:

- The user-facing problem
- Why existing surfaces (skills, MCP, settings) aren't enough
- A specific UX you'd accept as a fix

---

## License

By contributing you agree your changes are released under the MIT license that covers the rest of the project.
