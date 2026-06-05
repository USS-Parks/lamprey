# Lamprey Customize Phase — Build Plan (C1–C12)

**Scope.** Add a first-class **Customize** surface to Lamprey that mirrors Claude Code's Customize panel: user-authored Skills, Connectors (MCP), and Personal Plugins. Reachable from the left sidebar; replaces the mislabeled "Plugins" shortcut. Promotes the existing `SkillsManager` and `McpSettings` out of the Settings dialog into a dedicated full-window view, and adds a brand-new plugin system (manifest + loader + registry + browser) from scratch.

**Why now.** Lamprey already ships the two hardest pieces — a chokidar-watched skill loader (`skill-loader.ts`) and an MCP manager with OAuth — but they're hidden inside Settings tabs and don't compose. Users can't author a skill from a guided wizard, can't browse plugins, and the sidebar's `pluginsIcon` button currently lies (it opens MCP settings). This phase fixes all three.

**Non-goals.**
- No remote/hosted plugin marketplace this phase — registry is local-first (bundled categories + URL/path install). A remote registry server is a future phase.
- No plugin sandbox/execution VM. Plugins this phase are *bundles of declarative assets* (skills, slash-commands, MCP server defs) — they don't ship executable code Lamprey runs in-process. Hooks/agents come later.
- No file-format compatibility shim with Claude Code's `.claude-plugin/plugin.json` on day one. We adopt the *spirit* (manifest + skills/ + .mcp.json) but use Lamprey's own naming. Import-from-Claude-Code is a stretch goal in C12 if time allows.

---

## §0 Execution Protocol

This plan follows the same discipline as the Parity, Fluidity, and Deep Research plans (see `CLAUDE.md` execution rules).

**Step 1 — Worktree.** This plan executes on its own branch in its own git worktree. The current worktree (`determined-pasteur-033123`) is fine for the whole phase; do not jump branches mid-phase.

**Step 2 — Verify gate (per prompt).** Every prompt must pass before being marked `[x]`:
- `npx tsc --noEmit -p tsconfig.node.json`
- `npx tsc --noEmit -p tsconfig.web.json`
- `npx electron-vite build` (renderer + main + preload all build clean)
- Any prompt-specific smoke check listed in its acceptance criteria
- Manual launch via `ELECTRON_EXEC_PATH=... npx electron-vite dev` for any prompt touching renderer surfaces

**Step 3 — Commit discipline.**
- One commit per prompt, message `feat(customize): C<N> — <one-line>`
- No co-author trailer (per `feedback_no_coauthor_trailer` memory)
- Bundle related sub-edits into the same commit; do not split mechanically

**Step 4 — DEVLOG.** Each prompt appends a dated entry to `DEVLOG.md` under a `## 2026-XX-XX — Customize Phase / C<N>` heading, with: what shipped, files touched, verify results, smoke notes.

**Step 5 — Push policy.** User reviews and pushes. Do not push unless explicitly told to.

**Step 6 — Phase wrap.** After C12 passes its gate: bump version in `package.json`, write `## Customize Phase complete` summary entry in DEVLOG, update `memory/project_build_status.md` and `CLAUDE.md` to mark the phase reference-only.

---

## §1 Prompt Roster

### C1 — Customize surface scaffolding + sidebar entry
**Goal.** Create a new top-level `/customize` route surface that the sidebar opens; retire the mislabeled "Plugins" shortcut.

**Work.**
- New component `src/components/customize/CustomizeView.tsx` — full-window panel with three-column layout placeholder (Skills | Connectors | Plugins) and the three bottom CTA cards from the Claude Code screenshot ("Connect your apps", "Create new skills", "Browse plugins"). All cards inert this prompt; layout + theming only.
- Add `customizeOpen: boolean` + `openCustomize()/closeCustomize()` to `src/stores/ui-store.ts`.
- Rewire `Sidebar.tsx:754` `pluginsIcon` button: label → "Customize", action → `openCustomize()` (not `openSettings('mcp')`). Keep the icon for now.
- Top-of-view breadcrumb ("← Customize") with close affordance returning to chat.
- Empty-state copy: "Skills, connectors, and plugins shape how Lamprey works with you." (matches the screenshot.)

**Acceptance.**
- TSC + build pass.
- Smoke: clicking sidebar "Customize" opens the new surface; close returns to chat. No console errors.
- The legacy `settings:mcp` and `settings:skills` tabs still work (deprecation comes in C2/C5).

---

### C2 — Skills column: live list, toggle, delete (Settings → Customize promotion)
**Goal.** Move skill management out of `SettingsDialog` into the Customize Skills column, with richer affordances than the current `SkillsManager`.

**Work.**
- New `src/components/customize/SkillsColumn.tsx` — uses existing `useSkillsStore` (no IPC churn this prompt).
- Per-row: name, description, enabled toggle, "edit" → opens the existing editor in a side drawer, delete with confirm.
- Header: count + filter input + "New Skill" button (wires to C4 in this prompt as a no-op opener).
- Bundled vs user-authored badge — read from skill's `filePath` (prefix `resources/skills/` vs `userData/skills/`).
- Delete `SettingsDialog` Skills tab + the `'skills'` entry from the `TABS` array in [SettingsDialog.tsx:27](src/components/settings/SettingsDialog.tsx:27). The existing `SkillsManager.tsx` stays as the editor body — Customize embeds it; Settings no longer surfaces it.

**Acceptance.**
- All existing skill CRUD flows work from Customize.
- TSC + build pass.
- Smoke: edit an existing skill, see the chokidar broadcast update the list; create still no-ops (deferred to C4).

---

### C3 — Skill format upgrade: richer frontmatter + directory-mode skills
**Goal.** Bring the skill manifest closer to Claude Code's so users can ship richer skills.

**Work.**
- Extend `LoadedSkill` interface in [skill-loader.ts:8](electron/services/skill-loader.ts:8) with optional fields:
  - `allowedTools?: string[]` (glob patterns, e.g. `"mcp:gmail-*"`)
  - `model?: string` (override the session model for this skill)
  - `autoInvoke?: boolean` (default true; false = manual `/skillname` only — equivalent to Claude's `disable-model-invocation: false`)
- Frontmatter parser updates: accept and pass through new keys; old skills without them keep working.
- **Directory-mode skills**: a subdirectory containing `skill.md` is already supported by the recursive walk at [skill-loader.ts:73](electron/services/skill-loader.ts:73). Add: sibling files in the same directory are tracked as `supportingFiles: string[]` on the `LoadedSkill` so the UI can surface them and the agent can read them by relative path.
- System-prompt builder ([system-prompt-builder.ts](electron/services/system-prompt-builder.ts)): when a skill is invoked, inject its `allowedTools` (if set) as a constraint line, and respect `model` override at the routing layer (defer to existing model-routing if `model` is set on the skill being invoked).

**Acceptance.**
- TSC + build pass.
- Smoke: ship one bundled directory-mode example skill in `resources/skills/example-directory-skill/skill.md` + `reference.md`; verify it loads with `supportingFiles: ["reference.md"]`.
- All existing flat `.md` skills still load with `supportingFiles: []` and no behavior change.

---

### C4 — "Create new skill" wizard
**Goal.** Replace the bare-form "new skill" path with a guided wizard that produces a well-formed directory skill.

**Work.**
- New `src/components/customize/NewSkillWizard.tsx` — modal opened from the SkillsColumn "New Skill" button.
- Three steps: (1) name + description, (2) trigger style — auto-invoke vs manual, optional allowed-tools picker (multi-select against `useMcpStore` server tools + native tools), (3) preview the generated `skill.md` + scaffold files.
- On submit: calls `window.api.skills.create({ ... })` with slugified name → IPC writes to `userData/skills/<slug>/skill.md`. If the user toggled "include reference.md" in step 3, scaffold an empty stub.
- After create, the new skill appears in SkillsColumn via the existing `skills:changed` event.

**Acceptance.**
- TSC + build pass.
- Smoke: walk the wizard end-to-end; produced file passes gray-matter parse and shows up in the list with correct flags.

---

### C5 — Connectors column: promote MCP from Settings
**Goal.** Same as C2 but for MCP. The existing `McpSettings.tsx` body becomes the Connectors column.

**Work.**
- New `src/components/customize/ConnectorsColumn.tsx` — wraps existing `useMcpStore`.
- Per-row: name, transport badge (stdio / SSE), status dot, auth state (none / google-oauth-connected / google-oauth-needs-auth), reconnect button, "edit" → side drawer, remove (with guard for built-ins).
- Header: count + filter + "Add Connector" button (wires to C6).
- Delete `SettingsDialog` MCP Servers tab + `'mcp'` entry from `TABS`. Existing `McpSettings.tsx` retained as the editor body.

**Acceptance.**
- TSC + build pass.
- Smoke: status changes from `mcp-manager` propagate; reconnect button still works; Google OAuth flow still completes.

---

### C6 — "Add connector" flow: JSON paste + curated catalog
**Goal.** The "Connect your apps" CTA opens a flow to add a new MCP server without hand-editing `mcp-servers.json`.

**Work.**
- New `src/components/customize/AddConnectorFlow.tsx` — two-tab modal:
  - **Catalog tab**: bundled list of common MCP servers (Linear, Sentry, Notion, Postgres via npx, Playwright, etc.) — each is a static `McpServerConfig` template the user can one-click add. Define the catalog in a new file `resources/connectors/catalog.json` so it can be edited without code changes.
  - **JSON tab**: textarea for pasting an `mcpServers` entry (matches Claude Code's `.mcp.json` schema shape — we accept it but normalize to Lamprey's `McpServerConfig`); validates on submit and shows parse errors inline.
- IPC handler `mcp:addServer` in [electron/ipc/mcp.ts](electron/ipc/mcp.ts) — sanitizes input, appends to mcp-manager, broadcasts to renderer.
- "Connect your apps" card in CustomizeView opens this flow.

**Acceptance.**
- TSC + build pass.
- Smoke: add a stdio server via JSON paste → it appears in ConnectorsColumn with `status: disconnected`; clicking reconnect transitions to `connecting → connected` (or `error` if the binary is missing, which is OK).

---

### C7 — Plugin manifest + loader (green field)
**Goal.** Define the plugin format and ship the service that discovers/parses them. No UI yet.

**Work.**
- New `electron/services/plugin-loader.ts` — mirrors `skill-loader.ts` structure (chokidar watcher, dev-vs-prod path resolution, broadcast on change).
- Plugin layout (Lamprey-flavored, Claude-Code-spirit):
  ```
  <plugin-root>/
    plugin.json          (required manifest)
    skills/              (optional — same format as standalone skills)
    slash-commands/      (optional — flat .md files)
    connectors.json      (optional — array of McpServerConfig)
    README.md            (optional)
  ```
- `plugin.json` schema:
  ```ts
  interface PluginManifest {
    id: string                  // kebab-case, unique
    name: string                // display name
    description: string
    version: string             // semver
    author?: string
    homepage?: string
    category?: string           // e.g. "Productivity", "Engineering" — drives sidebar grouping
    enabled?: boolean           // default true on install
  }
  ```
- Paths:
  - Bundled: `resources/plugins/<id>/`
  - User-installed: `userData/plugins/<id>/`
- On init: bootstrap any bundled plugins into userData (same pattern as `ensureSkillsDir`), then load all and watch.
- Public API: `listPlugins()`, `getPlugin(id)`, `enablePlugin(id)`, `disablePlugin(id)`, `removePlugin(id)`, `installFromDirectory(srcPath)`, `installFromUrl(url)` (the last two stubbed; real install lands in C10).
- Persist enabled-state in a separate `userData/plugins.json` (so a disabled plugin can keep its files but stay inert).

**Acceptance.**
- TSC + build pass.
- Smoke: drop a minimal `resources/plugins/example-plugin/plugin.json` + one skill; on app launch, `listPlugins()` returns it and the manifest validates.

---

### C8 — Plugin IPC + store + change broadcast
**Goal.** Wire the loader to the renderer.

**Work.**
- New `electron/ipc/plugins.ts` — handlers `plugins:list`, `plugins:get`, `plugins:enable`, `plugins:disable`, `plugins:remove`, `plugins:installFromUrl`, `plugins:installFromDirectory`. All follow the standard `{success, data}|{success, error}` envelope.
- Preload exposure in [preload.ts](electron/preload.ts) under `window.api.plugins.*` (mirror the skills shape).
- New `src/stores/plugins-store.ts` — Zustand store mirroring `skills-store.ts`: `{ plugins, loaded, loadPlugins(), setPluginsFromEvent(), enable(id), disable(id), remove(id) }`. Subscribes to `plugins:changed` event.

**Acceptance.**
- TSC + build pass.
- Smoke: in renderer DevTools, `await window.api.plugins.list()` returns the example plugin; `enable/disable` toggles the manifest state and re-broadcasts.

---

### C9 — Plugins column UI in Customize
**Goal.** The "Personal plugins" list from the screenshot, with categories.

**Work.**
- New `src/components/customize/PluginsColumn.tsx` — reads `usePluginsStore`.
- Grouped by `category` (alphabetized; uncategorized falls into "Other"). Each plugin row: name, version, description, enabled toggle, kebab menu (View details, Remove).
- "Personal plugins" header with `+` button → opens C10's install flow.
- Detail drawer on row click: shows manifest, the included skills/connectors/commands counts, README if present.
- Ship 3–5 minimal bundled "starter" plugins in `resources/plugins/` covering common categories (e.g. "lamprey-research-helpers", "lamprey-git-tools") to make the empty state look populated for first-run users.

**Acceptance.**
- TSC + build pass.
- Smoke: starter plugins appear under their categories; toggling one to disabled removes its skills from the SkillsColumn list (verifies C11's runtime hookup is needed — that's why C11 follows).

---

### C10 — Plugin install flow: local dir + URL
**Goal.** The `+` button and "Browse plugins" CTA both reach a working install path.

**Work.**
- New `src/components/customize/InstallPluginFlow.tsx` — three-tab modal:
  - **From directory**: native file picker (`dialog.showOpenDialog` via new IPC `plugins:pickDirectory`) → reads target's `plugin.json` → validates → copies the directory into `userData/plugins/<id>/`.
  - **From URL**: textarea accepts a `.zip` or `.tar.gz` URL → downloads via fetch → extracts to `userData/plugins/<id>/` (use `node:zlib` + `tar` for tarballs, the existing project unzip util if any, else add `unzipper`). Validate manifest before persisting; reject if `plugin.json` missing or malformed.
  - **From bundled catalog**: lists "available but not enabled" bundled starters the user previously removed (so they can re-enable without re-bundling).
- On success: refresh the plugin loader (`reloadPlugins()` triggers chokidar re-scan), close modal.
- Surface install errors with actionable messages (manifest invalid → show which field; download failed → show URL + status).

**Acceptance.**
- TSC + build pass.
- Smoke: pack the example plugin into a `.zip`, host it on a local HTTP server, install via URL; verify it appears in the list and its skills load.

---

### C11 — Plugin runtime: namespace plugin skills/connectors/commands
**Goal.** When a plugin is enabled, its skills/connectors/commands surface in the rest of the app. When disabled, they hide.

**Work.**
- `skill-loader.ts`: add a "plugin source" path — when loading, also walk `userData/plugins/<id>/skills/` for every enabled plugin. Plugin-sourced skills get `pluginId: string` on `LoadedSkill` and their IDs are namespaced (`<pluginId>:<skillId>`) to avoid collisions.
- `slash-commands.ts`: same treatment for `userData/plugins/<id>/slash-commands/`.
- `mcp-manager.ts`: when a plugin with `connectors.json` is enabled, register those servers (as transient, plugin-owned — removed from `getServers()` view when the plugin is disabled). Plugin-owned MCP servers show up in ConnectorsColumn with a "from plugin: X" badge and are read-only.
- Enable/disable toggle in PluginsColumn now actually changes runtime state (loader re-scans, MCP manager hot-adds/removes).
- Skill picker / mention UI ([ChatInput.tsx](src/components/chat/ChatInput.tsx)) groups plugin-sourced entries under the plugin name; built-in vs user-authored vs plugin-sourced should each be visually distinct.

**Acceptance.**
- TSC + build pass.
- Smoke: enable the example plugin → its skill appears in `@`-mention; disable it → it disappears, and the file on disk is untouched.

---

### C12 — Polish + bundled starter content + phase wrap
**Goal.** Last-mile rough-edge sweep, bundled starter content, version bump.

**Work.**
- Replace the placeholder `pluginsIcon` in the sidebar with a "Customize" icon (use an existing safe-bet icon from the asset folder or fall back to a 24×24 lucide-equivalent — no fake polish, real asset only).
- Wire the three CustomizeView bottom CTA cards to live flows: "Connect your apps" → AddConnectorFlow (C6), "Create new skills" → NewSkillWizard (C4), "Browse plugins" → InstallPluginFlow (C10).
- Ship 3 bundled starter skills (`research-helper`, `git-status-recap`, `path-line-linker-doctor`) and 2 bundled starter plugins as polished examples.
- Add a one-line tip strip at the top of CustomizeView pointing first-run users at the "Create new skills" CTA.
- Bump `package.json` to `v0.5.0` (v0.4.0 was claimed by the Snip Phase).
- DEVLOG wrap-up entry summarizing C1–C12; update `memory/project_build_status.md` + `CLAUDE.md` Current State block to mark Customize Phase complete + reference-only.
- (Stretch) Importable from a Claude Code skills directory: file → "Import skills from folder…" → reads any `.md` with frontmatter into Lamprey's skill store. Skip if it would push C12 past one commit.

**Acceptance.**
- TSC + build pass; production `electron-vite build` is clean.
- Manual smoke of the full flow: sidebar → Customize → create skill → add connector → install plugin → enable/disable → confirm skill picker reflects state.
- Phase-wrap commit + DEVLOG entry merged.

---

## §2 Open Questions (decide before C1)

1. **Customize surface presentation.** Full-window panel (like Claude Code) that replaces the chat view, or a large modal layered over chat? Claude Code's screenshot shows full-window. **Recommend: full-window panel** — it gets enough real estate for three columns plus CTAs and matches the reference UX. Cheap to escape back to chat.
2. **Settings tab retirement.** Hard-delete the Skills + MCP Servers tabs from `SettingsDialog` (C2 + C5), or leave them as deep-link aliases that redirect to Customize? **Recommend: hard-delete** — duplication is its own bug, and the Customize surface is strictly richer. The `SettingsTabId` union narrows accordingly.
3. **Plugin manifest format.** Strict JSON (proposed), or YAML to match skill frontmatter? **Recommend: JSON** — it's a structured config file, not a document, and parsers are zero-dependency.
4. **Plugin install scope.** User-only this phase, or also project-scoped (per-repo `.lamprey/plugins/`)? **Recommend: user-only this phase** — project scope adds a settings-precedence layer that's better deferred until there's demand.
5. **Sidebar icon.** Keep the existing `pluginsIcon` PNG (currently labels the to-be-retired shortcut), or commission a new "Customize" asset? **Recommend: keep `pluginsIcon` for now**, relabel to "Customize"; swap the asset only if the user provides one. Avoids fake polish.

---

## §3 What this phase deliberately does NOT do

- No remote/hosted plugin marketplace (no `lamprey.io/plugins` registry server).
- No plugin sandbox or executable hooks; plugins are declarative-asset bundles only.
- No multi-scope settings layering (project vs user vs local) for plugins.
- No Claude Code `.claude-plugin/plugin.json` byte-compat import. (C12 stretch may add a one-way Skills folder importer.)
- No telemetry on which skill/plugin/connector got invoked. (Considered for a future Activity Phase.)

---

## §4 Risk register

| Risk | Mitigation |
|---|---|
| Plugin-owned MCP servers leak into config persistence | C11: keep them transient — never written to `mcp-servers.json`, regenerated from manifest on every boot. |
| Skill ID collisions between user + plugin | C11: namespace plugin skills as `<pluginId>:<skillId>` in the loader output; UI strips the namespace for display but keeps it for execution lookup. |
| URL install pulls hostile manifests | C10: validate every manifest field; reject anything not in the schema; surface the resolved path before commit so users can inspect. Note in DEVLOG: phase one ships *without* signature checks; that's a known gap. |
| Tar/zip extraction outside target dir (path traversal) | C10: explicit per-entry path normalization + reject any entry whose resolved path escapes the destination. Use the standard tar library's strict mode. |
| Sidebar "Plugins" → "Customize" rename breaks user muscle memory | C1: keep the same icon position; the relabel is a one-time adjustment, not a relocation. |

---

*Ready for review. No code changes will land until this plan (or a revised version) gets explicit approval per the "plan before work" rule.*
