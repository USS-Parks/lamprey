# Lamprey Robustness Hotfix — Sequential Prompt Roster

**Goal:** close two recurring user-visible defects with one small, defensible patch and ship as **v0.8.4**:

1. **Duplicate-app launches** — Lamprey opens a second independent Electron process when the desktop launcher fires twice (or relaunches mid-splash). Root cause: `electron/main.ts` has no `requestSingleInstanceLock()` call. Each duplicate process opens its own SQLite handle on `lamprey.db`, its own MCP clients, its own watchers — at minimum confusing, at worst a corruption window.
2. **"Re-prompt to make it act"** — the model emits `<bash>…</bash>` (and adjacent `<tool>`, `<run>`, `<shell>`, `<execute>`, `<command>`, `<terminal>`, `<output>`, `<result>`, `<stdout>`, `<stderr>`) **pseudo-tags as final assistant text** instead of invoking a real tool. The bubble renders the bash-as-prose verbatim and the turn effectively ghosts — the user has to re-prompt. RT1 added a guard for this on the **Reviewer** role only ([system-prompt-builder.ts:300-311](../electron/services/system-prompt-builder.ts:300)); the same defect is observable on `coder` (see screenshots 2026-06-06 072546 / 072629) and is structurally possible on `planner` / `composer` / `coworker` too.

**Defense strategy for #2 is deliberately belt-and-braces** per the user direction:

- **Prompt-side**: extract the RT1 guard into a single `PSEUDO_TAG_GUARD` constant and append it to **every** model-facing role prompt + the `COMPOSER_SYSTEM` block. Prompts can still be ignored by the model, so:
- **Persist-side**: add a pure `sanitizePseudoTags(text)` function that rewrites stray `<bash>…</bash>`-style pairs in assistant text to fenced ```bash blocks, and a new `content_raw TEXT` column on `messages`. On every assistant INSERT, persist `content = sanitized`, `content_raw = original`. Display path keeps reading `content` (clean). Audit/export paths can opt into `content_raw` for the verbatim trail — honest, lossless, no fabricated polish.

**Execution model:** **single session, single worktree off `main`, sequential HX1 → HX5.** Branch: `feat/robustness-hotfix` (in the existing `cool-wescoff-726885` worktree off `main`). One commit per prompt; STS at HX5.

**Version:** `0.8.3` → `0.8.4` (hotfix).

**Companion to:** RT1 (Reasoning-Trace Phase) — this completes the rollout RT1 started but limited to the reviewer.

---

## 0. SESSION BOOTSTRAP — READ THIS FIRST

You are a fresh Claude Code session handed this document. Before doing anything else:

### Step 1 — Confirm environment

Verify:
- Working directory is the `cool-wescoff-726885` worktree off `main` (CLAUDE.md path).
- Current branch is **not** `main` — `feat/robustness-hotfix` (this worktree's branch `claude/cool-wescoff-726885` is acceptable as the working branch; final push fast-forwards `main`).
- `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both pass cleanly *before* you start.
- `npx electron-vite build` exits 0.
- `npx vitest run` is green on the current `main` baseline (record the test count — HX2/HX3 add tests on top of it).

If any of those fail, halt and report. Do not start on a broken baseline.

### Step 2 — No track question

This is a single linear hotfix. **Do not ask the user which track** — there is only one path. Proceed directly into HX1.

### Step 3 — Execute HX1 → HX5 without stopping

1. **Do not ask further questions** unless a prompt requires a decision only the user can make (a real product fork the plan doesn't resolve, or a genuine blocker). Per `feedback_execute_dont_ask`: STS authorization covers every step required to deliver the ship.
2. **For each prompt, in order:**
   a. Read the "Files (net new / modified)" list. Read existing files first — these prompts touch shipped code.
   b. Implement the change. Edit existing files in place; create new ones only when the prompt calls for them.
   c. Run the **verify gate** (the "Verify" column). Always: both tsc configs + `npx electron-vite build` + the vitest suites listed for that prompt. Manual smoke steps that require a real Electron shell are written into DEVLOG as **"user-verification-needed"** rather than claimed (per `feedback_no_fake_polish`).
   d. If verify fails: fix and retry up to **2 times**. On the third failure, halt, write a "blocked" entry in `DEVLOG.md`, report to the user.
   e. If verify passes: mark the prompt `[x]` in this document via `Edit`, write a DEVLOG.md entry (Step 4 format), then commit.
   f. Move to the next prompt.
3. **Do not push to GitHub mid-phase.** One commit per prompt. HX5 does the final push to `main` after the version bump + local Windows build + tag-push + GitHub release + CDN evergreen rename per the standing memories.
4. **When HX5 completes:** write a final phase-completion summary in DEVLOG.md listing every shipped prompt with its commit SHA + final vitest count + `dist/` artifacts list + GitHub release URL + CDN evergreen URLs, then announce completion in chat.

### Step 4 — DEVLOG entry format

```markdown
## [Robustness Hotfix — Prompt HXN] <Title>  —  2026-06-06

**Files changed:** <list>
**Verify gate:**
- tsc node ✓
- tsc web ✓
- electron-vite build ✓
- vitest (<scope>): <count> ✓
- <manual smoke result OR "user-verification-needed: <what to check>">

**Notes:** <anything surprising, deferred, or worth knowing>

**Commit:** <SHA>
```

### Step 5 — Commit discipline

- One commit per prompt. No batching, no amending across prompts.
- Never use `--no-verify`. If a pre-commit hook fails, fix the underlying issue.
- Never add the `Co-Authored-By: Claude` trailer (per `feedback_no_coauthor_trailer`).
- Commit-message style: `fix(robustness): HX1 single-instance lock blocks duplicate Lamprey processes` etc.

### Step 6 — STS authorization scope (binding)

The user invoked STS ("P-SPR then STS"). Per `feedback_sts_convention` + `feedback_execute_dont_ask` + `feedback_readme_is_part_of_ship` + `feedback_cdn_evergreen_artifacts`:
- Run HX1 → HX5 end-to-end with no mid-loop permission asks.
- Bump version in `package.json` at HX5 (`0.8.3` → `0.8.4`).
- Run `npm run build:win` at HX5 — produce `.exe` + `.zip` + `.blockmap` + `latest.yml` in the worktree's `dist/`, then move all four artifacts into the **primary repo's** `dist/` per `feedback_release_artifacts_in_primary_dist`.
- Push branch → `main` (fast-forward merge then `git push origin main`).
- **Push the `v0.8.4` tag** — CLAUDE.md confirms tag pushes work from this Windows session (verified on v0.8.2 / v0.8.3).
- Create GitHub release `v0.8.4` via `gh release create` with the four artifacts attached.
- Update `README.md` per `feedback_readme_is_part_of_ship`: download heading, table URLs, "New in" paragraph, Quick start link, Roadmap top entry.
- CDN evergreen: rename + overwrite-upload `Lamprey-x64.exe` + `Lamprey-x64.zip` to the Cloudflare R2 bucket per `feedback_cdn_evergreen_artifacts`.

---

## 1. Audit Summary — what exists vs. what's missing

| # | Defect | Current state | Gap | Owner prompt |
|---|---|---|---|---|
| 1 | Duplicate Lamprey processes on relaunch | `electron/main.ts` calls `app.whenReady().then(...)` at line 329 with no `requestSingleInstanceLock()` guard above it; `app.on('second-instance', ...)` handler also absent | Standard single-instance pattern: request the lock at the very top of main; `app.quit()` immediately if a primary already holds it; on `second-instance` event, restore + focus the existing `BrowserWindow` | **HX1** |
| 2a | Pseudo-tag guard only on Reviewer | `AGENT_ROLE_PROMPTS.reviewer` lines 300-311 forbid `<bash>`/`<tool>`/`<run>`/etc.; `planner` (lines 294-296), `coder` (lines 297-299), `coworker` (lines 312-314), `reader` (lines 315-318), `verifier` (lines 319-322), and the `COMPOSER_SYSTEM` block (lines 142-161) are silent — they let the model fall back to pseudo-XML as prose | Extract the guard into a single exported `PSEUDO_TAG_GUARD` constant. Append it to every role prompt that emits user-visible final text (`planner`, `coder`, `composer`, `coworker`) and the `COMPOSER_SYSTEM` block. Leave `reader` and `verifier` alone since they emit short verdict strings; add explicit "no tool calls — text only" line if missing. Extend `system-prompt-builder.test.ts` to snapshot the guard phrases across all touched prompts. | **HX2** |
| 2b | No persist-side sanitizer; no audit-safe verbatim column | `saveMessage` in `electron/services/conversation-store.ts:523` runs `splitInlineReasoning` + `INSERT INTO messages` directly — whatever the model emitted lands in `content` verbatim | Add `content_raw TEXT` column to `messages` (idempotent `ALTER TABLE` via `PRAGMA table_info` check; NULL for pre-hotfix rows). New pure module `electron/services/sanitize-pseudo-tags.ts` with `sanitizePseudoTags(text: string): string` that rewrites stray `<bash>…</bash>`, `<tool>…</tool>`, `<run>…</run>`, `<shell>…</shell>`, `<execute>…</execute>`, `<command>…</command>`, `<terminal>…</terminal>`, `<output>…</output>`, `<result>…</result>`, `<stdout>…</stdout>`, `<stderr>…</stderr>` pairs to fenced Markdown blocks (`` ```bash …``` `` for the shell-shaped ones, `` ```text …``` `` for the result-shaped ones). Handles unbalanced tags gracefully (open-without-close → close at next newline-newline boundary or end-of-string). Idempotent (running it twice is a no-op). Comprehensive vitest. | **HX3** |
| 2c | Sanitizer not wired into the save path | Same chokepoint as 2b | In `saveMessage`: for `role === 'assistant'` rows, set `content_raw = original content (post `splitInlineReasoning` content piece)`, `content = sanitizePseudoTags(...)`. Update the `INSERT` statement + column list. Extend `listMessages` / `getMessageById` IPC return shapes to include `content_raw` (optional field, present only when populated) for future audit-surface use. UI remains untouched — keeps reading `content` (cleaned). Vitest in `conversation-store.test.ts` (extend existing or new) covers: assistant row with pseudo-tags → `content` clean + `content_raw` raw; assistant row without pseudo-tags → `content === content_raw`; non-assistant rows → no `content_raw` (NULL). | **HX4** |
| — | Ship | n/a | DEVLOG phase-completion + README update + version bump + CLAUDE.md "Current State" + memory updates + local Windows build + `dist/` move + push `main` + push tag + GitHub release + CDN evergreen | **HX5** |

**Non-goals (this hotfix):**
- No UI surface for `content_raw` (future Reasoning-Trace Viewer addition; out of scope here).
- No changes to RT2's `message_stage_metrics` table.
- No retroactive sanitizing of historical rows (pre-hotfix `content_raw` stays NULL; rendering path is unchanged so users see what they always saw).
- No changes to provider routing, model selection, MCP transport, or any non-target surface.
- No new Settings tab.

---

## 2. Architectural Invariants — Locked

These apply across all 5 prompts. Treat as binding.

1. **Single-instance lock is the very first action in main.** Before splash, before DB open, before any IPC handler registration — so the second process exits before it allocates anything that could conflict with the primary.
2. **No prompt-guard semantics regression on `reviewer`.** HX2 extracts the inline RT1 guard into a constant and re-uses it; the resulting reviewer prompt body must be character-identical to the pre-HX2 body when reassembled.
3. **`sanitizePseudoTags` is pure and idempotent.** No side effects. Calling it twice on the same input returns the same output as calling it once. This is a vitest invariant.
4. **`content_raw` migration is additive only.** `ALTER TABLE messages ADD COLUMN content_raw TEXT` (no NOT NULL, no DEFAULT) — pre-hotfix rows read as NULL, no backfill, no destructive change.
5. **UI display path is unchanged.** Every component that reads `content` continues to read `content` and gets the sanitized version. `content_raw` is opt-in for whoever wants the verbatim audit trail.
6. **`splitInlineReasoning` ordering is preserved.** The current call order is `splitInlineReasoning(content, reasoning, draft)` → INSERT. HX4 inserts `sanitizePseudoTags` *after* the split (on `split.content`), so the reasoning extraction logic is untouched.
7. **No new IPC channels.** HX1 + HX2 + HX3 + HX4 are all main-process internal. The `listMessages` return-shape extension in HX4 reuses the existing IPC.
8. **`window.api` guards.** N/A for this hotfix — no new renderer code lands.
9. **Per `feedback_no_fake_polish`:** any smoke step that can't be exercised inline (Electron shell behaviors like the duplicate-launch test on HX1) is written as `user-verification-needed`, never claimed.

---

## 3. The Five Prompts

| # | Prompt | One-liner | Files (net new / modified) | Verify | Status |
|---|---|---|---|---|---|
| HX1 | **Single-instance lock blocks duplicate Lamprey processes** | At the top of `electron/main.ts` (immediately after the imports, before `let mainWindow`), call `const gotTheLock = app.requestSingleInstanceLock()`. If `!gotTheLock`, `app.quit(); process.exit(0)`. Register `app.on('second-instance', (_event, _argv, _workingDirectory) => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } })`. Block must precede `app.whenReady()` registration. Add a one-line code comment explaining "duplicate-launch protection — second instance exits + focuses primary." | `electron/main.ts` | both tsc · `electron-vite build` · launch app, double-click desktop launcher, confirm only one window exists (user-verification-needed — no inline harness for true OS-level relaunch); single-launch baseline still opens normally | [x] |
| HX2 | **Extract `PSEUDO_TAG_GUARD` constant; apply across all model-facing role prompts + composer** | (a) In `electron/services/system-prompt-builder.ts`, define `export const PSEUDO_TAG_GUARD = '...'` containing the canonical guard text (extracted verbatim from `AGENT_ROLE_PROMPTS.reviewer` lines ~304-311 — the "Output format: plain Markdown only..." through "...not in prose." block, generalized to omit the reviewer-specific `<think>` reference where appropriate). (b) Refactor `AGENT_ROLE_PROMPTS.reviewer` to use `PSEUDO_TAG_GUARD` (its assembled string must match the pre-HX2 body byte-for-byte — invariant #2). (c) Append `PSEUDO_TAG_GUARD` to `AGENT_ROLE_PROMPTS.planner`, `AGENT_ROLE_PROMPTS.coder`, and `AGENT_ROLE_PROMPTS.coworker`. (d) Append `PSEUDO_TAG_GUARD` to the `COMPOSER_SYSTEM` array (after the "Keep it short and concrete." line). (e) Extend `system-prompt-builder.test.ts`: assert the guard text exists in all five touched prompts; assert reviewer prompt body is unchanged (golden snapshot). | `electron/services/system-prompt-builder.ts`, `electron/services/system-prompt-builder.test.ts` | both tsc · `electron-vite build` · `npx vitest run system-prompt-builder` ✓ — must include new guard-presence assertions + reviewer-unchanged golden | [x] |
| HX3 | **`content_raw` migration + pure `sanitizePseudoTags` module + tests** | (a) In `electron/services/database.ts` `initSchema`, after the `CREATE TABLE IF NOT EXISTS messages` block, add an idempotent column-add: read `PRAGMA table_info(messages)`, if `content_raw` not present run `ALTER TABLE messages ADD COLUMN content_raw TEXT`. (b) New module `electron/services/sanitize-pseudo-tags.ts` exporting `sanitizePseudoTags(text: string): string`. Behavior: for each pseudo-tag in `{bash, tool, run, shell, execute, command, terminal, output, result, stdout, stderr}`, rewrite `<TAG>…</TAG>` (case-insensitive, multi-line, non-greedy) to a fenced markdown block — `bash`/`shell`/`run`/`execute`/`command`/`terminal`/`tool` map to ` ```bash `, `output`/`result`/`stdout`/`stderr` map to ` ```text `. Skip pairs that already sit inside an existing fenced ` ``` ` block (avoid double-wrapping). Handle unbalanced opens (open-without-close): if no close tag is found, leave the open tag alone (we'd rather under-rewrite than corrupt). Return original string unchanged if no matches. Idempotent on re-run. (c) New vitest `electron/services/sanitize-pseudo-tags.test.ts` covers: each tag type rewritten correctly; case-insensitive match; multi-line bodies preserved; no rewrite inside existing fences; unbalanced open left intact; idempotency (`sanitize(sanitize(x)) === sanitize(x)`); no rewrite when input has no pseudo-tags; mixed real backtick blocks + pseudo-tags handled. | `electron/services/database.ts`, `electron/services/sanitize-pseudo-tags.ts` (new), `electron/services/sanitize-pseudo-tags.test.ts` (new) | both tsc · `electron-vite build` · `npx vitest run sanitize-pseudo-tags` ✓ · launch app against existing `lamprey.db` snapshot, confirm migration runs once + idempotent on second launch (user-verification-needed: existing-db smoke); `PRAGMA table_info(messages)` shows `content_raw` column | [x] |
| HX4 | **Wire `sanitizePseudoTags` into `saveMessage`; expose `content_raw` in read IPC** | (a) In `electron/services/conversation-store.ts` `saveMessage` (line ~523), import `sanitizePseudoTags`. For assistant rows only: after the existing `splitInlineReasoningWithDraft` call, compute `const sanitized = sanitizePseudoTags(split.content)`; pass `sanitized` as the `content` column value and `split.content` as the new `content_raw` column value. For non-assistant rows: pass `content_raw = null`. (b) Update the `INSERT INTO messages (...) VALUES (...)` SQL to include `content_raw` and add the bound parameter. (c) Locate the `listMessages` / `getMessageById` read paths (same file) — extend their SELECT + return shape to include `content_raw` as an optional field (`string | null | undefined`). (d) Extend `src/lib/types.ts` `StoredMessage` (or equivalent renderer-facing shape) with optional `content_raw?: string | null` so the type compiles renderer-side. The UI does not consume it yet — that's a future RT extension. (e) Extend `electron/services/conversation-store.test.ts` (or add `conversation-store.sanitize.test.ts` if cleaner): assistant row with `<bash>...</bash>` → DB `content` is fenced + `content_raw` retains the pseudo-tag; assistant row with no pseudo-tags → `content === content_raw`; user row → `content_raw` NULL. | `electron/services/conversation-store.ts`, `electron/services/conversation-store.test.ts` (extend) or `electron/services/conversation-store.sanitize.test.ts` (new), `src/lib/types.ts` | both tsc · `electron-vite build` · `npx vitest run conversation-store` ✓ · `npx vitest run` total green at or above pre-HX4 baseline + 3 new HX3 tests + new HX4 tests · launch app + run a turn that historically emitted `<bash>` (user-verification-needed: bash-as-prose regression confirms clean bubble in UI) | [x] |
| HX5 | **DEVLOG + README + version bump + ship arc** | (a) Write the phase-completion summary in `DEVLOG.md` listing HX1-HX4 with commit SHAs + final vitest count + the canonical "this fixes the duplicate-app and bash-as-prose ghost-reply user-reported symptoms" framing. (b) Bump `package.json` from `0.8.3` → `0.8.4`. (c) Update `CLAUDE.md` "Current State" with a Robustness Hotfix bullet (single line, mirror the v0.8.2 / v0.8.3 hotfix format). (d) Update `memory/MEMORY.md` build-status entry + `memory/project_build_status.md` with the same hotfix. (e) **README per `feedback_readme_is_part_of_ship`**: update the download heading to v0.8.4, swap the four artifact URLs in the download table, write a "New in v0.8.4" paragraph covering both fixes, update the Quick start `git clone` reference if version-tagged, bump the Roadmap top entry. (f) Final verify gate: both tsc · `npx electron-vite build` · `npx vitest run` (full suite green) · `npm run lint` (0 errors). (g) Local Windows build: `npm run build:win`. Confirm `.exe` + `.zip` + `.blockmap` + `latest.yml` produced in the worktree's `dist/`. (h) Move all four artifacts into the **primary repo's** `dist/` per `feedback_release_artifacts_in_primary_dist`. (i) Commit the version-bump + DEVLOG + README + CLAUDE.md + memory updates as the HX5 commit. (j) Fast-forward merge `claude/cool-wescoff-726885` → `main`; `git push origin main`. (k) `git tag v0.8.4 -m '...'`; `git push origin v0.8.4` (tag pushes work this session per CLAUDE.md). (l) `gh release create v0.8.4 --notes-file <inline>` with the four `.exe`/`.zip`/`.blockmap`/`latest.yml` attached. (m) **CDN evergreen** per `feedback_cdn_evergreen_artifacts`: copy `Lamprey-0.8.4.exe` → `Lamprey-x64.exe` + `Lamprey-0.8.4.zip` → `Lamprey-x64.zip`, overwrite-upload to the Cloudflare R2 bucket fronting `cdn.islandmountain.io`. (n) Final phase-completion DEVLOG entry with all SHAs + GitHub release URL + CDN evergreen URLs. | `DEVLOG.md`, `package.json`, `CLAUDE.md`, `README.md`, `memory/MEMORY.md`, `memory/project_build_status.md`, `dist/` (artifacts) | both tsc · `electron-vite build` · `npx vitest run` (full suite) ✓ · `npm run lint` 0 errors · `npm run build:win` produces all 4 artifacts · primary `dist/` contains the 4 artifacts · `git log --oneline main` shows the 5 HX commits · tag `v0.8.4` pushed · GitHub release `v0.8.4` exists with 4 artifacts attached · CDN `Lamprey-x64.exe` + `Lamprey-x64.zip` reflect v0.8.4 (HEAD check) · `git status` clean | [x] |

---

## 4. Risks + Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| HX1's lock blocks legitimate "open with file" flows (passing argv to existing window) | low | The `second-instance` handler receives `argv`; we don't currently handle file-open argv, but the handler signature is forward-compatible. Future file-open work can extend this handler without touching the lock. |
| HX2's `PSEUDO_TAG_GUARD` extraction subtly changes the reviewer prompt body | medium | Invariant #2 + the HX2 verify gate requires a **golden snapshot** of the pre-HX2 reviewer prompt; the extraction must reassemble byte-for-byte. If the snapshot diverges, halt and fix. |
| Pseudo-tag guard makes outputs over-formal / over-fenced for short replies | low | The guard only forbids `<TAG>` pseudo-XML; it does not require fences for everything. Inline backtick code stays valid. |
| HX3's `ALTER TABLE` runs more than once on subsequent launches | mitigated | The `PRAGMA table_info` check makes it idempotent. The migration is a no-op on already-migrated DBs. |
| HX4's sanitizer rewrites a real user-pasted code block that legitimately contains `<bash>` text | low | Tests cover the inside-fence skip case explicitly. Pre-existing fenced blocks (` ``` … ``` `) are skipped. A user pasting `<bash>` outside a fence is rare and the rewrite is non-destructive (text → fenced text, no semantic loss). The `content_raw` column preserves the verbatim original for any user who needs to recover it. |
| `npm run build:win` fails in the worktree | low | The build has shipped from this Windows session on v0.8.2 and v0.8.3 in the last 24 hours. If it fails, halt at HX5 step (g) and report; do **not** push without artifacts. |
| Tag push or `gh release create` fails | low | CLAUDE.md confirms both work from this session (v0.8.2 / v0.8.3 verified). If a CDN evergreen upload step fails (rate limit / auth), retry once then flag — the GitHub release artifacts are the canonical source. |

---

## 5. What this hotfix explicitly does NOT do

- Does **not** retroactively sanitize historical message rows.
- Does **not** expose `content_raw` in any UI surface (chat bubble, reasoning-trace viewer, export).
- Does **not** modify R7's per-bubble reasoning pill, R8's API stack rehydration toggle, RT5/RT6/RT7's Reasoning-Trace Viewer + export.
- Does **not** retire or modify RT1's reviewer guard (it's preserved + generalized).
- Does **not** add a Settings tab, new IPC channel, or new tool.
- Does **not** change provider routing, MCP transport, agent pipeline orchestration, or theme tokens.
- Does **not** touch the Snip / Customize / Panels / Skill Import surfaces.

---

## 6. Acceptance — hotfix done when

1. All 5 prompts are `[x]` in this document.
2. `DEVLOG.md` has an entry per prompt + a final phase-completion entry.
3. `git log --oneline main` shows 5 commits attributable to this hotfix.
4. `package.json` reads `"version": "0.8.4"`.
5. Primary repo's `dist/` contains `Lamprey-0.8.4.exe`, `Lamprey-0.8.4.exe.blockmap`, `Lamprey-0.8.4.zip`, `latest.yml`.
6. `npx vitest run` is fully green with at least 2 new test files (HX3 `sanitize-pseudo-tags.test.ts` + HX4 sanitize coverage on `conversation-store`).
7. `feat/robustness-hotfix` (working branch `claude/cool-wescoff-726885`) is merged + pushed to `main`.
8. Tag `v0.8.4` pushed; GitHub release `v0.8.4` exists with the 4 artifacts attached.
9. `cdn.islandmountain.io/Lamprey-x64.exe` + `Lamprey-x64.zip` reflect the v0.8.4 binaries.
10. README.md on the GitHub repo landing page shows v0.8.4 download links + "New in" paragraph.

---

## 7. Stop conditions

Halt and report (do not retry indefinitely) if:

- HX1 lock change breaks normal app launch (cold-start fails to show a window).
- HX2 reviewer-body snapshot diverges and can't be reconciled.
- HX3 migration test fails on an existing-db snapshot.
- HX4 sanitizer breaks a vitest snapshot for an existing test (not just the new ones).
- `npm run build:win` fails after one retry.
- Tag push or `gh release create` returns a non-recoverable error after one retry.

Otherwise, no mid-loop permission asks. STS authorization stands.
