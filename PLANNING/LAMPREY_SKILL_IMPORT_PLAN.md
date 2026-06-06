# Lamprey Skill Import Phase — Build Plan (I1–I8)

**Scope.** Add a first-class **"Import from Claude Code"** path to Lamprey's Customize surface, so the user can pull their on-disk Claude Code skill bundles into Lamprey as namespaced plugins without hand-copying files.

**Why now.** A long, growing list of Anthropic-managed and third-party Claude Code skills already lives on the user's disk under `%APPDATA%\Claude\local-agent-mode-sessions\skills-plugin\`. Lamprey's plugin loader (`electron/services/plugin-loader.ts`) and skill loader (`electron/services/skill-loader.ts`) are already shaped to accept these bundles — they just need a thin compatibility layer (root-level `plugin.json`, lowercase `skill.md`) plus a discovery + install UX. Doing this once unlocks 12 immediate skills (docx, pdf, pptx, xlsx, schedule, consolidate-memory, setup-cowork, skill-creator, theme-factory, web-artifacts-builder, im-blog-post, im-investor-update) and any future plugin bundles that ship to the same dir.

**Non-goals.**
- No extraction of skills bundled inside `claude.exe` itself (verify, code-review, simplify, run, init, review, security-review, deep-research, claude-api, loop, schedule, update-config, keybindings-help, fewer-permission-prompts). Several are already covered by Lamprey-shipped equivalents under `resources/skills/`. We surface a note rather than pretending we can import them.
- No bundling of external tooling (`pandoc`, `python`, `extract-text`) that imported skills depend on. We disclose the dependency in the importer UI and let the user install separately.
- No re-implementation of Lamprey's plugin loader. The importer adapts CC's plugin layout into Lamprey's existing shape, not the other way around.
- No remote / network sync. Importer reads local disk only.

---

## §0 Execution Protocol

This plan follows the same discipline as the Customize and Panels phases.

**Step 1 — Worktree.** This plan executes on its own branch in its own git worktree (`claude/kind-noyce-f4eeca`). The branch is fine for the whole phase; do not jump branches mid-phase.

**Step 2 — Verify gate (per prompt).** Every prompt must pass before being marked `[x]`:
- `npx tsc --noEmit -p tsconfig.node.json`
- `npx tsc --noEmit -p tsconfig.web.json`
- Any prompt-specific test or smoke check listed in the prompt
- For I8: full `npm run build:win` producing `.exe` + `.zip` + `.blockmap` + `latest.yml`

**Step 3 — Commit discipline.**
- One commit per prompt, message `feat(skill-import): I<N> — <one-line>` (or `chore(release):` for the I8 version bump).
- No co-author trailer (per `feedback_no_coauthor_trailer` memory).
- Bundle related sub-edits into the same commit; do not split mechanically.

**Step 4 — DEVLOG.** Each prompt appends a dated entry to `DEVLOG.md` under a `## 2026-06-05 — Skill Import Phase / I<N>` heading, with: what shipped, files touched, verify results, smoke notes.

**Step 5 — Push policy.** STS green light covers a single push to `main` after I8. No mid-roster pushes; no force-push.

**Step 6 — Phase wrap.** After I8 passes its gate: bump version in `package.json`, write `## Skill Import Phase complete` summary entry in DEVLOG, update `memory/project_build_status.md` and `CLAUDE.md` to mark the phase reference-only, drop the full release-artifact set into the primary repo's `dist/`, push.

---

## §1 Source layout (on disk, verified)

```
%APPDATA%\Claude\local-agent-mode-sessions\skills-plugin\
  <outer-session-uuid>\
    <inner-session-uuid>\
      .claude-plugin\plugin.json     → { name, version, description }   (no `id` field)
      manifest.json                  → { lastUpdated, skills: [{ skillId, name, description, creatorType, enabled }] }
      skills\
        <slug>\
          SKILL.md                   ← frontmatter: name, description, license
          scripts\ references\ assets\ themes\ agents\ eval-viewer\ ...
          LICENSE.txt
```

Verified 12-skill payload at the time of writing: `consolidate-memory`, `docx`, `im-blog-post`, `im-investor-update`, `pdf`, `pptx`, `schedule`, `setup-cowork`, `skill-creator`, `theme-factory`, `web-artifacts-builder`, `xlsx`.

Discovery must tolerate:
- Multiple outer/inner session UUIDs (only one was present, but the layout suggests >1 is possible).
- Plugin bundles without `manifest.json` (use frontmatter-only mode).
- Missing `.claude-plugin/plugin.json` (skip).

---

## §2 Strategy

**Import as plugins, not as loose skills.** Lamprey's plugin loader already namespaces bundled skills as `<pluginId>:<skillId>`, groups them in the Customize → Plugins column, and supports a single-toggle enable/disable. Treating each CC plugin bundle as an installable Lamprey plugin gives us:
- correct grouping (12 imported skills land under one "anthropic-skills" plugin),
- honors the CC `manifest.json` per-skill `enabled` flag,
- one-click uninstall via the existing Plugins column,
- preserves supporting trees (`scripts/`, `references/`, `assets/`) so the agent can still read referenced paths.

**Adaptation steps performed during import:**
1. Read `.claude-plugin/plugin.json` (`name`, `version`, `description`).
2. Synthesize a Lamprey-compatible root `plugin.json`:
   ```json
   { "id": "<slugified-name>", "name": "<name>", "version": "<version>",
     "description": "<description>", "category": "Imported from Claude Code",
     "enabled": true }
   ```
3. Copy `skills/` tree into `<userData>/plugins/<id>/skills/`, recursively.
4. For every copied `SKILL.md`, write a lowercase `skill.md` companion alongside it (Lamprey's `discoverSupportingFiles()` keys on lowercase). The uppercase file stays so re-imports detect "already present" idempotently.
5. Read CC's `manifest.json` `enabled` flag per skill. For skills with `enabled: false`, rewrite the frontmatter to add `autoInvoke: false` so they appear in Lamprey as manual-only rather than vanishing.
6. Record import metadata in `<userData>/plugins/<id>/.cc-import.json`: `{sourcePath, importedAt, ccPluginVersion}`. Used for the "Re-sync" affordance.

**Eject affordance.** A plugin-sourced skill row gains an "Eject as user skill" action. Copies the SKILL.md into `<userData>/skills/<slug>/skill.md` so it becomes editable through the existing wizard / editor. Plugin copy stays in place; user copy takes precedence by id.

---

## §3 Known gaps & limitations

1. **`plugin.json` schema mismatch.** CC's is at `.claude-plugin/plugin.json` with `{name, version, description}`; Lamprey requires root `plugin.json` with `{id: kebab-case, ...}`. Importer synthesizes.
2. **Skill filename case.** CC ships `SKILL.md`; Lamprey accepts `*.md` but `discoverSupportingFiles()` keys on `skill.md` lowercase for sibling-file enumeration. Importer writes both.
3. **Supporting-file enumeration depth.** Current loader lists immediate siblings only; CC skills nest `scripts/office/soffice.py` two levels deep. Agent still reads by explicit path — display-only gap, flagged for I7 polish (tree summary, not flat list).
4. **External tool dependencies.** `docx` (pandoc, python), `pdf` (extract-text), `pptx` (python), `xlsx` (python). Importer surfaces a "what you're getting" disclosure listing required tooling.
5. **Built-in CC skills inside `claude.exe`.** Out of scope. Empty-state copy points users to Lamprey's bundled equivalents (`resources/skills/verify`, `review`, `code-review.md`, `debug`, `plan`).
6. **Future CC layout changes.** Schema is hand-coded against the on-disk shape observed 2026-06-05. If CC ships a new layout, discovery must skip rather than crash. Importer paths defensive throughout.

---

## §4 Prompt Roster

### I1 — Disk-discovery service
**Goal.** Pure read-only scan for CC plugin bundles on the user's disk.

**Work.**
- New `electron/services/cc-skill-discovery.ts` exporting:
  - `discoverCcPlugins(opts?: { extraRoots?: string[] }): Promise<DiscoveredCcPlugin[]>`
  - `DiscoveredCcPlugin = { sourcePath, pluginName, version, description, skills: DiscoveredCcSkill[] }`
  - `DiscoveredCcSkill = { slug, name, description, enabled, supportingFileCount }`
- Default roots scanned: `%APPDATA%\Claude\local-agent-mode-sessions\skills-plugin`, plus equivalent macOS/Linux paths for cross-platform readiness. User-pickable extras via `opts.extraRoots`.
- Walks two levels deep (outer-session/inner-session) looking for `.claude-plugin/plugin.json`. For each match, parses the plugin manifest + the sibling `manifest.json` (if present) + each `skills/<slug>/SKILL.md` frontmatter.
- No copying, no writes, no IPC yet.

**Verify.**
- Both tsc configs pass.
- Vitest fixture (`tests/cc-skill-discovery.test.ts`): mirrors the on-disk layout in a tmp dir, asserts 12 skills, correct `enabled` flags, supporting file counts.

---

### I2 — Importer service
**Goal.** Copy a discovered CC plugin into `<userData>/plugins/<id>/` as a Lamprey-compliant bundle.

**Work.**
- New `electron/services/cc-skill-importer.ts` exporting:
  - `importCcPlugin(sourcePath: string, opts?: { overwrite?: boolean }): Promise<ImportResult>`
  - `ImportResult = { pluginId, installPath, skillsImported, skipped: string[] }`
- Steps (per §2 strategy):
  1. Read source manifests.
  2. Slugify plugin name → `pluginId`. Reject duplicates unless `opts.overwrite`.
  3. `mkdirSync(<userData>/plugins/<pluginId>, { recursive: true })`.
  4. Recursive copy of `skills/` tree.
  5. For each copied `SKILL.md`: write lowercase `skill.md` alongside. If CC's `manifest.json` flags it disabled, parse the frontmatter and re-emit with `autoInvoke: false`.
  6. Write synthesized root `plugin.json`.
  7. Write `.cc-import.json` metadata.
- Idempotent on re-import with `overwrite: true`: removes the previous install dir first, then re-copies.

**Verify.**
- Both tsc configs pass.
- Vitest test: importing the fixture from I1 produces a directory whose `plugin.json` validates against Lamprey's `parseManifest()` (require + call it directly to confirm).

---

### I3 — IPC surface
**Goal.** Renderer can call into discovery + import.

**Work.**
- New `electron/ipc/cc-skill-import.ts` registering:
  - `ccImport:discover` → calls `discoverCcPlugins()`, returns `{success, data}`
  - `ccImport:install` (args: `{sourcePath, overwrite?}`) → calls `importCcPlugin()`. On success, also calls plugin-loader's internal scan refresh so the new bundle shows up live.
- `electron/main.ts`: register the new handlers alongside the existing ones.
- `electron/preload.ts`: extend the typed `window.api` surface with `ccImport.discover()` + `ccImport.install(args)`.

**Verify.**
- Both tsc configs pass.
- `electron-vite build` succeeds (validates preload typings).

---

### I4 — Renderer store + types
**Goal.** Renderer-side state holder for discovery results and last import result.

**Work.**
- New `src/stores/cc-import-store.ts` (Zustand) with state `{ discovered: DiscoveredCcPlugin[], lastResult: ImportResult | null, loading: boolean, error: string | null }` and actions `refresh()`, `install(sourcePath, overwrite)`.
- New types in `src/lib/types.ts` mirroring the main-side shapes.

**Verify.**
- Both tsc configs pass.

---

### I5 — UI: "From Claude Code" tab in InstallPluginFlow
**Goal.** Add a fourth tab to the existing install dialog.

**Work.**
- Edit `src/components/customize/InstallPluginFlow.tsx`: add `'cc-import'` tab option.
- Tab body: "Refresh" button (calls `refresh()`); list of discovered plugins as cards. Each card shows plugin name, version, source path (truncated, tooltip-full), skill count, per-skill chips with enabled badge. "Install" button per card (with overwrite confirm if already imported).
- Prominent "What you're getting" disclosure block: lists external tooling dependencies (`pandoc`, `python`, `extract-text`) for the well-known skills (`docx`, `pdf`, `pptx`, `xlsx`).
- Empty state: "No Claude Code skill bundles found on disk." with a help link explaining where CC stores them.

**Verify.**
- Both tsc configs pass.
- Manual smoke: launch dev, open Customize → Browse Plugins → "From Claude Code" tab, see the 12-skill bundle, install it, see "anthropic-skills" appear in the Plugins column, see its skills appear in the Skills column as `anthropic-skills:docx` etc.

---

### I6 — UI: "Import from Claude Code" entry on SkillsColumn
**Goal.** Surface discoverability from the Skills column directly.

**Work.**
- Edit `src/components/customize/SkillsColumn.tsx`: small "↓ Import" button next to "+ New" in the header.
- Click opens `InstallPluginFlow` with `initialTab='cc-import'` (extend the prop API minimally).

**Verify.**
- Both tsc configs pass.
- Manual smoke: button opens the dialog focused on the right tab.

---

### I7 — Polish + edge cases
**Goal.** Round off the rough edges.

**Work.**
- (a) Empty-state copy in I5 points at the Lamprey-bundled fallback skills if discovery returns nothing.
- (b) "Re-sync" button on already-imported plugin cards (calls `install` with `overwrite: true`).
- (c) `SkillsColumn` edit drawer: when the skill has `pluginId` and supporting files nested >1 level deep, show a small tree summary in the drawer (read-only).
- (d) "Eject as user skill" action on plugin-sourced skill rows. Copies the canonical `skill.md` into `<userData>/skills/<slug>/skill.md`. User copy takes precedence; plugin copy remains.

**Verify.**
- Both tsc configs pass.
- Manual smoke: eject one skill, see it appear in the user-authored list, see its plugin sibling marked "ejected" (optional toast is fine).

---

### I8 — Ship: DEVLOG, version bump, build, push
**Goal.** Phase wrap.

**Work.**
- Append `## 2026-06-05 — Skill Import Phase complete` summary to `DEVLOG.md`.
- Bump `package.json` version: 0.5.3 → 0.6.0 (mirroring the v0.5 → v0.6 step the Panels phase used). If 0.6.0 was already cut, bump to 0.6.1.
- Update `CLAUDE.md` "Current State" bullet list with a Skill Import Phase entry, and add a row to `memory/project_build_status.md`.
- `npm run build:win` → produces `dist/Lamprey-<version>-Setup.exe` + `.blockmap` + `latest.yml` + `.zip`. Move artifacts into the primary repo's `dist/` (worktree → primary mirror per `feedback_release_artifacts_in_primary_dist` memory).
- `git push origin claude/kind-noyce-f4eeca:main` (push branch tip to `main`).

**Verify.**
- Full release artifact set lands in primary `dist/`.
- `main` branch advances on the remote.

---

## §5 Out-of-scope follow-ups (not this phase)

- **Watch-mode for CC plugins.** Auto-reimport when CC updates its skills dir. Currently the user clicks "Re-sync".
- **Bundling CC's external tool dependencies** (pandoc, python). Massive scope expansion; punt.
- **Importing CC slash-commands / hooks / agents.** This phase covers skills only. Slash-command importer could follow the same shape but isn't urgent.
- **Cross-machine sync of imported plugins.** They live in `userData`; if the user reinstalls Lamprey, they re-run import.
