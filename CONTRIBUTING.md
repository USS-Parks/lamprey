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
npm run lint                              # ESLint (flat config)
npm test                                  # vitest unit/integration suite
npx electron-vite build                   # full build, no warnings
npm run smoke:bundle                      # headless load of out/main/index.js
npm run smoke:renderer                    # integrity of the renderer bundle
```

All seven must pass before a PR, plus the manual smoke checklist for release-bound
changes. In CI today: the `ci` workflow runs ESLint + both typechecks (`lint` job)
and the full Vitest suite (`test` job) on every PR and push; the `build` workflow
runs both typechecks + build + bundle smoke on Windows and Linux. The Windows
installer build and the manual smoke checklist are owner/release-runner steps.

`smoke:bundle` stubs `electron` and `better-sqlite3` at the Node module loader and `require()`s the packaged main bundle. It catches the class of bundler-specific failures vitest cannot observe — ES-module import hoisting that puts a side-effect register call ahead of its target's initialization, TDZ ReferenceErrors during module evaluation, and missing pack registrations. Source-tree tests can be green while the bundle is broken; the smoke is the last gate before that ships.

The unit suite runs through `npx vitest run` (also exposed as `npm test`). It targets `electron/**/*.test.ts` and `src/**/*.test.{ts,tsx}`.

### Troubleshooting

**`vitest` fails to start on Windows with `spawn EPERM` while loading `vitest.config.ts`.** The runner uses esbuild as the config transformer and spawns `node_modules/esbuild/bin/esbuild.exe`. On Windows that binary is a frequent false-positive for Defender and several third-party endpoint products — the spawn is blocked before any test code runs.

Pick one:

- **Add an antivirus exclusion** for the project's `node_modules/esbuild` directory (Defender: *Settings → Virus & threat protection → Manage settings → Exclusions → Add folder*). This is the persistent fix.
- **Whitelist via single-run prompt**: from the repo root, run `node node_modules/esbuild/bin/esbuild --version`. If your AV uses an on-access prompt, allowing this single invocation usually lifts the block for subsequent spawns. The version flag is harmless.
- **Reinstall after exclusion**: if the binary was quarantined, `rm -rf node_modules/esbuild && npm install` will restore it once the exclusion is in place.

Symptom of a different cause: if the EPERM message references a path outside `node_modules/esbuild`, the issue isn't AV — check Windows long-path support (`git config --global core.longpaths true`) or the npm cache (`npm cache verify`).

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

## Review and sign-off

Every change — including the maintainer's own — lands through a pull request. Nothing is pushed straight to `main`. A PR does not merge until all three hold:

1. **CI is green** — the gates listed under [Required before every PR](#required-before-every-pr).
2. **A human has read the diff** — the maintainer (Basho Parks) reviews the change and leaves an explicit approval, not a rubber stamp.
3. **It carries a sign-off** — the merge includes `Reviewed-by: Basho Parks <basho.parks@gmail.com>`.

AI assistants are welcome to draft code and open PRs — much of this project was built that way, and the README says so plainly. The rule is simply that a person reviews and signs off before anything merges. The sign-off means a human read the change and stands behind it.

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
