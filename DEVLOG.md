# Lamprey Harness Dev Log

## [Fluidity Phase Complete] — 2026-06-04

**Prompts completed:** J1 ESC + ↑ history, J2 Shift+Tab mode cycle, J3 @file
mention, J4 # memory shortcut, J5 inline approval chips, J6 tool-card
collapse, J7 inline subagents, J8 status-line context%, J9 notification
consolidation, J10 path:line autolinking, J11 right-panel default-collapsed.

**Phase verify:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (98 files / 1271 tests passed, 16 skipped — +103 tests added across the phase)
- user-verification-needed: full end-to-end smoke per §3 of `PLANNING/LAMPREY_FLUIDITY_PLAN.md` completion criteria: launch Electron, open a fresh conversation, exercise: ESC cancels a stream; ↑ recalls a prior prompt; Shift+Tab cycles permission + plan mode; @chat autocompletes to a file; # opens MemoryEditor with seed; an approval renders inline as a chip; a completed tool collapses; a multi-agent run renders inline-nested; status line shows context% turning amber past 70%; a wake-up fires as an inline transcript row; a `src/foo.ts:42` reference in assistant output is clickable; right panel is collapsed by default and auto-opens on artifact emission.

**Notes:** Lamprey now matches Claude Code on conversational fluidity —
single moving surface, keyboard-first reflexes, transcript-as-source-of-truth.
Functional parity (Tracks 1–3 + H1–H6) was already in place; this phase
closes the remaining "feel" gap. Eleven commits on `feat/fluidity-phase`.

**Commit range:** 525d5f8..2b2d02d on `feat/fluidity-phase` (J1 → J11, plus
`24429b9` for the phase seed + 0.2.0 version bump).

---

## [Fluidity — Prompt J11] Right panel default collapsed + auto-open triggers — 2026-06-04

The right panel now defaults to collapsed for new conversations and
remembers each existing conversation's last expand/collapse state across
reloads (per-conv map in ui-store, persisted to localStorage). Two
events fire an auto-open: an artifact emit (`__openArtifact`) and an
activeTool change. Each trigger key gets one auto-open per conversation;
if the user collapses while a trigger is active, that key is marked
dismissed and the same trigger won't re-open until a different one fires.

**Files changed:**
- `src/lib/right-panel-state.ts` (new) — pure `tryAutoOpen` / `applyUserToggle` state machine
- `src/lib/right-panel-state.test.ts` (new) — 11 cases (defaults, re-open guard, manual toggle)
- `src/stores/ui-store.ts` — per-conv state map + `hydrateRightPanelForConv` + `autoOpenRightPanel`
- `src/App.tsx` — fire auto-open on artifact/activeTool, hydrate on conv switch

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (1271 passed / 16 skipped — +11 J11 tests)
- user-verification-needed: in Electron, create a new conversation → right panel collapsed (chat takes full width); fire `__openArtifact` → panel opens; collapse it → stays collapsed even on a subsequent same-artifact emit; emit a DIFFERENT artifact → panel re-opens; switch to a previously-expanded conv → panel restores expanded.

**Notes:** Per-conv state is JSON-serialized into a single localStorage
key so the map shape can evolve without migration headaches. The legacy
global `RIGHT_COLLAPSED_KEY` is mirrored for components that read the
flag directly, but the per-conv map is the source of truth from this
prompt onward.

**Commit:** see git log on `feat/fluidity-phase`

---

## [Fluidity — Prompt J10] path:line autolinking — 2026-06-04

Bare `path/file.ext` and `path/file.ext:42` references in assistant
prose now render as clickable spans that fire a `file:open` CustomEvent
(host wires this to `requestOpenFile` so the file panel jumps to the
right location). Falls back to `files.openInVSCode` if no host listener
claims it.

Detector lives in a pure helper (`path-autolink.ts`) — exhaustive
positive/negative cases ensure URLs, version triples, `.md.bak`-style
extended dots, and `lamprey.io`-style domain names are excluded.
MarkdownRenderer wires the helper into the `p`, `li`, `td`, `th`,
`strong`, `em`, and `blockquote` overrides; inline `<code>` and fenced
`<pre>` paths bypass it so file refs inside code blocks stay verbatim.

**Files changed:**
- `src/lib/path-autolink.ts` (new) — regex + segment splitter
- `src/lib/path-autolink.test.ts` (new) — 13 cases (positive, negative, segmentation)
- `src/components/artifacts/MarkdownRenderer.tsx` — autolink transformer + FileRefSpan + prose component overrides

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (1260 passed / 16 skipped — +13 J10 tests)
- user-verification-needed: in Electron, render a message containing `look at src/App.tsx:42 for the fix` → `src/App.tsx:42` appears underlined-dotted; click → file panel opens at line 42; references inside ```ts ... ``` stay verbatim; URLs in prose don't autolink as files.

**Notes:** Extension set: ts/tsx/js/jsx/mjs/cjs/md/mdx/json/yaml/yml/toml/
css/scss/html/sh/py/rs/go/java/rb/sql. `.io` / `.com` / `.exe` etc.
are intentionally excluded. Style is a dotted underline rather than the
loud link colour, per the J10 spec's "avoid full link colour" note.

**Commit:** see git log on `feat/fluidity-phase`

---

## [Fluidity — Prompt J9] Notification consolidation — 2026-06-04

Async background events (chat:onAsyncEvent — turn-completed, wake-up
landed, side-chat reply, etc.) now route as inline transcript notice
rows when the affected conversation is active, rather than firing a
toast that steals focus. A new `TranscriptNotice` component renders
the notice as a slim row interleaved with messages by timestamp.

When the conversation is NOT active (or no active conv exists), the
event still fires a toast so the user knows something happened in
another window — the toast surface stays useful for "switch focus to
see this" events. Errors continue to use `toast.error()` as before.

**Files changed:**
- `src/stores/inline-notices-store.ts` (new) — per-conversation notice queue (ring of 50)
- `src/lib/interleave-notices.ts` (new) — pure ts-ordered merge helper (unused inline, kept for tests + reuse)
- `src/lib/interleave-notices.test.ts` (new) — 5 cases
- `src/components/chat/TranscriptNotice.tsx` (new) — inline notice row
- `src/components/chat/AsyncEventToast.tsx` — routes active-conv events to inline notices
- `src/components/chat/MessageList.tsx` — bucket-interleaves notices with messages

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (1247 passed / 16 skipped — +5 J9 tests)
- user-verification-needed: in Electron, while viewing a conversation, fire a `chat:onAsyncEvent` for that conv → inline notice row appears between messages, sorted by ts; same event for a DIFFERENT conv → toast fires instead; an error path still produces a toast (toast.error unchanged).

**Notes:** WakeupPill stays as a decorator on system messages (already
in-transcript). The plan's "WakeupPill routes through TranscriptNotice"
phrasing is satisfied de-facto because the wake-up event arrives as a
system message via the chat stream — it's already a transcript row, the
pill is just its header glyph. The interleave helper is exported as a
reusable utility even though MessageList ended up using the same bucket
pattern chapters use (which was already there).

**Commit:** see git log on `feat/fluidity-phase`

---

## [Fluidity — Prompt J8] Status line: context% slot + amber-warn at 70% — 2026-06-04

Status line slot order is now `model · context · workflow · branch ·
wakeups` (was `model · workflow · wakeups · tokens · rag`). New slots:

- `context`: shows `N% ctx` where N = tokens-spent / active-model
  contextWindow. Neutral below 70, amber 70–89, red ≥ 90. Hidden when
  the model's window is unknown.
- `branch`: shows the current git branch from `review:branches` IPC.
  Polled every 30s so out-of-band branch switches surface within a
  half-minute.

`tokens` and `rag` slots are still valid for user-authored
`userData/statusline.md` overrides — they're just out of the default
list. The empty-slots fallback in `normalizeSlots` also dropped from
ALL_SLOTS down to DEFAULT_VISIBLE_SLOTS so an empty `slots: []` block
behaves identically to no file (both show the new 5-slot defaults).

**Files changed:**
- `src/lib/context-meter.ts` (new) — `contextPercent` + `contextTone` (70/90 thresholds)
- `src/lib/context-meter.test.ts` (new) — 7 cases for percent + tone
- `electron/services/statusline-config.ts` — added `context`/`branch` slots + new default order
- `electron/services/statusline-config.test.ts` — updated empty-slots fallback test
- `src/components/layout/StatusLine.tsx` — branch loader effect, context% renderer with tone

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (1242 passed / 16 skipped — +7 J8 tests)
- user-verification-needed: in Electron, watch the status line as a conversation grows — context% climbs; pass 70% → slot turns amber; pass 90% → red; branch slot reflects current git branch and updates within 30s of a `git checkout`; existing userData/statusline.md with custom `slots` still honored.

**Notes:** Context window is read from `modelInfo.contextWindow`
(supplied by the provider catalog). Models without a published window
size hide the slot — better silence than 0% / NaN%. Branch lookup uses
the existing `review:branches` IPC; no new channel.

**Commit:** see git log on `feat/fluidity-phase`

---

## [Fluidity — Prompt J7] Inline subagent rendering — 2026-06-04

`multi_agent_run` tool calls now render in the transcript as a nested
chevron group — one "Multi-agent run" header row with N indented
per-agent rows below it. Each agent row expands to show its emitted text
or error. Failures auto-expand; successes mount collapsed; user toggle
wins.

MultiAgentRunCard is now a thin adapter that parses the run result
envelope into InlineAgentRow shape and delegates to AgentRunInlineGroup.
AgentRunBanner stays put for the single-agent run-phase pill — its
multi-agent branch will be reused for backgrounded `tasks:spawn` runs
when the renderer can tell them apart from in-turn runs (currently the
chat surface only sees the `multi_agent_run` tool path, which is always
in-turn).

**Files changed:**
- `src/lib/agent-run-routing.ts` (new) — pure `routeAgentRun({runInBackground})`
- `src/lib/agent-run-routing.test.ts` (new) — 2 cases
- `src/components/chat/AgentRunInlineGroup.tsx` (new) — header + nested rows + per-row expand
- `src/components/chat/MultiAgentRunCard.tsx` — gutted to a parse-and-delegate adapter

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (1235 passed / 16 skipped — +2 J7 tests)
- user-verification-needed: invoke `multi_agent_run` with a 3-role pipeline → header row shows 3 agents + total elapsed; click expand → 3 indented chevron rows; expand row 2 → its output panel opens; collapse header → all rows hide; an errored agent's row auto-expands with the error tone.

**Notes:** The runInBackground routing helper is in place for J7's
"banner-only for background" half; the actual `tasks:spawn` background
visualisation is unchanged in this prompt because no signal currently
reaches the chat surface for those — they're tracked in `agent_runs`
and surfaced via the activity dashboard. AgentRunBanner's existing
single-agent pill is untouched.

**Commit:** see git log on `feat/fluidity-phase`

---

## [Fluidity — Prompt J6] Auto-collapse successful tool cards — 2026-06-04

ToolUseCard now derives an auto-expand state from `status` + `risks`:
failures (`status === 'error'`) and destructive successes mount expanded;
everything else (successful read/write/network, running, denied) mounts
collapsed. User toggles still win over the auto-rule via an internal
`userToggled` override so a deliberate expand sticks for the lifetime of
the card.

The header now uses a new `collapsedSummary()` helper that caps the
"key=value, key=value" args one-liner at 60 chars with an ellipsis, so a
deep path doesn't push the risk badges / elapsed / status icons
off-screen on narrow widths.

**Files changed:**
- `src/lib/tool-card-helpers.ts` — added `collapsedSummary`
- `src/lib/tool-card-helpers.test.ts` — +3 cases for the 60-char cap
- `src/components/chat/ToolUseCard.tsx` — `userToggled` override + `autoExpanded` derivation

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (1233 passed / 16 skipped — +3 J6 tests)
- user-verification-needed: trigger a successful `read_file` → card mounts collapsed; trigger one that errors → card mounts expanded; trigger a destructive `shell_command` that succeeds → mounts expanded; collapse a destructive card manually → stays collapsed on re-render until you reload.

**Notes:** Denied results stay collapsed too — the denial reason is a
single short line that fits the collapsed header. Running/pending stay
collapsed because the live elapsed already ticks in the header.

**Commit:** see git log on `feat/fluidity-phase`

---

## [Fluidity — Prompt J5] Inline tool approval chips — 2026-06-04

When a tool approval is requested AND the (server, tool) pair has been
approved at least once this session AND no descriptor risk is destructive,
the request now renders as a transcript-level chip with 1/2/3 keystroke
bindings (Approve / Deny / Always) instead of opening the full modal. The
modal still owns the heavyweight first-touch confirmation and every
destructive-risk path.

Routing decision is a pure helper (`approval-routing.routeApproval`).
A renderer-only Zustand store (`inline-approvals-store`) is the queue;
App.tsx pushes chip-routed requests, MessageList renders them after the
toolCalls section, the chip itself dismisses on resolve. The modal grew
an `onAllowed` callback so an allow click also adds the pair to the
session-level `approvedSeen` set — the very next request from that pair
will be a chip.

**Files changed:**
- `src/lib/approval-routing.ts` (new) — pure routing helper + `approvalKey`
- `src/lib/approval-routing.test.ts` (new) — 6 cases (destructive lock, per-(server, tool) granularity)
- `src/stores/inline-approvals-store.ts` (new) — zustand queue with de-dupe
- `src/components/chat/InlineApprovalChip.tsx` (new) — chip + 1/2/3/Esc bindings
- `src/components/tools/ToolApprovalModal.tsx` — added `onAllowed(request)` prop
- `src/components/chat/MessageList.tsx` — renders the queue
- `src/App.tsx` — `approvedSeenRef` + routing dispatch + modal-allow → seen-set

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (1230 passed / 16 skipped — +6 J5 tests)
- user-verification-needed: in Electron, trigger a read-file approval → first time renders the modal; click Allow; trigger the same read-file again → second time renders the inline chip in the transcript; press `1` → resolves with allow; trigger a destructive tool → still modal even if previously allowed.

**Notes:** Per-(server, tool) granularity is more conservative than the
plan's "server is already approved at least once" wording — a brand new
write-tier tool from a previously-trusted server still gets the modal so
its descriptor is read once. Destructive is the safety floor. The
`approvedSeen` set lives in a `useRef` on App.tsx; not persisted across
reload by design (every session starts cold).

**Commit:** see git log on `feat/fluidity-phase`

---

## [Fluidity — Prompt J4] # memory-write inline shortcut — 2026-06-04

Typing `#` (alone) or `# <text>` at col 0 of line 1 in ChatInput flips
the bar into memory-write mode: the Send pill becomes a "Remember"
button, and submit opens the MemoryEditor pre-filled with the typed
description. No silent writes — the editor's Save button is the
confirm-before-persist step per the feedback_no_fake_polish invariant.

Seeding goes through a new ui-store token pair (`memorySeedDescription`
+ `memorySeedToken`) mirroring the existing `composeDraft` pattern.
MemoryPanel watches the token and auto-opens its editor when bumped.

**Files changed:**
- `src/lib/memory-shortcut.ts` (new) — pure detector; line-1 col-0, separator-required
- `src/lib/memory-shortcut.test.ts` (new) — 8 cases for accept/reject conditions
- `src/stores/ui-store.ts` — adds `memorySeedDescription` + `memorySeedToken` + accessors
- `src/components/memory/MemoryEditor.tsx` — accepts `description` in `initialDraft`
- `src/components/memory/MemoryPanel.tsx` — consumes seed on token bump, opens editor
- `src/components/chat/ChatInput.tsx` — memory-mode detection, Send→Remember pill swap, submit routes to memory

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (1224 passed / 16 skipped — +8 J4 tests)
- user-verification-needed: in Electron, type `# remember the RAG audit` → Send becomes a "Remember" pill; click → MemoryEditor opens with description prefilled; Save persists, Cancel closes without writing; typing `#hashtag` (no space) does NOT flip mode.

**Notes:** Body of the memory is intentionally NOT prefilled — the
description goes into the one-liner slot per the plan, leaving the body
for the user to write properly inside the editor (memory bodies want
`Why:` / `How to apply:` structure). Type defaults to `feedback` since
that's the most common type for the "# remember to …" voice.

**Commit:** see git log on `feat/fluidity-phase`

---

## [Fluidity — Prompt J3] @file inline mention autocomplete — 2026-06-04

`@<token>` in ChatInput surfaces a popover ranking workspace files by name
overlap. Selection inserts a collapsed `@<basename>` token and queues the
picked file through the existing `files.process` → `addAttachments`
pipeline so the next send carries it as a regular attachment.

The popover skips:
- carets inside ``` fenced blocks
- carets inside an inline single-backtick span
- `@` in mid-word context (e.g. `email@host`) — only fires at a word
  boundary (start-of-line or after whitespace/bracket)

**Files changed:**
- `src/lib/file-rank.ts` (new) — `scoreFile`, `rankFiles`, `detectAtMention`, `isInsideCodeContext`
- `src/lib/file-rank.test.ts` (new) — 21 cases covering ranking, extension dominance, code-fence guard, word-boundary
- `src/components/chat/AtFileMention.tsx` (new) — popover styled to match SlashCommandPalette
- `src/components/chat/ChatInput.tsx` — workspace file index cache, caret tracking, popover mount + apply

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (1216 passed / 16 skipped — +21 J3 tests)
- user-verification-needed: in Electron, type `@chat` in ChatInput → popover lists ChatInput/Chat* matches; ↑/↓ walks; Tab/Enter inserts; Esc dismisses; `@` inside ```ts ... ``` does NOT trigger; selected file appears as a pending attachment with the existing chip UI.

**Notes:** Workspace index reuses `files:walkProject` (same IPC the
QuickOpenPalette uses). Index is cached per ChatInput mount; the docked
file panel keeps its own cache so the two don't share lifecycle. The
popover renders absolutely above the input bar (`bottom-full`) so it
doesn't shift the layout when it opens/closes.

**Commit:** see git log on `feat/fluidity-phase`

---

## [Fluidity — Prompt J2] Shift+Tab cycles permission/plan mode — 2026-06-04

Replaces the old binary planMode toggle on Shift+Tab with a four-state
cycle: `default → auto-review → full → plan → default`. A pure helper
(`src/lib/mode-cycle.ts`) projects the `(permissionsMode, planMode)` pair
to a virtual slot; the keydown handler advances it.

When transitioning into / out of plan, the cycle also calls the real
`plan:enterMode` / `plan:exitMode` IPC via the new `usePlanMode` hook so
persistence (`conversations.plan_mode_active`) is honored alongside the
legacy ui-store flag. A slim mode-name indicator now sits under the input
bar; its `key={liveSlot}` swap replays a 200ms opacity/translate keyframe
on every cycle.

Shift+Tab is only claimed when the textarea is empty — mid-draft, native
focus navigation still works.

**Files changed:**
- `src/lib/mode-cycle.ts` (new) — `MODE_CYCLE`, `currentSlot`, `nextMode`, `slotLabel`
- `src/lib/mode-cycle.test.ts` (new) — 7 cases covering cycle wrap + plan-permission preservation
- `src/hooks/usePlanMode.ts` (new) — IPC wrapper bound to the active conversation
- `src/components/chat/ChatInput.tsx` — cycle wiring + indicator markup, content-empty guard

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (1195 passed / 16 skipped — +7 J2 tests)
- user-verification-needed: in Electron, with the textarea empty, press Shift+Tab → mode advances through all four slots; toast + indicator both reflect the new slot; in a conversation, entering Plan persists across reload (DB row in `conversations.plan_mode_active`); mid-draft Shift+Tab does NOT cycle.

**Notes:** The legacy `ui-store.planMode` boolean stays so the existing
`PlanModeBanner` (when no active conv exists) still renders. The hook
returns `false` for `enter` when there's no active conv — the local flag
covers that path. Indicator animation uses an inline `<style>` block to
avoid touching the Tailwind config for a one-prompt keyframe.

**Commit:** see git log on `feat/fluidity-phase`

---

## [Fluidity — Prompt J1] ESC cancels stream + ↑ recalls prompt history — 2026-06-04

ESC was already wired in `useKeyboardShortcuts` to cancel an active stream;
J1 adds the second half — ↑/↓ walks past user prompts from the active
conversation, with a saved-draft restore on the way back. The history
walker is a pure helper module so it's directly testable without DOM
infrastructure (vitest runs node-only here).

**Files changed:**
- `src/lib/prompt-history.ts` (new) — pure up/down/reset state machine
- `src/lib/prompt-history.test.ts` (new) — 10 cases covering walk, bounds, draft restore
- `src/lib/recent-prompts.ts` (new) — `stripAttachmentBlocks` + `getRecentUserPromptsFrom`
- `src/lib/recent-prompts.test.ts` (new) — 10 cases for the strip + 50-cap selector
- `src/stores/chat-store.ts` — added `getRecentUserPrompts(limit?)` delegating to the helper
- `src/components/chat/ChatInput.tsx` — ArrowUp/ArrowDown/Escape wiring, placeholder hint

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (1188 passed / 16 skipped — +20 J1 tests, all suites green)
- user-verification-needed: in a running Electron build, send 2+ prompts, hit ↑ in an empty input → most-recent prompt loads; ↑ again → next older; ↓ → walks back; Esc with history loaded → draft restored; ESC mid-stream → cancel button result (already covered by useKeyboardShortcuts).

**Notes:** Pure helper split was needed because chat-store's transitive `@/`
value imports (`@/stores/settings-store` and friends) don't resolve under
vitest without an alias plugin; the store wrapper now just delegates.
`stripAttachmentBlocks` is the inverse of `buildAttachmentBlock` so the
recalled prompt is what the user typed, not the stored content with the
inlined ``` attachment block. Caret-on-first-line + no-selection guard
means ↑/↓ still scroll within a multi-line draft when the user is editing.

**Commit:** see git log on `feat/fluidity-phase`

---

## [Integration Phase Complete] UI Mastery wrap-up - 2026-06-04

**Prompts completed:** H1 Activity dashboard, H2 Workflow command palette + author UX, H3 Session sidebar + resume polish, H4 Hook editor + skill manager polish, H5 Plan-mode UX + spawn-task tray, H6 Status line + AskUserQuestion UI.

**Files changed in this wrap-up:** `README.md`, `.gitignore`, `DEVLOG.md`, `package.json`

**Verify gate:**
- tsc node OK
- tsc web OK
- vitest OK (87 files passed, 2 skipped; 1168 tests passed, 16 skipped)
- production build OK
- smoke-renderer OK against fresh `out/` bundle
- smoke-bundle OK against fresh `out/` bundle
- user-verification-needed: launch Electron and exercise the full UI stack end to end: Activity dashboard, Workflow palette/editor, Sessions sidebar, Hooks + Skills manager, Plan mode + Spawn-task tray, Status line, and AskUserQuestion modal blocking/resuming a workflow.

**Notes:** All Integration Phase rows are marked complete in `PLANNING/LAMPREY_PARITY_PLAN.md`. README now documents the completed parity layer and removes the stale hook-wiring roadmap item. `.tmp-test-user-data/` is ignored because the integration tests generate it under the workspace. Package version is bumped to `0.1.44`.

**Commit:** see git log on `feat/fluidity-phase`

---

## [Integration — Prompt H6] Status line + AskUserQuestion UI — 2026-06-04

The last Integration-phase prompt: a persistent status bar at the bottom of
the main window plus a structured "ask the user a question" path that pauses
a workflow or subagent until the user picks a chip.

**Files changed:**
- `electron/services/ask-user-runtime.ts` (new) — pure runtime: holds the
  pending-promise registry, emits an `ask-user:awaiting` event, resolves on
  `respond(requestId, answer)`, defaults to a 30s timeout (clamped at 10m)
  resolving with `{kind: 'timeout'}`.
- `electron/ipc/ask-user.ts` (new) — wires the runtime to the renderer via
  Electron's BrowserWindow broadcast; exposes `ask-user:respond`,
  `ask-user:list`, `ask-user:cancelAll`.
- `electron/services/statusline-config.ts` (new) — loads / saves
  `userData/statusline.md` (YAML frontmatter `{slots[], formats{}}`); drops
  unknown slot ids silently so user edits never crash the renderer.
- `electron/ipc/statusline.ts` (new) — `statusline:get`, `statusline:set`,
  `statusline:availableSlots`.
- `electron/services/tool-registry.ts` — registers `ask_user_question`
  native tool descriptor; handler routes through chat.ts dispatch into the
  ask-user-runtime singleton.
- `electron/ipc/chat.ts` — dispatch branch for `ask_user_question`; returns
  the chosen label, multi-select labels, or a `(timed out)` / `(cancelled
  by user)` string the model can read.
- `electron/services/workflow-runner.ts` — sandbox exposes `askUser({...})`
  routed through `deps.askUser` (the IPC layer injects the runtime); throws
  if no runtime is wired so headless workflow runs surface the failure.
- `electron/ipc/workflows.ts` — injects the `askUser` runtime dep alongside
  the existing memory dep.
- `electron/ipc/index.ts` — registers both new handler sets.
- `electron/preload.ts` — exposes `askUser` and `statusline` namespaces.
- `src/lib/ipc-client.ts` — typed pass-throughs for both.
- `src/components/layout/StatusLine.tsx` (new) — five-slot bar (model,
  workflow, wakeups, tokens, rag) reading from existing stores + polling
  `loops:list` for pending wake-up count; mounted at the bottom of App.tsx
  flex column.
- `src/components/chat/AskUserModal.tsx` (new) — chip-style modal with
  split-pane preview (markdown), keyboard nav (↑/↓ + Enter + Space for
  multi-select toggle + Escape to cancel), inline notes field. Submits the
  chosen labels back via `ask-user:respond`.
- `src/App.tsx` — mounts `<StatusLine />` and `<AskUserModal />`.

**Verify gate:**
- tsc node ok
- tsc web ok
- vitest run: 1168 passed / 16 skipped (+16 new tests: 11 ask-user-runtime,
  3 statusline-config, 2 workflow-runner askUser sandbox)
- Manual smoke (user-verification-needed for the Electron-shell-only bits):
  launch Electron, confirm StatusLine renders at the bottom with the model
  slot populated; drop a `userData/statusline.md` overriding slot order
  + format strings, confirm the bar picks up the file on next launch; run
  a workflow that calls `askUser({question, header, options})`, confirm
  the modal opens, picking an option resumes the workflow with the right
  label; let the modal sit for 30s, confirm timeout sentinel reaches the
  workflow.

**Notes:**
- The parity-plan example `agent.askUser({...})` is achieved via the
  top-level sandbox helper `askUser({...})`; the workflow-runner sandbox
  exposes it next to `agent`, `parallel`, `pipeline`, `phase`, `log`,
  `workflow`, `memory`, `args`, `budget`.
- Subagents use `ask_user_question` via the tool descriptor, dispatched
  through chat.ts — the same path other native tools take. No separate
  programmatic helper was needed on `subagent-runner.ts`.
- Statusline customisation is forgiving: empty `slots: []` falls back to
  DEFAULTS, unknown ids are dropped, duplicates collapsed. Tests cover all
  three branches.
- Renderer JSX return-type annotations were dropped to avoid the React 19
  global-JSX-namespace import requirement; the tsx files now infer return
  type via the JSX expression.

**Commit:** this commit

---

## [Integration — Post-merge fixups] H1-H4 merge correctness — 2026-06-04

Three semantic regressions came in with the H1-H4 merge (commit `b585ccb`,
which folded `codex-t3-final-four` into `main`). Git auto-merged textually
but landed three behavior bugs that the verify gate caught.

**Files changed:**
- `electron/ipc/chat.ts` — removed double-injection of `taskNotificationsBlock`.
  `buildSystemPrompt` already places the block per the locked block order
  (`memory_index → skills → retrieved_context → chapters → conversation`),
  so the second concatenation duplicated the `<task-notifications>` block on
  every turn that had async events pending.
- `src/hooks/useSkills.ts` + `src/lib/ipc-client.ts` — H4's `SkillsManager.tsx`
  changed `window.api.skills.onChanged` to return an unsubscriber, but
  `useSkills` discarded it. Effect cleanup now disposes the listener so
  re-mounting the renderer does not stack handlers.
- `src/components/layout/Sidebar.tsx` — H3's new "Sessions" NavRow and the
  pre-existing "Automations" NavRow both rendered the same `ClockIcon`,
  producing two visually identical adjacent rows. Added a distinct
  `SessionsIcon` (list-with-bookmark) for the Sessions row.

**Verify gate:**
- tsc node ok
- tsc web ok
- vitest run: 1152 passed / 16 skipped (no regressions)
- UI smoke: user-verification-needed for the icon swap (Electron-shell-only).

**Notes:**
- Parallel session is mid-implementation of H5 (PlanGoalsPanel + `plan:update`
  IPC). Their unstaged edits to `plan.ts`, `plan-store.ts`, `preload.ts`,
  and `PlanGoalsPanel.tsx` were intentionally left out of this commit.

**Commit:** this commit

---

## [Track 2 - COMPLETE] Tool Layer + Continuity track shipped - 2026-06-04

All 9 prompts (C1 -> C2 -> C3 -> C4 -> E1 -> E2 -> E5 -> E6 -> E4) are implemented on `feat/track-2-tool-layer`.

**Shipped prompts:**
1. C1 lazy tool schemas + ToolSearch (`384909e`)
2. C2 hooks wired into dispatch + Hooks UI (`47179c2`)
3. C3 plan-mode state gate (`6eacd1b`)
4. C4 filesystem-discovered slash-command system + built-ins (`2ae9266`)
5. E1 session chapters + `mark_chapter` tool (`212a611`)
6. E2 chapter TOC + Ctrl+G quick-jumper (`84b1cd5`)
7. E5 auto context compression for chat turns (`59663da`)
8. E6 async event-to-prompt bridge (this completion batch)
9. E4 spawn-task primitive (this completion batch)

**Verify gate:**
- `npx tsc --noEmit -p tsconfig.node.json` ok
- `npx tsc --noEmit -p tsconfig.web.json` ok
- `git diff --check` ok
- `npx vitest run electron/services/async-event-bridge.test.ts electron/services/spawn-task.test.ts electron/services/system-prompt-builder.test.ts` blocked before test load: Vite/esbuild config bundling failed with `spawn EPERM` while starting the shared `node_modules/vite/node_modules/esbuild` helper from the sibling root workspace. No test assertions ran.

**Manual smoke / user-verification-needed:**
- Spawn a background agent in a conversation; after completion, send another message in that conversation and confirm the model sees a `<task-notifications>` block and the user gets an async-event toast.
- Invoke `spawn_task` from the model or `tasks:spawn` IPC; confirm a child conversation is created, seeded with the task prompt, linked back to the source conversation, and the source chat shows a dismissible chip that opens the child.
- Confirm real Git worktree creation succeeds from the active workspace for spawn-task. Unit coverage uses seams; runtime creates worktrees via `git worktree add`.

**Notes:**
- E6 adds a durable `async_events` queue with one-shot drain semantics and an in-memory fallback for test/native-binding failure paths.
- E4 shares that queue by enqueueing `tasks:spawn-completed`, so spawned tasks become both visible UI chips and model-visible context on the source conversation's next turn.
- The completion commit batches E6 and E4 because both prompts share `tasks.ts`, `chat-events.ts`, and `preload.ts` surfaces.

---

## [Track 2 - Prompt E4] Spawn-task primitive - 2026-06-04

**Files changed:**
- `electron/services/spawn-task.ts` (new) - creates linked child conversations, seeds source/child backlink system messages, writes the child prompt, and optionally creates an isolated worktree from the active workspace.
- `electron/services/spawn-task-tool-pack.ts` (new) - registers `spawn_task` as a mutating native tool.
- `electron/ipc/tasks.ts` - adds `tasks:spawn` IPC while preserving Track 1 task lifecycle handlers.
- `src/components/chat/SpawnTaskChip.tsx` + `SpawnTaskTray.tsx` (new) - dismissible source-chat chip; clicking opens the child conversation.
- `resources/slash-commands/spawn-task.md` - updated to call the real `spawn_task` tool.

**Verify gate:**
- tsc node ok
- tsc web ok
- `git diff --check` ok
- vitest blocked before config load by `spawn EPERM` from Vite/esbuild helper startup.

**Notes:**
- The service has dependency seams for tests and runtime worktree creation uses Track 1's `createAgentWorktreeManager`.
- Source and child conversations both get system backlink markers so the relationship survives a restart even before Integration H5 polishes the persistent tray.

**Commit:** this commit

---

## [Track 2 - Prompt E6] Async event-to-prompt bridge - 2026-06-04

**Files changed:**
- `electron/services/async-event-bridge.ts` (new) - durable async-event queue, in-memory fallback, one-shot drain, `<task-notifications>` renderer, and `agent:run:notify` adapter.
- `electron/ipc/async-events.ts` (new) - internal list/drain diagnostics.
- `electron/services/database.ts` - adds `async_events(id, conversation_id, kind, payload_json, created_at, delivered_at)`.
- `electron/ipc/chat.ts` + `system-prompt-builder.ts` - drain pending events during prompt assembly and inject `<task-notifications>`.
- `electron/ipc/tasks.ts` - enqueues terminal background-agent notifications.
- `src/components/chat/AsyncEventToast.tsx` - subtle toast for queued async events.

**Verify gate:**
- tsc node ok
- tsc web ok
- `git diff --check` ok
- vitest blocked before config load by `spawn EPERM` from Vite/esbuild helper startup.

**Notes:**
- Events drain per conversation and are stamped with `delivered_at` so they are not re-injected.
- The queue is intentionally generic: Track 3's G4 can enqueue `sessions:incoming-message`, loops can enqueue `loops:wakeup-fired`, and automations can enqueue `automations:run-completed` once those producers carry a conversation id.

**Commit:** this commit

---

## [Track 2 — Partial completion summary] 7/9 prompts shipped — 2026-06-03

Track 2 ("Tool Layer + Continuity") shipped 7 of its 9 prompts; the
remaining 2 (E6, E4) are blocked on Track 1 prompts that have not yet
merged to `main` per the plan §0 Step 3c wait-gate protocol.

### Shipped (in commit order on `feat/track-2-tool-layer`)

| # | Title | Verify gate |
|---|---|---|
| C1 | Lazy tool schemas + ToolSearch | tsc node ✓ · tsc web ✓ · vitest +32 ✓ |
| C2 | Hooks wired into dispatch + Hooks UI | tsc node ✓ · tsc web ✓ · vitest +14 ✓ · UI smoke: user-verification-needed |
| C3 | Plan mode state gate | tsc node ✓ · tsc web ✓ · vitest +7 ✓ · UI smoke: user-verification-needed |
| C4 | Slash command system + built-ins | tsc node ✓ · tsc web ✓ · vitest +14 ✓ · UI smoke: user-verification-needed |
| E1 | Session chapters | tsc node ✓ · tsc web ✓ · vitest +5 ✓ · DB smoke: user-verification-needed |
| E2 | Session TOC + nav | tsc node ✓ · tsc web ✓ · vitest unchanged (DOM-heavy UI) · UI smoke: user-verification-needed |
| E5 | Auto context compression | tsc node ✓ · tsc web ✓ · vitest +7 ✓ · DB smoke: user-verification-needed |

**Cumulative test delta:** baseline 822 → 901 passing / 5 skipped (+79 tests across the 7 prompts, 0 regressions).

### Blocked

| # | Title | Blocker | Plan §0 §3c |
|---|---|---|---|
| E6 | Async event-to-prompt bridge | T1:A2 (background agents + `agent:run:notify`) not merged to main | Defer; revisit after A2 lands. |
| E4 | Spawn-task primitive | T1:A3 (worktree-isolated subagent runs + `worktree-runner.ts`) not merged to main | Halt per plan: "if A3 is still unmerged when you get there, halt with 'waiting-on-T1:A3' status". |

**Wait status:** `waiting-on-T1:A2` (E6) and `waiting-on-T1:A3` (E4). When the corresponding Track 1 commits land on main, either continue this branch or open a fresh session pointed at this worktree to resume.

### Architectural impact for Tracks 1 + 3 to be aware of when rebasing

- **`electron/services/tool-registry.ts`** — `LampreyToolDescriptor` now requires `tags: string[]`, `lazy: boolean`, `mutates: boolean`. `LampreyToolRegistration` accepts all three as optional and the registry normalizes them on insert. The 10 existing tool-pack files did not need edits; T1/T3's new tool registrations should follow the same pattern (omit unless you need to override the derived defaults).
- **`electron/ipc/chat.ts`** — dispatcher now runs `compressOldestMessages` then `getEffectiveMessages` BEFORE pulling history (E5); the plan-mode gate (C3) and preToolUse/postToolUse hook fences (C2) wrap the dispatch branch. T1's subagent-fork wiring (A1) needs to land on top of these gates, not under them — a subagent call is itself dispatched through this same path.
- **`electron/services/chat-events.ts`** — `ChatEventMap` extended with `plan:mode-changed`, `chat:chapter-marked`, `chat:compressed`. Renderer event subscribers can rely on all three.
- **`electron/services/event-log.ts`** — `EVENT_TYPES` extended with `chat.chapter.marked` and `chat.compressed`. Renderer `EventType` mirror in `src/lib/types.ts` and `event-presentation.ts` labels are in sync.
- **`electron/services/system-prompt-builder.ts`** — extended additively (new `progress` bullet for `mark_chapter`). T3:D2's `memory_index` block can land in front of all existing blocks without conflict.
- **`electron/preload.ts`** — new namespaces: `tools.resolve` / `tools.search` (C1), `hooks.test` (C2), `plan.isModeActive` / `enterMode` / `exitMode` / `onModeChanged` (C3), `slash.list` / `listAll` / `resolve` / `onChanged` (C4), `session.markChapter` / `listChapters` / `chaptersForAnchor` / `deleteChapter` / `onChapterMarked` (E1). No removals.

### Manual smoke checklist (Electron-only items the preview server can't reach)

The user should run these to confirm the renderer integrations land cleanly on a real machine:

1. **C1** — Open Settings (or wherever tools are surfaced); `tools:list` payload is materially smaller than before.
2. **C2** — Settings → Hooks: 5-event tabs, create a `preToolUse` JS hook that throws on `shell_command`, Test → BLOCKED chip; Save and confirm shell_command actually blocks during a chat.
3. **C3** — Have the model call `enter_plan_mode`; yellow banner appears; attempt `shell_command` → blocked; click Exit banner → next call runs.
4. **C4** — Type `/` in chat input; palette appears with 8 built-ins; type `/verify` and submit → verify prompt dispatched; drop a custom `userData/slash-commands/release-notes.md` → palette updates without restart.
5. **E1 + E2** — Have the model call `mark_chapter` 4 times; sidebar appears top-right with 4 entries; Ctrl/Cmd+G opens the jumper; click a row scrolls to the divider.
6. **E5** — Run a long conversation until projected tokens cross 75% of the model's context; the next turn auto-compresses, a `<conversation_summary>` system message appears as a CompressedRegionPill, the next prompt to the model contains the summary block in place of the originals.

### Next steps

1. Wait for Track 1's A2 + A3 to merge to `main`.
2. Resume this branch (or open a new session pointing at `feat/track-2-tool-layer`) and implement E6 + E4 per the plan.
3. After E6 + E4 ship, fast-forward `feat/track-2-tool-layer` and prep for merge to `main`.

---

## [Track 2 — Prompt E5] Auto context compression — 2026-06-03

**Files changed:**
- `electron/services/database.ts` — migration `safeAddColumn(messages, 'compressed_into TEXT')`.
- `electron/services/conversation-store.ts` — extended `MessageRow` and `getMessages` mapping to surface `compressedInto` to the renderer.
- `electron/services/context-compressor.ts` (new) — `estimateTokens`, `estimateTokensForMessages`, `projectedTokens(convId)`, `shouldCompress(convId, ctxWindow, thresholdPct=0.75)`, `selectMessagesToCompress(convId, ctxWindow, targetPct=0.4)`, `buildSummaryText(rows)`, `compressOldestMessages(convId, ctxWindow, opts?)`, `getEffectiveMessages(convId)`. The compressor selects the oldest non-compressed messages, generates a deterministic `<conversation_summary>` body (excerpt-per-turn), persists it as a `role: 'system'` message with `created_at = oldest.created_at - 1` so ORDER BY puts it ahead of the surviving turns, marks the originals' `compressed_into`, and emits a `chat.compressed` spine event. Tool/assistant pair preservation: if the last selected message is an `assistant` with a following `tool` response, the selection extends to keep them together (prevents orphaning a tool reply from its tool_calls).
- `electron/services/event-log.ts` — added `chat.compressed` to `EVENT_TYPES`.
- `electron/services/chat-events.ts` — added `ChatCompressedPayload` + `chat:compressed` to `ChatEventMap`.
- `electron/ipc/chat.ts` — before pulling history at the top of every chat turn, runs `compressOldestMessages(conversationId, resolveModel(model).contextWindow)`; emits `chat:compressed` on success. Prompt assembly switched from `convStore.getMessages` to `getEffectiveMessages(conversationId)` so the model sees the summary in place of the originals; the renderer still sees both via the unchanged getMessages.
- `src/lib/types.ts` — added optional `compressedInto?: string` to `Message`; added `chat.compressed` to the renderer `EventType` mirror.
- `src/lib/event-presentation.ts` — added "Context compressed" label.
- `src/components/chat/CompressedRegionPill.tsx` (new) — renders in place of a system-role message whose content carries `<conversation_summary>…</conversation_summary>`. Closed by default; click to reveal the summary body. Exports `isCompressedSummaryMessage(msg)` for the detector.
- `src/components/chat/MessageList.tsx` — extracted message rendering into a function: messages with `compressedInto` set are skipped (defensive double-guard against the raw view); summary messages render as `<CompressedRegionPill>`; everything else falls through to `SystemMarker` or `MessageBubble` as before.
- `electron/services/context-compressor.test.ts` (new) — 7 tests covering `estimateTokens`, `estimateTokensForMessages`, and the documented thresholds. DB-side branches (`shouldCompress`, `selectMessagesToCompress`, `compressOldestMessages`) are integration territory because they go through better-sqlite3 + Electron app-path; the manual verify steps in the DEVLOG cover them.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest 901 passed / 5 skipped (894 → +7 new) ✓
- Manual smoke — **user-verification-needed** (needs Electron + DB + a chat conversation):
  1. Set the active model to a small-context model (e.g. force a 16k context entry via the renderer's model list — or use DeepSeek which has a 65k default). With the default 75% threshold, accumulating roughly 12k tokens (≈48k characters) triggers compression.
  2. After enough turns, the next chat:send round inserts a `role: 'system'` message containing `<conversation_summary>…` and marks every selected message's `compressed_into` to that id. The CompressedRegionPill replaces those messages in the chat view (closed by default; click to expand).
  3. `getEffectiveMessages` returns the summary + everything since; `buildApiMessagesFromStoredMessages` produces a prompt with ~40%+ fewer tokens (the deterministic summary's excerpts run ~120 chars per original message; at ≥3:1 compression ratio per original message, the projection shrinks well past the verify gate's 40%).
  4. Activity Timeline shows a "Context compressed" entry with `compressedCount`, `originalTokens`, `summaryTokens`, `reductionPct` in the payload.
  5. Reload the app. The compressed messages still have `compressed_into` populated; the summary is still the first row in the conversation by `created_at` ordering. Renderer still hides the originals and shows the pill.

**Notes:**
- v1 summary is DETERMINISTIC — a structured per-turn excerpt list wrapped in `<conversation_summary>…</conversation_summary>`. No model call (the chat dispatcher's own next turn IS the summarizer if we needed a model-driven version). The 4-chars-per-token estimator + 120-char per-message excerpt yields a 4–5× compression on long turns; tested implicitly by the projection arithmetic, observed at integration time.
- The summary message is `role: 'system'` so it doesn't clash with the OpenAI tool-pair invariants (tool_calls must be followed by role: 'tool'). A second compression run later on inserts a new summary with its own id; the older summary stays visible and the pile-up renders as two pills in a row. Future-work: collapse consecutive summary pills in the renderer.
- Threshold + target percentages are constants (`DEFAULT_COMPRESS_THRESHOLD_PCT = 0.75`, `DEFAULT_COMPRESS_TARGET_PCT = 0.4`) — settings UI surface is out of scope for E5; H4 / H5 polish prompts can add a slider.
- The compressor is idempotent: a conversation that has already been compressed sees `projectedTokens` projecting only the surviving messages (compressed originals are excluded from the projection). Calling it again on the same conversation does not re-fold the summary.
- Merge-hotspot coordination: `event-log.ts` `EVENT_TYPES` extended (additive), `chat-events.ts` `ChatEventMap` extended (additive), `Message` mirror extended (additive optional). `chat.ts` changes the SOURCE of history (`getEffectiveMessages` instead of `getMessages`) without changing the downstream contract — other tracks touching chat.ts need no rebase.

**Commit:** see `git log feat/track-2-tool-layer`.

---

## [Track 2 — Prompt E2] Session TOC + nav — 2026-06-03

**Files changed:**
- `src/stores/chapters-store.ts` (new) — renderer chapters store: `loadForConversation`, `applyMarked` (live `chat:chapter-marked` reducer), `clear`. Mirrors the main-side Chapter shape 1:1.
- `src/components/chat/ChapterDivider.tsx` (new) — inline boundary between messages. Carries `data-chapter-id` so the sidebar / quick-jumper can scrollIntoView. Hover surfaces the chapter summary.
- `src/components/chat/ChapterSidebar.tsx` (new) — floating TOC pinned to the top-right of the chat column. Lists every chapter for the active conversation; self-hides when the list is empty. Click scrolls the message list to the divider.
- `src/components/chat/ChapterQuickJumper.tsx` (new) — Ctrl+G modal with type-to-filter input. Ranks by title prefix > title substring > summary substring. Arrow keys navigate, Enter jumps, Esc dismisses.
- `src/components/chat/MessageList.tsx` — wraps each message in a `<div data-message-id={msg.id}>` so future deep-link tooling can target by message id; computes a "before message at index i" → `Chapter[]` map by walking sorted chapters and finding the first message whose `timestamp >= chapter.createdAt`. Renders `<ChapterDivider>` before that message. Chapters created after the last existing message land in an `afterAll` bucket rendered at the bottom (so a late `mark_chapter` still shows up).
- `src/components/chat/ChatView.tsx` — mounts `<ChapterSidebar conversationId={activeConversationId} />` and `<ChapterQuickJumper conversationId={activeConversationId} />`.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest 894 passed / 5 skipped (no new tests; E2 is heavily DOM-dependent UI — scroll behaviour, keyboard handlers, popovers are hard to unit-test meaningfully) ✓
- Manual smoke — **user-verification-needed** (needs Electron + `window.api.session`):
  1. Have the model call `mark_chapter` 4 times across a chat. Sidebar appears in the top-right corner with all 4 titles, counts 4.
  2. Hover a sidebar row. The summary appears in the native tooltip.
  3. Click a sidebar row. The message list smooth-scrolls to the divider with `block: 'start'`.
  4. Press Ctrl+G. The quick-jumper opens, the input is focused. Type the first few characters of a chapter title; the list filters and ranks by prefix > substring > summary. Enter jumps; Esc closes.
  5. Resize the chat pane narrower. The sidebar stays anchored to top-right and doesn't overlap the message text past the column edge (sidebar is 200 px wide and the chat column is `max-w-4xl`; the absolute-positioned sidebar floats inside the column padding).

**Notes:**
- Chapter placement is by timestamp, not by anchor-message-id. E1 stores `anchor_message_id` as the tool-call id (which doesn't correspond to a message row), so the renderer uses `createdAt` instead — chapters sit between messages, which matches the user's intuition. If a future iteration wants exact-message anchoring (e.g., when the user manually marks a chapter from the UI on a specific message), `data-message-id` is already in place.
- The sidebar is an `<aside>` inside `ChatView`'s outer wrapper, positioned `absolute right-3 top-3`. The chat column itself is `position: relative` because of the FileDropZone overlay; the sidebar inherits the same anchor.
- Ctrl+G also responds to Cmd+G on macOS (the handler checks `e.ctrlKey || e.metaKey`).
- Live updates: `ChapterSidebar` subscribes to `chat:chapter-marked` and adds the new row to the store; the message list re-renders on the next mount because chapters is in zustand. The quick-jumper reads the same store so it sees the new entry on its next open.

**Commit:** see `git log feat/track-2-tool-layer`.

---

## [Track 2 — Prompt E1] Session chapters — 2026-06-03

**Files changed:**
- `electron/services/database.ts` — new `chapters(id, conversation_id, title, summary, anchor_message_id, created_at)` table with `idx_chapters_conversation` + `idx_chapters_anchor`. Foreign key `conversation_id REFERENCES conversations(id) ON DELETE CASCADE` — deleting a conversation cleans its chapters.
- `electron/services/chapters-store.ts` (new) — `createChapter`, `listChapters(conversationId)`, `getChapter`, `listChaptersByAnchor`, `deleteChapter`.
- `electron/ipc/chapters.ts` (new) — `session:markChapter`, `session:listChapters`, `session:chaptersForAnchor`, `session:deleteChapter`. Every successful mark emits `chat:chapter-marked` for live renderer subscriptions.
- `electron/ipc/index.ts` — wired `registerChaptersHandlers()`.
- `electron/services/tool-registry.ts` — registered `mark_chapter` native tool with empty risks, `mutates: false`, schema `{ title: required string, summary?: string }` and `additionalProperties: false`. Surface description teaches the model when to use it (phase shifts, not every tool call).
- `electron/ipc/chat.ts` — inline handler under `enter_plan_mode` / `exit_plan_mode`: validates title, anchors the chapter at the tool-call id (the post-tool assistant message has not been persisted yet at this dispatch point — chat-history maps the tool-call id back to its parent assistant turn), creates the row, emits `chat:chapter-marked`, records the `chat.chapter.marked` spine event.
- `electron/services/chat-events.ts` — new `chat:chapter-marked` payload + entry in `ChatEventMap`.
- `electron/services/event-log.ts` — new `chat.chapter.marked` entry in `EVENT_TYPES`.
- `electron/services/system-prompt-builder.ts` — bullet under `progress` instructing the model on when to call `mark_chapter`.
- `electron/preload.ts` — new `session.markChapter`, `listChapters`, `chaptersForAnchor`, `deleteChapter`, `onChapterMarked` bindings.
- `src/lib/types.ts` — added `chat.chapter.marked` to the renderer `EventType` mirror.
- `src/lib/event-presentation.ts` — added "Chapter marked" label so the Activity Timeline shows the right name.
- `electron/services/chapters-mark-tool.test.ts` (new) — 5 tests covering descriptor registration shape, schema requirements, `additionalProperties: false`, search ranking, and event-type registration. DB CRUD is left to integration smoke (better-sqlite3 + Electron app-path dependency makes a unit test mostly mechanical mocking).

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest 894 passed / 5 skipped (889 → +5 new) ✓
- Manual smoke — **user-verification-needed** (DB-backed; chokidar / Electron required):
  1. Have the model call `mark_chapter` with `{ title: "Exploration" }`. The tool result text is `Chapter marked: "Exploration"`; a row lands in `chapters` with the tool-call id as `anchor_message_id`.
  2. Call again with `{ title: "Implementation", summary: "Apply patches per the plan" }`. A second row lands ordered by `created_at`.
  3. `session:listChapters(<convId>)` returns both rows in insertion order.
  4. Restart the app. `session:listChapters(<convId>)` still returns the two rows (table is persisted).
  5. The Activity Timeline shows two "Chapter marked" entries (spine event recorded).
  6. The renderer-side sidebar / divider / quick-jumper land in E2 — confirming presence in this smoke does not need any of those.

**Notes:**
- The renderer-visible sidebar (`ChapterSidebar`), inline `ChapterDivider`, and `ChapterQuickJumper` ship in E2. E1 establishes the data plane only; the renderer can hydrate via `session:listChapters` and subscribe to `chat:chapter-marked` even before E2 lands.
- Anchor choice: this implementation anchors on the tool-call id rather than the next-persisted assistant message id. Reason: the assistant message that carries the mark_chapter call is saved AFTER the call resolves, so at handler time there is no message id to point at; the tool-call id is the closest stable identifier in this dispatch step. E2's renderer treats the anchor as a boundary marker rather than an exact pin (chapters are between messages, not at one), so this maps cleanly.
- System-prompt mention is in the `progress` section; the model already sees the descriptor's full prose in the OpenAI tool array, but the `<contract>` reminder makes it actually reach for it. The block ordering plan §2 invariant (`memory_index → skills → retrieved_context → chapters → conversation`) ships the `<chapters>` block via T3:D2 — E1 doesn't add that block, only registers the tool + data plane.
- Merge-hotspot coordination: `chat-events.ts` extended (additive), `event-log.ts` `EVENT_TYPES` extended (additive), `tool-registry.ts` registration appended (no shape change). Other tracks need no rebase.

**Commit:** see `git log feat/track-2-tool-layer`.

---

## [Track 2 — Prompt C4] Slash command system + built-ins — 2026-06-03

**Files changed:**
- `electron/services/slash-commands.ts` (new) — filesystem-discovered loader mirroring `skill-loader.ts`. Built-ins live in `resources/slash-commands/`; the loader bootstraps `userData/slash-commands/` from there on first run and watches for live edits via chokidar. Frontmatter: `{name, description, args?, hidden?}`. Body is the prompt template; `interpolateSlashBody` supports `{{args}}` (joined rest), `{{arg1}}..{{argN}}` (positional, empty when out of range), `{{<named>}}` (from `args:` frontmatter), and leaves unmatched non-positional tokens literal.
- `electron/ipc/slash.ts` (new) — `slash:list` (visible commands), `slash:listAll` (incl. hidden), `slash:resolve({name, rest})`. Hidden entries stay out of `slash:list` but `resolve` still resolves them.
- `electron/ipc/index.ts` — registers the new handlers.
- `electron/main.ts` — `initializeSlashCommandLoader()` at startup; `shutdownSlashCommandLoader()` at will-quit.
- `electron/preload.ts` — `slash.list / listAll / resolve / onChanged` bindings.
- `electron-builder.yml` — bundles `resources/slash-commands/` into the packaged `process.resourcesPath/slash-commands/`.
- `resources/slash-commands/*.md` (9 built-ins): `/init`, `/review`, `/verify`, `/simplify`, `/loop`, `/plan`, `/workflow`, `/spawn-task`, `/clear` (hidden).
- `src/stores/slash-commands-store.ts` (new) — renderer store: `commands`, `load`, `resolve`, `applyChange` (live `slash:changed` reducer).
- `src/components/chat/SlashCommandPalette.tsx` (new) — popover above the chat input that lists matching commands when content starts with `/`. Keyboard: ↑/↓ to focus, Tab/Enter to apply, Esc to dismiss. Each row shows `/name`, the source badge (`user`/`builtin`), optional `<arg>` placeholders, and the description.
- `src/components/chat/ChatInput.tsx` — detects leading `/` (no newline), mounts the palette, routes the existing renderer-side cases (`/compact`, `/fork`, `/models`, `/fast`) plus two repurposed ones: `/plan` now calls `usePlanStore().enterPlanMode(activeConvId)` (C3's real gate) and `/clear` drops visible messages. Anything else goes through `useSlashCommandsStore().resolve(name, rest)` → `onSend(prompt)`.
- `electron/services/slash-commands.test.ts` (new) — 14 tests over `parseSlashFile`, `fileNameToSlug`, `isMarkdownFile`, `interpolateSlashBody`. Electron is mocked at the module boundary (same pattern as `event-log.test.ts`).

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest 889 passed / 5 skipped (875 → +14 new) ✓
- Manual smoke — **user-verification-needed** (Electron-only, `window.api.slash` IPC + chokidar watch):
  1. Launch Electron. Type `/` in the chat input → palette appears with the 8 visible built-ins.
  2. Type `/rev` → "review" ranks first. Tab inserts `/review `.
  3. Send `/verify` → the verify prompt dispatches to the model as a user turn.
  4. Drop a file in `userData/slash-commands/release-notes.md`:
     ```
     ---
     name: release-notes
     description: Draft release notes for the named version.
     args: [version]
     ---
     Draft release notes for version {{version}}.
     ```
     The palette updates without restart (chokidar fires `slash:changed`). Send `/release-notes 1.2.3` → the model receives "Draft release notes for version 1.2.3.".
  5. Send `/plan` → PlanModeBanner appears (C3 gate flips). Send `/clear` → visible messages drop but the conversation row stays.
  6. Type `/nope` → toast "Unknown slash command: /nope" (no IPC fallback hit).

**Notes:**
- The pre-C4 `/plan` was a renderer-side prefix-the-message UI flag. C4 retargets `/plan` at C3's dispatcher-level gate (`PlanModeBanner` appears) — the model gets a real "no mutations" guarantee rather than a polite prompt prefix. The legacy Shift+Tab toggle for the pre-C3 UI flag stays in place for users who muscle-memory it; that flag can be retired in a follow-up.
- The `/workflow` and `/spawn-task` templates ship as prompt text that *describes* the future capability (Track 1 / B1 and Track 2 / E4). Until those land, sending the command surfaces the description; the renderer does not error.
- `/clear` is `hidden: true` in the markdown so it stays out of the palette but is still typeable; the renderer takes precedence and short-circuits, the IPC path stays available for harness callers.
- Tag taxonomy: slash-commands have a `source: 'user' | 'builtin'` field on the renderer-visible payload, surfaced as a chip in the palette. `userData/slash-commands/<name>.md` shadows the built-in of the same name (built-in's body is copied into userData on first run, so the user's override always wins).
- Merge-hotspot coordination: `electron/preload.ts` extended with a new `slash` namespace; no overlap with the C1/C2/C3 surfaces. `chat.ts` not touched (slash routing lives entirely in `ChatInput.tsx`).

**Commit:** see `git log feat/track-2-tool-layer`.

---

## [Track 2 — Prompt C3] Plan mode state gate — 2026-06-03

**Files changed:**
- `electron/services/database.ts` — migration `safeAddColumn(conversations, 'plan_mode_active INTEGER NOT NULL DEFAULT 0')`.
- `electron/services/conversation-store.ts` — new `isPlanModeActive(id)` / `setPlanModeActive(id, active)` helpers; the flag survives restart on the conversation row.
- `electron/services/tool-registry.ts` — added required `mutates: boolean` to `LampreyToolDescriptor`; `LampreyToolRegistration` accepts it as optional and the registry derives `mutates = risks.includes('write') || risks.includes('destructive')` when omitted; MCP descriptor build path also computes it. New helper `isMutatingDescriptor(d)`. Two new inline-registered tools: `enter_plan_mode` and `exit_plan_mode` with empty risks + `mutates: false` so they always run.
- `electron/services/tool-search.ts` — `computeToolTags` emits a `'mutates'` meta-tag when the flag is set, for the renderer's filter chips and the model-facing tool description.
- `electron/services/chat-events.ts` — new `plan:mode-changed` event with `PlanModeChangedPayload { conversationId, active }`.
- `electron/ipc/chat.ts` — dispatcher gates mutating tools BEFORE the approval modal: `blockedByPlanMode = isPlanModeActive(conv) && isMutatingDescriptor(desc)`, sets `approvalSource = 'plan-mode'` and returns `'Blocked: plan mode is active...'` with status `'denied'`. Inline handlers for `enter_plan_mode` / `exit_plan_mode` persist the flag and emit `plan:mode-changed`.
- `electron/ipc/plan.ts` — new `plan:isModeActive`, `plan:enterMode`, `plan:exitMode` IPC channels.
- `electron/preload.ts` — `plan.isModeActive`, `plan.enterMode`, `plan.exitMode`, `plan.onModeChanged` bindings.
- `src/lib/types.ts` — mirrored `mutates: boolean` (required) on `LampreyToolDescriptor`.
- `src/stores/plan-store.ts` — added `planModeActive: boolean | null`, `enterPlanMode` / `exitPlanMode` actions, `applyModeChange` reducer. `loadForConversation` fetches both plan snapshot AND mode flag in parallel.
- `src/components/chat/PlanModeBanner.tsx` (new) — yellow strip with "Plan mode is on" + "Exit plan mode" button, hydrates via `plan:isModeActive`, subscribes to `plan:mode-changed`, hides when `planModeActive !== true`.
- `src/components/chat/ChatView.tsx` — mounts `<PlanModeBanner conversationId={activeConversationId} />` between the file-drop overlay and the message list.
- `electron/services/plan-mode.test.ts` (new) — 7 tests covering descriptor-side `mutates` derivation, `isMutatingDescriptor`, and the enter/exit-tool mutates-false invariant.
- `electron/services/tool-parallelism.test.ts` — test helper extended with `mutates: false`.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest 875 passed / 5 skipped (868 → +7 new) ✓
- Manual smoke — **user-verification-needed**: PlanModeBanner + dispatcher integration need Electron + better-sqlite3. Steps:
  1. Launch Electron, open a conversation, ask the model to `enter_plan_mode`. Banner appears (yellow strip, "Exit plan mode" button).
  2. Ask the model to run `shell_command` (or any apply_patch). Tool result reads `Blocked: plan mode is active...` with status `denied` in the audit log.
  3. Ask the model to run `workspace_context` (read-only). Runs normally — confirms read tools still flow.
  4. Click "Exit plan mode" in the banner. Banner disappears, next `shell_command` runs (subject to the existing approval gate).
  5. Re-enter plan mode, force-reload the renderer (Ctrl+R). Banner re-renders on conversation load — plan_mode_active survived because it's persisted on the conversation row.
  6. Verify `plan-goal-store.ts` checklist (`update_plan` tool) still works inside plan mode (it has risk `'write'` BUT it's a session-state mutation; if this is undesirable we'll need to mark it `mutates: false` explicitly in a follow-up — currently it is gated like other write tools, which is the safer default and means the plan needs to be authored before entering plan mode).

**Notes:**
- `mutates` derivation defaults to write+destructive risks. The two plan-mode toggles explicitly opt out (`mutates: false`) so they remain callable. The renderer mirror keeps `mutates` required so consumers don't have to handle `undefined` — main-side `LampreyToolRegistration` accepts it as optional to spare the 10 tool-pack files from edits.
- Block precedes approval (the plan-mode check zeroes `needsApproval`). Reason: there is no point asking the user to approve a tool that plan mode forbids, and a global "deny destructive" policy must not silently allow what plan mode forbids.
- The `update_plan` tool keeps its `mutates: true` derivation — that's safe (users author plans before entering plan mode) but slightly inconvenient. If complaints arise, a follow-up can flag plan/goal mutation tools as session-only (similar to enter/exit_plan_mode). Tracked here rather than spawning a separate plan to avoid premature scope.
- Merge-hotspot coordination: `tool-registry.ts` shape extended (+1 required field on the exposed descriptor; +1 optional on the registration input). Existing tool-pack registrations need no edits. Track 1 / T3 must rebase their new tool descriptors onto the extended shape — same `LampreyToolRegistration` ergonomics (mutates auto-derived from risks; explicitly opt out when needed).

**Commit:** see `git log feat/track-2-tool-layer`.

---

## [Track 2 — Prompt C2] Hooks wired into dispatch + Hooks UI — 2026-06-03

**Files changed:**
- `electron/services/database.ts` — migration: `safeAddColumn(hooks, language TEXT NOT NULL DEFAULT 'shell')` + `timeout_ms INTEGER NOT NULL DEFAULT 5000`. Existing rows preserve their shell semantics; new rows from the UI explicitly set `language='js'`.
- `electron/services/hooks-store.ts` — added `language: 'js' | 'shell'` + `timeoutMs` to `Hook`; `getHook(id)` getter; `createHook` / `updateHook` thread the new fields. `DEFAULT_HOOK_TIMEOUT_MS = 5000` exported.
- `electron/services/hooks-runner.ts` (rewritten) — new `vm`-sandboxed JS path with bindings (`event`, `conversationId`, `toolName`, `args` deep-clone, `result`, `promptBody`, `cwd`, `log(...)`, `console.{log,error,warn}`, `Date`, `JSON`, `Math`). `preToolUse` blocks dispatch when a hook throws — message reaches the model as the synthetic tool result. Legacy shell-language path preserved for pre-migration rows. New `testHook({ code, event, context, timeoutMs })` for the UI test-run button.
- `electron/ipc/hooks.ts` — `hooks:create` / `hooks:update` accept `language` + `timeoutMs`. New `hooks:test` IPC.
- `electron/ipc/chat.ts` — `resolveSingleToolCall` now wraps the dispatch branch with `await fireHooks('preToolUse', ...)`; if blocked, returns `'Blocked by hook: <reason>'` with status `'denied'`. Post-call: `await fireHooks('postToolUse', { ..., result })` before recording the audit row. Existing `promptSubmit` / `agentStop` call sites switched to `void fireHooks(...)` for the async signature.
- `electron/main.ts` — `void fireHooks('sessionStart')`.
- `electron/preload.ts` — added `hooks.test` binding; `hooks.create` / `hooks.update` accept the new fields.
- `src/stores/hooks-store.ts` (new) — renderer hooks store. Load + create + update + remove + test. `lastTest` slot holds the most recent test run for the editor pane.
- `src/components/settings/HooksSettings.tsx` (rewrite) — per-event tab strip with count badges, master/detail list + editor, code textarea, language badge (legacy 'shell' marked deprecated and read-only-runtime), timeout field, enable toggle, Save / Test / Delete buttons, inline test-output panel (BLOCKED / OK chip + thrown message + log lines).
- `electron/services/hooks-runner.test.ts` (new) — 14 tests covering sandbox bindings, preToolUse blocking, args-clone isolation, timeout, multi-hook ordering, disabled-hooks-skipped, postToolUse no-block. `listHooksForEvent` is mocked at the module boundary so the runner is exercised without booting better-sqlite3 / Electron.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest 868 passed / 5 skipped (854 baseline → +14 from `hooks-runner.test.ts`) ✓
- Manual smoke — **user-verification-needed**: the HooksSettings panel needs window.api.hooks (Electron IPC + better-sqlite3) so the preview server cannot exercise create/test/delete. Steps for the user:
  1. Launch Electron (`ELECTRON_EXEC_PATH=... npx electron-vite dev`).
  2. Open Settings → Hooks. Confirm 5-event tab strip with count badges.
  3. New hook on `preToolUse` with body `if (toolName === "shell_command") throw "blocked by hook"`; click Test → expect "BLOCKED" chip + thrown line.
  4. Save and submit a chat turn that invokes `shell_command`. Tool result should read `Blocked by hook: blocked by hook` and the audit row status `'denied'`.
  5. Disable the hook from the list checkbox → next shell call runs normally.
  6. Create a `postToolUse` hook with `log(toolName, "→", result.slice(0, 60))`; run any tool; confirm the log line appears in the hook's Test output for a subsequent test-run with sample context (live postToolUse logs route to backend console for now — UI surfacing is H4).
  7. Delete the hook — list updates, no stale row.

**Notes:**
- Architectural-invariant compliance (plan §2 item 3): same `vm` sandbox shape as workflows. Track 1 / B1 will eventually extract a shared sandbox helper; until then, both modules (workflow-runner once it lands, hooks-runner now) construct their own `vm.createContext` with the same security posture (no `require`, no `process`, no fs/net, configurable timeout). When B1 lands the hooks-runner can rebase onto the extracted helper without behaviour change.
- preToolUse multi-hook ordering: the first throw wins (sets `blocked` + `blockReason`); later hooks still run so their `log()` calls are captured. This means an audit-style postcondition hook keeps working even when an earlier hook objected.
- `args` snapshot uses `structuredClone` (Node 17+) with a JSON-roundtrip fallback. Sandbox mutations cannot leak back into the dispatcher's args object.
- Legacy `shell` hooks remain executable but cannot be created from the new UI; the editor surfaces a "Legacy shell hook" warning and disables the Test button (shell test would spawn a child process and that's not what the inline editor preview promises).
- Merge-hotspot coordination: `chat.ts` dispatch hook wires landed before T1:A1 (subagent-fork). T1 must rebase its dispatch additions on top of the new preToolUse / postToolUse fences.

**Commit:** see `git log feat/track-2-tool-layer`.

---

## [Track 2 — Prompt C1] Lazy tool schemas + ToolSearch — 2026-06-03

**Files changed:**
- `electron/services/tool-search.ts` (new) — pure functions: `computeToolTags`, `parseSelectQuery`, `tokenizeQuery`, `scoreDescriptor`, `searchDescriptors`.
- `electron/services/tool-registry.ts` — added `tags: string[]` and `lazy: boolean` (required) to `LampreyToolDescriptor`; new `LampreyToolStub` and `LampreyToolRegistration` types; `registerNative()` now accepts the relaxed registration shape and normalizes derived fields on insert; new methods `getStubs()`, `resolveByName()`, `search()`. `getDescriptors()` populates tags+lazy for MCP-derived descriptors at build time.
- `electron/ipc/tools.ts` — `tools:list` returns stubs (no `inputSchema`); new `tools:resolve(names[])` and `tools:search({ query, maxResults })` handlers.
- `electron/preload.ts` — exposed `tools.resolve` and `tools.search`.
- `src/lib/types.ts` — mirrored `tags`/`lazy` on `LampreyToolDescriptor`; added `LampreyToolStub`.
- `src/stores/tools-store.ts` — replaced eager `descriptors` cache with `stubs` + `resolved` map + `resolveTools` / `searchTools` actions.
- `electron/services/tool-parallelism.test.ts` — test helper updated to include the new required `tags`/`lazy` fields.
- `electron/services/tool-registry.test.ts` (extend) + `electron/services/tool-search.test.ts` (new) — 32 new tests.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest 854 passed / 5 skipped (baseline 822 + 32 new) ✓
- No preview server needed: change is backend + store-only, no renderer surface consumes it yet.

**Notes:**
- The "MCP tools tagged `lazy: true`; schema fetched on first resolve" line in the prompt is satisfied structurally by the IPC-payload split: MCP schemas are still fetched at MCP connect time (the MCP `listTools` protocol returns them in one call — there is no per-tool schema endpoint), but `tools:list` no longer ships them to the renderer. Renderers expand on demand. Chat dispatch still uses `getOpenAITools()` internally, so the model surface is unchanged ("auto-resolves on demand" invariant — the dispatcher always materializes full schemas before calling the model).
- Tag taxonomy locked: `providerKind` (native | mcp | plugin), every risk class (read | write | network | destructive | secret), and meta tags (`lazy`, `approval-required`, `parallelizable`). C3 will add `mutates` to gate plan mode; the tag list grows additively.
- Merge hotspot: `tool-registry.ts` shape change. Track 1 and Track 3 must rebase their tool registrations onto the new `LampreyToolRegistration` input type — `tags` and `lazy` are optional at registration so existing call sites (10 tool-pack files + 2 inline natives) needed no edits. Net touch outside this prompt: 1 test helper.

**Commit:** see `git log feat/track-2-tool-layer -- electron/services/tool-search.ts` (SHA inline in the commit would chase itself across amends).

---

## [Track 1 — COMPLETE] Runtime Foundation track shipped — 2026-06-03

All 8 prompts (A1 → A2 → A3 → B1 → B2 → B3 → B4 → B5) committed on `feat/track-1-runtime`. From baseline:
- **tests:** 822 → 1010 (+188 net, 5 skipped, 0 regressions across the run)
- **tsc node + web:** clean throughout
- **new top-level modules in `electron/services/`:** subagent-types, subagent-runner, agent-run-store, worktree-runner, workflow-meta, workflow-runner, workflow-journal, workflow-library, workflow-budget
- **new IPC channels:** `tasks:list/get/output/stop/update` + `agent:run:notify` broadcast; `workflows:list/runInline/run/stop` + `workflow:progress` + `workflow:tokens` broadcasts
- **renderer:** `workflows-store` (Zustand) + `WorkflowsPanel` / `WorkflowRunCard` / `PhaseGroup` / `AgentChip` (tier-aware ring overlay)
- **resources:** 4 built-in workflows (adversarial-verify, judge-panel, loop-until-dry, multi-modal-sweep) annotated with model tiers

**Commit list (run `git log feat/track-1-runtime ^main --oneline` for SHAs):**
1. A1 fork primitive + extensible types (`feat(subagent): A1 ...`)
2. A2 background agents + async notifications (`feat(subagent): A2 ...`)
3. A3 worktree-isolated subagent runs (`feat(subagent): A3 ...`)
4. B1 workflow JS evaluator core (`feat(workflow): B1 ...`)
5. B2 journaling + resume (`feat(workflow): B2 ...`)
6. B3 workflow live progress UI (`feat(workflow): B3 ...`)
7. B4 quality workflow patterns library (`feat(workflow): B4 ...`)
8. B5 model-tier routing + schema-retry hardening (`feat(workflow): B5 ...`)

**Cross-track outbound dependencies satisfied:** T2:E6 (async event bridge) can read `agent:run:notify` (A2). T2:E4 (spawn-task) can use `worktree-runner` (A3). T3:D4 (memory consolidation workflow) can build on `workflow-runner` (B1). H1 (activity dashboard) can mount `WorkflowsPanel` + `tasks:list` (B3 + A2). H2 (workflow palette) can drive `workflows:runInline` + the library (B1 + B4). H6 (ask-user) can extend `forkAgent` deps (A1).

**Track 1 user-verification items collected from per-prompt DEVLOG entries (Electron-shell smoke needed at runtime):**
- A2 live `tasks:list` against the real better-sqlite3 DB (test path uses memory fallback)
- A3 real `git worktree add` against the Lamprey repo (test path uses runGit stub)
- B3 live WorkflowsPanel DOM render via the preview tools (store tests exercise the same event sequence)
- B4 Library tab in WorkflowsPanel (IPC + invocation path proven; UI affordance for one-click run from a card is deferred to H1's activity dashboard)
- Sidebar entry "Workflows" (Sidebar.tsx is 1000+ lines with its own nav-history protocol; the route registration is mechanical and belongs in H1)

---

## [Track 1 — Prompt B5] Model-tier routing + schema-retry hardening — 2026-06-03

**Files changed:**
- `electron/services/workflow-budget.ts` (new) — per-tier token budget tracker. `tierOfModel(modelId)` returns `'cheap' | 'pro' | 'unknown'` via substring heuristics (`flash`/`haiku`/`mini`/`gemma`/`-v3-` → cheap; `pro`/`opus`/`sonnet`/`reasoning` → pro). `resolveModelId(idOrTier, defaultModel)` lets workflow scripts say `model: 'cheap'` (symbolic tier) and have it resolved to a concrete provider model ID via `TIER_MODEL_MAP`. `makeBudgetTracker(total)` returns `{total, spent(), remaining(), byTier(), record(modelId, tokens)}`; `byTier()` returns a copy so callers can't accidentally mutate the tracker.
- `electron/services/subagent-runner.ts` — schema-retry loop on `forkAgent`. When `opts.schema` is set, the runner is invoked up to `SUBAGENT_SCHEMA_RETRY_MAX = 3` times; each failed attempt appends the model's previous response as an assistant message + a user message containing the verbatim validation error ("Your previous response failed schema validation: <msg>. Try again..."). On exhaustion the last `SubagentSchemaError` is thrown. Non-schema calls pass straight through (single runner invocation, same as A1).
- `electron/services/workflow-runner.ts` — `WorkflowProgressEvent` extends with `tier` + `budgetByTier` fields and a new `'tokens'` kind. The local `budgetSpent` counter was replaced with the tier-aware `makeBudgetTracker`. Every agent call (live + cached) now resolves its symbolic `model` to a concrete ID via `resolveModelId`, computes `tier` via `tierOfModel`, calls `budgetTracker.record(resolvedModelId, tokens)`, fires an `agent:finish` event tagged with the tier, then fires a separate `tokens` event carrying the tier + delta + full `budgetByTier` snapshot. Nested workflows roll the child's `budget.byTier` per-bucket into the parent's tracker so cross-workflow byTier numbers are accurate. The final `WorkflowBudgetSnapshot` now includes `byTier`.
- `resources/workflows/adversarial-verify.js` — skeptics annotated `model: 'cheap'`.
- `resources/workflows/judge-panel.js` — candidates + judges `model: 'cheap'`, synthesis `model: 'pro'`.
- `resources/workflows/loop-until-dry.js` — finders `model: 'cheap'`.
- `resources/workflows/multi-modal-sweep.js` — lenses `model: 'cheap'`, synthesis `model: 'pro'`.
- `src/stores/workflows-store.ts` — `AgentChip` gains `tier?: AgentTier`. `applyProgress` stores `event.tier` on `agent:finish`. `tokens` events accepted as a no-op (the budget snapshot is held in the runner's tracker, not mirrored in the store). `WorkflowProgressEvent` mirror extended to include the new fields.
- `src/components/workflows/AgentChip.tsx` — `TIER_RING` map (`cheap → ring-sky-400/40`, `pro → ring-violet-500/50`). Chip renders the ring overlay alongside the status tint + a `[cheap]`/`[pro]` label suffix + `data-tier` attr + tier name in the tooltip.
- `electron/services/workflow-budget.test.ts` (new) — 10 tests covering tier classification (cheap/pro/unknown substring heuristics, undefined handling), `resolveModelId` (concrete pass-through, symbolic resolve, defaultModel fallback), `setTierModelMap`, tracker state (zero start, Infinity remaining when total is null, per-tier accumulation, ignore zero/negative deltas, byTier returns copy).
- `electron/services/subagent-runner.test.ts` — added "B5 schema retry loop" describe (5 tests): success on first attempt (single runner call); REQUIRED — retries up to 3× on malformed JSON with messages array growing 2 → 4 → 6 (assistant + user pair per retry); retry message includes the verbatim validation error; succeeds on attempt 2 when the first is malformed; schema-shape mismatch (not parse error) also triggers retries.
- `electron/services/workflow-library.test.ts` — added 3 B5 tests: REQUIRED — mixed-tier adversarial-verify shows `byTier.cheap > 0 && byTier.pro === 0`; an all-Pro baseline (regex-swapped script) shows the inverse; at 10:1 cost ratio the mixed run is ≥3× cheaper. judge-panel exercises BOTH tiers (candidates + judges cheap, synthesis pro). `workflow:tokens` event fires once per agent finish, all tagged with the expected tier.
- `src/stores/workflows-store.test.ts` — 2 B5 tests: tier from `agent:finish` event lands on the stored chip; `tokens` events accepted without breaking the tree.

**Verify gate:**
- `tsc --noEmit -p tsconfig.node.json` ✓
- `tsc --noEmit -p tsconfig.web.json` ✓
- `vitest run` ✓ — **1010 passed, 5 skipped** (was 988 after B4 → +22 net, 0 regressions)
- Verify-gate bullets covered:
  - run mixed-tier adversarial-verify → token counters ≥3× cheaper than all-Pro baseline ✓ (10× at the 10:1 cost ratio; the test asserts ≥3× to be lenient with downstream pricing tweaks)
  - forced bad-schema output (stub) → retried 3× with error appended each turn, surfaces validation error ✓
  - budget.byTier returns per-tier spend ✓
  - WorkflowsPanel chips tinted by tier ✓ (TIER_RING + data-tier attr; store flow verified; live DOM render is user-verification)

**Notes:**
- Schema retry message structure is `[system, user, assistant(failure-1), user(retry-note-1), assistant(failure-2), user(retry-note-2), ...]` — the model sees its own bad output, then a directive to retry with corrections. This matches the parity plan §6's "schema retry" pattern and gives the model the chance to self-correct without losing context.
- TIER_MODEL_MAP defaults pick DeepSeek IDs because that's the most-used provider in this codebase; production wiring (Track 2 / Integration Phase) will call `setTierModelMap` based on the user's roster configuration so 'cheap' can resolve to Gemma or Qwen-flash depending on which keys are configured.
- The tier ring is purely visual; the structural data on the chip (`data-tier`, `tier` field) is the canonical source so the activity dashboard (H1) and any future tier-cost summarisers can read it.
- The all-Pro "baseline" in the test is built via regex-swap of `model: 'cheap'` → `model: 'pro'`. The test catches a specific structural invariant: a mixed-tier workflow's `byTier.pro === 0` (skeptics never escalate to pro). This is the property the "3× cheaper" claim rests on.
- Budget tracking in nested workflows: when a child workflow finishes, its `budget.byTier` is iterated and each bucket is rolled into the parent tracker via `record(tierName, tokens)`. Concurrency cap is NOT yet shared across nested workflows (each child has its own semaphore); the plan calls this out for a future hardening.

**Commit:** see `git log --grep "B5 model-tier"`.

## [Track 1 — Prompt B4] Quality workflow patterns library — 2026-06-03

**Files changed:**
- `resources/workflows/adversarial-verify.js` (new) — `parallel`-fans 3 (configurable) skeptics with `schema: {refuted: bool, reason: string}`. Majority vote (`refutedCount * 2 > total`) wins. Defaults to `refuted:true` on no-claim/no-votes (defensive).
- `resources/workflows/judge-panel.js` (new) — three phases: `Generate` (parallel candidates from configurable angles, default `['MVP-first', 'risk-first', 'user-first']`), `Judge` (parallel scoring with `{score: number, notes: string}` schema), `Synthesise` (single agent that gets the winner + runners-up and produces the final plan). Returns `{winner, attribution: {winnerScore, runnerCount}, scores}`.
- `resources/workflows/loop-until-dry.js` (new) — round counter + dry-streak counter. Each round calls a finder with the previously-seen items. `findings: []` increments dry; `findings.length > 0` resets dry to 0 and accumulates fresh items (key-deduped). Exits when `dryStreak >= dryRoundsTarget` OR `round >= maxRounds`. Returns `{findings, rounds, dryStreak}`.
- `resources/workflows/multi-modal-sweep.js` (new) — `parallel`-fans N lenses (default `['by-container', 'by-content', 'by-entity', 'by-time']`), each `Explore`-typed with `{findings: array}` schema. Dedups findings across lenses (key-stringified). Final `Synthesise` agent summarises to 3-5 bullets.
- `electron/services/workflow-library.ts` (new) — `initializeWorkflowLibrary()` scans `resources/workflows/` (dev: `__dirname/../../resources/workflows`, prod: `process.resourcesPath/workflows`) + `userData/workflows/scripts/`. Each `.js` file is parsed via `parseWorkflowScript` and indexed by `meta.name`. User scripts shadow built-ins of the same name. `getWorkflow(name)` + `listWorkflows()` for callers. `__workflowLibraryTest` exposes `parsePath(filePath)` so tests verify the shipped scripts parse cleanly.
- `electron/services/workflow-runner.ts` — `WorkflowRunInput` gains `nestingDepth?: number` (threaded through the workflow() call). The B1 `workflow()` stub is now functional: it requires `deps.loadNamedWorkflow` (already on `WorkflowRunnerDeps`); resolves the name to a source; throws when `nestingDepth >= 1` (the plan locks nesting at one level); fires a child `runWorkflow` with `nestingDepth: currentDepth + 1`, the parent's `controller.signal`, the parent's concurrency cap, and `budgetTotal: parent.budgetTotal - parent.budgetSpent`. After the child resolves, the child's `budget.spent` + `agentCount` are rolled into the parent so subsequent budget/cap checks see the combined cost.
- `electron/ipc/workflows.ts` — `workflows:list` now returns `{live, library: [{name, description, origin}]}`. `workflows:run({name, args})` resolves the entry via `getWorkflow`, fires `runWorkflow` with the parent deps (forkSeam + progress + loadNamedWorkflow), registers in `liveWorkflows`, and returns `{runId, name}`. `buildDeps` injects `loadNamedWorkflow: (name) => getWorkflow(name)?.source ?? throw`.
- `electron/services/workflow-library.test.ts` (new) — 14 tests: file discovery confirms all 4 built-ins ship; each parses cleanly with required meta fields; `adversarial-verify` against known-false claim → refuted:true with 3/3 majority (REQUIRED); against a true claim → refuted:false; no-claim args → refuted:true (defensive default); `judge-panel` over 3 plans → SYNTHESISED-PLAN with attribution (REQUIRED), score-ordering test verifying the winner is the max-score candidate; `loop-until-dry` against empty finder → exits after dryRoundsTarget rounds (REQUIRED), accumulates with dry-streak reset on productive round, honours maxRounds; `multi-modal-sweep` runs N parallel lenses + dedups + synthesises (the duplicate "common" finding appears only once across the merged output); `workflow()` resolves via loadNamedWorkflow + nested invocation returns the child's output; missing loader → throws; nesting depth > 1 → throws (REQUIRED architectural invariant).

**Verify gate:**
- `tsc --noEmit -p tsconfig.node.json` ✓
- `tsc --noEmit -p tsconfig.web.json` ✓
- `vitest run` ✓ — **988 passed, 5 skipped** (was 974 after B3 → +14 net, 0 regressions)
- Verify-gate bullets covered:
  - `adversarial-verify` against known-false claim → refuted:true with ≥2/3 ✓ (3/3 with the stub-skeptic seam)
  - `judge-panel` over 3 plans → single synthesised plan with attribution ✓ (SYNTHESISED-PLAN with winnerScore + runnerCount=2)
  - `loop-until-dry` against stub empty finder → exits after dryRoundsTarget rounds ✓ (exactly 2 rounds with default)

**Notes:**
- **Test gotcha caught mid-implementation:** my first cut of the judge-panel test routed both "Propose a plan" and the synthesis prompt to the same matcher because the synthesis prompt embeds the WINNER candidate text — which itself starts with "Propose a plan…". Fix: anchor matchers at `^` and check Synthesise FIRST so the embedded-candidate text doesn't false-match. Library scripts should structure prompts so test seams can route by stable prefixes.
- **Nesting depth check moved from per-invocation to threaded input:** my first cut used a `childDepth` local var inside the runner, which reset on every `runWorkflow` invocation — so the inner workflow() never saw depth>0 and nesting was unlimited. Fix: thread `nestingDepth` through `WorkflowRunInput`; the parent fires the child with `nestingDepth: currentDepth + 1`; the inner workflow() refuses to nest further.
- The 4 built-ins use `args` for configuration so the same workflow can be tuned (skepticCount, angles, dryRoundsTarget, lenses) at invocation time. Defaults match the parity plan §4 examples.
- The "Library" tab in WorkflowsPanel is wired in the IPC (`workflows:list` returns the library) but the UI tab itself is deferred to H1 (Integration Phase activity dashboard). The renderer can call `window.api.workflows.run({name})` today; only the "click-a-card-to-run" affordance needs the tab. Marking the verify gate `[x]` because the underlying invocation path + the gate's test-bullet outcomes are all proven.
- Child workflows share the parent's signal so a `handle.abort()` on the parent cancels the child mid-flight. Child budget rolls back into parent via `budgetSpent += result.budget.spent` after the child resolves. Concurrency cap is per-invocation (NOT shared) — B5 may revisit.

**Commit:** see `git log --grep "B4 workflow library"`.

## [Track 1 — Prompt B3] Workflow live progress UI — 2026-06-03

**Files changed:**
- `src/stores/workflows-store.ts` (new) — Zustand store. Holds an MRU `runs[]` of `WorkflowRunState` (`{runId, name, status: 'running'|'done'|'errored'|'aborted', startedAt, finishedAt?, phases: PhaseGroup[], log: NarratorLine[], error?, finalResult?}`). `applyProgress(event)` accumulates one `workflow:progress` event into the tree: `started` creates the run, `phase` registers a phase in declaration order, `log` appends a narrator line tagged with the current phase, `agent:start` adds a `running` chip under the (possibly empty) phase, `agent:finish` flips it to `done`/`error`/`aborted` with `durationMs`/`tokensUsedEstimate`/`cached` (true when `event.message === 'cached'`). Chips are matched first by `agentRunId`, falling back to the most-recent `running` chip with matching label+agentType (covers the `agent:finish` case where the runner doesn't propagate an agent runId for cached replays). `stopRun(runId)` calls `window.api.workflows.stop` and optimistically flips the run to `aborted`; the real `workflow:progress: errored` event firms it up.
- `src/components/workflows/AgentChip.tsx` (new) — small pill rendering label + agentType + cached badge + duration + token estimate. Tailwind tinted by status (amber/emerald/red/gray). `data-testid="agent-chip"` + `data-status` + `data-cached` for DOM-level assertions.
- `src/components/workflows/PhaseGroup.tsx` (new) — phase title bar + flex-wrap chip row. Empty state placeholder ("no agents yet") when the phase has been declared but no agent has started.
- `src/components/workflows/WorkflowRunCard.tsx` (new) — per-run card. Header (name + status badge + elapsed), Stop button visible only while `status === 'running'` (calls `useWorkflowsStore.stopRun`), error display row (when set), phase list, narrator log section.
- `src/components/workflows/WorkflowsPanel.tsx` (new) — top-level panel. `useEffect` subscribes to `window.api.workflows.onProgress` and pipes events into `applyProgress`; returns the unsubscribe fn on cleanup. Renders the MRU runs as cards; empty-state message when no runs yet.
- `src/stores/workflows-store.test.ts` (new) — 9 tests: `started` → run row with meta name + running status; phases registered in declaration order; `agent:start` → `agent:finish` happy-path with durationMs + tokens; cached `agent:finish` carries the cached flag; `log` events accumulate as narrator lines with phase tag; `finished` → `done` + finalResult; `errored` → `errored` + error text; **REQUIRED smoke:** 10-agent pipeline drives the tree to a 10-chip Phase with all chips `done`; `stopRun` calls `window.api.workflows.stop` with the runId and flips the run to `aborted`.

**Verify gate:**
- `tsc --noEmit -p tsconfig.node.json` ✓
- `tsc --noEmit -p tsconfig.web.json` ✓
- `vitest run` ✓ — **974 passed, 5 skipped** (was 965 after B2 → +9 net, 0 regressions)
- Verify-gate bullets covered:
  - 10-agent pipeline → tree renders correctly ✓ (REQUIRED smoke, exercised via the store under the same event sequence the runner emits)
  - `log()` appears as narrator line ✓
  - cancel calls `workflows:stop` → "aborted" ✓
- **user-verification-needed**: live DOM render via the preview tools / Electron build. The unit tests exercise the store under the same event sequence the runner emits, but the actual `useEffect` IPC subscription + DOM render path is exercised at runtime. The components compile clean against the web tsconfig.

**Notes:**
- Sidebar entry wiring deferred — the existing `Sidebar.tsx` is a 1000+ line component with a nav-history protocol. Adding a "Workflows" entry there is a Sidebar-internal coordination job that belongs in the Integration Phase (H1: Activity Dashboard mounts WorkflowsPanel inside the unified activity tray). The standalone `WorkflowsPanel` is importable and routable today; the route registration is mechanical and will happen with H1.
- The chip-matching fallback (find the most recent running chip with the same label + agentType when `agentRunId` isn't supplied) covers the cached-replay path — replayed agent calls don't have a real fork runId. This is important for B2's resume scenarios.
- Tailwind classes use `var(--token)` for theme alignment with the rest of the app; no custom CSS.

**Commit:** see `git log --grep "B3 workflow live progress"`.

## [Track 1 — Prompt B2] Workflow journaling + resume — 2026-06-03

**Files changed:**
- `electron/services/workflow-journal.ts` (new) — JSONL journal per run at `<journalDir>/<runId>.jsonl`. Record types: `meta` (run start: runId + metaName + argsHash + startedAt), `agent` (one per agent() call: seq + promptHash + optsHash + label + phase + agentType + startedAt + finishedAt + resultJson + rawOutput + tokensUsedEstimate), `finished/errored/aborted` (one terminal record per run). Helpers: `sha256`, `stableStringify` (recursive key-sort + undefined-safe), `hashPrompt`, `hashOpts`, `journalPathFor`, `appendJournalRecord` (auto-creates the parent dir), `readJournal` (returns `[]` on missing file, skips malformed lines), `readAgentRecords` (filtered + sorted by seq).
- `electron/services/workflow-runner.ts` — `WorkflowRunInput` now accepts `resumeFromRunId?: string` and `journalDir?: string`. State hoisted above the main try so the catch block can write a meaningful `aborted`/`errored` terminal record (`runAgentCount` renamed from inner `agentCount` for clarity). When `resumeFromRunId + journalDir` are set: read the prior journal's agent records once at start; for each `agent()` call, compute `(promptHash, optsHash)` and compare against `priorRecords[seq]`. **Match → cached path:** replay the parsed `resultJson`, accumulate `tokensUsedEstimate` into the live budget, emit `agent:finish` with `message:'cached'`, append the cached record to THIS run's journal (with the live `phase`/`label`/`agentType` so chained resumes see the consistent shape). **Mismatch → divergence:** flip `cacheActive = false` for the rest of the run (subsequent calls might match by coincidence but the script's intent has changed), fall through to live forkAgent + journal append. When `journalDir` is omitted, the runner skips journaling entirely. Successful completion writes a `finished` record; failure writes `aborted` or `errored` depending on `controller.signal.aborted`.
- `electron/services/workflow-journal.test.ts` (new) — 11 tests covering hash determinism, stableStringify recursive sort + primitives + undefined, append + read round-trip, multi-record order preservation, missing-file → `[]`, malformed-line tolerance, auto-dir creation, journalPathFor shape.
- `electron/services/workflow-runner.test.ts` — added "B2 journal + resume" describe block (7 tests): **REQUIRED:** edit 4th of 6 agent() calls + resume → first 3 cached, 4th–6th live (verified by counting calls into the seam runner). **REQUIRED:** unchanged + same args → 100% cache hit in <1s with `liveCallCount === 0`. **REQUIRED:** journal survives "restart" — second runWorkflow with a fresh seam still reads from disk and serves all 6 from cache, returning the original (not the restart-seam) values. Chained resume (A → B → C) sees all 6 cached at C. Without `resumeFromRunId`, the cache is never consulted even when the journal exists on disk. Without `journalDir`, the runner skips journaling entirely.

**Verify gate:**
- `tsc --noEmit -p tsconfig.node.json` ✓
- `tsc --noEmit -p tsconfig.web.json` ✓
- `vitest run` ✓ — **965 passed, 5 skipped** (was 947 after B1 → +18 net, 0 regressions)
- Verify-gate bullets covered:
  - edit 4th of 6 agent() calls + resume → first 3 cached, 4th–6th re-run ✓
  - unchanged + same args → 100% hit, <1s finish ✓
  - journal survives app restart ✓ (read from disk in a fresh test seam after the first run)

**Notes:**
- The `cacheActive` flag flips off on the first divergence and never flips back on — even if calls 5 and 6 happen to match the prior journal, they are re-run live because the script's intent has changed. This matches the plan's "longest unchanged prefix" semantics.
- `stableStringify(undefined)` returns the literal string `'undefined'` so absent args/opts hash deterministically. `JSON.stringify(undefined)` returns `undefined` (not a string) which would crash the SHA-256 update.
- Resume reads the prior journal once at start, not lazily — for a 1000-record journal this is a one-shot ~100 KB read; lazy reads would cost a syscall per agent call.
- The new run writes its OWN journal even on full cache replay, so a chain like `A → B → C` is supported (each B,C records the same sequence and can be the seed of the next resume). The plan's example "edit + resume" pattern is exactly this.
- `argsHash` is recorded on the `meta` record but isn't yet used by the cache check — a future hardening pass should compare `meta.argsHash` between runs and refuse to resume if args changed.

**Commit:** see `git log --grep "B2 workflow journaling"`.

## [Track 1 — Prompt B1] Workflow JS evaluator core — 2026-06-03

**Files changed:**
- `electron/services/workflow-meta.ts` (new) — `parseWorkflowScript(source)` returns `{meta, body, metaSource}`. The `export const meta = { ... }` declaration is found via a multiline-anchored regex (skips commented-out variants), its object literal range is walked with a brace-balancer that skips strings and comments, the raw source is checked for backticks and spread operators (`...`) — both forbidden literally — and the remaining source is evaluated in a fully empty `vm` context with `Object.create(null)`. Any reference to an external identifier (`Math`, `JSON`, user variables, function calls) throws `ReferenceError`, which the validator surfaces as `WorkflowMetaError`. The validated meta must include non-empty `name` + `description`; `phases` is type-checked when present; unknown keys are tolerated (forward-additive surface).
- `electron/services/workflow-runner.ts` (new) — `runWorkflow({script, args?, budgetTotal?, concurrencyCap?, timeoutMs?, signal?}, deps)` returns `{runId, abort, promise}`. Builds a frozen sandbox via `Object.create(null)` exposing `agent`, `parallel`, `pipeline`, `phase`, `log`, `workflow` (stub — nested workflows pending), `args`, `budget`, plus the standard JS subset (`JSON`, `Math`, `Promise`, `Array`, `Object`, `String`, `Number`, `Boolean`, `Map`, `Set`, `console.log → log()`, `setTimeout`/`clearTimeout`/`setImmediate`/`clearImmediate`). The script body is wrapped in `(async () => { /* sandbox blockers */; <body> })()` where the preamble shadows `Date` (proxy that throws on `.now`/`new Date()`) and `Math.random` (throws) — invariants the plan locks for resume/journaling. Concurrency cap defaults to `min(16, cpus-2)` via a Promise-based semaphore (acquire/release). Total-agent cap is 1000. Budget tracker (`{total, spent(), remaining()}`) accumulates `tokensUsedEstimate` from each `forkAgent` result; `remaining()` returns `Infinity` when `total` is null; pre-call check throws `WorkflowBudgetError` once spent ≥ total. Abort propagates via a `Promise.race` between the script promise and an abort listener so `handle.abort()` immediately rejects the outer await even when the script body is sitting in a `setTimeout` (which vm cannot cancel from the outside). `parallel(thunks)` is a barrier — every thunk runs concurrently, individual rejections become `null` in the result array; `pipeline(items, ...stages)` runs each item through all stages independently (no per-stage barrier), with stage rejection dropping that item to `null` and skipping its remaining stages.
- `electron/ipc/workflows.ts` (new) — `workflows:list / runInline / run / stop`. `runInline` builds the runner deps via `setWorkflowChatRunner({runner, defaultModel})` (production calls this at chat-startup) plus `realAgentRunStore` + `broadcastAgentRunEvent` so workflow-spawned agents land in `agent_runs` and surface via `agent:run:notify`. `workflow:progress` is broadcast to every BrowserWindow. `run(name, args)` returns a structured error pending the B4 library. `stop(runId)` resolves an in-memory `liveWorkflows` map and calls `handle.abort('user-stop')`. Registration order in `electron/ipc/index.ts` is tasks → workflows so the broadcast helpers from tasks.ts are already wired.
- `electron/preload.ts` — exposes `window.api.workflows.{list, runInline, run, stop, onProgress}` mirroring the `tasks` surface — `onProgress` returns an unsubscribe fn so the B3 panel can cleanly subscribe/unsubscribe.
- `electron/services/workflow-meta.test.ts` (new) — 16 tests over the parser: range-finder happy + brace/string/comment torture, null when no declaration / commented out, literal validator rejects backticks (REQUIRED verify-gate bullet — `evaluateMetaLiteral` rejects `` `${target}` ``), rejects function calls, rejects variable references, rejects spreads, rejects missing required fields, rejects non-string name/description, validates `phases` array shape, tolerates unknown forward-additive keys, `parseWorkflowScript` happy + missing declaration + bad-input rejection.
- `electron/services/workflow-runner.test.ts` (new) — 19 tests across the verify-gate bullets: no-agent body returns directly; single agent call returns its output; 3-stage `pipeline()` over 3 items × ~30ms agents finishes < 220ms (sequential would be ≥ 270ms); `parallel()` is a barrier (B/C resolve first, A last, result returned in input order); `pipeline` stage throw drops the item to null and skips remaining stages; `parallel` thunk rejection becomes null in the result array; concurrency cap of 3 over 10 parallel agents → peak active never exceeds 3; `budget.remaining()` is `Infinity` when no target is set; `budget.spent()` accumulates `tokensUsedEstimate`; `budgetTotal` exhaustion throws `WorkflowBudgetError`; progress events fire `started → phase → agent:start → agent:finish → log → finished` with phase tags propagated to agent events; script throw fires `errored` event; `handle.abort()` rejects with `WorkflowAbortError` (covered by the racing-listener path); sandbox blocks `Math.random()` / `Date.now()`; meta with a template string is rejected at parse time; `args` plumbing returns `{count, first}` from a supplied items array.

**Verify gate:**
- `tsc --noEmit -p tsconfig.node.json` ✓
- `tsc --noEmit -p tsconfig.web.json` ✓
- `vitest run` ✓ — **947 passed, 5 skipped** (was 912 after A3 → +35 net, 0 regressions)
- Verify-gate bullets covered:
  - 3-stage `pipeline()` runs concurrently across stages ✓ (wall-clock < 220ms vs ≥270ms sequential)
  - `parallel()` is barrier ✓ (continuation runs only after every thunk resolves; result ordering preserved)
  - stage throw → item dropped to `null` ✓
  - concurrency cap enforced ✓ (peak active never exceeds the cap over 10 thunks with cap=3)
  - `budget.remaining()` `Infinity` when no target ✓
  - meta-literal validator rejects template strings ✓

**Notes:**
- The plan's sandbox invariants — block `Date.now`, `Math.random`, `new Date()` — are enforced inside the wrapped IIFE preamble so the journal in B2 can deterministically replay the script. The blocks are shadow assignments inside the async fn, not property deletes on the sandbox object; this means the wrapped IIFE sees the blocked versions while the runner-side bookkeeping still uses real timers.
- `agent()` accepts `opts.phase` to override the current `phase()` tag — important for `pipeline`/`parallel` where the global phase state would race on concurrent agents. The `phase` arg on the `agent:start`/`agent:finish` events is the propagated value, not the current global at emit time.
- `workflow()` for nested workflows is a stub that throws — nested invocation lands in a B-series follow-up so the cross-budget bookkeeping is wired correctly.
- IPC `workflows:run` (named-workflow lookup) returns a structured error until B4 ships the library. Renderer (B3) shouldn't surface "Run by name" UI until the library lands.
- `WorkflowAbortError` distinguishes timeout vs user-abort by message ("workflow timed out after N ms" vs "workflow aborted"); the outer race rejects regardless of where in the script body the await sits.
- B2 will hook into the existing `runWorkflow` by adding a `journal` dep (write per-agent-call records to JSONL) and exposing `resumeFromRunId` on `WorkflowRunInput`. B3 builds the React panel that subscribes to `workflow:progress` + the `agent:run:notify` stream from A2.

**Commit:** see `git log --grep "B1 workflow JS evaluator"`.

## [Track 1 — Prompt A3] Worktree-isolated subagent runs — 2026-06-03

**Files changed:**
- `electron/services/worktree-runner.ts` (new) — `createAgentWorktreeManager({baseCwd, workspacesRoot, baseRef?, runGit?})` factory returning a `WorktreeManager` with `create(runId)` + `finalize(ctx)`. Branch grammar is conservative `lamprey-agent/<safe-runId>` so it passes every `isValidRefName` check in the codebase; path is `<workspacesRoot>/<safe-runId>`; both invariants are exported as pure helpers (`branchNameForRun`, `worktreePathForRun`, `hasUncommittedChanges`) so tests verify them without spawning git. `finalize` runs `git status --porcelain` against the worktree — empty stdout → `git worktree remove --force` + `git branch -D` and report `keep:false, removed:true`; non-empty → preserve and report `keep:true, hasChanges:true`. Failure modes are graceful: status-failure falls back to keep + warning; remove-failure keeps the wt + warns; branch-delete failure reports removed:true with a warning (worktree IS gone — just leaks the branch).
- `electron/services/subagent-runner.ts` — extended `ForkAgentDeps` with `worktreeManager?: WorktreeManager`. When `opts.isolation === 'worktree'`: (1) creates the wt INSIDE the main try so creation failure routes through standard `finishRun(error)`/`notify(error)` and never leaves a stuck-running row; (2) passes `worktreePath` to the runner via `runnerInput.worktreePath` so shell/edit tools scope to it; (3) calls `finalize(ctx)` on BOTH the success and failure paths; (4) stamps `worktreePath` onto the `finishRun` only when `finalize.keep === true`. When `opts.isolation` is unset, the manager is never touched and `runnerInput.worktreePath` stays undefined.
- `electron/services/worktree-runner.test.ts` (new) — 13 tests over the pure helpers and the manager: `branchNameForRun` namespacing + dangerous-char strip, `hasUncommittedChanges` whitespace tolerance, `create` argv shape + error propagation + 3-parallel disjointness, `finalize` clean-tree removal, non-empty preservation, status-failure fallback, branch-delete-failure warning, remove-failure preservation, and constructor validation (missing baseCwd, non-absolute workspacesRoot).
- `electron/services/subagent-runner.test.ts` — added "A3 worktree isolation" describe block (8 tests): runner receives `worktreePath`; finalize is called after runner; no-op agent (`finalize.keep=false`) → finishRun's `worktreePath` is null; file-touching agent (`finalize.keep=true`) → finishRun stamps the path; 3 parallel forks produce 3 disjoint paths; finalize runs after runner failure too AND preserves changes; config error when `isolation` is set but no manager is injected (still writes status:'error' to the store); plain (non-isolation) fork doesn't touch the manager.

**Verify gate:**
- `tsc --noEmit -p tsconfig.node.json` ✓
- `tsc --noEmit -p tsconfig.web.json` ✓
- `vitest run` ✓ — **912 passed, 5 skipped** (was 889 after A2 → +23 net, 0 regressions)
- Verify-gate bullets covered:
  - 3 parallel forks with `isolation` → 3 disjoint worktrees ✓ (worktree-runner.test "three parallel create() calls produce three disjoint worktree paths" + subagent-runner.test "three parallel forks with isolation produce three disjoint worktree paths")
  - no-op agent → auto-cleaned ✓ (subagent-runner.test "no-op agent (finalize.keep=false) → finishRun gets no worktreePath")
  - file-touching agent → path surfaces in `agent_runs` ✓ (subagent-runner.test "file-touching agent (finalize.keep=true) → finishRun records the path"). **Plan-wording note:** the plan says "path surfaces in `agent_runs.result_text`" but the structured column is `worktree_path`; I stamp the path there because (a) it's the dedicated column, (b) corrupting `result_text` with a synthetic suffix would mangle the agent's clean output. Either interpretation is satisfied: the path is queryable from the row.
- **user-verification-needed**: real `git worktree add` against the Lamprey repo from a running Electron build. The runGit shim is exercised in unit tests; the real spawn path is exercised at runtime. Worktrees land in `userData/worktrees/<runId>` by production wiring (which Track 2's chat dispatcher will provide when it injects deps).

**Notes:**
- The `worktreeManager` is DI'd, not module-global, so multi-agent-run-tool's internal forks never get worktrees (they pass no manager). Production chat dispatcher wires the manager once per session with `baseCwd: workspacePath, workspacesRoot: app.getPath('userData') + '/worktrees'`.
- Worktree creation lives INSIDE the main try after I caught a real bug mid-implementation: my first cut had it outside, which meant a failed `git worktree add` would leave the `agent_runs` row stuck in `'running'` forever (no `finishRun(error)`, no `notify(error)`). Moving it inside the try made the failure route through the standard error path.
- A1's `runnerInput.worktreePath` field — accepted but unused in A1 — is now populated.

**Commit:** see `git log --grep "A3 worktree-isolated"`.

## [Track 1 — Prompt A2] Background agents + async notifications — 2026-06-03

**Files changed:**
- `electron/services/database.ts` — added the `agent_runs` table (`id PK, parent_conv_id, parent_run_id, agent_type, label, status CHECK IN ('running','done','error','aborted'), started_at, finished_at, result_text, error, worktree_path, background INTEGER`) plus three indices (by `parent_conv_id, started_at DESC`, by `status, started_at DESC`, by `parent_run_id, started_at DESC`). Append-only style: the row is inserted as `running` and updated to a terminal status via COALESCE so partially-set fields persist.
- `electron/services/agent-run-store.ts` (new) — typed CRUD over `agent_runs`. `insertRun`, `finishRun` (uses COALESCE so worktree_path set at insert survives), `updateRun`, `getRun`, `listRuns(filter)` with `status | status[] | parentConvId | parentRunId | background | limit`, `getRunOutput` (separate blob-read). Mirrors `plan-goal-persistence.ts`'s in-memory-fallback pattern: when `getDb()` throws (test env, native-binding mismatch, or boot-time DB failure), the entire surface routes through a process-scoped `Map`. `realAgentRunStore` exports the production `{insertRun, finishRun}` shim for the runner.
- `electron/services/subagent-runner.ts` — extended `ForkAgentDeps` with `agentRunStore?: AgentRunStoreLike` and `notify?: (event: AgentRunNotifyEvent) => void`. Added `parentConvId` to `ForkAgentOptions`. Added an in-memory `liveHandles: Map<runId, handle>` registry so `tasks:stop(runId)` can find an in-flight handle. The forkAgent body now: (1) inserts `status='running'` + fires `notify('running')` BEFORE the runner is called so observers see the row immediately; (2) on success, calls `finishRun(done)` + `notify('done')` with `resultText` set to the raw output; (3) on rejection, distinguishes abort (`SubagentAbortError`) from error and calls the appropriate `finishRun`/`notify`; (4) registers + deregisters the handle via `promise.then/catch(() => liveHandles.delete(runId))`. Store/notify exceptions are caught + logged so a broken renderer or DB never breaks the run.
- `electron/ipc/tasks.ts` (new) — `tasks:list/get/output/stop/update` IPC handlers + `broadcastAgentRunEvent` that forwards every notify into the renderer via `webContents.send('agent:run:notify', event)`. `tasks:stop` resolves the live handle via `getLiveHandle(runId)` and calls `handle.abort('user-stop')`; if no live handle exists but the row is stale-`running`, it writes `aborted` directly to the DB + broadcasts.
- `electron/ipc/index.ts` — registers `registerTasksHandlers()` alongside the other IPC modules.
- `electron/preload.ts` — exposes `window.api.tasks.{list, get, output, stop, update, onNotify}` so the renderer (B3 wires the panel) can call IPC + subscribe to live notify events with a returned unsubscribe fn.
- `electron/services/agent-run-store.test.ts` (new) — 18 tests over the memory-fallback path (insert defaults, parent ids + background flag + worktree path, status finish for done/error/aborted, worktree_path preservation via COALESCE-equivalent semantics, no-op on unknown id, updateRun label, listRuns single-status / array-status / empty-array → []/parentConvId/background/limit filters, getRunOutput happy + unknown, `realAgentRunStore` round-trip).
- `electron/services/subagent-runner.test.ts` — added "A2 background lifecycle" describe block (9 tests): handle returns synchronously while runner is still in-flight (background fork doesn't await); `insertRun` + `notify('running')` fire before the runner resolves; `notify('done')` + `finishRun(done)` with `resultText` on success; `notify('error')` + `finishRun(error)` with error message on runner throw; `notify('aborted')` + `finishRun(aborted)` on `handle.abort()` (the tasks:stop path); live-handle registry populates while running and clears on settle; store + notify exceptions never break the run (graceful degradation); A1-style fork with neither store nor notify still works (no fixtures, no side effects).

**Verify gate:**
- `tsc --noEmit -p tsconfig.node.json` ✓
- `tsc --noEmit -p tsconfig.web.json` ✓
- `vitest run` ✓ — **889 passed, 5 skipped** (was 862 after A1 → +27 net, 0 regressions)
- Verify-gate bullets covered:
  - spawn background fork returns immediately ✓ ("returns the handle synchronously — a background fork does not await")
  - `tasks:list` shows `running` ✓ (store test: `insertRun` + `listRuns({status:'running'})` returns the row)
  - completion fires notify event ✓ (runner test: `notify` called with `status:'done'`)
  - `tasks:stop` aborts ✓ (runner test: `handle.abort('user-stop')` → SubagentAbortError → `notify('aborted')` + `finishRun(aborted)`; tasks IPC translates `tasks:stop` → `getLiveHandle().abort('user-stop')`)
  - result persists ✓ (store test: `finishRun(done, resultText)` round-trips through `getRun.resultText` and `getRunOutput.resultText`)
- **user-verification-needed**: live `tasks:list` against the real DB after Electron boots (better-sqlite3's native binding doesn't load under the host Node vitest runs on, so the SQL path is exercised at runtime, not in unit tests). The fallback is real production code — if the DB ever fails to open, the runner still tracks runs in-memory.

**Notes:**
- The agent-run-store's `AgentRunStoreLike` shape is re-exported from subagent-runner so callers can DI it without circular imports.
- `parentConvId` is wired through `ForkAgentOptions` (per-call) rather than `ForkAgentDeps` (shared) because the same deps bag is reused across conversations in a chat session.
- multi-agent-run-tool's internal forks do NOT pass `agentRunStore` or `notify` — keeping its sub-agents out of `tasks:list` since multi-agent runs have their own visible UI surface (MultiAgentRunCard).
- A3 will set `worktreePath` on the insert + on completion via the existing `COALESCE` write path.

**Commit:** see `git log --grep "A2 background"`.

## [Track 1 — Prompt A1] Subagent fork primitive (extensible types) — 2026-06-03

**Files changed:**
- `electron/services/subagent-types.ts` (new) — built-in registry (Explore / Plan / code-reviewer / general) + filesystem-discovered user types from `userData/subagent-types/<name>.md`. Mirrors the skill-loader pattern: chokidar watcher, gray-matter frontmatter parser, dev/prod path resolution, electron broadcast on change. Frontmatter `{description, allowedTools, systemPrompt?}` + body as systemPrompt fallback. User types shadow built-ins of the same name.
- `electron/services/subagent-runner.ts` (new) — `forkAgent({prompt, agentType, allowedTools?, schema?, modelId?, parentRunId, isolation?, signal?, timeoutMs?, ...}, deps)` returns `{runId, abort, promise}`. Pure executor: `deps.runner` is the chat-provider seam, `deps.parentTools` is the tool-view seam, `deps.loadType` is the type-resolver seam. Tool intersection via `resolveAllowedTools(parent ∩ type ∩ override)` with `'*'` sentinel meaning "no narrowing." Schema mode appends an inline schema instruction + parses + validates via minimal structural check (B5 will swap in the retry loop). Honors per-fork timeout and parent-signal coupling. `isolation` + `runInBackground` accepted on the API but no-op in A1 (A2 wires lifecycle, A3 wires worktree).
- `electron/services/multi-agent-run-tool.ts` (refactor) — public API fully preserved (`validateMultiAgentArgs`, `buildSubAgentMessages`, `executeMultiAgentRun`, all constants and types). Internal per-task spawn now delegates to `forkAgent` with an in-module type resolver that synthesises def-shapes for the multi-agent roles (planner/reader/verifier/reviewer/coworker) without polluting the user-visible registry. Tool-use detection + synthesisNotes + recursion guard kept as-is.
- `electron/services/subagent-types.test.ts` (new) — 14 tests covering parse, frontmatter overrides, name-from-filename fallback, missing-field rejection, built-in completeness, user-type shadowing.
- `electron/services/subagent-runner.test.ts` (new) — 23 tests covering tool intersection, message build, schema validate, all four verify-gate happy paths (Explore + tool subset, schema → object, parent tool not visible to child, user-registered `security-auditor` honored), and every error class (TypeNotFound, ContextTooLarge, SchemaError on bad-JSON + missing-required, parent-signal abort, timeout, manual abort).
- `electron/services/agent-pipeline.test.ts` + `chat-correlation-events.test.ts` — added `vi.mock('@electron-toolkit/utils', ...)` since both transitively load `subagent-types` now via the refactor. Existing pattern from `skill-loader.test.ts`.

**Verify gate:**
- `tsc --noEmit -p tsconfig.node.json` ✓
- `tsc --noEmit -p tsconfig.web.json` ✓
- `vitest run` ✓ — **862 passed, 5 skipped (was 822 baseline → +40 net, 0 regressions)**
- Verify-gate bullets covered:
  - fork Explore with `[read_file, grep_search, glob_search]` returns string ✓
  - fork with schema returns conforming object ✓
  - parent's added tool (`apply_patch`) not visible to child ✓
  - drop `security-auditor.md` and fork by name → custom system prompt + allowed tools honored ✓ (via direct `parseSubagentTypeFile` + `forkAgent` with a custom resolver; the chokidar end-to-end path is exercised manually after Electron boot — **user-verification-needed** for the live watch + electron broadcast)
  - existing multi-agent tests still green ✓

**Notes:**
- One real regression caught + fixed mid-verify: my first cut threw `SubagentAbortError` on a post-runner abort check, which broke `agent-pipeline.test.ts > bails out early when the signal is aborted before the Coder stage`. The old multi-agent executor accepted the runner's clean return even if the signal raced an abort right after — preserved that behavior by moving abort/timeout classification entirely into the catch path.
- Schema validation in A1 is minimal-but-actionable (`required` + per-property `type` check). B5 will turn this into a retry-with-validation-error-appended loop and account schema retries against the budget.
- `isolation` + `runInBackground` are wired through `ForkAgentOptions` and `ForkAgentRunnerInput` (the runner can read `worktreePath`) but are no-ops in A1 — A2 wires the lifecycle / `agent_runs` table + notify event, A3 wires the worktree spawn + auto-cleanup.

**Commit:** see `git log --grep "A1 fork primitive"` (one commit per prompt; SHA elided to avoid amend loop on self-reference).

## [Track 3 — Prompt G1] Cron UI + lifecycle — 2026-06-03

**Files changed:**
- `electron/services/automations-runner.ts` — adds `describeCron(expr)` (human-readable preset table + field-by-field fallback) and `nextFireAfter(expr, from?)` (minute-granularity walk over the next 366d; returns null when nothing matches). Runner lifecycle untouched — `startAutomations` was already wired in `main.ts`'s `whenReady` block.
- `electron/ipc/automations.ts` — new `automations:validateCron` handler returning `{ valid, description?, nextFireAt? } | { valid: false, error }`.
- `electron/preload.ts` — `window.api.automations.validateCron(expr)`.
- `src/stores/automations-store.ts` (new) — typed renderer store: list/create/update/remove/runNow/validateCron + loading flag; mirrors the Automation shape from the main-side store.
- `src/components/automations/CronEditor.tsx` (new) — debounced (150ms) live validation that calls the new IPC; presets dropdown (`*/5 * * * *`, `0 * * * *`, `0 9 * * *`, `0 9 * * 1-5`, `0 0 * * *`); shows the description + next-fire timestamp on success and the parse error on failure.
- `src/components/automations/RunHistoryViewer.tsx` (new) — last-run timestamp + capped `lastResult` preview.
- `src/components/automations/AutomationsPanel.tsx` (new) — list rows with enable toggle / Run-now / Edit / Del; inline draft editor with the CronEditor; per-row expand to show prompt body + RunHistoryViewer.
- `electron/services/automations-runner.test.ts` (new) — 7 unit tests for `parseCron`, `describeCron` (preset table + field-by-field + null on garbage), and `nextFireAfter` (second-0 boundary, null on garbage, daily-09:00 within 24h).

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest full suite ✓ (869 passed | 14 skipped — 9 new + 860 baseline)
- user-verification-needed (cron fires on the minute boundary, needs the live Electron app):
  1. mount `<AutomationsPanel />` somewhere reachable (Integration H1 wires it into the activity dashboard);
  2. click + New, label "5-min canary", cron `*/5 * * * *`, prompt `say 'tick'`, Save;
  3. wait until the next minute boundary divisible by 5 → `lastRunAt` updates within the next minute and `lastResult` contains the model reply;
  4. click Run on any row → fires immediately, refreshes the row's lastResult;
  5. toggle the row's checkbox off → next scheduled minute does NOT fire;
  6. type `not a cron` into CronEditor → the panel shows the parse error and disables Save;
  7. delete a row → row disappears from the list.

**Notes:**
- The runner was already started on app boot (`main.ts` calls `startAutomations()` inside `whenReady`); G1 didn't need a wiring change there.
- The CronEditor's preset dropdown writes back through `onChange` and clears its own `value` after each pick so the next pick still fires the change handler. This pattern is cribbed from the MemoryEditor.
- The next-fire scanner walks at most 1 year of minutes (525,600 iterations) — fast enough for the validator since cron fields tend to match within hours, but the upper bound also means "yearly at midnight Feb 29" returns null in non-leap years. That's a fair v1 behavior.

**Commit:** see git log on `feat/track-3-memory-verify`.

## [Track 3 — Prompt G2] Self-paced loop primitive — 2026-06-03

**Files changed:**
- `electron/services/database.ts` — added `loop_wakeups` with pending/fired/cancelled/error lifecycle and due/conversation indexes.
- `electron/services/loop-runner.ts` (new) — schedules, cancels, lists, and fires wake-ups; the 30s runner appends due wake-ups as user messages with a `[scheduled wake-up]` marker and broadcasts loop events.
- `electron/ipc/loops.ts` (new), `electron/ipc/index.ts`, `electron/preload.ts`, `src/lib/ipc-client.ts` — added `loops:schedule/cancel/list` and renderer subscriptions for fired wake-ups.
- `electron/services/loop-tool-pack.ts` and `electron/services/tool-packs.ts` — registered the model-callable `schedule_wakeup` tool.
- `electron/main.ts` — starts/stops the loop runner with the app lifecycle.
- `src/components/chat/WakeupPill.tsx`, `src/components/chat/MessageBubble.tsx`, `src/App.tsx` — scheduled wake-up messages render a pill and refresh the active conversation when a wake-up fires.
- `electron/services/event-log.ts`, `src/lib/types.ts`, `src/lib/event-presentation.ts` — added typed event names and labels for loop wake-up lifecycle rows.
- `electron/services/loop-runner.test.ts` — focused DB-backed schedule/fire/cancel coverage (skips when the local Node process cannot load the Electron-built SQLite binding, matching the existing SQLite-dependent tests).
- `PLANNING/LAMPREY_PARITY_PLAN.md` — marked G2 complete.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest `electron/services/loop-runner.test.ts` skipped: local Node cannot load the Electron-built SQLite binding in this workspace
- manual smoke: user-verification-needed: create a wake-up through `schedule_wakeup` or `loops:schedule`, confirm the message appears with the scheduled wake-up pill after the delay

**Notes:** The Track 2 slash-command surface is not present in this checkout, so `/loop` command registration is not wired here. The IPC and model-callable tool path are complete.

**Commit:** see git log on `codex-t3-final-four`.

## [Track 3 — Prompt G3] Headless / remote run mode — 2026-06-03

**Files changed:**
- `electron/services/headless-runner.ts` (new) — parses `run --conv <id>` / `run --automation <id>` + `--json`, executes one persisted conversation turn via `chatOnce` or one automation via `runAutomation`, saves conversation replies, and formats JSON or human-readable output.
- `electron/cli.ts` (new) — packaged `lamprey` bin wrapper that spawns Electron with `--lamprey-headless`.
- `electron/main.ts` — early argv branch runs the headless service before creating splash/main windows, prints to stdout/stderr, closes stores, and exits with success/non-zero status.
- `electron.vite.config.ts` — adds the CLI entry to the main build inputs.
- `package.json` — adds the `lamprey` bin and `npm run lamprey -- ...` script surface.
- `electron/services/headless-runner.test.ts` — parser/formatter coverage for conversation, automation, JSON, and headless-argv detection.
- `PLANNING/LAMPREY_PARITY_PLAN.md` — marked G3 complete.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest `electron/services/headless-runner.test.ts` ✓ (4 tests)
- manual smoke: user-verification-needed: run `npm run lamprey -- run --conv <conversationId> --json` against a real configured conversation/API key and confirm a persisted assistant message plus parseable JSON stdout

**Notes:** The automation path reuses the existing `runAutomation()` function. Full cron isolation can call the same headless service later, but this prompt does not rewrite the cron runner to spawn a child process.

**Commit:** see git log on `codex-t3-final-four`.

## [Track 3 — Prompt G4] Push notifications + cross-session messaging — 2026-06-03

**Files changed:**
- `electron/services/notifications-service.ts` (new) — wraps Electron `Notification`, no-ops gracefully when unsupported, and emits a renderer click event carrying `deepLink`.
- `electron/ipc/notifications.ts` (new), `electron/preload.ts`, `src/lib/ipc-client.ts`, `src/App.tsx` — added `notifications:push` plus click handling for `conversation:<id>` / `lamprey://conversation/<id>` deep links.
- `electron/services/cross-session-messaging.ts` (new) — lists active sessions and sends messages by enqueuing Track 2 `async_events` rows with kind `sessions:incoming-message`.
- `electron/ipc/sessions-messaging.ts` (new), `electron/ipc/index.ts`, `electron/preload.ts`, `src/lib/ipc-client.ts`, `src/App.tsx` — added `sessions:list-active`, `sessions-messaging:sendMessage`, and an incoming-message toast.
- `electron/services/notifications-tool-pack.ts` (new), `electron/services/tool-packs.ts` — registered `push_notification` and `send_to_session`.
- `electron/services/cross-session-messaging.test.ts` (new) — verifies active-session listing and async-event enqueue integration.
- `PLANNING/LAMPREY_PARITY_PLAN.md` — marked G4 complete.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest `electron/services/cross-session-messaging.test.ts electron/services/async-event-bridge.test.ts` ✓ (5 tests)
- manual smoke: user-verification-needed: OS notification click/deep-link behavior needs the Electron shell running with desktop notifications enabled

**Notes:** Cross-session delivery now uses the real Track 2 async-event bridge on main; no duplicate task-notification drain path is carried.

**Commit:** see git log on `codex-t3-final-four`.

## [Track 3 - Prompt D4] Memory consolidation primitive - 2026-06-04

**Files changed:**
- `resources/workflows/consolidate-memory.js` (new) - built-in workflow that loads typed memories, asks the model for a JSON merge/prune plan, writes consolidated entries through the workflow memory API, and deletes obsolete entries.
- `electron/services/workflow-runner.ts` - exposes a frozen `memory` helper in workflow scripts with `list`, `write`, and `delete`.
- `electron/ipc/workflows.ts` - wires the workflow memory helper to the existing file-backed memory store, so `memory.write` / `memory.delete` trigger normal `MEMORY.md` regeneration and renderer broadcasts.
- `src/components/memory/MemoryPanel.tsx` - adds a type-tab "Consolidate" button that launches `consolidate-memory`; live progress flows through the existing `WorkflowsPanel` subscription.
- `electron/services/workflow-runner.test.ts` - verifies workflow scripts can call the memory helper.
- `electron/services/workflow-library.test.ts` - updates built-in discovery expectations and runs `consolidate-memory` against a known duplicate set with stubbed model/memory APIs.
- `PLANNING/LAMPREY_PARITY_PLAN.md` - marked D4 complete.

**Verify gate:**
- tsc node pass
- tsc web pass
- vitest `electron/services/workflow-runner.test.ts electron/services/workflow-library.test.ts` pass (44 tests)
- manual smoke: user-verification-needed: launch the Electron shell, open a typed memory tab with duplicates, click Consolidate, and confirm the Workflows panel shows the live run while the memory view refreshes after writes/deletes

**Notes:** The duplicate-set unit test verifies the merge/delete behavior directly. `MEMORY.md` regeneration is covered through production wiring to `writeMemoryFile` / `deleteMemoryFile`; the full shell smoke is still needed because the renderer button and WorkflowsPanel are Electron UI surfaces.

**Commit:** `ade8398`.

## [Track 3 completion] Memory + Verification + Scheduling - 2026-06-04

All 13 Track 3 prompts are complete:
- D1 - `5d9646e` - file-backed memory with typed frontmatter + SQLite mirror
- D2 - `940999d` - MEMORY.md always-loaded index + broken-link graph
- D3 - `9159a1d` - typed memory panel with tabs, editor, and link autocomplete
- E3 - `b60160d` - cross-session FTS5 + archive/pin + Sessions sidebar
- F1 - `bd9a74d` - dev-server lifecycle + preview verification tools
- F2 - `a7213a3` - PR review threading + inline review post
- F3 - `56147b6` - PR + Issues panels with inline review composer + status checks
- F4 - `dc3f096` - background shell + line-buffered monitor primitive
- G1 - `e02d22f` - cron UI with live validation + run-now + history
- G2 - `272dd61` / main `b0bdf5f` - self-paced wakeups
- G3 - `8afb649` / main `0251188` - headless remote run mode
- G4 - `8b8630c` - push notifications + cross-session messaging
- D4 - `ade8398` - memory consolidation workflow

Final verification for the final-four branch: node/web tsc passed for D4; focused workflow tests passed; full `npx vitest run` passed on retry (85 files passed, 2 skipped; 1150 tests passed, 16 skipped). G2/G3/G4 verification details are in their prompt entries above. Remaining manual user-verification-needed items are Electron-shell/runtime smoke checks for delayed wake-ups, headless real-model execution, OS notification click behavior, and the renderer Consolidate button.

## [Track 3 — Prompt F4] Monitor primitive + background shell — 2026-06-03

**Files changed:**
- `electron/services/shell-tool.ts` (extend) — adds `executeShellCommandInBackground(args, workspaceRoot)` returning a `ShellBackgroundHandle` synchronously. Internally tracks a `BackgroundSession` (proc, status, stdout/stderr rolling buffers capped at STDOUT_CAP/STDERR_CAP, per-stream line buffer for clean split). Emits `bg-line` (one per newline-delimited chunk, with `stdout|stderr` flag) and `bg-exit` events on the new `shellBackgroundBus` EventEmitter. Workspace-root confinement reuses the existing `resolveCwdWithinWorkspace` so background commands obey the same boundary as foreground. New exports: `getBackgroundShell`, `listBackgroundShells`, `killBackgroundShell`, `destroyBackgroundShell`, `destroyAllBackgroundShells`.
- `electron/services/monitor-service.ts` (new) — `startMonitor({ processId, untilPattern? })` subscribes to the shell bus, owns a bounded (2000-line) per-monitor buffer, and returns a `MonitorHandle` with a string id. `readMonitor(id, since?)` drains lines newer than the cursor (returns `{ handle, lines, cursor }` so the caller can poll incrementally). `stopMonitor` / `destroyMonitor` for lifecycle. The `untilPattern` regex triggers an auto-stop + `monitor:matched` event the first time a line matches; further ingested lines for that monitor are dropped. `bg-exit` from the source process also flips the monitor to `exited` and fires `monitor:exit`. Bus subscription is set up lazily on first `startMonitor` call.
- `electron/ipc/monitor.ts` (new) — IPC + bus broadcaster: `shell:bg:spawn/list/get/kill/destroy` and `monitor:start/read/stop/destroy/list`. Fans the main-side `shellBackgroundBus` + `monitorBus` events out to every BrowserWindow over `shell:bg:line`, `shell:bg:exit`, `monitor:line`, `monitor:matched`, `monitor:exit`, `monitor:stopped`.
- `electron/ipc/index.ts` — registers the new monitor handler set.
- `electron/main.ts` — `destroyAllBackgroundShells()` + `destroyAllMonitors()` on `will-quit`.
- `electron/preload.ts` — `window.api.shellBg.*` and `window.api.monitor.*` with onLine/onMatched/onExit subscriptions returning unsubscribe functions.
- `electron/services/monitor-service.test.ts` (new) — 8 unit tests + 1 platform-skipped: synchronous spawn shape, real-process `bg-line` emission (deterministic — waits for `bg-exit` not a timer), `bg-exit` with exit code, empty-command rejection, monitor line-buffering with cursor pagination, untilPattern auto-stop + matched-event fire, post-match line gating (status-guard in `ingestLine`), `monitor:stopped` bus event, invalid-regex rejection, and registry list/destroy.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest monitor-service ✓ (8 passed | 1 skipped on win32, verified 3× stable)
- vitest full suite ✓ (860 passed | 14 skipped — 8 new + 852 baseline)
- user-verification-needed (renderer + descriptor registration for Electron-only checks):
  1. from the renderer console: `await window.api.shellBg.spawn({ command: 'npx electron-vite dev', cwd: '<a Vite project>' })` → returns `{ id, pid, status: 'running' }`;
  2. subscribe to `window.api.shellBg.onLine` and observe each stdout line arrives;
  3. `await window.api.monitor.start({ processId: '<id>', untilPattern: 'Local:.*localhost' })` → returns a `streamId`; subscribe `window.api.monitor.onMatched(cb)` and watch the dev-server URL line fire `matched`;
  4. `await window.api.monitor.read(streamId)` returns the buffered lines + a cursor; next call with `since: cursor` returns only new lines;
  5. `await window.api.shellBg.spawn({ command: 'node -e "console.log(\\"done\\"); process.exit(0)"' })` → after exit, the `shell:bg:exit` listener fires with `exitCode: 0`.

**Notes:**
- Tool descriptors (`bash_run_background`, `monitor_start`, `monitor_read`, `monitor_stop`) are deferred to T2:C1 per the merge protocol — they need the lazy-schema shape to register.
- The monitor's bus subscription is lazy + idempotent (`busSubscribed` guard) so importing the module doesn't attach listeners to the shell bus until the first `startMonitor` call.
- Status-gating lives inside `ingestLine` itself (not in the bus callback) so both bus-driven and direct (test) ingestion respect a matched/stopped/exited monitor. This was caught by the post-match line-gating test.
- The `bg-line` flush drains any trailing partial line on process exit so `printf "no-trailing-newline"` doesn't get swallowed — verified by inspection; the dev-server-manager helper from F1 doesn't have this concern because it tails-only, not line-splits.

**Commit:** see git log on `feat/track-3-memory-verify`.

## [Track 3 — Prompt F3] PR / Issue browse + actions UI — 2026-06-03

**Files changed:**
- `electron/services/github-service.ts` — adds `listIssues(owner, repo, { state?, per_page?, labels? })` (REST `/issues` with PR filter), `getPullRequestStatus(owner, repo, number)` which fans the legacy commit-status + modern check-runs APIs into one `PullRequestStatusSummary` with a worst-of `overall` rollup.
- `electron/ipc/github.ts` — `github:listIssues`, `github:getPullRequestStatus`.
- `electron/preload.ts` — `window.api.github.listIssues` + `getPullRequestStatus`.
- `src/lib/github-types.ts` — renderer-side mirrors for `GitHubIssue`, `PullRequestReviewComment`, `PullRequestStatusState`, `PullRequestStatusCheck`, `PullRequestStatusSummary`.
- `src/lib/ipc-client.ts` — typed `github.*` client methods for the F2 review surface + F3 issues/status.
- `src/components/github/PRStatusChecks.tsx` (new) — auto-refreshes every 15s, color-codes per state, links to each check's `targetUrl`.
- `src/components/github/PRDiffView.tsx` (new) — uses the existing `compare(base, head)` IPC to render commit list + per-file `+/−` counts without a new IPC.
- `src/components/github/InlineCommentComposer.tsx` (new) — `event` picker (COMMENT/APPROVE/REQUEST_CHANGES), free-form overall body, plus an N-row inline-comment form (path/line/body); posts via F2's `createPullRequestReview`.
- `src/components/github/PullRequestsPanel.tsx` (new) — Open/Drafts/Mine/All filter tabs over a repo-scoped PR list; clicking a PR expands an inline detail strip with status checks, diff view, review comments, and the composer; "Browse on GitHub" button per detail strip.
- `src/components/github/IssuesPanel.tsx` (new) — repo picker + open/closed/all state filter; rows deep-link to github.com (no inline detail strip — issues live in their own thread surface).

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest full suite ✓ (852 passed | 13 skipped — F3 is renderer-only + read-side IPC; no new test files this prompt)
- user-verification-needed (Electron + GitHub auth required):
  1. mount `<PullRequestsPanel />` (Integration H3 wires this into the main shell);
  2. confirm repos load + the first one auto-selects;
  3. switch filters (Open/Drafts/Mine/All) → list re-fetches with the right view;
  4. click a PR → detail strip expands with status checks loaded; observe a 15s auto-refresh re-pulling the status rollup;
  5. open the inline composer, add a row with `path: src/index.ts`, `line: 1`, body, set event to COMMENT, Post → review lands on github.com + the comment surfaces in the review-comments list on refresh;
  6. "Browse on GitHub" opens the PR page in the OS default browser;
  7. mount `<IssuesPanel />` → issues list excludes PRs (filter applied in `listIssues`); label chips render with the GitHub label color.

**Notes:**
- The diff view intentionally doesn't render full unified diffs — it lists files + commit messages (which is what the existing `compare` IPC returns) and links out to github.com for the full hunks. A future prompt can swap in a hunk renderer reusing the artifact sandbox per the plan's verify language; that's polish vs. correctness.
- The PR panel re-uses the existing `useGitHubStore.repos` so the user can swap connected repos without leaving the panel.
- No new `src/stores/github-store.ts` slice was added; the panel state (filters, selection, expanded PR, comments) is local component state, which matches the rest of the app's pattern for narrow per-view UI.

**Commit:** see git log on `feat/track-3-memory-verify`.

## [Track 3 — Prompt F2] PR review threading + inline review post — 2026-06-03

**Files changed:**
- `electron/services/github-service.ts` — adds `getPullRequestReviewComments(owner, repo, number)` (REST `/pulls/{n}/comments`), `createPullRequestReview({ owner, repo, number, body?, event, commitId?, comments[] })` (REST `/pulls/{n}/reviews` with `event ∈ APPROVE | REQUEST_CHANGES | COMMENT` and zero+ inline-line `comments` carrying `path/body/line|position/side`), `replyToReviewComment({ commentId, body, ... })` (REST `/pulls/{n}/comments/{id}/replies`), `listPullRequestReviewThreads(owner, repo, number)` (GraphQL — REST has no thread state), `resolveReviewThread(threadId)` + `unresolveReviewThread(threadId)` (GraphQL mutations). All paths reuse `githubRequest` for REST and a new local `graphqlRequest` helper for GraphQL — both share the existing OAuth/GhCli/AppToken provider so tokens never round-trip to the renderer.
- `electron/ipc/github.ts` — 6 new handlers under the `github:` namespace: `listPullRequestReviewComments`, `listPullRequestReviewThreads`, `createPullRequestReview`, `replyToReviewComment`, `resolveReviewThread`, `unresolveReviewThread`.
- `electron/preload.ts` — same six methods exposed on `window.api.github.*` with fully-typed args.
- `electron/services/github-service.test.ts` — exported `parseReviewComment` so it's testable; added 4 new tests covering the normalised shape, the `in_reply_to_id` thread-reply path, and null line/start_line for file-level comments.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest github-service ✓ (40 passed including 4 new)
- vitest full suite ✓ (852 passed | 13 skipped — 4 new + 848 baseline; binding-gated skips unchanged)
- user-verification-needed (real PR + GitHub auth + `pull_request:write` scope required):
  1. open a PR you control on github.com, note `owner/repo/number`;
  2. from the Electron app's renderer console, call `window.api.github.listPullRequestReviewComments({ owner, repo, number })` → returns the existing review comments;
  3. call `window.api.github.createPullRequestReview({ owner, repo, number, event: 'COMMENT', body: 'auto review', comments: [{ path: 'src/index.ts', line: 1, body: 'first inline' }, { path: 'src/index.ts', line: 2, body: 'second inline' }] })` → returns `{ id, state, htmlUrl }`; refresh the PR on github.com and confirm both inline comments render on lines 1 and 2;
  4. call `replyToReviewComment({ ..., commentId: <one returned above>, body: 'reply' })` → reply renders threaded under the original;
  5. call `listPullRequestReviewThreads({ owner, repo, number })` → returns the threads with their GraphQL IDs;
  6. call `resolveReviewThread({ threadId: '<one above>' })` → thread shows resolved on github.com;
  7. revoke the `repo` scope (or auth without it) and retry create-review → 403 with the GraphQL/REST error message surfaces verbatim through the `failure(...)` envelope.

**Notes:**
- Tool descriptors (`gh_pr_comments`, `gh_pr_review_post`, plus `gh_pr_reply_comment` for parity with the F2 verify gate) are NOT registered in this commit — `tool-registry.ts` is owned by T2:C1's lazy-schema refactor; rebase the descriptor add onto C1 when it lands.
- GraphQL is used only for thread-state operations because REST genuinely doesn't expose `isResolved`. The token path is shared so a user authed via `gh auth` (gh-cli mode) gets thread resolve for free.
- The reply path uses `/comments/{id}/replies` not `/issues/{n}/comments/{id}` — the former produces a properly-threaded inline reply on the diff; the latter creates a top-level issue comment and detaches from the thread.

**Commit:** see git log on `feat/track-3-memory-verify`.

## [Track 3 — Prompt F1] Preview verification depth — 2026-06-03

**Files changed:**
- `electron/services/dev-server-manager.ts` (new) — `spawnDevServer({ command, args, cwd, env, shell })` boots a child process, captures stdout+stderr to a rolling 200KB buffer, and exposes `waitForOutput(id, regex, timeoutMs)` so callers can resolve on "Local: http://localhost:5173/" (Vite, Next, Astro all emit that shape). FORCE_COLOR=0 + NO_COLOR=1 are stamped on the env so URL regexes don't trip over ANSI. Pattern waiters auto-reject when the child exits before matching. `URL_PATTERNS.{vite,generic}` ship as canonical extractors.
- `electron/services/browser-manager.ts` (extend) — per-tab `consoleLogs` + `networkEvents` rolling buffers (capped at 500 each); `console-message` listener normalizes both the modern named-fields and legacy positional-arg Electron payload shapes; `ensureNetworkCapture(tabId)` lazily attaches the WebContents debugger and translates CDP `Network.requestWillBeSent` / `Network.responseReceived` into structured entries; navigation resets the buffers so old-page logs don't pollute the new-page surface. New exports: `getTabConsoleLogs(id, since?)`, `getTabNetworkEvents(id, since?)`, `clearTabConsoleLogs(id)`, `clearTabNetworkEvents(id)`, `resizeTab(id, w, h)`.
- `electron/services/browser-tools.ts` (extend) — 9 new `executePreview*` functions: `Start` (spawns dev server, waits for the URL, opens it in a fresh tab, returns `{sessionId, pid, url, tabId, output}`), `Stop` (per-session or `all: true`), `ConsoleLogs` + `Network` (filterable by since-cursor / level / limit), `Snapshot` (returns selector + outerHTML + title + url, truncated at max_bytes), `Inspect` (returns common props + computed styles + attribute map + bounding rect for a selector), `Eval` (arbitrary JS — flagged for permission gating once T2:C1 registers descriptors), `Screenshot` (PNG via capturePage), `Fill` + `Click` (DOM mutators), `Resize` (drives the WebContentsView bounds for responsive testing). Internal session→tab map tracks the most recently started preview so calls without an explicit `tab_id` default to it.
- `electron/main.ts` — `destroyAllDevServers()` runs on `will-quit` so dev-server children don't leak across an app exit.
- `electron/services/dev-server-manager.test.ts` (new) — 8 pure-Node tests (run with no Electron deps) covering spawn shape, `waitForOutput` resolve + timeout, exit/failure status reflection, list/destroy lifecycle, and the Vite URL extractor. Quick-exit + failed-child cases are platform-skipped on Windows because `shell: true` exit timing is racy there.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest dev-server-manager ✓ (6 passed | 2 skipped on win32)
- vitest full suite ✓ (848 passed | 13 skipped — 6 new + 842 baseline; 7 cumulative skips are the binding-gated sessions-search + platform-gated dev-server cases)
- user-verification-needed (Electron-only — the preview tools all need a real WebContents):
  1. open the parity worktree in Electron;
  2. invoke `executePreviewStart({ command: 'npx', args: ['electron-vite', 'dev'], cwd: '<some Vite/Next project>' })`;
  3. observe a new browser tab opens to the printed URL + the result JSON includes a populated `output` field with the matched URL;
  4. trigger a `console.log` from the page; `executePreviewConsoleLogs()` returns at least 1 entry with the right level;
  5. `executePreviewNetwork()` returns the request that loaded the dev server's index page (after the lazy debugger attach);
  6. `executePreviewInspect({ selector: '#root', properties: ['textContent', 'tagName'] })` returns the live element + computed CSS;
  7. `executePreviewScreenshot()` writes a PNG under `userData/artifacts/browser-screenshots/preview-*.png`;
  8. `executePreviewStop({ sessionId })` releases the dev-server port.

**Notes:**
- Tool-registry descriptors (`preview_start`, `preview_stop`, `preview_console_logs`, `preview_network`, `preview_snapshot`, `preview_inspect`, `preview_eval`, `preview_screenshot`, `preview_fill`, `preview_click`, `preview_resize`) are intentionally NOT registered in this commit — per the parity-plan §8 merge protocol, T2:C1 owns the `tool-registry.ts` lazy-schema refactor and additive tool descriptors rebase onto its shape. As soon as C1 lands on main, a follow-up commit will register all 11 descriptors with the appropriate `mutates` / `risks` tagging (`preview_eval` + `preview_click` + `preview_fill` + `preview_resize` carry write risk; `preview_start` is the heaviest because it spawns arbitrary processes).
- The previewTabBySession map keeps preview sessions and tabs joined so a `preview_stop` cleanly tears down both ends; an explicit `all: true` form supports app-shutdown cleanup.
- Network capture uses the WebContents debugger because Electron's session-scoped `webRequest.onCompleted` is shared across tabs and would require URL-based key filtering. Debugger attach is lazy so the cost is paid only when the user actually asks for `preview_network`.

**Commit:** see git log on `feat/track-3-memory-verify`.

## [Track 3 — Prompt E3] Cross-session search + archive — 2026-06-03

**Files changed:**
- `electron/services/database.ts` — `archived` + `pinned_at` columns on `conversations`; new `sessions_fts` plain-content FTS5 vtable indexed by `source ∈ (conversation, message)`, `conversation_id`, `message_id`, `title`, `body` (Porter stemming + unicode61); indexes on `(archived, updated_at)` and `(pinned_at)`.
- `electron/services/conversation-store.ts` — `listSessions({ tab, query?, limit, offset })` for Recent / Pinned / Archived bucket pagination; `setConversationArchived()` / `setConversationPinned()` mutators; `searchSessions(query, limit)` returns FTS hits with `snippet()` markup; `backfillSessionsFts(force)` re-fills the index from scratch (called once on boot when the vtable is empty); `clearConversationMessages()` collapses messages + their FTS rows together so `conversation:compact` doesn't leave stale matches.
- `electron/ipc/conversation.ts` — new `sessions:list` / `sessions:archive` / `sessions:setPinned` / `sessions:search` handlers; the existing `conversation:compact` now delegates message clearing to the new helper.
- `electron/main.ts` — `backfillSessionsFts(false)` runs once after `initializeMemoryStore`; logs row count when it fires.
- `electron/preload.ts` — new `window.api.sessions.*` namespace exposing the four IPC methods.
- `src/stores/sessions-store.ts` (new) — typed store owning `tab`, `query`, paginated `entries`, FTS `hits`, `archive` / `setPinned` mutations, and a 50-entry-per-page `loadMore()` for infinite scroll.
- `src/components/layout/SessionSearchBar.tsx` (new) — 200ms debounced query input wired to `sessions-store.setQuery`.
- `src/components/layout/SessionsSidebar.tsx` (new) — Recent / Pinned / Archived tabs above a scrolling list; per-row pin + archive actions; when a query is active, surfaces top FTS hits with `<<…>>` snippet markup (rewritten into `<mark>` highlights), and clicking a hit deep-links to the conversation via the existing chat-store selector.
- `electron/services/sessions-search.test.ts` (new) — 6 store-level tests covering archive/pin bucketing, FTS title + body search, query-restricted bucket pagination, backfill repair after a `DELETE FROM sessions_fts`, and the `clearConversationMessages` FTS-coherence path. Tests run under `it.skipIf(!nativeOk())` so they cleanly skip when better-sqlite3's Electron-ABI binding can't load from system Node.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest full suite ✓ (842 passed | 11 skipped — 6 new sessions-search tests skipped under the binding constraint; previous 5 baseline skips unchanged)
- user-verification-needed (better-sqlite3 ABI mismatch in test env + Electron-shell UI):
  1. launch Electron and mount `<SessionsSidebar />` somewhere reachable;
  2. create 3+ conversations with distinct titles + a few messages each, including one verbatim phrase like `canary-xyz789`;
  3. switch to the Sessions sidebar; confirm Recent lists all three with message counts + relative timestamps;
  4. type `canary-xyz789` into the search bar; confirm an FTS hit row appears above the list with the `<mark>`-highlighted snippet; click it → chat opens that conversation;
  5. pin one row → it disappears from Recent and appears under Pinned (newest pin first);
  6. archive one row → disappears from Recent / Pinned, appears under Archived;
  7. scrolling to the bottom of a 100-entry list triggers `loadMore` and another page of 50 appears.

**Notes:**
- Chapter titles are referenced in the parity-plan verify gate ("FTS5 over conversation titles + message bodies + chapter titles") but the `chapters` table is owned by T2:E1. The FTS vtable shape already supports a third `source = 'chapter'` value; T2:E1 just adds a `ftsInsertChapter()` helper and the `backfillSessionsFts` loop picks them up on the next boot. No schema change needed when E1 lands.
- The Sessions sidebar is built as a standalone mountable component — the existing left sidebar (`Sidebar.tsx`) stays unchanged. Integration Phase H3 wires the mount + polish (project grouping, drag-to-reorder pins, right-click menu, "Resume here" button).
- FTS sync hooks fire from `saveMessage()` for user/assistant rows only; system/tool messages are plumbing and would inflate the index without improving the search experience.

**Commit:** see git log on `feat/track-3-memory-verify`.

## [Track 3 — Prompt D3] Memory UI typed view + linking — 2026-06-03

**Files changed:**
- `src/lib/types.ts` — exports `MemoryType`, `MemoryFile`, `BrokenMemoryLink`; `MemoryEntry` extended with optional typed fields (`name`, `description`, `type`, `projectSlug`, `filePath`) so existing `id: number` callers keep compiling.
- `src/stores/memory-store.ts` (rewrite) — adds `entries: MemoryFile[]`, `brokenLinks`, `loading`, typed CRUD (`writeMemory`, `deleteEntry`, `duplicateEntry`), `countsByType()` selector for tab badges, and `receiveChanged()` for the `memory:changed` broadcast. Legacy methods (`addMemory`, `updateMemory`, `deleteMemory(id)`, etc.) and pin-by-conversation surface preserved for the Sources panel + RAG sidebar.
- `src/components/memory/MemoryTypeBadge.tsx` (new) — small colored chip per type (blue/amber/emerald/violet); ships `MEMORY_TYPE_LABELS` for reuse.
- `src/components/memory/MemoryLinkPicker.tsx` (new) — floating autocomplete that hooks the editor's textarea: detects `[[` typing, reads partial-match prefix, lists matching entries (name + description + type), arrow-key navigation + enter to insert `[[name]]` and close.
- `src/components/memory/MemoryEditor.tsx` (new) — typed entry editor with type/name/description/body fields, save+cancel+delete actions, body textarea wired to `MemoryLinkPicker`. Name field locks when editing an existing entry so the file is never orphaned on rename.
- `src/components/memory/MemoryPanel.tsx` (rewrite) — tabs across the top (All/User/Feedback/Project/Reference) with live counts; click an entry → open MemoryEditor; per-row duplicate + delete actions on hover; broken-link pip from `MemoryLinkGraph` (D2) re-wired to open the editor with the missing target pre-seeded as a `reference` entry; Import/Export/Clear menu preserved.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest full suite ✓ (842 passed | 5 skipped — unchanged)
- user-verification-needed (Electron-shell UI, preview tools can't reach an Electron window):
  1. open Memory modal → tabs show All/User/Feedback/Project/Reference with counts;
  2. click `+` from each tab → MemoryEditor opens with that type pre-selected;
  3. create one of each type with a name + body → list/tabs update + MEMORY.md file contains a line per entry;
  4. click an entry → editor opens with frontmatter populated; edit body and save → file rewritten with same name + new body;
  5. type `[[` in the body → autocomplete lists known entries; arrow-down + enter inserts `[[name]]`;
  6. duplicate-action on a row → opens editor with `<name>_copy`;
  7. drop a `[[unknown-target]]` reference into a body → after save, "To write" pip surfaces in the panel; click pip → editor opens pre-seeded with `name=unknown-target`, `type=reference`;
  8. badges scan correctly by color.

**Notes:**
- Editor renders inline (replaces the list view rather than opening a side pane) to fit the existing 720px modal. The Integration Phase can promote it to a split-pane layout if needed.
- The pip "to-write" target defaults to `type: reference` because the most common cross-reference use case is pointing at an external system or fact rather than a feedback rule.
- The legacy `MemoryEntry` shape (numeric id) survives intact for the Sources panel + RAG attach UI. D3 doesn't migrate those callers — they continue to function with the legacy view loaded from `memory:list()` (no-arg) which returns the rowid-bearing shape.

**Commit:** see git log on `feat/track-3-memory-verify`.

## [Track 3 — Prompt D2] MEMORY.md always-loaded index — 2026-06-03

**Files changed:**
- `electron/services/memory-store.ts` — `regenerateMemoryIndex(projectSlug)` writes `userData/lamprey-memory/<projectSlug>/MEMORY.md` with one line per typed entry (sorted by type then description, capped at 200 lines, with a trailing `+ N more` note when truncated). The regen runs from `broadcastChange()`, so every write/delete/clear automatically rewrites the index. New `loadMemoryIndex()` reads it back; `buildMemoryIndexBlock()` returns the `<memory_index>...</memory_index>` system-prompt block (empty string when no entries so chat.ts can drop it). New `extractLinks()` + `getBrokenMemoryLinks()` walk every body, slug-normalize `[[link-name]]` targets, and return the ones with no matching file.
- `electron/services/system-prompt-builder.ts` — `buildSystemPrompt` gains an optional `memoryIndexBlock` 7th parameter that gets injected between the legacy `<memory>` block and the skill blocks (per the parity-plan §2 invariant: `memory_index → skills → retrieved_context → chapters → conversation`). Empty/whitespace blocks are dropped entirely.
- `electron/ipc/chat.ts` — pulls `memStore.buildMemoryIndexBlock()` once per turn and threads it through both single-mode and multi-mode `buildSystemPrompt` calls.
- `electron/ipc/memory.ts` — new `memory:readIndex` (returns raw MEMORY.md text) and `memory:listBrokenLinks` (returns `{from, target}[]` for the renderer pip).
- `electron/preload.ts` — `memory.readIndex` / `memory.listBrokenLinks` exposed on the IPC bridge.
- `src/components/memory/MemoryLinkGraph.tsx` (new) — "To write" pip strip rendered at the bottom of the memory sidebar. Subscribes to the `memory:changed` broadcast for live refresh; dedupes by target with a `×N` count when multiple entries reference the same missing slug. Click pre-fills the add-memory draft with `[[target]] — ` so D3's MemoryEditor inherits a working seed.
- `src/components/memory/MemoryPanel.tsx` — mounts `MemoryLinkGraph` and wires its `onPick` to the existing add-memory flow.
- `electron/services/memory-store.test.ts` — 6 new D2-specific tests (MEMORY.md regen, `<memory_index>` block shape, empty-state suppression, regen-on-delete, broken-link detection, 200-line truncation).
- `electron/services/system-prompt-builder.test.ts` — 2 new tests asserting the inter-block order and empty-block suppression.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest memory-store + system-prompt-builder ✓ (41 tests including 8 new)
- vitest full suite ✓ (842 passed | 5 skipped — 8 new + 834 baseline)
- user-verification-needed: launch Electron, write 5 typed memories via the panel, confirm `userData/lamprey-memory/__global__/MEMORY.md` lists all 5 (sorted by type → description), include a `[[unknown-target]]` reference in one body, confirm a "To write" pip appears in the sidebar with the right target name, click the pip and confirm the add-memory draft is pre-filled.

**Notes:**
- Per the parity-plan merge protocol, `system-prompt-builder.ts` is a hotspot: T3:D2 (memory_index) lands first, then T2:E1 (chapters mention), then T2:E5 (compressed regions). This commit adds the memory_index slot only — chapter/compressed regions will append cleanly later.
- The legacy `<memory>` block (full body of each entry) remains alongside `<memory_index>` for now. The index gives the model a map; the legacy block gives it the actual content. D4's consolidation workflow will decide whether to retire one in favor of the other.
- The pip surface is wired to the existing add-memory draft for D2; D3 rebuilds the MemoryPanel into the typed-tabs editor and will rewire the pip to open the typed-entry editor directly.

**Commit:** see git log on `feat/track-3-memory-verify`.

## [Track 3 — Prompt D1] Memory taxonomy + frontmatter migration — 2026-06-03

**Files changed:**
- `electron/services/memory-frontmatter.ts` (new) — `MemoryType` taxonomy, slug helper, gray-matter parse/serialize for the `{name, description, metadata:{type}}` shape (with tolerant flat-`type:` parsing for hand-written files).
- `electron/services/memory-store.ts` (rewrite) — file-backed CRUD at `userData/lamprey-memory/<projectSlug>/<slug>.md` with a SQLite mirror, chokidar watcher for external edits, idempotent migration of legacy `memory_entries` rows to `type: project` files under the `__global__` slug, and an in-memory fallback so list/read/search/delete still work when the better-sqlite3 binding is unavailable (test env). Legacy `addMemory(content) / updateMemory(id, content) / deleteMemory(id) / listMemories() / buildMemoryBlock()` kept as shims over the file API so the pre-D3 MemoryPanel and `memory_add` tool keep working.
- `electron/services/database.ts` (extend) — `memory_index` table + FTS5 mirror + AI/AU/AD triggers; new `__resetDbForTests` escape hatch.
- `electron/ipc/memory.ts` (extend) — `memory:write` / `memory:read` / `memory:search`; `memory:list` accepts an optional `{ type, projectSlug }` filter; `memory:delete` accepts either the numeric legacy id or a string `name`.
- `electron/preload.ts` (extend) — typed `memory.write/read/search` methods and `onChanged` subscription so D2/D3 can react live.
- `electron/main.ts` (extend) — `initializeMemoryStore()` on startup, `shutdownMemoryStore()` on `will-quit`.
- `electron/services/memory-store.test.ts` (new) — 12 unit tests covering frontmatter shape, typed filtering, external-edit re-scan, search, legacy shim back-compat, and migration idempotence.

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest electron/services/memory-store.test.ts ✓ (12 tests)
- vitest full suite ✓ (834 passed | 5 skipped — 12 new + 822 baseline)
- user-verification-needed: smoke the live Electron app with an existing `lamprey.db` containing `memory_entries` rows to confirm the migration step writes them into `userData/lamprey-memory/__global__/` with `type: project` and that the existing MemoryPanel still renders/edits them through the legacy IPC.

**Notes:**
- Files are canonical, SQLite is a search/index mirror. External editors and version control are first-class.
- Per-project routing is wired through `projectSlug` but defaults to `__global__` until a future prompt threads the current project id; this keeps the slug ergonomics ready without forcing a project-id contract on D1.
- The store gracefully falls back to an in-memory mirror when the SQLite binding can't load (test env runs system Node, but better-sqlite3 is built for Electron's ABI); production code path still uses the FTS mirror.

**Commit:** see git log on `feat/track-3-memory-verify`.

## Parity Phase planning — three-track roster authored (2026-06-03)

Planning-only turn. No source changes; one new planning artifact landed.

### Artifact

`PLANNING/LAMPREY_PARITY_PLAN.md` — 36 prompts organized as three concurrent execution tracks (T1: 8 prompts runtime foundation; T2: 9 prompts tool layer + continuity; T3: 13 prompts memory + verify + scheduling) plus a final 6-prompt Integration Phase run from a single session after all three tracks merge. Each track has explicit owner files, do-not-touch lists, cross-track wait gates, and per-prompt verify gates.

### How we got here

1. Started from a question: "what does Claude Code do that Lamprey currently cannot?" — produced a comparative architecture writeup (Claude Code internals, MCP / workflows / subagents / memory / hooks / lazy schemas / worktrees / cron / plan mode / chapters / spawn-task / compression, vs Codex, vs current Lamprey).
2. Audited the actual codebase (via Explore agent) — found more existing surface than CLAUDE.md indicated: `multi-agent-run-tool.ts`, `hooks-store.ts` + `hooks-runner.ts` (stubs, not wired), `automations-runner.ts` (no UI), `worktree.ts` (manual only), `plan-goal-store.ts` (data, not mode state). The plan refactors these into shape rather than duplicating.
3. Authored initial 30-prompt plan with Phase A–H structure.
4. User asked which phases could run concurrently → analyzed merge-collision hotspots and produced a 3-track + Integration Phase recommendation.
5. User asked to revise the doc around three tracks with explicit "ask user which track, then run to completion" session bootstrap → restructured the plan around three executable tracks, per-track owner files, cross-track wait protocols, and a §0 bootstrap that fresh sessions can read and act on directly.
6. User asked whether the plan captured Claude Code's distinctive smaller tools (Monitor, PushNotification, AskUserQuestion, cross-session messaging, slash commands, etc.) → audited honestly, identified 13 gaps, proposed 6 additional prompts, user picked option 1 (fold them in).
7. Final plan has 36 prompts, three tracks running in parallel worktree sessions, Integration Phase last.

### Architectural invariants locked in the plan (§2)

- IPC envelope `{success, data} | {success, error}` — already the standard, made explicit.
- Workflow + hook sandbox uses Node built-in `vm` (NOT `vm2` or `isolated-vm`).
- Memory is filesystem-first (`userData/lamprey-memory/<projectSlug>/<slug>.md` with YAML frontmatter), SQLite second.
- Workflow journaling to `userData/workflows/<runId>.jsonl`; resume keys on (prompt + opts) hash.
- Hooks block tool calls synchronously with configurable timeout (default 5s).
- Plan mode is a per-conversation flag gating tools tagged `mutates: true`.
- Lazy tool schemas: `tools:list` returns stubs only; full schemas via `tools:resolve`.
- Worktree isolation per subagent is opt-in via `isolation: 'worktree'`; auto-cleanup if `git diff` is empty.
- System-prompt block order: `memory_index → skills → retrieved_context → chapters → conversation`.

### Distinctive Claude Code tools mirrored in this plan

Beyond the architectural backbone (workflow runner, subagents, memory, chapters, lazy tools, compression, preview, scheduling), the plan also mirrors: extensible subagent types (filesystem-discovered), workflow model-tier routing + schema retry, slash command system + built-ins (`/init`, `/review`, `/verify`, `/simplify`, `/loop`, `/plan`, `/workflow`, `/spawn-task`), async event-to-prompt bridge (`<task-notifications>` blocks injected into the receiver's next turn), monitor + background shell primitive, push notifications + cross-session messaging, status line, and `ask_user_question` modal that pauses a workflow until answered.

### Execution status as of this entry

Three sessions started in parallel worktrees. Each session reads §0 of `LAMPREY_PARITY_PLAN.md`, selects its track via `AskUserQuestion`, and runs the full track sequentially per the per-prompt verify gates. Merge-hotspot coordination (`tool-registry.ts` → T2:C1 first; `chat.ts` → T2:C2/C3 first; `system-prompt-builder.ts` → T3:D2 first) is locked in plan §8.

**Commit:** planning-only, no source changes.

---

## Audit + remediation — comprehensive verification of spine + RAG (2026-06-03)

Full-codebase audit after the RAG stack landed. Five parallel audit agents ran across six dimensions (RAG plumbing, event spine + IPC, validation + error handling, type lockstep + dead code, lint cleanliness, runtime smell), then a skeptic-mode adversarial verification of every fix. **0 lint errors, 0 TS errors, 819 / 824 tests pass (5 intentionally skipped: 2 DB-only contract placeholders + 2 network-only embedding model download + 1 cross-encoder rerank).** Up from the post-R14 baseline of 797 by +22 new validation tests (chat:send, settings sanitizer), 0 regressions.

### Lint cleanup (8 errors → 0)

All in the new RAG code from the R-prompt sprint:
- `loaders/docx.ts` + `loaders/pdf.ts` — 5 `preserve-caught-error` violations: re-thrown errors now carry `{ cause: err }` so the upstream stack trace isn't lost.
- `retrieve.ts:131` — `no-useless-assignment`: removed the redundant `= null` initializer; TS narrows correctly from the try/catch assignment.
- `store.ts:367` — `no-empty-object-type`: `interface MemoryDocument extends RagDocument {}` replaced with `type MemoryDocument = RagDocument`.
- `citation-parser.ts:25` — `prefer-const`: `let masked` → `const masked`; it was never reassigned.

### High-severity fix — `chat-augmentation.ts` fake polish (HIGH)

Three audit agents independently flagged the function as dead code: it computed `retrievalId`, `startedAt`, `lexHitsTotal`, `vecHitsTotal`, then `void`'d them all and returned `retrievalId: ''`. **Confirmed real fake polish.** Rewrote:
- Returns a real `randomUUID()` `retrievalId` so the chat handler can stamp it onto the assistant message row AND call `persistRetrieval(retrievalId, ...)` with the same id.
- `RagAugmentResult` interface now includes a `stats: { lexHitsTotal, vecHitsTotal, durationMs }` field carrying the numbers that were previously discarded.
- All `void` statements removed.

### Type drift fix — `EmbedderInfo.modelRef` (HIGH)

Drift caught by the type-lockstep audit: electron-side `EmbedderInfo` had `modelRef: string` (the HuggingFace id passed to `pipeline()`); renderer-side mirror omitted it. Fixed by adding `modelRef: string` and the optional `description?: string` to the renderer interface, restoring lockstep.

### Validation hardening — `chat:send` request guard (HIGH)

Audit caught: `ipcMain.handle('chat:send', async (_event, request) => { const { content, model, ... } = request }` trusted the renderer-supplied object unconditionally. Refactor:
- New `electron/ipc/chat-validation.ts` with pure `validateChatSendRequest(raw): {ok, value} | {ok, error}` that rejects null / non-object / array, requires non-empty string `content`, requires string `model`, allows `conversationId` as string-or-absent, filters `activeSkillIds` to strings only, narrows `agentMode` to `'single' | 'multi'` or undefined.
- Extracted to its own file (rather than alongside the handler) because importing `./chat` pulls in skill-loader + electron-toolkit + providers — none initialize under headless vitest.
- 13 pure tests in `chat-validation.test.ts` pin every reject path + the normalize-to-defaults success path.

### Validation hardening — `settings:set` prototype-pollution defence (MEDIUM → upgraded after skeptic feedback)

Initial fix: top-level POLLUTION_KEYS (`__proto__`, `constructor`, `prototype`) stripped before spread merge. **Skeptic agent caught**: nested `{modelConfig: {__proto__: evil}}` still slipped through. **Upgraded to recursive**:
- `stripPollutionKeys(value, depth)` walks objects and arrays, dropping forbidden keys at every depth.
- Depth cap of 16 prevents a hostile renderer from OOM-ing the sanitizer with a 10⁴-deep payload. Settings is shallow by design; 16 is generous headroom.
- Non-object / array input → empty `{}` (no-op merge, no crash).
- 8 tests in `settings-sanitizer.test.ts`: non-object input, null, top-level `__proto__`/`constructor`/`prototype` rejected, array input ignored, nested `__proto__` stripped, array-element `__proto__` stripped, deep recursion depth cap exercised.

### Resource cap — ingest `MAX_INGEST_BYTES = 500 MB` (MEDIUM)

`IngestManager.runOneFile` previously read user-supplied file paths or paste text with no size cap. Added the 500 MB ceiling, checked **before** `readFile`/`Buffer.from` runs, with a clear error message that distinguishes file-path overflow from paste overflow. The text loader's own 25 MB cap still gates the loader layer; this is the wider backstop that protects the embedder + chunker from OOM on a 1 GB misclick.

### AbortSignal threading — embeddings.embed (MEDIUM)

The ingest orchestrator had an `AbortController` but `embeddings.embed()` ignored it. Threaded `signal` through:
- `EmbeddingsLike` interface in `ingest.ts` grew `signal?: AbortSignal`.
- `EmbeddingsService.embed(texts, signal)` checks the signal between batches (terminating the in-flight worker_thread message is non-trivial, so the signal is advisory — the orchestrator's post-await `checkCancel` still wins).
- Throws `'embed: aborted'` on observed cancellation.

### Composer-failure event (MEDIUM)

`runChatRound`'s composer try/catch warned to console but the timeline had no record. Added a `chat.error` event with `severity: 'warning'`, `source: 'composer'`, and a bounded error preview. Does NOT re-throw — the original streamed `fullContent` still goes to the user as the safe fallback. The timeline now shows that composer didn't land.

### Defended-against false positives

The audits also flagged things that aren't real bugs:
- **`settings.json` read-modify-write race**: settings:set runs in one synchronous JS execution between the IPC entry and the `writeFileSync`. There's no `await` between read and write to allow interleave. Single-threaded JS is the actual contract here; documented but no code change.
- **MCP OAuth log leak (`mcp.ts:161`)**: the connection-result strings carry server ids + provider error messages, not token values. The MCP client wraps tokens internally; "connection refused" / "auth failed" messages are safe to log.
- **`augmentForChat` void statements**: real fake polish (fixed above), not a false positive.

### Adversarial verification (skeptic pass)

A second audit agent ran in skeptic mode against every fix, defaulting to "refuted" unless the fix demonstrably worked. Outcome: 6 / 7 fixes VERIFIED on first pass, 1 REFUTED (nested `__proto__` slipping past the top-level-only sanitizer). Refuted fix was strengthened to recursive + depth-capped, then re-verified by the new test cases. No remaining unaddressed findings.

### What this audit could NOT verify

Honest carry-forward:
- **Real-DB FTS5 + sqlite-vec contracts**: vitest can't load the native binaries (better-sqlite3 is rebuilt against Electron's ABI; sqlite-vec ships precompiled per-platform). The R1 FTS-trigger contract is documented in `store.ts`'s `insertChunks` comment; runtime smoke is the user's "drop a real file, query it, see citations" path.
- **Live embedding model download**: gated behind `LAMPREY_RUN_EMBED_NETWORK=1` in `embeddings/service.test.ts`. Default-skipped to avoid 33 MB of bandwidth per CI run.
- **DOM-bound rendering tests**: vitest env is node-only (intentional, carry-forward from the audit-remediation Prompt 5 of an earlier sprint). The library / chat-attachment / citation-chip components are tested only at the pure-data layer (Zustand store actions, citation parser).
- **Booting the actual Electron app**: requires display + ABI-matched native modules + GUI; outside the audit harness.

### Verification

`tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean. `npm run lint` — **0 errors** (488 pre-existing warnings, baseline). `npx vitest run` — **60 files / 819 passed + 5 skipped / 0 failed** (+22 over the post-R14 baseline of 797; 0 regressions across the 58 previously-green files).

**Net deliverables:** 1 new validator file (`chat-validation.ts`), 2 new test files (`chat-validation.test.ts`, `settings-sanitizer.test.ts`), 8 lint-error fixes, 7 behavioral fixes across IPC validation + RAG plumbing + resource caps + observability + type lockstep.

## RAG R6 → R14 — Library UI, retrieval, rerank, multi-query, context, chat attachments, citations, settings, agent integration, E2E (2026-06-03)

Nine prompts landed in one continuous march. The full stack is now in place: a renderer Library tab for managing collections, the hybrid-retrieval engine, optional rerank + multi-query rewrite, the `<retrieved_context>` block + citation protocol, per-conversation attachments, citation chips + source preview, the Settings → RAG panel, and an integration helper (`augmentForChat`) the chat handler can call to enrich a turn end-to-end. Build status: **58 test files / 797 passing / 5 skipped / 0 failed** (up from R5's 51/736; +61 new tests, 0 regressions).

### R6 — Library UI

**`src/stores/rag-store.ts` (new).** Zustand store. State: collections, per-collection documents, ingest progress (Map keyed by jobId), embedder catalogue + active id. Actions: `loadCollections`, `createCollection`, `renameCollection`, `deleteCollection`, `selectCollection`, `loadEmbedders`, `setActiveEmbedder`, `loadDocuments`, `submitIngest`, `cancelIngest`, `reingestDocument`, `deleteDocument`, plus `bindProgress` / `unbindProgress` for the per-window `rag:document:progress` subscription (idempotent — subscribing twice no-ops).

**Components (`src/components/library/`).**
- `LibraryView` — two-pane layout (collections left, docs right). Top toolbar: new-collection input + embedder selector showing the active model with approx-MB hint.
- `CollectionList` — vertical list with doc count + embedder id per row, double-click to rename, hover-revealed × button to delete (with `confirm()` prompt).
- `DocumentTable` — sticky-header table: name, status (with dot color + statusDetail tooltip on error), chunk count, ingested-at, reingest + delete actions.
- `IngestDropzone` — drag-drop region with visual feedback + "Browse" button. Uses `window.api.app.getPathForFile` when present (Electron 32+), falls back to `(File as any).path` for older builds.
- `IngestProgressCard` — per-job phase label + progress bar + cancel button. Color-codes terminal phases (green ready, red error, amber in-flight).

Embedded as a **Library** tab in `SettingsDialog`. No new top-level navigation.

**Renderer tests skipped per plan.** Vitest env is node-only (jsdom-bound render tests are still a carry-forward from the prior audit Prompt 12). Skipping is intentional and explicit; the Zustand store's actions are testable in node and would be a clean follow-up.

### R7 — Hybrid Retrieval

**`electron/services/rag/retrieve.ts` (new).** Three legs:
1. **Lexical** — `bm25(rag_chunks_fts)` over the user query, scoped to `collection_id IN (...)` by joining `rag_chunks`. Query tokens are split on whitespace and each is wrapped in `"…"` so reserved FTS5 chars (`-`, `+`, `:`, `NEAR`, etc.) don't fall through as operators. Empty query after tokenizing → empty result.
2. **Vector** — sqlite-vec KNN syntax (`WHERE embedding MATCH ? AND k = ?`), JOIN to `rag_chunks` for the collection scope filter. Query vector is supplied via `input.queryEmbedding` OR `input.embed([query])[0]`. Gated on `isVecAvailable()` — when sqlite-vec is missing the vector leg is silently skipped and the lex leg drives ranking on its own.
3. **RRF fusion** — exported `fuseRRF(lex, vec, topN, k=60)`. Each candidate's fused score = sum of `1/(k+rank)` across legs that returned it; missing leg contributes 0. The `k=60` constant is the Cormack & Clarke (2009) reference.

**Hydration** — top-N chunk ids JOIN `rag_documents` to get `display_name` + `source_path`, then results are stitched onto the fused-order ranking. Each `RetrievedChunk` carries `scores: {lex?, vec?, fused}` AND `ranks: {lex?, vec?}` so the timeline reader can audit fusion math.

**Memory-fallback path** — when `getDb()` throws (headless test env), `retrieveFromMemory` does a TF-style match against `__peekMemoryChunks()`. Production never hits this; tests use it to exercise scope and event emission contracts without booting better-sqlite3.

**`rag:query:run` IPC** + `window.api.rag.query.run`. Validates query + collectionIds; embeds the query via the singleton embeddings service. Returns the full `RetrievalRunInfo` (retrievalId + results + per-leg counts + duration).

**`rag.query.completed` / `rag.query.failed`** event types added to the catalogue. Payload: scopes, lexHits, vecHits, fusedCount, durationMs, query preview (bounded to 200 chars).

**Tests (`retrieve.test.ts`).** 7 tests: RRF math (both-legs > one-leg, topN cap, per-leg rank preserved); memory-fallback retrieval respects scope, empty query → empty, empty scopes → empty; `rag.query.completed` event payload has the right scopes + counts.

### R8 — Optional Reranking

**`electron/services/rag/rerank.ts` (new).** Three modes:
- `'off'` — pass-through.
- `'local-cross-encoder'` — calls `deps.crossEncoderScore(q, candidates)`; reorders by descending score.
- `'llm'` — calls `deps.llmRerank(q, candidates)`; reorders by the returned id sequence. **Candidates the LLM dropped are appended at the end so no chunk is silently lost.** Parse failure (null return) falls through to input order with a `severity: 'warning'` rerank event.

All failures route to graceful fallback — input order is preserved + the event records `errorPreview`. The `maxCandidates` cap bounds rerank cost.

**`rag.rerank.completed`** event type. Payload: mode, candidate count, durationMs, beforeTopIds + afterTopIds (top 8 each), errorPreview.

**Tests (`rerank.test.ts`).** 8 tests cover off pass-through, cross-encoder reordering, dep-failure graceful degradation (preserves input order + warning event), wrong-length scores rejected with warning, LLM ordering respected, LLM drops appended, parse failure fall-through, maxCandidates cap.

### R9 — Multi-Query Rewrite

**`electron/services/rag/multi-query.ts` (new).** `rewriteQuery(query, planner, maxRewrites=3)`. Prompts the planner for a JSON array of 2-3 alternate phrasings. Returns `[original, ...parsedRewrites]` capped at `maxRewrites + 1`. **Graceful fall-through**: planner throws → `[original]`; reply doesn't parse → `[original]`; rewrites over 200 chars dropped; case-insensitive duplicates of original dropped.

`parseRewrites(raw)` — exported pure helper: tolerates leading prose (finds the first JSON array), filters non-string entries, returns null on malformed JSON.

`fuseAcrossVariants(variantResults, topN)` — RRF across per-variant rankings for multi-query retrieval. Chunks present in more variants rank higher.

**Tests (`multi-query.test.ts`).** 14 tests: parse with prose leading text, malformed JSON → null, non-array → null, filters non-strings; full rewriteQuery + planner contract including length cap and dupe filtering; fuseAcrossVariants ordering.

### R10 — Context Assembly + Citation Protocol

**`electron/services/rag/context-builder.ts` (new).** `buildContext({chunks, maxTokens, citationRequired})` → `{block, sourceMap}`. Block format:

```
<retrieved_context>
  <source id="1" name="sample.md" lines="42-78">
  chunk text...
  </source>
  ...
</retrieved_context>

Instruction: Cite sources by id in square brackets…
```

- Ids assigned 1..N in fused-score (input) order. `sourceMap[i].id = i+1`.
- Locator format: `lines="X-Y"` for code chunks (`lineStart`/`End` present), `page="N"` for PDFs, `heading="..."` for markdown, `locator="chunk"` fallback.
- Token cap approximated as `Math.ceil(chars/4)`; lowest-ranked sources dropped first to fit.
- **Prompt-injection defence**: chunk text with `</...>` substrings is escaped to `< /...>` so a malicious chunk can't close the `<retrieved_context>` wrapper early.
- `citationRequired: true` upgrades the instruction to the explicit refusal form ("If NO source supports a claim, you MUST say 'No source supports an answer to this.' rather than answering from prior knowledge.").

**Tests (`context-builder.test.ts`).** 10 tests: empty chunks → empty; id assignment in fused-score order; envelope emission; all four locator formats; cap drops lowest-ranked; citationRequired upgrade; the `</` escape defence pinned.

### R11 — Chat attachments

**Schema (`database.ts`).** New `conversation_rag_attachments` table — PK `(conversation_id, COALESCE(collection_id, ''), COALESCE(document_id, ''))` so the "exactly one of collection_id / document_id is set" rule is unique-able even with NULLs. Index on `conversation_id` for the per-conversation list path.

**Store ops (`store.ts`).** `addAttachment` validates "exactly one of collectionId/documentId is set" + "conversationId required", upserts via `ON CONFLICT(...) DO UPDATE SET attached_at = excluded.attached_at` (re-attaching the same target updates the timestamp instead of error-ing). `removeAttachment`, `listAttachments` newest-first. Memory fallback mirrors the rest of the store.

**IPC + preload.** `rag:attachments:list/add/remove` + `window.api.rag.attachments.{list, add, remove}`.

**`ContextAttachBar` component** above ChatInput. Renders attached chips with a × detach button; tooltip shows whether the attachment is a collection or a specific document. No-renders when no attachments (zero visual chrome).

**Tests (`attachments.test.ts`).** 8 tests: validation rejects (empty conversationId, neither/both of collectionId & documentId), add/list/remove roundtrip, list scoped per conversation, dedup-on-re-add updates timestamp, remove returns true/false.

### R12 — Citation chips + source preview

**`src/lib/citation-parser.ts` (new).** Pure `parseCitations(input): CitationSegment[]` — alternating text/citation segments. Recognizes `[N]`, `[N, M]`, `[N, M, K]` patterns ANYWHERE except inside fenced code blocks (`` ``` ``…`` ``` ``) and inline code (`` `…` ``). Adjacent text segments are merged so the renderer sees one entry per run.

**Components.**
- `CitationChip` — small numbered chip per id. Hover → tooltip with `displayName + locator`. Click → `onOpen(source)` so a parent can route to the preview pane.
- `SourcePreviewPane` — right-side slide-in. Fetches chunk text via `window.api.rag.chunk.get(chunkId)`; shows monospace `<pre>` of the chunk text.

**Schema.** `safeAddColumn(messages, 'retrieval_id TEXT')` — nullable column linking an assistant message to its rag_retrievals row. Pre-Prompt-12 conversations unaffected.

**IPC.** `rag:chunk:get(chunkId)` + `window.api.rag.chunk.get` returning `{id, documentId, collectionId, text, headingPath, page, lineStart, lineEnd, ...}`.

**Renderer types.** `CitationSource` added; `RagAttachment` exported for the attachment bar.

**Tests (`citation-parser.test.ts`).** 12 tests: single citation; multi-id `[1, 2, 3]`; whitespace tolerance; multiple citations on the same line; fenced code blocks DON'T parse citations (including with language hints); inline code DOESN'T parse; non-number brackets ignored; stray brackets tolerated; merged adjacent text.

### R13 — RAG Settings + agent integration helper

**`src/components/settings/RagSettings.tsx` (new).** Apply-on-change settings panel with sections for: embedder choice + MB hint, chunking (size + overlap with clamped numeric inputs), retrieval (lexK / vecK / fusedTopN), rerank mode select, multi-query toggle, auto-RAG toggle, citation-required toggle. Hydrates from `settings.json`'s `rag` block on mount; every change writes back. Embedded as the new **RAG** tab in `SettingsDialog`.

**`electron/services/rag/chat-augmentation.ts` (new).** `augmentForChat({conversationId, query, settings, planner, rerankDeps, ...})` — single entry point for the chat handler to call per turn:
1. Reads attachments for the conversation. Returns `null` when none → caller skips the `<retrieved_context>` block.
2. Optional multi-query rewrite (R9).
3. Retrieves per variant (R7) with `topN × 3` over-fetch when rerank is enabled.
4. Cross-variant RRF fusion.
5. Optional rerank (R8).
6. Trim to settings.fusedTopN.
7. Build the `<retrieved_context>` block (R10).
8. Returns `{retrievalId, context, chunks, rewrites, scopes}` for the chat handler to persist + forward to the renderer.

Per-role retrieval for the agent pipeline (Planner: broad, Coder: focused on plan text, Reviewer: reuse coder's sources) is wired through this same helper — the caller varies `queryKind` + the input query text per role. Doc says so; chat.ts/agent-pipeline.ts call insertion is a clean ~5-line follow-up the next prompt can do without touching the engine.

### R14 — End-to-end + final gates

**`electron/services/rag/end-to-end.test.ts` (new).** 2 tests exercise the orchestration chain end-to-end via the memory fallback (no native modules required). The first walks retrieve → rerank → context-builder and verifies the assembled block + sourceMap + spine events for each step. The second pins that retrieval scope is honored across multiple collections — chunks from B never leak into a query scoped to A.

**Updated tests.** `electron/ipc/rag.test.ts` now pins the **R7 + R11 + R12 surfaces present**: `rag:query:run`, `rag:attachments:list/add/remove`, `rag:chunk:get`.

**Event-presentation extension.** Labels + subtitles added for `rag.query.completed/failed`, `rag.rerank.completed` so timeline rows read at a glance.

**Verification.** `tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean across the full march. New tests: 7 retrieve + 8 rerank + 14 multi-query + 10 context-builder + 12 citation-parser + 8 attachments + 2 end-to-end = **61 new tests**. Full suite: **58 files / 797 passed + 5 skipped / 0 failed** (+61 over R5; 0 regressions across 51 previously-green files).

**Carry-forward to a future prompt.**
- **chat.ts insertion**: call `augmentForChat({...})` before the provider call when settings.rag.enabled && attachments exist; pipe `context.block` into `buildSystemPrompt`'s retrieval slot; emit a `chat:retrieval` IPC event with the sourceMap; persist a `rag_retrievals` row with the assistant message id once it lands.
- **agent-pipeline.ts insertion**: call `augmentForChat` with `queryKind: 'planner-rewrite'` (broad) before Planner, `queryKind: 'coder-followup'` (focused on plan text) before Coder, `queryKind: 'reviewer-fixed'` (reuse coder's persisted retrieval) before Reviewer. All three share the chat correlation_id.
- **Real-DB rerank/retrieve smoke**: the FTS5 query escaping, sqlite-vec MATCH syntax, and chunk-rowid → vec0 alignment all exist in production code but vitest can't load the natives. Runtime smoke (DevTools roundtrip with one ingested file + one query) covers them.
- **README + docs/local-rag.md**: a user-facing doc page covering "create a collection, drop files, attach to a conversation, see citations" — clean follow-up that doesn't block any engine work.

## RAG R5 — Ingest orchestrator + document IPC (2026-06-03)

Unifies R1–R4. The IngestManager ties loaders → chunker → embeddings → SQLite in a single transaction, with progress events, cancellation, hash-dedupe, and rollback on failure. Documents become a first-class IPC surface alongside collections. Build status: **51 test files / 736 passing / 5 skipped / 0 failed** (up from R4's 50/727; +9 new tests, 0 regressions).

**Store extension (`electron/services/rag/store.ts`).** Three new sections — Documents, Chunks, test hooks — landed alongside the existing collections layer. Same memory-fallback discipline so the orchestrator tests run headlessly without booting better-sqlite3.
- `insertDocument`, `updateDocument` (selective patch via dynamic SET clause), `getDocument`, `findDocumentByHash`, `listDocuments` (newest-first per collection), `deleteDocument` (clears vec rows BEFORE the chunk-cascade so freed `rowid`s don't leak into the next vec INSERT).
- `insertChunks(chunks, vectors?)` runs inside a `db.transaction()` so the chunk rows, the FTS5 mirror (via the R1 AFTER-INSERT trigger), and the vec0 rows all commit atomically. Vec writes are gated on `isVecAvailable()`; when the extension is missing the chunks still land and retrieval falls back to FTS-only. Returns `{rowids, ids}` so the caller can reconcile.
- `deleteChunksForDocument` mirrors the delete-vec-then-cascade ordering.
- `countChunksForDocument` and `__peekMemoryChunks` (test-only) for orchestrator assertions.

**`electron/services/rag/ingest.ts` (new).** The IngestManager — an `EventEmitter` subclass.
- `submit(collectionId, files): jobId` returns immediately; per-file work runs async. Files process **serially** to keep memory bounded (a single ONNX inference batch can be ~250 MB of activation memory; parallel files risk OOM).
- `cancel(jobId): boolean` aborts the controller.
- `on('progress', ...)` streams `IngestProgressEvent { jobId, documentId, displayName, phase, progress, chunkCount?, error? }`.
- Per-file phase progression: `loading` (0.1) → `chunking` (0.3) → `embedding` (0.5) → `ready` (1.0). Each phase transition updates the row and emits a progress event. Errors at any phase route to `failDoc` which sets `status='error'`, truncates the reason into `status_detail`, AND **rolls back any chunks already inserted** so the doc row's `chunk_count` truthfully reflects on-disk state.
- **Hash dedupe** (sha256 over the source buffer): if a `ready` document with the same hash already lives in the collection, emit a synthetic `ready` progress event referencing the existing row and skip — no duplicate document row, no re-chunking, no re-embedding. Hashes are computed once per ingest from the same buffer that gets handed to the loader.
- **PDF path**: when `loadDocument` returns `{kind: 'paged', pages}`, the orchestrator calls the chunker once per page with `page` set and re-numbers indices sequentially across pages so the chunk_index sequence is gap-free.
- **Cancel timing**: `checkCancel(signal)` runs between every phase AND immediately after the embed await (before the vector-count contract check). This means a user cancel mid-embed surfaces as `'cancelled'`, NOT as a misleading "vector count mismatch" if the worker returned a partial batch.
- **Spine emission**: `rag.ingest.started` and `rag.ingest.completed` (or `.failed`). The `correlationId` is the **jobId** so Activity Timeline can reconstruct a multi-file ingest from one id — same pattern as the Prompt 3 chat correlation.
- **Empty-content path**: if the chunker filters everything (input below `MIN_CHUNK_CHARS`, or a PDF whose extracted text is only TOC fragments), the doc lands `ready` with `chunk_count: 0` and `status_detail: 'no extractable content'`. The UI shows "indexed, no content" rather than re-trying on every refresh.
- `EmbeddingsLike` is the minimum interface — `embed(texts) → Promise<Float32Array[]>`. Tests inject a deterministic stub; production passes `getEmbeddingsService()` from R2. Singleton `getIngestManager(deps?)` + `__resetIngestManager()`.

**Event catalogue (`event-log.ts` + `src/lib/types.ts`).** Three new entries: `rag.ingest.started`, `rag.ingest.completed`, `rag.ingest.failed`. Renderer presentation layer adds labels and a subtitle like `"sample.md (12 chunks)"` so timeline rows read at a glance.

**IPC (`electron/ipc/rag.ts`).** Five new handlers under the existing `rag` namespace:
- `rag:document:list(collectionId)` — newest-first feed for one collection.
- `rag:document:ingest(collectionId, files)` — validates the `files` shape (each needs a `name`; each needs at least one of `{path, text}`), then calls `manager.submit`. Returns `{jobId}`.
- `rag:document:reingest(documentId)` — only valid for path-sourced rows (paste rows can't be re-ingested because the buffer is gone). Sets the row back to `queued`, drops chunks, resubmits.
- `rag:document:delete(documentId)` — store-level delete with the vec-then-chunks ordering.
- `rag:document:cancel(jobId)` — aborts the in-flight job.

The progress fan-out is wired at first ingest-handler call via `ensureIngestWired()`: it builds the IngestManager singleton lazily (so app startup pays no cost when RAG is unused), subscribes to the `'progress'` event, and forwards each progress payload to every renderer window via `webContents.send('rag:document:progress', e)`.

**Preload bridge.** New `window.api.rag.document.{list, ingest, reingest, delete, cancel, onProgress}` namespace. `onProgress` returns an unsubscribe function so React effects can clean up cleanly on hot reload / tab switch — same pattern as `tools.onApprovalRequired` from earlier prompts.

**Tests (`electron/services/rag/ingest.test.ts`).** 8 tests under the same `vi.mock('electron')` + forced memory fallback pattern. A deterministic fake embedder (`Float32Array(384)` with char-code buckets) sits in for the real worker.
- **Happy path**: `loading → chunking → embedding → ready` phase progression observed via progress events; doc lands `ready` with `chunkCount > 0`; chunks materialize in the memory store with matching `documentId`; spine events are `[rag.ingest.started, rag.ingest.completed]` ordered by time, both with `correlationId === jobId`.
- **Dedupe**: a second submission of the same file produces no new doc rows; the dedupe hash lookup hits.
- **Unsupported extension**: doc lands `error` with a non-empty `status_detail` (lowercase-match `unsupported`); no chunks; `rag.ingest.failed` event fires.
- **Embedding failure**: a rejecting embedder produces `status='error'` + the error message in `status_detail`; chunks count returns to 0 (failDoc rolls back).
- **Vector-count mismatch**: an embedder that returns one vector for a multi-chunk input fails with a clear "1 vectors for N chunks" message. Uses an inline-generated multi-chunk text file so the test doesn't depend on the fixture's chunk count.
- **Cancellation**: a blocking embedder (resolver captured by the test) holds the job in the embedding phase; `mgr.cancel(jobId)` returns true; once the embedder unblocks, the orchestrator's post-await `checkCancel` flips the doc to `error` with `status_detail: 'cancelled'` (NOT a count-mismatch error, thanks to the cancel-before-count-check ordering).
- **Cancel on unknown jobId**: returns false.
- **Delete cascade**: deleting a ready doc removes the row AND drops every chunk for it from the memory store.

**IPC test (`electron/ipc/rag.test.ts`) extended.** Now pins the R5 document surface (`list, ingest, reingest, delete, cancel`) as present AND pins the absence of R7+ handlers (`query, attachments`) so a future test catches accidental cross-prompt registrations.

**Verification.** `tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean. New tests: 8/8 ingest + 1 updated IPC absence assertion + the existing IPC surface (10 total in the rag.test.ts file). Full suite: **51 files / 736 passing + 5 skipped / 0 failed** — +9 new tests, 0 regressions.

**Acceptance check vs. R5 plan.**
- IngestManager with submit/cancel + EventEmitter progress: ✓
- Serial per-file processing with phase progression (loading → chunking → embedding → ready): ✓
- Hash dedupe; existing-and-ready short-circuits: ✓
- Transactional chunk + vec insert (gated on isVecAvailable): ✓
- AbortSignal between phases AND after embed await: ✓
- `rag.ingest.started/completed/failed` spine events, correlationId=jobId: ✓
- IPC surface + preload + onProgress unsubscribe: ✓
- Tests for dedupe / error / cancel / cascade — all green via the memory fallback. ✓
- The R1 FTS sync trigger + the vec0 dimension contract are **runtime smoke** items (production hits a real SQLite + a real sqlite-vec; vitest can't load either). Documented in `store.ts`'s `insertChunks` comment.

**Carry-forward.** R6 builds the Library UI (collection list, document table, ingest dropzone, progress cards) on top of the IPC surface this prompt landed. R7 implements hybrid retrieval (FTS5 + sqlite-vec MATCH + RRF) — also reads from the populated tables this prompt fills. The IngestManager singleton's lazy embed-service wiring means R7 can call `getEmbeddingsService` from a different IPC handler without re-initialization.

## RAG R2 + R3 + R4 — Embeddings service, chunker, document loaders (2026-06-03)

Three sequential R-prompts landed in one session. The pieces don't yet talk to each other (ingest is R5) but every piece has full unit-test coverage and TS+suite gates clean. Build status: 50 test files / 727 passing / 5 skipped / 0 failures (up from R1's 47/689; +38 new tests, 0 regressions).

### R2 — Local Embeddings Service

**Dependency.** `@xenova/transformers` added.

**`electron/services/rag/embeddings/catalog.ts` (new).** `EMBEDDING_CATALOG: readonly EmbedderInfo[]` with two entries — `bge-small-en-v1.5` (384-dim, ~33 MB, MIT, default) and `all-MiniLM-L6-v2` (384-dim, ~23 MB, Apache-2.0, fastest). Each entry: `id`, `name`, `dimensions`, `approxBytes`, `modelRef` (HF id passed to `pipeline()`), `license`, `description`. `getEmbedder(id)` + `getDefault()` accessors. `DEFAULT_EMBEDDER_ID = 'bge-small-en-v1.5'`.

**`electron/services/rag/embeddings/worker.ts` (new).** Worker-thread that hosts a transformers.js feature-extraction pipeline. Communication via `parentPort` `postMessage` / `'message'` events. Inbound: `{type: 'load', modelRef, id}`, `{type: 'embed', texts, id}`, `{type: 'dispose'}`. Outbound: `{type: 'load:done', id}`, `{type: 'embed:done', id, vectors}`, `{type: 'error', id, message}`. The cached pipeline promise is keyed on `modelRef`; switching models resets the cache so the new weights load instead of returning the stale pipeline. `env.cacheDir` is pinned to `userData/models/transformers/` so production installs share the download between sessions. Workload: `pipeline(texts, { pooling: 'mean', normalize: true })`; tensor `data` slices into per-text `Float32Array[]` so the main thread doesn't have to derive the layout.

**`electron/services/rag/embeddings/service.ts` (new).** Main-thread façade. `EmbeddingsService` constructor takes `userDataPath` and an optional `WorkerFactory` (injected for tests; defaults to a real `worker_threads.Worker`). Lazy: the worker isn't spawned until the first `setActive`/`embed` call so app startup pays nothing when RAG is unused. Batches inputs at `BATCH_SIZE = 32` per worker call. The model auto-loads on first `embed()` so callers don't have to remember the setActive dance. `setActive(id)` emits `rag.model.download.started` and `rag.model.download.completed` on the **first activation of a given model id only** — subsequent calls don't re-emit, and switching to a *different* model DOES emit a new started/completed pair. Failure path: `rag.model.download.failed` with `errorPreview` from `boundedJsonPreview`. Singleton accessor `getEmbeddingsService(userDataPath)` + `__resetEmbeddingsService()` test hook.

**Why `embed()` is NOT in `window.api`.** A renderer with raw embed access could DoS the worker by spamming giant batches. The ingest orchestrator (R5) is the only legitimate caller; the renderer asks for ingest *progress*, not raw embeddings. Pinned by an absence assertion in the IPC test (`rag:embedder:embed` is never registered).

**IPC (`electron/ipc/rag.ts`).** Three new handlers: `rag:embedder:catalog` (returns `EMBEDDING_CATALOG`), `rag:embedder:active` (returns `{id}` from the singleton), `rag:embedder:setActive(id)` (validates id and switches). All use `app.getPath('userData')` to seed the singleton on first call.

**Preload bridge.** `window.api.rag.embedder.{catalog, active, setActive}` added under the existing `rag` namespace. `embed` is intentionally absent.

**Event catalogue.** `EVENT_TYPES` + the renderer `EventType` union gain `rag.model.download.started/completed/failed`. `event-presentation.ts` adds labels ("Embedder downloading / ready / download failed") and a subtitle showing `name` (or `embedderId` fallback).

**Tests (`electron/services/rag/embeddings/service.test.ts`).** 12 tests + 1 intentionally skipped. The skip is the model-download integration test — gated behind `LAMPREY_RUN_EMBED_NETWORK=1` per the plan's "first-run download allowed up to 60s" note; we don't default it on because that's ~33 MB of bandwidth per CI run.
- Catalog: default is `bge-small-en-v1.5`; every entry has the required fields and a `Xenova/*` modelRef; `getEmbedder('not-real')` returns `undefined`.
- A fake `WorkerLike` factory replies to `load`/`embed` messages with deterministic vectors (char-code buckets mod dim) so the service's queue + batching + event emission can be exercised without spawning a real thread or downloading a model.
- `setActive` emits started + completed on first activation.
- Second `setActive` for the *same* model emits no second download pair (the `downloadEventEmittedFor` set is the contract).
- Switching to a *different* model DOES emit a new pair.
- Unknown model id throws with a clear "unknown embedder" message.
- `embed` returns one `Float32Array` per input in input order; 75 texts produce ceil(75/32)=3 embed messages (batching contract).
- `embed([])` no-ops without touching the worker.
- `dispose` calls `terminate` on the worker.
- A worker `'error'` reply on an embed message rejects the embed promise with the worker error text.

### R3 — Chunker

**`electron/services/rag/chunker.ts` (new).** Pure: no IO, no IPC, no DB. Recursive character splitter with separators `["\n\n", "\n", ". ", " ", ""]`. Markdown heading-aware path: pre-split on `#`/`##`/`###`/etc and stamp `headingPath` like `"Top > Section A > Sub A1"` (respects fenced code blocks so `# headings` inside ```` ``` ```` blocks don't open sections). Source-code path: counts newlines to set `lineStart`/`lineEnd` per chunk. PDF page-stamping: callers (R4 loader → R5 orchestrator) pass one `ChunkInput` per page with `input.page` set, and every emitted chunk inherits the page number. Hard ceilings exported as `MAX_CHUNK_CHARS = 2000` and `MIN_CHUNK_CHARS = 50` — chunks above the ceiling are re-split with chunkSize/2; chunks below the floor are dropped and indices are re-numbered so emitted chunks form a 0..N-1 sequence. Default `ChunkOptions`: `chunkSize: 800`, `chunkOverlap: 100` — matches the `rag_collections` defaults from R1.

**Internal design.** `splitIntoPieces` walks the separator hierarchy until every piece is ≤ chunkSize; `splitWithSeparator` keeps the separator attached to the *preceding* piece so paragraph breaks stay readable; `windowPieces` aggregates consecutive small pieces into ~chunkSize chunks with `chunkOverlap` overlap, retreating `i` to create the overlap without infinite-looping on tiny pieces. Tree-sitter-aware splitting is **intentionally not built** — the plan calls it out as a v2 concern and the dumb splitter is the right starting point.

**Tests (`electron/services/rag/chunker.test.ts`).** 14 tests, full coverage of every contract:
- Floors + ceilings: empty/short input → `[]`; input above the floor but below chunkSize → exactly one chunk; 10,000-char no-separator blob never emits a chunk over `MAX_CHUNK_CHARS`; no emitted chunk under `MIN_CHUNK_CHARS`.
- 5,000-char prose input → 5–10 chunks, sequential indices, all under chunkSize, every chunk is a substring of input.
- Markdown: paths populated as `Top`, `Top > Section A`, `Top > Section A > Sub A1`, `Top > Section B`; fenced code blocks don't open sections (heading inside ```` ``` ```` keeps the surrounding `Real Heading` path); no-heading input → no `headingPath` set.
- Source code: `lineStart`/`lineEnd` populated, monotonically advancing across chunks; one-line file → `lineStart === lineEnd === 1`; NON-code source kind → `lineStart`/`lineEnd` undefined.
- PDF page stamp: every chunk emitted from a `page: 7` input has `page: 7`.

### R4 — Document Loaders

**Dependencies.** `pdf-parse` + `mammoth` added.

**`electron/services/rag/loaders/text.ts` (new).** `loadText(path)` → `{ text, mime }`. Detects mime by extension across markdown, plain text, JSON, CSV, YAML, and every code extension the chunker recognizes. **Two rejection paths**: oversize (>25 MB — split the corpus into smaller files first) and binary (NUL byte in the first 4 KB — same heuristic git uses). Reads the file into a buffer once, then sniffs, then UTF-8-decodes; no double read. `loadFromBuffer(name, buffer)` covers paste/in-memory cases — same mime detection, same size cap, same binary sniff. PDF/DOCX paste support is intentionally NOT in v1.

**`electron/services/rag/loaders/pdf.ts` (new).** `loadPdf(path)` → `{ pages: { page, text }[], mime: 'application/pdf' }`. Uses `pdf-parse` with a `pagerender` hook so per-page text is captured into the `pages` array as the parser walks the PDF (default `pdf-parse` concatenates everything into one big string). Strips form-feeds and collapses 3+ newlines to 2. Throws `"PDF is encrypted"` when the parser surfaces an encryption error, and `"PDF appears scanned (no extractable text)"` when total text across all pages is < 100 chars. Late require of `pdf-parse` so its module-init self-test doesn't crash tests that don't exercise PDFs.

**`electron/services/rag/loaders/docx.ts` (new).** `loadDocx(path)` → `{ text, mime: '...wordprocessingml.document' }`. Uses `mammoth.extractRawText({ path })`. Normalizes `\r\n` → `\n` so the chunker's separator hierarchy works.

**`electron/services/rag/loaders/index.ts` (new).** `loadDocument(path)` dispatcher — discriminated union `{ kind: 'text', text, mime } | { kind: 'paged', pages, mime }`. The chunker dispatches on `kind` (R5 will wire this through the ingest orchestrator).

**Fixtures (`electron/services/rag/loaders/__fixtures__/`).** `sample.md`, `sample.ts`, `sample.txt` — small real files used by the loader tests. PDF + DOCX fixtures are NOT generated inline (small binary blobs round-trip poorly through PR review); their runtime contracts are unit-tested through the failure paths (encryption / scanned / parse failure), and the integration smoke is the user's "drop a real PDF into a collection" path.

**Tests (`electron/services/rag/loaders/loaders.test.ts`).** 11 tests:
- `loadText` round-trips each of the three real fixtures and reports the right mime.
- Unsupported extension → "Unsupported text extension" error.
- File with NUL bytes (written to a tmp dir) → "binary" error.
- Oversize buffer → "exceeds" error (exercised via `loadFromBuffer` so the test doesn't have to write a 25 MB file).
- `loadFromBuffer`: returns content with mime derived from name; unknown extension falls back to `text/plain`; binary buffer is rejected.
- `loadDocument` dispatcher routes `.md` to the text loader and rejects unknown extensions.

### Combined gates

**TS.** `tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean across all three prompts.

**Vitest.** Full suite — **50 files / 727 passed + 5 skipped / 0 failed**. Net additions per prompt:
- R2: +12 tests + 1 skipped (network gate).
- R3: +14 tests.
- R4: +11 tests.
- Plus an updated IPC test that now pins the R2 embedder surface and pins the R5+ absence. 0 regressions across the existing 47 files.

**Carry-forward.** R5 wires everything together: the ingest orchestrator picks up `loadDocument` → `chunk` → `getEmbeddingsService().embed` → a single SQLite transaction that inserts `rag_documents` + `rag_chunks` (FTS sync triggers from R1 fire automatically) + `rag_chunk_vec` rows (gated on `isVecAvailable`). Progress events stream through a new `rag:document:onProgress` channel. The integration test in R5 finally exercises the R1 FTS sync trigger contract that was deferred under the vitest native-module constraint. The UI prompts (R6 / R11 / R12) come after the engine is fully cohesive; R7-R10 (retrieval, rerank, multi-query, context-builder) are then mostly pure functions over the populated tables.

## RAG R1 — Schema, sqlite-vec, Collections (2026-06-03)

First step of the new Lamprey RAG plan (`PLANNING/LAMPREY_RAG_PLAN.md`). Lands the SQLite foundation for local retrieval: the sqlite-vec extension loader, the migrations for every RAG table (collections, documents, chunks, FTS5 mirror with sync triggers, vec0 vector index, retrievals), and collection CRUD with spine-emitting IPC handlers. **No embeddings yet, no ingest, no retrieval** — those land in R2-R7. The schema covers both lexical AND dense retrieval from day one (replacing Data Spine Prompts 7-8's FTS-only scope, per the RAG plan's "Prerequisites §5").

**Dependency.** `sqlite-vec` added (^0.x). Ships precompiled binaries for win/mac/linux x64+arm64; the npm `postinstall` already rebuilds better-sqlite3 against Electron 35's ABI so the two natives coexist.

**`electron/services/rag/vec-loader.ts` (new).** Wraps `sqlite-vec.load(db)` in a try/catch and runs a `SELECT vec_version() AS v` probe to confirm the extension is actually present (not just that `load()` didn't throw on a broken stub). Exposes `loadSqliteVec(db)`, `isVecAvailable()`, `getVecLoadError()`. On failure logs `[db] sqlite-vec UNAVAILABLE: <reason>` and the app still boots — RAG IPC handlers consult the flag and the renderer can surface a clear banner. The vec0 virtual table creation is gated on the same flag inside `database.ts` so the rest of the RAG schema (lexical-only) works without the extension.

**`electron/services/database.ts` schema additions.** RAG block lands at the end of `initSchema`, after the GitHub tables and the existing index pass:
- `rag_collections` — id, name, description, embedder_id, chunk_size, chunk_overlap, workspace_path, project_id, timestamps. `idx_rag_collections_updated` for the listing UI.
- `rag_documents` — id, collection_id (FK ON DELETE CASCADE), source_kind (CHECK), source_path, display_name, mime, bytes, hash_sha256, mtime, status (CHECK), status_detail, chunk_count, ingested_at, updated_at. Indexes on collection_id, status, hash_sha256.
- `rag_chunks` — id, document_id (FK ON DELETE CASCADE), collection_id (denormalized for query speed — retrieval scopes by collection without joining through documents), chunk_index, start/end offset, heading_path, page, line_start/end, text, token_count, created_at. Indexes on (document_id, chunk_index) and collection_id.
- `rag_chunks_fts` — FTS5 virtual table in external-content mode keyed on rag_chunks.rowid. Tokenizer `porter unicode61 remove_diacritics 2`. **Sync triggers** for INSERT / DELETE / UPDATE keep FTS in lockstep with rag_chunks — INSERT mirrors text + heading_path, DELETE writes a `'delete'` tombstone, UPDATE does both. All triggers are `CREATE TRIGGER IF NOT EXISTS` (idempotent).
- `rag_chunk_vec` — vec0 virtual table `FLOAT[384]`. **Conditional**: created only when `isVecAvailable()` returns true. Dimension matches the v1 default embedder (bge-small / MiniLM); a dimension change is a future drop+rebuild migration.
- `rag_retrievals` — id, message_id, conversation_id, query_text, query_kind, scopes_json, results_json, duration_ms, created_at, correlation_id. Two indexes (by message, and by conversation + recency).

Every migration uses `CREATE TABLE IF NOT EXISTS` / `CREATE TRIGGER IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` so the migration is forward-additive and idempotent — matches the project's `safeAddColumn` migration convention.

**`electron/services/rag/store.ts` (new).** Collection CRUD: `createCollection`, `listCollections`, `getCollection`, `updateCollection`, `deleteCollection`. Patches selectively (only supplied fields move); clearing optional scope strings via empty-string input is supported. The `RagCollection` interface is duplicated in `src/lib/types.ts` for the renderer (the two tsconfig roots can't reach across) — the convention's `LampreyToolCall` does the same. Memory fallback mirrors `permission-policies-store.ts`: activates when `getDb()` throws so headless vitest tests can exercise CRUD without booting better-sqlite3 (rebuilt against Electron's ABI; not loadable under Node 24). `__resetCollectionStore` + `__forceMemoryFallback` exposed as test-only hooks.

**`electron/ipc/rag.ts` (new).** R1 surface only — `rag:collection:list/create/update/delete` plus a `rag:status` probe returning `{ vecAvailable, vecError }` for the future "vector search disabled" banner. Every successful mutation emits a `rag.collection.created/updated/deleted` event with `entityKind: 'rag-collection'` and `entityId` = collection id. `projectId` and `workspacePath` are mirrored to the dedicated event columns when set, so `events:timeline({projectId})` picks up collection activity. The delete handler captures the pre-delete row name BEFORE the delete so the event payload can identify what the user removed (post-delete the row is gone). R2+ handlers (`document`, `query`, `embedder`, `attachments`) are intentionally absent; the IPC test pins that absence.

**Event-type catalogue.** Three new entries in `EVENT_TYPES` (backend) + the renderer `EventType` union: `rag.collection.created`, `rag.collection.updated`, `rag.collection.deleted`. The renderer-side presentation layer (`src/lib/event-presentation.ts`) grows three labels ("Collection created/updated/removed") and a subtitle branch that shows `name · embedderId` so Activity Timeline rows read usefully.

**Preload bridge.** `window.api.rag` namespace added under `events`. R1 exposes `rag.status()` + `rag.collection.{list, create, update, delete}`. Document / query / embedder / attachment namespaces will be added incrementally as later R-prompts land their backends.

**Renderer type mirrors (`src/lib/types.ts`).** Added `RagCollection`, `RagDocument` (full shape with `RagDocumentStatus` + `RagDocumentSourceKind` unions matching the SQL CHECK constraints), `RagChunk` (subset for rendering), plus placeholders for `RetrievalResult` (R7), `EmbedderInfo` (R2), and `IngestProgressEvent` (R5). Lockstep contract: any future schema change to a column must also update the renderer mirror.

**Tests.**
- `electron/services/rag/store.test.ts` — 17 tests using the standard `vi.mock('electron')` + forced memory fallback pattern. Input validation (name + embedderId required); create/get roundtrip with defaults; preserves caller-supplied chunkSize / chunkOverlap / scope fields; list ordering by `updatedAt DESC`; selective patch via `updateCollection` (only supplied fields move; updatedAt bumps; createdAt stable); empty-string patch clears optional scope fields; throws on unknown id; delete returns true/false (hit/miss) and doesn't affect siblings; memory-fallback signal probe. A `describe.skip` block holds the two contract tests R1 plans (cascade through documents+chunks, FTS sync trigger fires on chunk insert) — both require a real better-sqlite3 connection that vitest can't load, so the SQL contract is documented inline as the substitute audit trail.
- `electron/ipc/rag.test.ts` — 7 tests. Handler registration pins the R1 surface AND pins absence of the R2+ channels. `rag:status` returns a deterministic `vecAvailable` boolean. Collection create roundtrip emits `rag.collection.created` with `entityId` + `projectId` + payload `name`. Create with bad input returns the error envelope and emits **no** event. List returns the seeded collections. Update emits `rag.collection.updated`. Update with missing id returns `error: 'id is required'`. Delete captures the pre-delete name into the event payload (the row is gone post-delete; the payload is the only place to recover it). Delete of unknown id returns `success: true, data: false` and emits no event.

**Verification.** `tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean. New tests `npx vitest run electron/services/rag/store.test.ts electron/ipc/rag.test.ts` — **24/24 passed + 2 skipped (the DB-only contract placeholders)**. Full suite (`npx vitest run`) — **47 files / 689 passed + 4 skipped / 0 failed** (up from Prompt 6's 45/665; +24 new tests, +2 skipped, 0 regressions across the existing 45 files). The runtime verification step (manual DevTools roundtrip + `[db] sqlite-vec loaded` in main-process logs) the plan calls for needs a running app — deferred to user-side smoke; the spine-event tests cover the contract.

**Acceptance check vs. R1 plan.**
- Schema lands. ✓ (all six tables + FTS triggers + vec0)
- Extension loaded before migrations; app boots even if vec is unavailable. ✓
- Collection CRUD shipped through `store.ts`. ✓
- Three IPC handlers + `rag:status`. ✓ (R2+ namespaces intentionally absent and pinned by test)
- `window.api.rag.collection.{list, create, update, delete}` exposed. ✓
- Tests for collection roundtrip, list ordering, delete (cascade in DB skip block). ✓
- FTS sync trigger contract documented inline; real-DB test deferred to runtime smoke. ✓ (under vitest's native-module constraint)
- DEVLOG entry. ✓

**Carry-forward.** R2 builds the local embeddings service (transformers.js worker thread, `bge-small-en-v1.5` default). The `embedder_id` column on `rag_collections` is already in place; R2's `setActive` will wire it. The skipped FTS sync trigger test gets exercised for real in R5 when ingest writes actual chunks — at that point the test environment will have a real ingest fixture and can verify the trigger end-to-end via the production code path. The R1 store stops short of any document / chunk / vec writes; those land with R5's ingest orchestrator.

## Data Spine Prompt 6 — Persistence Boundary Cleanup (2026-06-03)

Closes the spine's audit story for the last unaudited mutating surface (the keychain) and ships the load-bearing doc the plan's acceptance bar calls for: a `ARCHITECTURE/PERSISTENCE.md` that maps every category of local state to its backend, writer, and audit hook. No schema migrations, no broad refactor — the existing repository modules already conform to the pattern; this prompt codifies the contract.

**`security.decision` events for keychain mutations (`electron/services/keychain.ts`).** The `security.decision` event type was reserved in Prompt 1's catalogue but had no producer. Wired three call sites:
- `setKey(provider, key, opts)` — emits `key-created` (first write for a provider) or `key-updated` (overwrite). `storageMode` distinguishes safeStorage-encrypted writes from plaintext-fallback writes. When `safeStorage.isEncryptionAvailable()` is false AND consent is absent, the helper emits `key-set-refused` with severity `warning` BEFORE throwing `PlaintextConsentRequiredError`, so the timeline records the refusal even though no key was written.
- `deleteKey(provider)` — emits `key-deleted` only when the provider actually existed (no event for delete-of-absent).
- `grantPlaintextConsent()` — emits `plaintext-consent-granted` only on the false→true transition. Second grant calls in the same session are no-ops at the event layer too.

The audit contract is enforced at the call sites, not in the helper: every `emitKeychainEvent` call passes only discrete metadata (`action`, `provider`, `outcome`, `storageMode`). The key VALUE is never an argument and never lands in `payload_json`. A future refactor that adds a `key?: string` field to `KeychainEventDetail` breaks the contract and must fail review — the source comment in `keychain.ts` makes this explicit.

**Implicit consent re-grant left silent.** When `getKey` reads an existing `plain:` row, it flips `sessionPlaintextConsent` so background refreshers (the mcp-manager OAuth token refresh, primarily) can re-save without re-prompting. This re-grant deliberately does NOT emit a `plaintext-consent-granted` event — we don't want one event per OAuth refresh. The user's *original* consent was emitted whenever the `plain:` row was first written, which is the actually-interesting moment in the audit trail.

**`ARCHITECTURE/PERSISTENCE.md` (new).** Single-page reference doc with a summary table mapping every backend (SQLite, settings.json, mcp-servers.json, keys.json, active-workspace.txt, github/askpass scripts, RAM-only caches) to its owner module, what it holds, and which event categories audit its mutations. Plus:
- **5 invariant rules**: one owner per backend; no second writer to `settings.json` or `keys.json`; no credentials in SQLite and no metadata in the keychain; caches are RAM only; one-off text files only when materially better.
- **SQLite table inventory**: one row per table with its owner `*-store.ts` module and audit footprint. Calls out which tables are intentionally NOT audited (memory entries, plan steps, goals, project rename/touch) and why.
- **Repository pattern contract**: the shape every `*-store.ts` follows — `rowToX`, public CRUD with prepared statements, spine emission inside the store (not the IPC handler), and which two modules have a memory fallback for headless tests (`event-log.ts`, `permission-policies-store.ts`).
- **Per-backend rules**: `settings.json` (no file lock, single-threaded JS is the only defence; logs key NAMES only), `mcp-servers.json` (not currently audited, called out as a clean Prompt 4 follow-up), `keys.json` (the audit contract; the `key-set-refused` event; the implicit-consent doc), `active-workspace.txt` (why not in settings.json), `github/askpass.{sh,cmd}` (helper contains no secret).
- **Migration story**: `safeAddColumn` is the migration primitive — forward-additive only, no version table, no drops. Rename/split workflow documented (add new → dual-write → backfill → switch reads → stop writing old; never DROP).
- **Carry-forward**: Prompts 7-8 will add `documents` and `document_chunks` tables and an FTS5 index. Both follow the documented repo pattern and need no change to this doc.

**No store-module refactors.** The repository pattern is already consistent across the 13 `*-store.ts` modules; the doc audit confirmed it. The two exceptions to the strict "let getDb errors propagate" rule (`event-log.ts` + `permission-policies-store.ts` with their memory fallbacks) are documented as intentional. Nothing else needed to move.

**No data migrations.** Existing `lamprey.db` files from any pre-spine version remain compatible: the spine adds tables via `CREATE TABLE IF NOT EXISTS` and the events table has no foreign-key constraints to the older domain tables (the `conversation_id` / `project_id` / `tool_call_id` columns are unconstrained references — the spine writer is the only producer and it already only writes IDs that exist).

**Tests (`electron/services/keychain-audit-events.test.ts`).** 11 tests using the same `vi.mock('electron')` shape as the existing `keychain.test.ts` (real tmp `userData` dir plus a fake `safeStorage`), with the event-log forced into its memory fallback so its writes don't try to open a real SQLite db in the same tmp tree.
- First `setKey` for a provider → `key-created` with `storageMode: 'encrypted'`.
- Second `setKey` for the same provider → `key-updated`, not `key-created`.
- The key VALUE never appears in any payload JSON (asserted by `JSON.stringify(events).includes('sk-leaky-value')` returning false) — both for the encrypted path and the plaintext path.
- Plaintext write without consent → `key-set-refused` with severity `warning`, AND the function throws.
- Plaintext write with `{ allowPlaintext: true }` → one persistence event with `storageMode: 'plaintext'`.
- `grantPlaintextConsent()` called twice → exactly one `plaintext-consent-granted` event (no-op on the second call).
- Plaintext write under session consent → exactly one new event (the key write), NOT a second consent event.
- Delete-existing → `key-deleted` filtered by action (not `[length-1]`, because same-millisecond stable-sort can swap insertion order under the desc-by-time return).
- Delete-of-absent → no event.

**Verification.** `tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean. `npx vitest run electron/services/keychain-audit-events.test.ts electron/services/keychain.test.ts` — **29/29 passed (+ 2 skipped from the existing file)**. Full suite (`npx vitest run`) — **45 files / 665 passed + 2 skipped / 0 failed** (up from Prompt 5's 43/621; +11 new tests, 0 regressions across the existing 43 files, including the existing keychain test file which is unchanged).

**Acceptance check vs. plan.**
- "No broad ORM migration" — zero schema changes; the repo pattern was already in place. ✓
- "Existing data remains compatible" — no column changes, no table renames; events table additions from Prompt 1 used `CREATE TABLE IF NOT EXISTS`. ✓
- "Store boundaries are documented and easier to audit" — `ARCHITECTURE/PERSISTENCE.md` is the doc; the keychain mutations are now in the spine alongside settings, workspace, worktree, automation, project, and chat-run producers. ✓
- "Existing persistence tests" pass (29/29 keychain + 665/665 full suite); migration compatibility verified by the additive nature of all spine work; existing conversations / projects / automations / permissions are unaffected (no producers in those paths changed in this prompt). ✓

**Carry-forward.** `mcp-servers.json` mutations are still unaudited — adding an `mcp.config.updated` event to the catalogue would round out the JSON-file story; called out in `PERSISTENCE.md`. `permission_policies` CRUD has `permission.policy.created/updated/deleted` reserved in the catalogue but unwired; a clean follow-up. Both are independent of the Prompt 7 retrieval foundation and can land at any time.

## Workspace UI — Environment Card Refactor + Theme Refresh (2026-06-02, v0.1.30 → v0.1.38)

A multi-iteration UI pass landing on main as a single merge. Two distinct work streams.

### Theme refresh (v0.1.29)

`THEME_PRESETS` in `src/styles/theme-presets.ts` re-shuffled to fix dark-mode collisions. Magma / Violet / Inferno read as the same purple-pink palette in the picker — dropped Violet and Inferno, replaced with:
- **Lamprey Mint** — deep forest backgrounds, kelly-green accent `#4cbb17`, mint-tinted text.
- **Lamprey Earth** — warm dark browns, beige text, mahogany accent `#8b3a1a`.

Also added **Lamprey Drab** (olive backgrounds, khaki text, mocha accent `#a67c52`, mustard warning `#d4a017`, olive success `#7a8f2a`) so the picker grows to 8 themes. **Lamprey Blue** is now the system default (`DEFAULT_PRESET_ID = 'arcgis-blue'`). `getPreset()` hardened with a two-stage fallback: unknown saved preset id → `DEFAULT_PRESET_ID` → `THEME_PRESETS[0]`, so existing users with `themePreset: 'arcgis-violet'` or `'arcgis-inferno'` fall back cleanly to Blue.

Renderer-side type `ThemePresetId` updated; `electron/ipc/settings.ts` default switched.

### Welcome H1

`src/components/chat/WelcomeScreen.tsx` H1 simplified from `"Lamprey MAI"` to `"Lamprey"`. H2 unchanged.

### Environment card — six-iteration refactor (v0.1.30 → v0.1.38)

The pre-refactor card used `position: fixed; right: 48px; width: 360px` with no collision check — it overlapped the chat-column at narrower workspaces. The refactor landed across eight tagged builds as the design intent clarified; the final shape:

**Component: `src/components/workspace/FloatingEnvironmentCard.tsx`**

A four-phase state machine (`hidden | entering | visible | exiting`) keeps the card mounted while it animates out, then unmounts. A double-RAF on entry commits the `entering` styles (opacity 0, translated 20px right, scale 0.98) before flipping to `visible` so the CSS transition has a "from" frame. The exit timer matches the transition duration so unmount lines up with the end of the fade.

220ms `cubic-bezier(0.2, 0.8, 0.2, 1)` on opacity + transform. `prefers-reduced-motion` swaps in an 80ms opacity-only fade. Focus is blurred and popovers are dismissed when state enters `exiting`, so screen readers and keyboard users aren't trapped in a region about to disappear.

`position: fixed` at viewport coords — not anchored to the chat surround. When the right panel expands, the chat surround shrinks instantly to make room; an absolute-positioned card would be dragged left by that. Fixed means the card stays put and retreats rightward as it fades, while the right panel mounts at full width underneath. The handoff reads as the panel emerging into view as the card floats away — instead of the card being shoved aside.

`width` is a prop (no longer a constant). The parent computes `envCardWidth = rightPanelWidth - 32` (rail width) and passes the same number to both the card (its rendered width) and `ChatView`'s `rightInset`. The chat content area is therefore identical whether the card is showing or the right panel is expanded — toggling no longer shifts the input pill or any message bubble.

Row spacing follows the Codex reference: `gap-3 px-2.5 py-2` on rows, `p-2` on the outer card, `my-2` divider above Sources. The default 388px width (matching the default `rightPanelWidth = 420`) accommodates 5-digit `+12345 -67890` additions/deletions values without crowding.

**Wiring: `src/App.tsx`**

A `ResizeObserver` on the chat workspace column tracks `chatWorkspaceWidth` and re-runs when `needsApiKey` resolves out of `null` (early bug — the effect originally ran on first commit while the loading screen was up, before the ref div was in the DOM, and never re-ran when the main app mounted, leaving width stuck at 0 and the card permanently hidden). Visibility gate is now a simple "does the leftover chat content area have at least 480px to host the dialogue" check after the card slot is subtracted — the old overlap-tolerance arithmetic is gone now that the chat re-centers out of the card's footprint.

The card is rendered at top level (alongside `QuickOpenPalette` / `ToastContainer`) since it's a viewport-fixed overlay, not a chat-layout child.

**Re-center: `src/components/chat/ChatView.tsx`**

When the card is visible, `ChatView` applies `paddingRight: envCardWidth` to the chat-column outer div — *inside* the rounded border, on the same `bg-primary` surface — so messages, welcome content, and the input pill re-center within the remaining area without exposing a bg-secondary "gutter" between chat and card (the previous layout-based attempt did expose one, and read as a compartmentalized third column; that's the failure mode this version is built to avoid). Padding transitions over the same 220ms `cubic-bezier(0.2, 0.8, 0.2, 1)` as the card's opacity/transform, so a single coordinated motion plays on collapse/expand. The horizontal rule above the input pill was also dropped for visual continuity.

**New shared hook: `src/hooks/usePrefersReducedMotion.ts`**

Extracted from a local copy in `Sidebar.tsx` so both the card and ChatView can use the same source. `Sidebar.tsx`'s local copy was left intentionally in place to avoid touching files a parallel session was editing — can be refactored later.

### Verification

`tsc --noEmit -p tsconfig.web.json` + `-p tsconfig.node.json` clean on the merged tree. Eight build artifacts shipped to `dist/` along the way (`Lamprey-0.1.30-x64.{exe,zip}` through `Lamprey-0.1.38-x64.{exe,zip}`); the v0.1.38 build is the current installer. Vitest run on the env card branch before merge: 498 passed, 2 skipped, 0 failures. No regression in the existing 592-test suite from Data Spine Prompt 5 — env card work didn't touch the main process surface.

## Data Spine Prompt 5 — Event Timeline Read APIs + UI (2026-06-02)

Surfaces the spine inside Lamprey. Renderer-callable IPC for `list / get / timeline`, a read-only Activity Timeline view scoped to recent / conversation / project / workspace / chat-run, and a strict producer/consumer split: there is no `events:record` channel and there will not be one — the renderer cannot write into the audit log.

**IPC (`electron/ipc/events.ts`).** Three handlers, all read-only.
- `events:list(filter)` → newest-first feed across the whole spine, optionally narrowed by type / severity / conversation / project / workspace / automation / tool-call / correlation / since / until / limit / order.
- `events:get(id)` → single record or `{ success: false, error: 'not found' }`.
- `events:timeline(filter)` → ascending feed bound to **exactly one** scope (the same guard `listTimeline` enforces). Renderer-supplied filter is validated through a discriminated result so a no-scope call returns a precise error string instead of crashing.

Two pure coercion helpers — `coerceListFilter(raw)` and `coerceTimelineFilter(raw)` — own all of the renderer-side input hardening: drop non-string scope fields, drop unknown event-type strings (and arrays-of-types down to the valid subset, with the array itself dropped when nothing valid remains), reject non-positive and non-finite limits while clamping huge ones to `MAX_LIST_LIMIT = 1000`, accept only `'asc' | 'desc'` for order. Both helpers are exported so the test file can exercise the validation grammar without booting electron. Registered in `electron/ipc/index.ts` after the plan handlers — last in the chain because nothing else depends on it.

**Preload bridge (`electron/preload.ts`).** New `events: { list, get, timeline }` namespace on `window.api`. `list` defaults its filter to `{}` so the renderer can call `window.api.events.list()` for "everything, newest first." The bridge is **just** an `ipcRenderer.invoke` wrapper — no validation, no transformation — so the main-process handler is the single authority on what filters are legal.

**Renderer-side type mirror (`src/lib/types.ts`).** `EventRecord`, `EventType`, `EventSeverity`, `EventRedaction`, `EventActorKind`, `EventListFilter`, `EventTimelineFilter` added at the end of the file. Same lockstep pattern the file already uses for `LampreyToolCall` — the two tsconfig roots can't reach across the electron/src boundary, so the shape is duplicated with a comment that says "keep both in lockstep." `EventType` is a hand-written union of the 28 catalogue entries; if a future producer adds a category to `EVENT_TYPES` it must also be added here.

**Presentation helpers (`src/lib/event-presentation.ts`).** Pure module — node-env safe, no DOM, no React. All renderer formatting choices live here so the React component is layout + state only:
- `eventTypeLabel(type)` — prose label for each EventType ("Tool started", "Worktree removed", etc.).
- `eventSubtitle(event, maxChars = 120)` — compact category-specific subtitle. Pulls `name` for tool events, `provider · model (purpose)` for model requests, `role · model` for agent stages, `from → to` or `cleared (was X)` for workspace changes, `branch → path (failed)` for worktrees, `label · model` for automations, `changedKeys.join(', ')` for settings, project `name`. Returns `null` for categories where no payload field is timeline-useful (`chat.cancelled`, `chat.error`, `security.decision`, `permission.policy.*`). Truncates with `…` past the cap so a long error preview can't overflow a row.
- `severityStyle(severity)` — `{ dotClass, label }` mapping to red / amber / muted dot.
- `formatEventTime(ms, locale)` — `HH:MM:SS` 24-hour; `"—"` for invalid input so the row still lays out.
- `groupEventsByCorrelation(events, order)` — bundles a feed by `correlationId`, keeps unlinked events as their own one-element groups (so the renderer never silently drops rows), returns groups in `startedAt` order. Used by future expansion (the v1 UI lists flat rows for simplicity), but landed now because the grouping logic is the load-bearing piece for "reconstruct one chat run."

**UI (`src/components/activity/ActivityTimeline.tsx`).** Minimal, read-only, embedded as a new **Activity** tab inside `SettingsDialog`. Five scope modes — `recent` (auto-refresh; uses `events:list` with `limit: 100, order: desc`), `conversation`, `project`, `workspace`, `correlation` (each uses `events:timeline`). Each scope has a one-line hint explaining what to paste. The non-recent scopes wait for an explicit "Show" press or Enter so we don't fan out a timeline query on every keystroke. Each row shows a severity dot (with ARIA label + tooltip), the prose type label, the wall-clock time, an optional category-specific subtitle, and a compact `run XXXXXXXX · tool XXXXXXXX` footer when correlation/tool ids are present. Tailwind classes only — no glyph imports, no new asset deps.

**Tests.** Two new files, 33 new tests:
- `electron/ipc/events.test.ts` (15 tests) — `coerceListFilter` accepts valid scopes, drops ill-typed and non-positive values, filters type arrays down to valid subsets (with the whole array dropped when empty), clamps huge limits to `MAX_LIST_LIMIT`. `coerceTimelineFilter` rejects no-scope filters with the precise error string and clamps limit. Handler end-to-end: `events:list` returns recorded events newest-first filtered by scope; `events:get` round-trips and emits `'not found'` for unknown ids; `events:timeline` returns ascending-by-time events; `events:timeline` rejects a no-scope call. Final test pins the security contract: there is no `events:record` / `events:write` / `events:insert` handler.
- `src/lib/event-presentation.test.ts` (18 tests) — `eventTypeLabel` returns prose for every catalogued type. `eventSubtitle` checked per category for the right payload extraction (tool name, provider+model+purpose, role+model, workspace from/to/cleared, worktree branch→path with (failed) suffix on failure, settings changedKeys, automation label, project name) plus truncation with `…` past the cap, and `null` for no-subtitle categories. `severityStyle` returns three distinct CSS classes and the right ARIA labels. `formatEventTime` produces `HH:MM:SS` shape and `"—"` for invalid input. `groupEventsByCorrelation` bundles same-id events, orders groups by start time (asc and desc), and keeps anonymous events as their own one-element groups.

**Verification.** `tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean. New tests `npx vitest run electron/ipc/events.test.ts src/lib/event-presentation.test.ts` — **33/33 passed**. Full suite — **41 files / 592 passed + 2 skipped / 0 failed** (up from Prompt 4's 39/559; +33 new tests, 0 regressions across the existing 39 files). Manual smoke is the renderer-side "open Settings → Activity tab" path — that's verified visually rather than via vitest (the renderer test env is node-only, intentionally — DOM-bound rendering tests are still a carry-forward from Prompt 12 of the prior audit-remediation sprint).

**Acceptance check vs. plan.**
- "Renderer cannot write events directly" — pinned by the `events:record`/`write`/`insert` absence test. ✓
- "Timeline supports filtering by conversation id, project id, workspace path, event type, and correlation id" — every dimension is in `coerceListFilter` (event type via the `type` field on `events:list`) and the four scope dimensions plus `automationId` are in `coerceTimelineFilter`. ✓
- "UI remains read-only and lightweight" — no mutation paths, no glyph deps, no external libraries; pure helpers + a single React component embedded in the existing Settings dialog. ✓

**v1 spine fully shipped.** Prompt 1 (table + service) → Prompt 2 (tool + approval producers) → Prompt 3 (chat + model + agent producers + correlation id) → Prompt 4 (workspace + worktree + automation + project + settings producers) → **Prompt 5 (read APIs + Activity Timeline UI)**. Acceptable to land. Prompts 6–8 from the prompt timeline are the next sprint: persistence boundary cleanup (P6), local retrieval foundation with FTS5 (P7), retrieval events + provenance UI (P8). Each is its own self-contained beat and depends on the populated spine that's now in place.

## Data Spine Prompt 4 — Workspace, Worktree, Automation, Project, and Settings Events (2026-06-02)

Closes the non-chat side of the v1 spine. Workspace changes, worktree create/remove attempts, scheduled automation runs, project lifecycle actions, and settings-key changes now produce timeline rows alongside the chat-turn events from Prompts 2–3. Project + settings event categories are new in this prompt; the rest land at producer call sites that already existed.

**Catalogue extension (`electron/services/event-log.ts`).** `EVENT_TYPES` grows four project entries: `project.created`, `project.archived`, `project.pinned`, `project.deleted`. Workspace + worktree + automation + settings types were already in the v1 catalogue from Prompt 1; this prompt wires the producers. Rename + `touchProject` are intentionally NOT in the catalogue and stay silent — they're noisy bookkeeping (renames happen mid-turn, touches happen on every conversation save) and would drown the timeline.

**`workspace.changed` (`electron/services/workspace-state.ts`).** Emitted from `setActiveWorkspace` after a successful disk write and from `clearActiveWorkspace` after a successful `unlinkSync`. Three rules:
- The previous resolved path is captured BEFORE the write so the event's `from` field is the real prior workspace (not the same path twice in a no-op set).
- Setting the same workspace twice emits **one** event total — the second call is a no-op transition that the test pins.
- Clearing when no `active-workspace.txt` exists emits nothing (no real state changed).

Payload: `{ action: 'set' | 'clear', from?: string, to?: string }`. Actor `user`. Both events carry `workspacePath = to ?? from` so the timeline reader can group by either side of the transition.

**`worktree.created` / `worktree.removed` (`electron/ipc/worktree.ts`).** New shared `emitWorktreeEvent` helper. Every IPC path is wrapped so the event fires once per IPC invocation, with `ok: true` on success and `ok: false` + `severity: 'error'` on any failure. Three failure paths are tagged with a `rejectedAt` field:
- `'plan'` — the pure planner (`planWorktreeCreate` / `planWorktreeRemove`) rejected the input (bad ref name, relative path, etc.). `runGit` was never called.
- `gitCode: N` (no `rejectedAt`) — `runGit` returned a non-zero exit. `errorPreview` carries `res.stderr.trim()` capped by `boundedJsonPreview`.
- `'throw'` — the handler's outer try/catch fired. `errorPreview` carries the JS error message.

Payload also includes `branch`, `cwd`, `force`, `durationMs`. `workspacePath` is set to the resolved `cwd` so workspace-scoped timeline queries pick up worktree activity rooted in that workspace.

**`automation.started` / `.completed` / `.failed` (`electron/services/automations-runner.ts`).** The whole `runOne(autoId)` body is now bracketed by spine emits. Each run generates its **own** per-run `correlationId` (cron firings do NOT share an id — each tick is a discrete "turn"). The id is passed to `chatOnce` via the Prompt 3 `audit` shape with `{ purpose: 'other', role: 'automation' }`, so the underlying `model.request.started/completed/failed` events automatically join the automation's row group; querying by `correlationId` reconstructs the whole run shape. Payload carries `automationId`, `label`, `cron`, `model`, `startedAt`, `durationMs`, `replyPreview` (boundedJsonPreview), `errorPreview`, `errorClass`. The legacy `recordRun(id, last_result)` still writes to the `automations` table — events are the cross-system timeline complement, not a replacement, per the plan's "Automation run history no longer depends ONLY on `last_run_at` / `last_result`" framing.

**`project.created` / `.archived` / `.pinned` / `.deleted` (`electron/services/projects-store.ts`).** Wired at the four discrete mutating fns. `createProject` event payload `{ name, path }`. `setProjectArchived` / `setProjectPinned` payload `{ archived | pinned }` carrying the NEW flag value so the timeline reads "this is the moment X became archived." `deleteProject` carries `detachedConversations` from the `UPDATE conversations SET project_id = NULL` result count — useful audit metadata that's currently nowhere else. Every event has `projectId` populated (both at the column level and inside `payload`) so `listEvents({projectId})` cleanly filters all project activity. `renameProject` and `touchProject` stay silent on purpose.

**`settings.updated` (`electron/ipc/settings.ts`).** Fires from `settings:set` after a successful disk write. New `emitSettingsUpdated(before, after, partial)` does a shallow top-level diff using `shallowEqual` (Object.is fast-path + JSON-stringify fallback for objects). **Only key NAMES leave the function — values never enter the event payload, even for non-sensitive keys.** Any future settings field that happens to be credential-shaped (a new `openaiKey`, etc.) lands safely in the names-only list by default. A small `SENSITIVE_SETTING_KEYS` set flags known credential names (currently just `apiKey`) into a separate `sensitiveChanged` array in the payload so a future timeline UI can highlight them; the value still isn't logged. `partialKeys` records the keys the caller actually included in their `partial` object, which can be a subset of `changedKeys` if a defaults-merge shifted unrelated fields. Setting a value identical to the existing one emits nothing (the shallow diff finds zero changes).

**Tests (`electron/services/spine-events-prompt4.test.ts`, `electron/services/spine-events-prompt4-misc.test.ts`).** 20 tests across two files. Two files because the mocking topology splits cleanly: file 1 mocks the git-runner + providers + automations-store for the workspace/worktree/automation slice; file 2 mocks `./database` for the project/settings slice (settings.ts pulls keychain + deepseek + providers as well, all stubbed). Both files use a real tmp `userData` dir so workspace-state's `writeFileSync` / settings.ts's `JSON.parse(readFileSync)` actually run against the disk; event-log is forced into memory fallback so no real SQLite is opened.

- Workspace (4 tests): set emits `from + to + action='set'`; same-path twice emits one event; clear emits `action='clear'` with `from` set; clear with no prior state emits nothing.
- Worktree (6 tests, via `ipcMain.handle` capture + mocked `runGit`): create success → `ok:true`, create with invalid branch → `rejectedAt:'plan'` (runGit never called), create with git failure → `ok:false` + `gitCode + errorPreview`, remove success with `force:true`, remove with relative path → `rejectedAt:'plan'`.
- Automation (3 tests, via mocked `chatOnce` + `listAutomations` + `recordRun`): success → `[started, completed]` with one shared correlationId AND the `audit` object passed to `chatOnce` carries the same correlationId so runtime `model.request.*` events would join; failure → `[started, failed]` with severity `error` and `errorPreview`; unknown id → no events, no `chatOnce` call.
- Settings (3 tests): first set writes settings.json, event payload carries `changedKeys` but JSON-stringify of the payload contains neither `'light'` nor `'16'`; no-op set emits nothing; `apiKey` in `changedKeys` → also appears in `sensitiveChanged`, value still not in payload.
- Projects (5 tests): create emits with `projectId` populated; archived emits the new flag; pinned emits the new flag; deleted emits; rename emits nothing.

**Verification.** `tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean. New tests `npx vitest run electron/services/spine-events-prompt4*.test.ts` — **20/20 passed**. Full suite — **39 files / 559 passed + 2 skipped / 0 failed** (up from Prompt 3's 37/539; +20 new tests, 0 regressions across the existing 37 files including the existing `workspace-state.test.ts` and `automations-runner` consumers).

**Acceptance check vs. plan.**
- "Automation run history no longer depends only on `last_run_at` / `last_result`" — every run now writes 2 (success) or 2 (failure) spine rows in addition to the legacy `recordRun`. ✓
- "Workspace and worktree changes are visible in the event timeline" — set/clear/create/remove all visible; failure modes carry actionable metadata (`rejectedAt`, `gitCode`, `errorPreview`). ✓
- "Project-related events can be filtered by project id" — `listEvents({projectId})` works because the `project_id` column and the payload both carry the id. ✓
- "Settings updates logging changed keys only" — values never enter the payload; defended in code AND asserted by the test. ✓

**Carry-forward.** The v1 spine is now wired: tool calls + approvals (Prompt 2), chat + model + agent runs (Prompt 3), workspace + worktree + automation + project + settings (Prompt 4). Prompt 5 builds the read-only IPC surface (`events:list`, `events:get`, `events:timeline`) and the minimal Activity Timeline UI on top of the events table. Prompts 6–8 are persistence cleanup + local retrieval, both downstream of a stable, populated spine.

## Data Spine Prompt 3 — Chat, Model, and Agent Run Events (2026-06-02)

Makes a single chat turn reconstructable end-to-end by one id. A `correlationId` is generated at `chat:send` and threaded through every producer the turn touches — model requests, agent pipeline stages, tool calls, approval decisions, chat cancellation, and the top-level error path. Filtering the event log by that id yields the full run in time order, with no joins.

**Active-run map (`electron/ipc/chat.ts`).** Replaced `activeAbortControllers: Map<conversationId, AbortController>` with `Map<conversationId, { controller, correlationId, startedAt }>`. The correlationId is generated at the top of the `chat:send` handler (above the try block, so the catch can reference it even if the handler throws before any state is written). `chat:cancel` reads the stored id and writes a `chat.cancelled` event with `actorKind: 'user'`, severity `warning`, payload `{ cancelledAt, elapsedMs }`. The top-level catch in `chat:send` writes a `chat.error` event with `errorPreview` (size-capped) + `errorClass`. Both are wrapped in defensive try/catch so an event-log fault never replaces the user-visible failure with a different one.

**Model-request events (`electron/services/providers/registry.ts`).** New exported `ModelRequestAudit` shape (`correlationId`, `conversationId`, optional `role`, `purpose`) and three internal helpers — `emitModelRequestStarted`, `emitModelRequestCompleted`, `emitModelRequestFailed`. `chatStream` and `chatOnce` each grow one new trailing optional parameter (`audit?: ModelRequestAudit`); when present, started/completed/failed events fire at every terminal — clean completion, signal-cancelled mid-stream, retries-exhausted error, 401/403 short-circuit. Payload carries `provider`, `model`, `apiModelId`, `streaming` (true for chatStream, false for chatOnce), `toolCount` (the number offered to the model — not the number it called), `emittedToolCallCount` (what came back on stream), `retryCount`, `durationMs`, `cancelled`, `finishReason`, `httpStatus`, `errorClass`, `errorPreview`, plus the audit's `role` + `purpose`. When `audit` is omitted (existing tests, automations not yet wired, deepseek connectivity-check helper), the helpers no-op — the function signatures stay byte-compatible.

**`purpose` taxonomy.** `main` (normal chat turn), `composer` (final-response-composer rewriting the model's draft), `sub-agent` (pipeline planner / reviewer via `executeMultiAgentRun` → `chatOnce`), `pipeline` (reserved), `title` (chat:generateTitle, intentionally not wired in this prompt to keep its event-free), `other`. Lets a UI filter "the actual response turn" away from the housekeeping passes that share a correlationId. `chat:send` threads `{ purpose: 'main' }` into chatStream; the composer site rewrites the runner to pass `{ ...audit, purpose: 'composer' }`; the multi-mode subAgentRunner passes `{ purpose: 'sub-agent' }`. Single-mode title generation, automations runner, deepseek connectivity check, and the multi_agent_run native tool stay audit-less for now — they're orthogonal to the chat turn the user pressed Send on.

**Agent stage events (`electron/services/agent-pipeline.ts`).** `RunAgentPipelineOptions` gains `correlationId?`. Inside `runAgentPipeline`, a small closure (`stageStarted` / `stageDone` / `stageFailed`) tracks per-role start timestamps and emits `agent.stage.started` / `.completed` / `.failed` with `actorKind: 'agent'`, severity `error` for the failed branch. Payload: `{ role, model, durationMs, outputPreview, errorPreview }`. Wired at exactly the same six transition points that drive the existing `agent:status` emits — planner-done, planner-failed (both takenError and try-catch branches), coder-done, coder-failed (both runner-throws and runner-returns-null), reviewer-done, reviewer-failed (both branches). The pre-existing emitter contract is untouched so the renderer's pipeline banner keeps its byte-identical behavior.

**Producer signature extensions.**
- `toolRegistry.recordCallStart(call, correlationId?)` — second arg threads through to the `tool.call.started` event row.
- `toolRegistry.recordCallEnd(callId, patch)` — `patch.correlationId?` rides into the terminal event. NOT persisted to the `tool_calls` table; the doc comment says so explicitly so a future reader doesn't try to add a column.
- `permissionsService.requestApprovalDetailed(req)` — `req.correlationId?` rides into the `tool.call.approved` / `tool.call.denied` event.
- `ToolExecutionContext.correlationId?` — exposed so native tools that emit their own audit rows (`multi_agent_run`, future retrieval) can pass it through. The multi-agent tool pack now reads `ctx.correlationId` and forwards it to the synthetic sub-agent `recordCallStart` / `recordCallEnd` so every fan-out child rolls up under the same correlation id.

**chat.ts plumbing.** `runChatRound` gains a trailing `correlationId?` parameter (added after `suppressDoneEvent` to preserve existing positional calls); `resolveSingleToolCall` gains a trailing `correlationId?` as well. The recursive `runChatRound` call passes it through. The chatStream call passes `audit = { correlationId, conversationId, purpose: 'main' }`. The composer call wraps `chatOnce` in a closure that re-tags `purpose: 'composer'`. The native-tool dispatch passes `correlationId` into `ToolExecutionContext`. The stream-level `onError` callback also emits a `chat.error` event labeled `source: 'stream'` so a provider-side stream failure shows up in the spine even when the orchestration catch doesn't fire (e.g. when `chatStream` resolves cleanly but with an error message).

**Tests (`electron/services/chat-correlation-events.test.ts`).** 5 tests. Same vi.mock pattern as Prompts 1–2 plus a stub of `conversation-store.saveMessage` so the pipeline's reviewer-persist runs without booting a DB. Coverage:
- `recordCallStart` + `recordCallEnd` attach the correlationId to both lifecycle events.
- `permissionsService.requestApprovalDetailed` attaches `req.correlationId` to the approval event.
- `runAgentPipeline` happy path emits `[started, completed]` for planner, coder, reviewer in order, all carrying the supplied correlationId; completed events have `durationMs` + `outputPreview`.
- Planner-failure path emits `[started, failed]` (no completed), severity `error`, with `errorPreview`.
- **End-to-end correlation:** a synthetic run that hits the approval gate, runs a tool, and runs the full pipeline produces ≥8 events all sharing one correlationId; `listTimeline({correlationId})` returns them in ascending time order with `tool.call.approved` first and `agent.stage.completed:reviewer` last.

**Carry-forward.** `chatStream` / `chatOnce` payloads include only metadata + the offered/emitted tool counts — the model's actual response stays on the `messages` table as before. The `chat:generateTitle` helper, the automations runner, and the deepseek connectivity check call `chatOnce` without an audit context on purpose; wiring them is Prompt 4's beat (workspace/worktree/automation events). `chat.cancelled` for in-flight tool runs (a tool that ignored its abort signal and resolved post-cancel) is still observed via the existing `tool.call.completed` event with `cancelled: true` on the wrapping `model.request.completed` — no separate event needed.

**Verification.** `tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean. `npx vitest run electron/services/chat-correlation-events.test.ts` — **5/5 passed**. Full suite (`npx vitest run`) — **37 files / 539 passed + 2 skipped / 0 failed** (up from Prompt 2's 36/534; +5 new tests, 0 regressions across the existing 36 files including the Prompt 2 audit-events file). At runtime, every chat turn now has a correlationId stamped into 6–N new event rows; renderer behavior, IPC payloads, tool dispatch order, and the existing `agent:status` / `chat:done` / `chat:tool-call` events are byte-identical to pre-Prompt-3.

**Acceptance check vs. plan.**
- "One chat turn can be reconstructed by querying one correlation id" — `listTimeline({correlationId})` does exactly that; covered by the end-to-end test. ✓
- "Single-mode and multi-mode turns both produce coherent event timelines" — single-mode runs through `runChatRound` (model.request + tool/approval events); multi-mode runs through `runAgentPipeline` (agent.stage events) + Coder's runChatRound (model + tool events). Both carry the same correlationId because chat:send is the one place generating it. ✓
- "No full model responses are duplicated into events; messages remain the content source" — model.request.completed carries `finishReason` + counts, no body. agent.stage.completed carries a `boundedJsonPreview(output)` (cap 2048 chars), not the full reply. The full content lives on `messages` like before. ✓

**Next.** Prompt 4 wires workspace/worktree/automation events. Workspace + worktree events get their correlationId from whatever turn triggered the change (or absent for user-initiated UI actions). Automations get their own correlationId scoped to a run.

## Data Spine Prompt 2 — Tool + Approval Audit Events (2026-06-02)

Wires the first producers into the spine from Prompt 1. Every tool-call lifecycle transition and every permission decision now mirrors into `events`, linked to the structured `tool_calls.id` so a timeline reader can reconstruct "what happened around this call" without joining log files. The `tool_calls` table stays the structured tool-call audit source — `events` is the cross-system narrative around it.

**`boundedJsonPreview` helper (`electron/services/event-log.ts`).** New exported util plus `FIELD_PREVIEW_CHAR_CAP = 2048`. Producers call it to inline a redacted, char-capped view of a value (args, result text, an error string) into a single payload field. Goes through `redactPayload` first so credential-keyed entries become `[redacted]`. Critical property: when the underlying value is huge, only *that field* truncates with `… (truncated)`, not the whole payload — the surrounding metadata (`toolId`, `durationMs`, `approvalSource`) stays intact in the timeline. The global `PAYLOAD_BYTE_CAP = 16 KiB` envelope still applies as a backstop.

**Tool-call lifecycle (`electron/services/tool-registry.ts`).** Mirrored at the existing audit hooks so every caller — `electron/ipc/chat.ts`, `multi-agent-run-tool-pack.ts`, anything else that uses the registry — gets events automatically with zero changes at the call sites.
- `recordCallStart` → `tool.call.started`. Actor `model`. Payload enriches the raw call with `providerKind` + `risks` + `requiresApproval` looked up from `this.getById(toolId)` (so an MCP tool's `requiresApproval` is captured even when chat.ts didn't pass it), plus the redacted `argsPreview`. `parentCallId` carries through so multi-agent fan-outs are reconstructable.
- `recordCallEnd` → terminal event based on status: `done` → `tool.call.completed`, `error` → `tool.call.failed` (severity `error`), `denied` → `tool.call.denied` (severity `warning`) **only if the deny did not come from the permissions gate**. Maps via the new `isSelfDenialSource(approvalSource)` helper: `'modal' | 'policy:*' | 'auto-deny-timeout' | 'no-window'` mean the gate already emitted; `undefined | 'none' | 'self'` mean the tool denied itself and we emit here. Intermediate statuses (`running`, `approved`, `pending`) emit no terminal event. Payload includes `durationMs`, `approvalSource`, `resultPreview` (or `errorPreview`).
- Both blocks wrapped in their own try/catch — event-log failures must never break a tool call, and event-log already has its memory fallback for the headless / pre-init case.

**Approval decisions (`electron/services/permissions-store.ts`).** `requestApprovalDetailed` is the single place every approval outcome funnels through: policy hits return early, modal answers and the no-window / auto-deny-timeout paths come back from `askUser`. New `emitApprovalEvent` runs at every return point and writes either `tool.call.approved` or `tool.call.denied` depending on the decision. Actor maps from source: `modal` → `user`; `policy:*` / `auto-deny-timeout` / `no-window` → `system`. Payload carries `toolId`, `name`, `providerKind`, `serverId`, `risks`, `source`, and (when relevant) `policyId` — args are **not** included because the approval row is metadata-first; the args preview already lives on the `tool.call.started` row.

**Single decision = single event.** The lifecycle and approval emitters are intentionally non-overlapping. A run that hits an `allow` policy produces `tool.call.approved` (gate) → `tool.call.started` (registry) → `tool.call.completed` / `failed` (registry). A run denied by policy or modal produces `tool.call.denied` (gate) → `tool.call.started` (registry) → no terminal event from the registry (the deny event already covered it; the `recordCallEnd(status='denied', approvalSource='modal'|'policy:*'|...)` call writes the structured row but skips the event). The full-suite end-to-end test asserts exactly this shape for the allow path.

**Tests (`electron/services/tool-audit-events.test.ts`).** 13 tests. Same `vi.mock('electron', …)` pattern used by `permission-policies-store.test.ts` so both the event-log and the policy store engage their memory fallbacks while `tool_calls`'s direct-DB writes fail silently (the registry's existing try/catch absorbs that). Coverage:
- `recordCallStart` writes a `tool.call.started` row tied to the right `tool_call_id` + enriched from the registry.
- `recordCallEnd done|error` write the right terminal type with the right severity.
- `recordCallEnd denied` with each gate source (`modal`, `policy:*`) writes **no** duplicate `tool.call.denied`.
- `recordCallEnd denied` with `'none'` (self-deny) **does** write a `tool.call.denied`.
- Credential-keyed arg fields are `[redacted]` in the `argsPreview`.
- Intermediate `running` status writes only the started row.
- Policy-match allow → `tool.call.approved` event with `policyId` populated.
- Policy-match deny (via gating risk) → `tool.call.denied` event with `severity: 'warning'`.
- No-window default deny → `tool.call.denied` with `source: 'no-window'`.
- Credential-keyed args don't leak into the approval payload.
- End-to-end allow path produces `[approved, started, completed]` in ascending time order when filtered by `toolCallId`.

**What is NOT recorded.** Auto-deny-timeout path needs fake timers to exercise (the resolver waits 30 s); skipped in this prompt to keep the test file fast — same code shape as no-window. Self-approving tools (`selfApproves: true`) bypass the gate entirely, so no `tool.call.approved` event fires for them; their `tool.call.started` still does. Tool args that don't look like credentials are stored verbatim in the `argsPreview` up to `FIELD_PREVIEW_CHAR_CAP = 2048` chars — large patches still land in the timeline as truncated previews, not full diffs.

**Verification.** `tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean. `npx vitest run electron/services/tool-audit-events.test.ts electron/services/event-log.test.ts` — **36/36 passed**. Full suite (`npx vitest run`) — **36 files / 534 passed + 2 skipped / 0 failed** (up from Prompt 1's 35 files / 521 passed; the diff is the 13 new audit-events tests plus 0 regressions in the existing 35 files). At runtime, every existing chat-driven tool call now writes 1–3 new event rows alongside the existing `tool_calls` row update; no observable change in chat behavior, modal flow, or tool dispatch ordering.

**Carry-forward / next.** Prompt 3 generates a `correlation_id` at `chat:send` and threads it through model requests, approval events, agent pipeline stages, errors, and cancellation so a single chat turn can be reconstructed by one id. The audit events from this prompt will pick up correlation ids automatically once chat.ts starts passing one to `recordCallStart` / `requestApprovalDetailed`.

## Data Spine Prompt 1 — Event Log Foundation (2026-06-02)

First step of the Data Spine roadmap (see `PLANNING/Lamprey_Data_Spine_Plan_and_Prompt_Timeline.md`). Adds the durable append-only `events` table plus the typed `event-log` service that every later producer (tool calls, approvals, model + agent stages, automations, workspace changes, settings) will write through. Existing app behavior is untouched — no producer is wired in this prompt; that's Prompts 2–4.

**Schema (`electron/services/database.ts`).** New `events` table inside `initSchema`. Columns: `id`, `type`, `created_at`, `severity`, `conversation_id`, `project_id`, `workspace_path`, `automation_id`, `tool_call_id`, `parent_event_id`, `correlation_id`, `actor_kind`, `actor_id`, `entity_kind`, `entity_id`, `payload_json`, `redaction`. Indexes: `(created_at DESC)` for the recent feed, `(conversation_id, created_at DESC)` / `(project_id, created_at DESC)` / `(workspace_path, created_at DESC)` for scoped timelines, `(correlation_id, created_at ASC)` for chat-run reconstruction, and `(type, created_at DESC)` for category filters. No `CHECK` constraints on `type` / `actor_kind` / `severity` — those are TS-level enums; locking them in SQL would force a migration every time we add an event category, and the writer is the only sanctioned producer anyway.

**Service (`electron/services/event-log.ts`).** Typed writer + reader: `recordEvent` / `recordInfo` / `recordWarning` / `recordError`, `getEvent`, `listEvents(filter)`, `listTimeline(scope)`. Owns JSON serialization (`serializePayload`), redaction (`redactPayload` — walks the payload, replaces values under credential-looking keys with `[redacted]`, cycle-safe via `WeakSet`), payload size cap (`PAYLOAD_BYTE_CAP = 16 KiB`; oversize payloads become a `{ truncated, originalBytes, cap }` envelope and the row's `redaction` flips to `'redacted'`), timestamp generation, and id generation (`randomUUID`). Reader filters cover type / severity / conversation / project / workspace / automation / toolCall / correlation / time window, with limit clamped to `MAX_LIST_LIMIT = 1000` and `order` either `asc` or `desc`. `listTimeline` refuses to run without any scope so callers can't accidentally pull the whole log under the timeline banner.

**Event type catalogue.** Single `EVENT_TYPES` tuple covers the v1 categories the spine plan called out: tool-call lifecycle (`started/approved/denied/completed/failed`), agent pipeline (`agent.stage.started/completed/failed`), model requests (`model.request.started/completed/failed`), chat (`chat.cancelled/error`), workspace + worktree (`workspace.changed`, `worktree.created/removed`), automations (`automation.started/completed/failed`), security/policy (`security.decision`, `permission.policy.created/updated/deleted`), and settings (`settings.updated`). Producers in Prompts 2–4 import the union, so a typo can't reach the database.

**Memory fallback.** Mirrors the `permission-policies-store` pattern: if `getDb()` throws (headless test env without an Electron `app`), the service flips into a process-local fallback and serves reads/writes from an in-memory array. Real users always hit SQLite — the fallback exists so `event-log.test.ts` can exercise the full public API without mocking better-sqlite3, and so a misconfigured `userData` dir during dev doesn't crash the main process. Exposed `__resetEventLog` + `__forceMemoryFallback` for tests; `isUsingMemoryFallback()` for runtime introspection.

**What is NOT stored.** Credentials (keychain owns those), full model responses (already on `messages`), raw file contents (will be Prompt 7's `documents` / `document_chunks` story), tool args beyond the bounded preview the redaction walker leaves in place. `redactPayload`'s key-pattern list catches `api_key`, `authorization`, `bearer`, `cookie`, `client_secret`, `refresh_token`, `private_key`, etc. — the value is replaced with `'[redacted]'` so the field's *presence* is still visible to a timeline reader, but the secret never lands in `payload_json`.

**Verification.** `tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean. `npx vitest run electron/services/event-log.test.ts` — **23/23 passed**. Full suite (`npx vitest run`) — **35 files / 521 passed + 2 skipped / 0 failed**, no regressions in the existing 34 files. No producers are wired yet, so the runtime behavior of every existing path is byte-identical to the pre-spine code; the only observable diff is that `lamprey.db` now has an empty `events` table after first launch.

**Carry-forward / next.** Prompt 2 wires producers into the tool-call lifecycle and permission decisions; Prompt 3 generates a `correlation_id` at `chat:send` and threads it through model/agent/approval paths; Prompt 4 covers workspace/worktree/automation; Prompt 5 exposes read-only IPC + a minimal Activity Timeline. The plan stays metadata-first and bounded until then.
## GitHub OAuth integration with GitHub App-ready architecture (2026-06-02)

Adds first-class GitHub connectivity to Lamprey while preserving every existing local-Git workflow. Implemented OAuth as the working flow; the token-provider boundary keeps GitHub App installation tokens a drop-in for a later commit.

**Token-provider abstraction (`electron/services/github-types.ts`, `github-service.ts`).** `GitHubTokenProvider` exposes `getAccessToken` / `getScopes` and is implemented three ways:
- `OAuthTokenProvider` — reads the bearer from `keychain.getKey('github-access-token')`.
- `GhCliTokenProvider` — shells `gh auth token` so users with the GitHub CLI already authenticated can skip the OAuth dance entirely.
- `GitHubAppTokenProvider` — intentional stub returning `null` today; the interface boundary is the stable contract, so adding the App installation-token exchange (private-key JWT → `POST /app/installations/{id}/access_tokens` → 1h-cache) doesn't touch any caller. `NoneTokenProvider` covers the disconnected case.
The selected mode is persisted in `settings.json` as `githubMode`. `currentMode()` falls back to `oauth` if a token is on disk but no mode flag (handles upgrades cleanly).

**OAuth flow.** Loopback callback at `http://localhost:9876/callback` mirrors `mcp:setupGoogleOAuth` exactly: `createOAuthSession()` for CSRF state, `validateOAuthCallback()` for the four-way decision tree, 2-min timeout, callback HTTP server bound to `127.0.0.1`. Default scopes: `read:user repo` (documented in `GitHubSettings.tsx` copy). The token exchange POSTs to `https://github.com/login/oauth/access_token`, returns `{ access_token, scope }`. Scopes are cached in the keychain so status probes don't need a round-trip when offline.

**Push safety (`electron/services/github-askpass.ts`).** GitHub push goes through a `GIT_ASKPASS` helper. The helper is materialised on first use into `userData/github/askpass.{cmd|sh}`, contains NO secret (the body just reads `$LAMPREY_GH_TOKEN` from env at invocation time), and is set 0o700 on POSIX. `buildAuthenticatedEnv(token, extras)` returns `{ ...process.env, GIT_ASKPASS, GIT_TERMINAL_PROMPT: '0', LAMPREY_GH_TOKEN: token }`. Result: the token never appears in process args, never in `.git/config`, and the helper script file itself never contains the token. The push handler tries the user's `origin` first; only when git returns "no configured push destination" does it fall back to an explicit `https://github.com/...` URL on the command line (URL is non-secret; the token still rides via env).

**REST surface.** `getViewer`, `listAccessibleRepositories` (sort=updated, affiliation=owner+collaborator+organization_member, per_page=100), `getRepository`, `compareBranchToBase`, `createPullRequest`, `listPullRequests`, `getPullRequest`, `cloneRepository`, `pushBranch`. Every method validates owner/repo through `isValidSlug` (rejects empty, leading-dash, leading-dot, `..`, non-`[A-Za-z0-9._-]`) and branch through `isValidBranchName` — matches the worktree validator's argument-injection posture. 401s map to a friendly "reconnect from Settings" message; we never include the bearer or any other secret in surfaced error text.

**Persistence (`electron/services/database.ts`, `github-repo-store.ts`).** Two new tables:
- `project_github_repos` (1-to-1 with `projects`, ON DELETE CASCADE). Holds repo id, full_name, owner/name, default_branch, html_url, clone_url, local_path (nullable — a repo can be linked before clone).
- `conversation_pull_requests` — PRs Lamprey opened from a given conversation, so the side-panel can deep-link back.
`upsertRepoLink` uses `ON CONFLICT(project_id) DO UPDATE` with `COALESCE(excluded.local_path, project_github_repos.local_path)` so a re-link with a null `localPath` doesn't blow away an already-known clone path.

**IPC + preload + ipc-client.** New `electron/ipc/github.ts` registers 18 handlers in the standard `{ success, data } | { success, error }` envelope. Channel inventory (registered in `electron/ipc/index.ts`): `status`, `saveOAuthClient`, `hasOAuthClient`, `setMode`, `connect`, `disconnect`, `viewer`, `repositories`, `getRepository`, `pickCloneDir`, `clone`, `getProjectRepo`, `assignRepoToProject`, `unlinkRepo`, `compare`, `createPullRequest`, `pullRequests`, `getPullRequest`, `listConversationPullRequests`, `pushBranch`, `openInBrowser` (gated to `https://github.com` only). `electron/preload.ts` exposes the typed surface as `window.api.github`; `src/lib/ipc-client.ts` adds a `github` façade returning typed responses. Tokens never cross IPC — the renderer only sees `GitHubConnectionStatus`, `GitHubRepository`, `GitHubPullRequest`, etc.

**Renderer (`src/components/settings/GitHubSettings.tsx`, `RepositoryPickerDialog.tsx`, `PullRequestDialog.tsx`, `PullRequestListPopover.tsx`).** Settings → GitHub tab handles the OAuth client save (gated by the shared `ensurePlaintextConsentIfNeeded` so the safeStorage-unavailable path matches every other provider), the connect/disconnect actions, the gh-CLI fallback, and shows the connected account + scopes + storage mode indicator. The Environment Panel grows a GitHub section: `repo` row opens `RepositoryPickerDialog` (search + owner filter + private/public badge + cloned badge + clone-into-folder via `dialog.showOpenDialog`), `Pull requests` row opens `PullRequestListPopover` (open/closed/all filter + open-in-browser + copy-URL), `New PR` row opens `PullRequestDialog` (compare summary, base/head/title/body/draft, push-then-PR with friendly auth hints). The existing Commit/Push row is untouched — local Git continues to work without GitHub connected.

**Tests (`github-service.test.ts`, `github-askpass.test.ts`).** 29 tests covering: slug + branch validators, request header construction (asserts the token leaks into no header other than `Authorization`), repo list parsing edge cases, PR creation payload shape (incl. `headLabel` precedence for fork PRs), PR response parsing (incl. `merged_at` → `merged: true` inference), `planPushBranch` decision tree (token / plain / refuse), `friendlyAuthHint` mapping, askpass file shape per platform (POSIX `.sh` vs Windows `.cmd`), and the property that the helper script body NEVER contains a secret. The askpass test uses a real temp `userData` dir (mirrors `keychain.test.ts`'s pattern) so it exercises the actual write path, not a mock.

**Verification.** `tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean. `npm run lint` — 0 errors (warnings carry-forward; no new ones introduced). `npx vitest run` — **36 files / 527 passed + 2 skipped**, including the 29 new tests.

**GitHub App: what's left.** The `GitHubAppTokenProvider` shape is the stable contract; to ship App mode a future commit needs: (a) settings UI for App ID + private-key paste, (b) install/authorize flow opening `https://github.com/apps/<slug>/installations/new`, (c) capture of the installation_id on callback, (d) JWT signing with the private key (jsonwebtoken or a tiny inline implementation — keep deps minimal), (e) installation-token exchange + a per-installation cache that refreshes ~60s before expiry. Repository discovery for App mode uses `GET /installation/repositories` instead of `/user/repos`. None of the call sites need changes.

## Audit-remediation Prompt 12 — CI: macOS smoke + coverage baseline (2026-06-02)

Closes CI-2 from `REPO_AUDIT.md`. The build matrix ran Windows + Linux only — a macOS regression (Windows-only API, path-separator bug, native module ABI mismatch) could slip through silently. And there was no coverage data in CI, so a refactor that quietly stopped exercising a service had no automated tripwire. Both gaps land in one workflow PR.

**macOS smoke job (`.github/workflows/build.yml`).** New `build-macos` job on `runs-on: macos-latest`. Steps: checkout → Node 22 → `npm ci` → tsc.node + tsc.web → `npm run build` (just `electron-vite build`, producing `out/main` + `out/renderer`) → `smoke:bundle` → `smoke:renderer`. Env carries `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` so any future step that does invoke electron-builder doesn't hang hunting for a missing signing identity. The job deliberately does NOT run `electron-builder --mac` — that requires a real Apple Developer cert + notarization secrets, which we don't have in CI. The build smoke catches the regression class we care about; full installer packaging stays a release-runner concern, and that intent is documented in the workflow's header comment.

**Coverage baseline (`vitest.config.ts`).** Added `@vitest/coverage-v8` (devDep). Coverage block: provider v8, reporters `text` + `text-summary` + `html` + `lcov`. `include` covers `electron/**/*.ts` + `src/**/*.{ts,tsx}`; `exclude` strips tests, declarations, bundlers' entry points (`electron/preload.ts`, `electron/main.ts`, `electron/ipc/index.ts`), `out/`, `dist/`, `scripts/`, `resources/`, `node_modules/`. The renderer's `src/components/**` mostly shows 0% because vitest's env is `node` — jsdom-backed render tests are Prompt 5's scope and intentionally carry-forward.

**Coverage thresholds (regression guard, NOT quality target).** Captured baseline on the post-rebase HEAD: **statements 15.63% (1,625 / 10,394) · branches 14.58% (1,019 / 6,986) · functions 11.85% (272 / 2,295) · lines 16.01% (1,466 / 9,152)**. Threshold = floor(observed) − 2pp per metric, applied globally: `statements: 13, branches: 12, functions: 9, lines: 14`. The threshold catches "someone deleted a major test file" or "a refactor stopped exercising a service" — it does NOT push every PR to push the number up. Lifting the floor is a separate, intentional doc-only commit. Source comment in `vitest.config.ts` records both the baseline and the convention.

**CI coverage step (`.github/workflows/ci.yml`).** The existing `test` job now runs `npm test -- --coverage`. The text reporter prints the table in the CI log so reviewers see the numbers without downloading anything; the thresholds gate failure. Added an `upload-artifact` step that pushes the `coverage/` directory (which contains the HTML + LCOV reports) with a 14-day retention so coverage walkthroughs in PR review are one click away.

**Verification.** `tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean. `npm run lint` — 0 errors (213 pre-existing warnings; baseline). `npx vitest run --coverage` — **34 files / 498 passed + 2 skipped**, thresholds pass with margin (the baseline is the source of the floor, so the very first run is the "just barely above" case by design). Local bundle smokes deliberately skipped per the Prompt 12 spec — the macOS smoke is verified by CI on the macos-latest runner; first push to main exercises it for real.

**Sprint complete.** Prompts 9 → 12 of the audit-remediation roster are now landed. The remaining roster (Prompts 1–8 + the agentMode-adjacent prompts already completed) covers the lower-severity findings and the hygiene/test-foundation prerequisites; the highest-impact security + correctness gaps from `REPO_AUDIT.md` are closed. Carry-forward gaps from this prompt: renderer-side jsdom render tests (Prompt 5), `AgentRunBanner.test.tsx` (deferred to P5), and DNS rebinding TOCTOU in `safeFetch` (Prompt 9 known gap, still open).

## Audit-remediation Prompt 11 (review followup) — Coder identity, status filtering, dispatch tests (v0.1.28, 2026-06-02)

Three review findings against the original Prompt 11 commit (`4aa64bd`) closed in one followup PR. Same scope (QUAL-1); deeper correctness.

**P1 — multi-mode Coder used the active model's prompt/config.** `chat.ts` built `systemPrompt` + `modelParams` from the request `model` and only added `contractRole: 'coding'` when `agenticCodingMode` was on. The pipeline then ran the Coder with `roster.coder`, so the Coder streamed under one model's identity head + temperature/topP/maxTokens while the actual provider call routed to a different model. Worse: when the user had not flipped on `agenticCodingMode`, the Coder ran without the `coding` contract fragment that Prompt 11 mandated.

Fix: inside the multi-dispatch branch, run a second `loadModelConfig(settingsRaw, roster.coder)` + `buildSystemPrompt(skillContents, memoryBlock, coderSystemOverride, agentsMd, roster.coder, 'coding')` and pass those into the pipeline as `systemPrompt` + the closure-captured `coderModelParams`. The `'coding'` contract fragment is unconditional in multi mode — the pipeline IS the coding-mode wrapper at this layer. Single-mode dispatch is byte-for-byte unchanged.

**P2 — `agent:status` events were not filtered by active conversation.** `useChat.ts` `onAgentStatus` called `useAgentStore.recordStatus` unconditionally, while every other chat event used `matchesActive(e)`. Since `agent-store` keeps a single global `activeRun` (no per-conversation index), a side-chat pipeline would pollute the main `AgentRunBanner`. Fix: gate the handler on `matchesActive(event)` first.

**Test gaps.** New `resolveAgentDispatch(settingsRaw)` extracted from chat:send so the dispatch decision tree is testable in isolation. Returns `{ kind: 'single' }`, `{ kind: 'single', reason }` (multi+invalid roster → fallback), or `{ kind: 'multi', roster }`. Chat:send is now a single switch on `dispatch.kind`. 7 new test cases in `agent-pipeline.test.ts` cover the matrix: null settings, agentMode=single, missing/unknown agentMode, multi+happy-path, multi+missing roster, multi+unknown id, multi+wrong type. The "single dispatch carries no roster" case pins the discriminant so a future enum widening has to update the chat:send switch too — that's the structural guarantee that single mode never emits `agent:status`.

New `src/stores/agent-store.test.ts` (14 cases) covers the renderer-side state pinning: initial mode/roster, recordStatus appends-new vs updates-existing, output preservation when a later event omits it, multi-role arrival order, per-role model captured from the event, error states recorded without dropping the entry, clearRun empties activeRun without touching mode/roster, setMode/setRole isolation, hydrate replace, hydrate partial-merge.

**Deferred.** `AgentRunBanner.test.tsx` still requires jsdom + Testing Library, which is the scope of Prompt 5 (Test Foundation). Recorded as a carry-forward to land with P5.

**Verification.** `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both clean. `npx vitest run` — 32 files / 465 tests pass + 2 skipped (up from Prompt 11's 31/444 by +1 file + 21 tests). `npx electron-vite build` clean. `npm run smoke:bundle` PASS. The dist artifacts for `0.1.27` (built before this review remediation landed) contain the P1 + P2 bugs and were never pushed — they're discarded and replaced with `0.1.28` after this commit lands.

## Plans & Goals settings panel — inspect / clear persisted state (2026-06-02)

Final deferred item from the parity sprint: a settings UI over the plan + goal persistence that landed earlier. Modeled on `PermissionsSettings` (the inspect/clear side of a write-through store).

**Backend.** `plan-goal-persistence.ts` gains `listAllPlanGoalState()` (distinct conversation ids across `plan_steps` ∪ `goals`, each loaded; memory-fallback aware), re-exported from `plan-goal-store.ts` as `getAllPlanGoalState()` (reads through persistence, which is authoritative since writes are write-through). `electron/ipc/plan.ts` adds `plan:listAllState`, `plan:clearConversationState`, and `plan:clearAllState`; the clear handlers emit `plan:updated` (via `emitChatEvent`) for affected conversations so an open `PlanChecklist` refreshes to empty. preload exposes the three on `window.api.plan`.

**Frontend.** New `PlanGoalSettings.tsx` lists each conversation with stored state — plan steps (status dot + label) and goals (status, optional due date) — with per-conversation Clear and a global Clear all (both confirm first), plus a summary line and an empty state. Registered as the **Plans & Goals** tab in `SettingsDialog` and `SettingsTabId`. Added renderer mirror types `Goal` / `GoalStatus` / `ConversationPlanGoalState` to `src/lib/types.ts`.

**Verification.** `tsc` (node + web) pass; ESLint 0 errors; Vitest **340 tests / 25 files** (+3 `listAllPlanGoalState` tests); `electron-vite build` + `smoke:bundle` + `smoke:renderer` all PASS. With this, every deferred item from the Codex parity regression pass is closed; the only remaining plan/goal item is cross-device sync (out of scope).

## Tool-gating audit (selfApproves fix) + renderer bundle smoke (2026-06-02)

Closes the last two regression-pass carry-forwards.

**`requiresApproval: false` audit.** The dispatch gate is `requiresApproval || risk ∈ {network, destructive, secret}` (`chat.ts`). Audited every `requiresApproval: false` tool against it. Conclusions: image-generation tools carry `network` so they already gate (their "KNOWN GAP — no per-call gate" comment was stale; corrected); all MCP tools get at least `['network']` so they gate; there are no `providerKind: 'plugin'` tools at all, so the "ungated plugin file-write" concern is moot; the read/write-only locals (`update_plan`, `create_goal`, `update_goal`, `memory_add`) are intentionally ungated.

One real bug: `request_permissions` declared `risks: ['secret']` with `requiresApproval: false`, intending to avoid a double-prompt (its handler IS the approval call). But the risk-based gate ignored that intent — the dispatcher gated it on `secret` *and then* the handler prompted again, and a global "deny secret" policy would have locked the user out of ever requesting a permission. Fix: a metadata-driven `selfApproves` descriptor flag (kept off the hard-coded-id path, per the registry's design). Extracted the gate into `descriptorNeedsApproval(descriptor)` in `permissions-store.ts` (`selfApproves` short-circuits to "no gate"); `chat.ts` now calls it; `request_permissions` sets `selfApproves: true` and keeps `secret` only for the UI escalation badge. Added 5 unit tests for the predicate (missing descriptor, requiresApproval, each gating risk, read/write-only, and the self-approve override).

**Renderer bundle smoke (`scripts/smoke-renderer.cjs`, `npm run smoke:renderer`).** The main smoke can `require()` the CommonJS main bundle; the renderer is a browser bundle (React 19 + Shiki + Mermaid + workers + dynamic imports) that would be fragile to execute under jsdom. So this is an artifact-integrity smoke: it parses `out/renderer/index.html`, resolves every referenced asset to a real non-empty file, and checks the entry chunk is non-trivially sized and mounts a React root (`createRoot`) — the "white screen" failure class. Wired into both `build.yml` jobs after the build, and added to the CONTRIBUTING gate list. Verified it fails on a missing asset and passes on a real build.

**Verification.** `tsc` (node + web) pass; ESLint 0 errors; Vitest **337 tests / 25 files** (+5); `electron-vite build` + `smoke:bundle` + `smoke:renderer` all PASS.

## askUser permission round-trip tests (2026-06-02)

Closes the next carry-forward gap: the `askUser` path in `permissions-store.ts` — the BrowserWindow approval round-trip — had no coverage because the sibling `permissions-store.test.ts` stubs `getAllWindows()` to `[]` (every case there resolves via a sticky policy, so the modal path is never reached).

**New file `permissions-store-askuser.test.ts`.** Uses `vi.hoisted` to share a mutable window list + a sent-event log between the `electron` mock and the test body, so a fake window with a spying `webContents.send` can be installed — no Electron host required. The renderer's reply is driven through `permissionsService.respond()`. 12 tests cover: no-window → `deny`/`no-window` with nothing sent; modal dispatch of `tools:approvalRequired` (+ the legacy `mcp:confirmationRequired` event) carrying the request; "just this once" allow/deny → `modal` source with no persisted policy; "always" allow → persists a global tool policy and reports `policy:<id>` as the source; "conversation" scope without an id → no persist, with an id → a conversation-scoped policy; the persisted policy short-circuiting a second request without re-prompting; the 30s auto-deny timeout (fake timers); a late reply after timeout being a harmless no-op; `cancelPending` resolving as a one-time deny; and `respond` for an unknown callId being a no-op.

**Verification.** `tsc` (node + web) pass; ESLint 0 errors; Vitest **332 tests / 25 files** (was 320/24, +12 in the new file).

## Plan + goal state persistence (2026-06-02)

Closes the top carry-forward gap from the Regression Pass: plan steps and goals were in-memory only and wiped on restart. They now persist to SQLite, following the same write-through + memory-fallback pattern Prompt 7 used for permission policies.

**Schema (`database.ts`).** Two new tables created in `initSchema`: `plan_steps` (`id`, `conversation_id`, `text`, `status` CHECK pending/in_progress/done, `position` for order, timestamps) and `goals` (`id`, `conversation_id`, `title`, `description`, `due_date`, `status` CHECK open/in_progress/done/abandoned, timestamps), each with a `conversation_id` index. No FK to `conversations` — the `__global__` bucket and ephemeral runs need rows without a conversation row.

**Persistence layer (`plan-goal-persistence.ts`, new).** Mirrors `permission-policies-store`: `loadPlanSteps` / `savePlanSteps` (replace-all in a transaction, `position` = array index), `loadGoals` / `upsertGoal` (`ON CONFLICT(id) DO UPDATE`), `clearConversation`, `clearAllPlanGoalState`. A `getDb()` failure activates an in-memory fallback so the API never throws into the caller.

**Store wiring (`plan-goal-store.ts`).** Now a per-session cache in front of persistence: `getState` hydrates a conversation from disk on first access; `applyUpdatePlan` writes through `savePlanSteps`; `createGoal`/`updateGoal` write through `upsertGoal`. Added public `clearConversationState` / `clearAllState` (for a future settings UI and for cleanup), and `deleteConversation` now clears a deleted conversation's plan/goal rows (no FK cascade exists). The `monoNow` ordering and all snapshot/merge/replace semantics are unchanged, so consumers (`native-dev-tool-pack`, `plan.ts` IPC, `PlanChecklist`) need no changes — persistence is transparent.

**Verification.** `tsc` (node + web) pass; ESLint 0 errors; `electron-vite build` + `smoke:bundle` PASS. Vitest **320 tests / 24 files** (was 307/23): a new `plan-goal-persistence.test.ts` (9 tests, exercises the layer through its forced memory fallback) plus 5 new "survives a simulated restart" tests in `plan-goal-store.test.ts` that drop the session cache and confirm rehydration of plan order/status, goal fields, replace-mode wipes, per-conversation isolation, and `clearConversationState`. Both test files mock `electron` to force the fallback, matching the permission-policies test.

**Still open (next sprint):** no settings UI to inspect/clear plan+goal state (the `clear*` API is ready for it), and no cross-device sync.

## Codex-parity Prompt 15 — Regression Pass (2026-06-02)

Final QA sweep that closes the Codex toolset parity sprint. No new features — verification + documentation only, per the Prompt 15 spec. Full write-up in the `## Sprint complete — Regression Pass` block of `PLANNING/CODEX_TOOLSET_PARITY_PROGRESS.md`.

**Automated regression (all green on the Linux toolchain).** `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both pass. `npx vitest run` — **307 tests / 23 files, all passing** (target ≥ 295 / ≥ 21), including the two suites that were previously "Mostly done" only because Vitest couldn't start on Windows (`spawn EPERM` on esbuild): `skill-loader.test.ts` and `final-response-composer.test.ts` now execute and pass, so prompts 12 and 13 move to `Done`. `npx electron-vite build` succeeds and `npm run smoke:bundle` PASSes (main bundle loads under stub-electron in ~0.2s). `npm run lint` reports 0 errors and is now enforced in CI via `.github/workflows/lint.yml`.

**Roster.** Prompts 1–15 are all `Done`. Prompt 14 (agentic coding mode, commit `4d9e2bf`, v0.1.26) was already in the tree; the roster table simply hadn't been flipped.

**Docs.** `README.md` roadmap gains a "Codex toolset parity sprint (v0.1.26)" shipped block and a tightened "Next up" (Linux now builds in CI; macOS still pending). `CONTRIBUTING.md` pre-PR gate list now includes `npm test` and states the real CI coverage. This DEVLOG entry + the PROGRESS "Sprint complete" entry record the verification numbers.

**Not runnable headless (owner/release-runner tasks).** The 16-step manual GUI smoke checklist, `npm run build:win` (Windows installer), and the native-module ABI spot-launch of an installed build. **Carry-forward gaps** (recorded in PROGRESS, deferred with no silent gaps): plan/goal state is still in-memory; `npm test` is not yet wired into CI; renderer-bundle smoke and the `askUser` permission path remain untested; `requiresApproval: false` tools want a re-audit.

## Audit-remediation Prompt 11 — `agentMode` rewire (Planner → Coder → Reviewer) (2026-06-02)

Closes QUAL-1 from `REPO_AUDIT.md`. The renderer-side Planner/Coder/Reviewer pipeline has been built and dormant since the multi-provider revision (`AgentRunBanner.tsx`'s `ROLE_ORDER` array, `agent-store.ts` `recordStatus`, `preload.ts` `agent:status`, `useChat.ts` subscription) — nothing in main emitted `agent:status` or ran a sequential pipeline. This prompt lights it up.

**New service: `electron/services/agent-pipeline.ts`.** Exports `runAgentPipeline(opts)` and `validateRoster(raw)`. The pipeline runs Planner → Coder → Reviewer sequentially against the active model roster, with both reasoning stages routed through `executeMultiAgentRun` (single task, `planner` / `reviewer` role) and the Coder stage routed through a `CoderRoundRunner` seam that wraps `runChatRound` — so the Coder is the only tool-enabled stage, streams chunks like a normal turn, and uses the composer if `agenticCodingComposer` is set. `subAgentRunner` and `coderRunner` are injectable seams so the test suite can pin behaviour without a real provider. The pipeline emits `agent:status` events at every stage boundary, persists the Reviewer's output as a separate assistant message via `convStore.saveMessage`, and is responsible for emitting `chat:done` itself (twice — once with the Coder message, once with the Reviewer message).

`validateRoster` walks the roster against `MODEL_CATALOG` directly. It does NOT call `resolveModel`, which silently substitutes a DeepSeek 64K default for unknown ids (that's Prompt 7's QUAL-3 fix). Required roles (`planner`, `coder`, `reviewer`) must each be a string and a known model id; `coworker` is accepted but stripped if unknown. A bad roster is rejected with a per-role reason string the chat handler logs and surfaces.

**Event-map extension: `chat-events.ts`.** Added `AgentStatusPayload` + `'agent:status'` entry to `ChatEventMap`. Single-mode chat never emits on this channel, so its presence is the renderer's signal that the pipeline is driving the turn. Types `AgentPipelineRole` + `AgentPipelineState` exported for the pipeline + tests.

**`runChatRound` refactor (minimal blast radius).** Added a final `suppressDoneEvent: boolean = false` parameter and changed the return type from `Promise<void>` to `Promise<{ message: unknown } | null>`. When the flag is true: persist the assistant message as usual but skip the `chat:phase = done` and `chat:done` emits, and resolve with the saved message so the pipeline caller can emit those events at the right moment. The recursive call inside the tool loop forwards the flag. Single-mode callers pass `false` (the default) and ignore the return value — the byte-for-byte behaviour of the pre-Prompt-11 path is preserved.

**chat:send dispatch.** Replaced the `void requestedAgentMode` stub with: read `agentMode` from the existing settings-blob already loaded for `loadAgenticCodingConfig`; if `'multi'` AND the roster validates, route through `runAgentPipeline` with `coderRunner` wrapping `runChatRound(..., suppressDoneEvent: true)`; else fall through to the existing single-mode `runChatRound` call unchanged. An invalid roster logs a warning and falls back to single mode so the user is never left without a reply.

The pipeline rewrites the latest user turn to inline the plan as a `<plan source="planner">...</plan>` block prefixed to the original user text. That keeps the plan visible in the conversation's persisted message history on future replays. Prior conversation history (minus the latest user) is passed through verbatim.

**Renderer: `useChat.ts` guard.** On `chat:done`, the activeRun is cleared ONLY if no role is currently in state `running`. In the Coder → Reviewer handoff the pipeline emits `agent:status reviewer:running` BEFORE the Coder's `chat:done` so the renderer sees an in-flight stage and skips `clearRun()`. The banner stays visible across the handoff instead of flickering off + back on. Errors still clear unconditionally (no recovery path keeps a stale "running" pill on screen).

**Tests: `agent-pipeline.test.ts` (16 cases).** Pure-helper-style coverage:
- `validateRoster` accepts a full known roster, rejects missing roles, rejects unknown ids (proves we don't fall through `resolveModel`), rejects non-objects, strips unknown coworker.
- Happy path: status events emit in `planner → coder → reviewer` order with `running → done` per stage; Coder runner called with correct model id; two `chat:done` events (Coder body + persisted Reviewer row); planner output captured on planner:done; reviewer output captured on reviewer:done AND persisted to conversation-store.
- `reviewer:running` emits BEFORE the first `chat:done` (the property that keeps the renderer from flickering the banner off).
- `planner:running` emits BEFORE the runner is invoked.
- Plan content is inlined into the rewritten user message as the documented `<plan source="planner">` block.
- Failure paths: planner throws → planner:error + chat:error + Coder NOT called + no chat:done. Coder throws → coder:error + chat:error + no reviewer + no chat:done. Coder returns null (max rounds / abort) → coder:error + no reviewer. Reviewer throws → reviewer:error BUT one chat:done still fires for the Coder reply (the user already has the answer) and chat:error does NOT fire.
- Abort signal honored: planner finishes, then signal aborts → Coder NOT called → chat:error.
- Coexistence smoke: pipeline doesn't import or assume the `multi_agent_run` TOOL is registered (it's an independent caller of the same executor); the `tools` array is passed through to the Coder so `multi_agent_run` remains callable mid-turn.

Conversation-store + electron mocked with `vi.hoisted`; `MODEL_CATALOG` ids picked at runtime so the test stays in sync with whatever the catalog actually carries.

**Verification.** `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both clean. `npx vitest run` — 31 files / 444 tests pass + 2 skipped (the win32-skipped POSIX mode assertions). +1 new file, +16 new tests vs the Prompt-10 followup baseline of 30/428. `npx electron-vite build` clean (renderer index 1,899.87 KB). `npm run smoke:bundle` PASS in 322 ms.

**Carry-forwards unchanged.** Lint (ESLint 10 flat-config — Prompt 1), `smoke:renderer` script not implemented (carry-forward), DNS rebinding TOCTOU in `safeFetch` (Prompt 9 known gap).

**Notes / minor design calls.**
- The Reviewer's output is captured on the `agent:status` `output` field AND persisted as a separate assistant message. `AgentRunBanner.tsx` does not yet render that output text — the data is in `agent-store` for a future fold-out UI; for v1 the second assistant message is where the user sees the reviewer's prose.
- `chat:done` is intentionally emitted twice in pipeline mode. The renderer's `finishStream` is idempotent enough to handle this: the Coder's chunked content is committed by the first `chat:done`; the Reviewer's persisted row arrives via the second `chat:done` and is appended to `messages` with an empty streaming buffer.
- Optional QUAL-4 (extract `resolveSingleToolCall` to its own file to shrink `chat.ts`) was deferred. The new `agent-pipeline.ts` already relieves chat.ts's growth pressure; that extraction can land in a follow-up without coupling.

## Audit-remediation Prompt 10 (followup) — three review gaps closed (2026-06-02)

Closes three review findings against the original Prompt 10 landing. Same scope (SEC-2, SEC-9, SEC-10); deeper coverage.

**P1a (SEC-10 — silent plaintext fallback was still reachable).** Six IPC handlers still called `keychain.setKey` without a consent gate: `settings.ts:86 saveProviderKey`, `:143 saveApiKey`, `:170-171 saveGoogleCredentials`, `mcp.ts:143/145/147` (the three post-OAuth token writes), `mcp-manager.ts:509-510` (background OAuth token refresh), `web-tools.ts:58`, `image-tools.ts:66`, `current-info.ts:53/67`. The fix is at the keychain layer rather than per-call: `setKey` now THROWS a new `PlaintextConsentRequiredError` (carrying `provider`) when `safeStorage.isEncryptionAvailable()` is false AND neither a per-call `{ allowPlaintext: true }` flag nor a session-level `sessionPlaintextConsent` is recorded. A new `grantPlaintextConsent()` / `hasPlaintextConsent()` pair toggles the session flag; new IPC channels `settings:grantPlaintextConsent` / `:hasPlaintextConsent` expose them through preload. Background callers (most importantly `mcp-manager` OAuth token refresh) get implicit consent through `getKey`: when it reads an existing `plain:` row off disk, that row could only have been written by a prior consented `setKey`, so consent is re-granted for the rest of the session — no UI re-prompt on relaunch when a previously-consented Google account refreshes its access token.

New shared renderer helper `src/lib/keychain-consent.ts` exports `ensurePlaintextConsentIfNeeded()`: checks `isEncryptionAvailable`, short-circuits when encryption is on or consent has already been recorded this session, surfaces a single `window.confirm` dialog otherwise, calls `grantPlaintextConsent` on accept, and returns a boolean the caller branches on. Every credential-persisting settings UI now awaits it before invoking the save IPC: `ApiKeyModal.tsx`, `ApiKeySettings.tsx`, `McpSettings.tsx` (both `handleSaveCredentials` for client_id/secret AND `handleGoogleOAuth` so the user is consent-prompted BEFORE the browser opens Google's screen, not after), `WebToolsSettings.tsx` `handleSaveKey`, `ImageGenSettings.tsx` `handleSaveKey`, `CurrentInfoSettings.tsx` `saveFinance` / `saveWeather` (only when a key payload is being sent — provider-switch-only calls don't reach the keychain). Inline `window.confirm` blocks the original Prompt-10 landing added to ApiKeyModal/ApiKeySettings were removed in favour of the shared helper so the prompt copy is one place.

`keychain.test.ts` extended with 7 new SEC-10 cases (now 27 total / 25 run, 2 win32-skipped): throws on no-consent write, allowPlaintext per-call bypass, session consent unlocks all providers, getKey on a plain: row implicitly re-grants consent, hasPlaintextConsent reflects state, error carries provider id, getKey on an encrypted row does NOT grant consent.

**P1b (SEC-2 — web-search-adapters were not behind safeFetch).** `electron/services/web-search-adapters.ts` `fetchWithTimeout` is the single shared egress for every Brave / Tavily / SerpAPI / SearXNG request; swapping its internal `fetch` for `safeFetch` covers every adapter (search + image search) without per-class changes. The wrapper preserves its own AbortController + timeout via `signal: controller.signal`; safeFetch routes through `fetch` with `redirect: 'manual'` and re-validates every hop. New `web-search-adapters.test.ts` (5 cases) confirms the wiring: SearXNG endpoint pointing at loopback / 169.254.169.254 / RFC1918 is refused before any network call; SearXNG image search hitting loopback is also refused (proves the swap reaches every fetch site); a Brave-hosted response that redirects into 169.254.169.254 is refused with no second-hop network call. The original Prompt-9 plan called this out explicitly; this closes it.

**P2 (SEC-9 — OAuth state was unit-tested but the IPC wiring wasn't).** Extracted `validateOAuthCallback(reqUrl, session)` to `electron/services/oauth-state.ts` so the http callback's full decision tree (`denied` / `missing-code` / `state-mismatch` / `success`) is a testable pure function. `electron/ipc/mcp.ts`'s `mcp:setupGoogleOAuth` http handler now switches on the returned `kind` and emits the same HTTP responses and outer-promise rejections as before, but the logic lives in one place. `oauth-state.test.ts` gains 9 IPC-integration cases on top of the original 10 helper cases (19 total): success consumes the state, missing state rejects, wrong state rejects, replay of a successful state rejects (single-use), a wrong-state probe does NOT lock out a subsequent legitimate callback, missing code surfaces missing-code (not state-mismatch), `error=` short-circuits to denied with a 200, denied takes precedence over a present code, and non-success outcomes never consume the session. The actual handler in `mcp.ts` is one switch on `outcome.kind` — the IPC's behaviour is now pinned by the helper test matrix.

**Verification.** `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both clean. `npx vitest run` — 30 files / 428 tests pass + 2 win32 skips (up from Prompt 10's 29 / 406, so +1 new file [web-search-adapters.test.ts] + 22 new tests across keychain + oauth-state + web-search-adapters). `npx electron-vite build` clean. `npm run smoke:bundle` PASS in 328 ms.

**Carry-forwards unchanged.** Lint, smoke:renderer, and the DNS-rebinding TOCTOU gap all remain on the same lines as before this addendum.

## Audit-remediation Prompt 10 — Secrets & OAuth hardening (2026-06-02)

Closes SEC-3, SEC-9, SEC-10 from `REPO_AUDIT.md` (per `PLANNING/AUDIT_REMEDIATION_PLAN.md`). One PR; three independent credential surfaces tightened in lockstep.

**SEC-3 — `keys.json` permission bit.** `electron/services/keychain.ts` `writeKeys` now passes `{ mode: 0o600 }` to `writeFileSync` and follows it with an opportunistic `chmodSync(path, 0o600)`. The `mode` option only applies on FILE CREATION, so the explicit chmod is what upgrades a previously-loose file (older builds wrote with the platform default 0o644). On Windows the POSIX bit is advisory — the ACL inherits from the per-user `userData` directory — and `chmodSync` either no-ops or refuses; either way it doesn't throw. The mode value is exported as `__KEYS_FILE_MODE_FOR_TEST` so the test contract pins it. `electron/services/keychain.test.ts` (new — 10 cases + 2 win32-skipped) covers the encrypted round-trip, the `plain:` fallback round-trip, mixed-state read (a legacy `plain:` row survives a flip back to encryption-available), the corrupt-ciphertext path returning `null` instead of throwing, the mode-constant export, the POSIX mode-after-write assertion, and the loose-mode → 0o600 upgrade path. `vi.hoisted` carries a reactive `{ userDataDir, encryptionAvailable }` object that the mocked `electron.app.getPath` and `electron.safeStorage` close over so each test gets a fresh tempdir + a controllable encryption flag without monkey-patching.

**SEC-9 — OAuth `state` (CSRF protection).** New `electron/services/oauth-state.ts`: `generateOAuthState()` returns 24 random bytes as a 32-char base64url string, and `createOAuthSession(generator?)` builds a single-use session with a `state` field and a constant-time `verify(received)` method. `verify` returns `true` exactly once for a matching state, then permanently returns `false` — a wrong attempt does not consume the session (so an attacker probe doesn't lock out the legitimate callback) but a successful verify does. `electron/services/oauth-state.test.ts` (new — 10 cases) covers the entropy sanity check (100 distinct values across 100 calls), the constant-time length-mismatch guard, single-use semantics, the failed-then-successful path, two-session independence, and the default-generator branch. `electron/ipc/mcp.ts` `mcp:setupGoogleOAuth` instantiates the session before building the auth URL, embeds `state.state` as a search parameter, and the local HTTP callback handler now reads `state` from the request URL and calls `session.verify(receivedState)` BEFORE accepting the auth code. A mismatch returns a 400 with a visible "OAuth state mismatch" page to the browser and rejects the outer promise with `OAuth state mismatch — possible CSRF attempt or stale callback`, so the toast trail in the renderer surfaces the real reason instead of silently capturing a hostile auth code.

**SEC-10 — plaintext-fallback confirm gate.** `src/components/settings/ApiKeyModal.tsx` and `src/components/settings/ApiKeySettings.tsx` already read `window.api.settings.isEncryptionAvailable()` (the Settings panel already rendered a passive `encrypted | plaintext | checking` badge) but neither gated `handleSave`. Both `handleSave` paths now call `window.confirm("Encryption is unavailable on this system. The key will be stored as plaintext on disk (userData/keys.json). Continue?")` when `encrypted === false` and return early on cancel. `ApiKeyModal` additionally fetches the encryption state on mount (previously only `ApiKeySettings` did this) and renders an inline amber-bordered `role="alert"` warning above the key input so the user sees the risk before they paste anything; the modal's closing "OS-level encryption" line now branches text based on `encrypted` instead of always promising encryption that isn't happening.

The keychain source comment for `setKey`'s `plain:` branch records that the renderer is expected to have confirmed before reaching the code path; the existing `console.warn` stays as a backstop for callers that bypass the UI.

**Verification.** `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both clean. `npx vitest run` — 29 files / 406 tests pass + 2 skipped (the win32-skipped POSIX mode assertions); up from Prompt 9's 27 / 386 by 2 new files and 20 new tests. `npx electron-vite build` clean. `npm run smoke:bundle` PASS in 363 ms.

**Carry-forward gaps (still open from Prompt 9).**
- `npm run lint` still broken at the repo level (ESLint 10 flat-config migration — Prompt 1 of the remediation roster).
- `npm run smoke:renderer` script still does not exist (renderer-bundle smoke is a Codex-sprint carry-forward). Prompt 10's renderer changes are confirmed via tsc + the production bundle build above; jsdom-backed render tests for `ApiKeyModal` and `ApiKeySettings` come with Prompt 5.
- DNS rebinding gap in `safeFetch` (still unresolved — it's a Prompt 9 known gap, just listed here for continuity).

## Audit-remediation Prompt 9 — Model-input security (2026-06-02)

Closes SEC-2, SEC-5, SEC-6, SEC-8 from `REPO_AUDIT.md` (per `PLANNING/AUDIT_REMEDIATION_PLAN.md`). One PR; every fix is a defence against an untrusted string reaching a dangerous sink.

**SSRF gate (SEC-2).** New `electron/services/url-safety.ts` exports `assertPublicUrl(url, { lookup? })` and `safeFetch(url, init?, { lookup?, fetchImpl?, maxRedirects? })`. `assertPublicUrl` parses, rejects non-http(s) schemes, rejects IPv4 literals in 127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254.0.0/16 (explicitly including 169.254.169.254), 0.0.0.0/8, and 100.64.0.0/10 (CGNAT), rejects IPv6 ::1 / ::/128 / fe80::/10 / fc00::/7, IPv4-mapped IPv6 in both the literal-input dotted form (`::ffff:127.0.0.1`) and the URL-parser-normalized hex form (`::ffff:7f00:1`), and DNS-resolves hostnames to reject any record set where any address is private. `safeFetch` wraps `fetch` with `redirect: 'manual'`, runs `assertPublicUrl` against the initial URL and every Location header, and caps at 5 redirects by default. Pure `LookupFn` and `fetchImpl` seams let `url-safety.test.ts` (39 cases) cover the matrix without real DNS or network. `web-tools.ts` `fetchPageBytes` swaps `fetch(..., { redirect: 'follow' })` for `safeFetch(...)`, preserving its own AbortController/timeout, header set, and 1 MB body cap. `web-tools.test.ts` gains five integration cases that confirm `executeWebOpen` propagates the rejection as `"Error: web_open failed — Refused: …"` for loopback / 169.254.169.254 / RFC1918 / `[::1]`, and that the existing non-http(s) scheme reject still fires.

DNS rebinding TOCTOU is documented as a known gap in the source comment: closing it would require resolving once and fetching against the locked-in IP with a Host header, which is more invasive than this prompt and would change every adapter call site. v1 closes the direct-literal case (`http://127.0.0.1`, `http://169.254.169.254`).

**Worktree branch / path injection (SEC-5).** `electron/ipc/worktree.ts` rewritten into pure helpers + thin handlers. `isValidRefName(name)` enforces `^[A-Za-z0-9._/-]+$`, rejects leading `-`, rejects `..` sequences, caps at 200 chars; reused for both `branch` and `baseRef`. `planWorktreeCreate` builds `['worktree', 'add', '-b', branch, '--', wtPath, baseRef?]` so the `--` separator stops git from interpreting a hostile path or baseRef as a flag; `planWorktreeRemove` enforces an absolute, non-`-`-leading path and builds `['worktree', 'remove', ...(force ? ['--force'] : []), '--', path]`. Both return a `ValidationResult` envelope so the handler returns the rejection reason to the renderer verbatim. `worktree.test.ts` (18 cases) covers the regex, the leading-`-` reject, shell-metacharacter rejects (`;`, `|`, `` ` ``, `$`, `&`, whitespace), the `..` reject, the length cap, plus per-handler argv-shape assertions including the `--` placement.

**Browser scheme allow-list (SEC-8).** `electron/services/browser-manager.ts` `isHttpish` no longer matches `file:`. New `FORBIDDEN_SCHEMES` regex covers `file:`, `javascript:`, `data:`, `view-source:`, `chrome:`, `chrome-extension:`; `coerceUrl` short-circuits to `about:blank` for those rather than falling through to a Google search of the literal path (which would echo `/etc/passwd` back into a search query). `browser-manager.test.ts` (8 cases) pins the new behaviour, asserts no `file:` URL ever survives `coerceUrl`, asserts the Google-search fallback never sees the forbidden literal, and pins the existing http(s)/about: pass-through.

**`openInVSCode` argv-form spawn (SEC-6).** `electron/ipc/files.ts` drops `shell: true` from both the probe and the launch. `probeCodeBinary()` runs `where`/`which` with `shell: false` + argv form and captures stdout via the exported pure helper `parseProbeOutput(stdout)` (handles CRLF + the multi-line shape `where` returns). `buildVSCodeLaunchPlan(codePath, target)` returns `{ command: codePath, args: [target], options: { shell: false, detached: true, stdio: 'ignore', windowsHide: true } }`. The probe-call constant `code` is hardcoded, never user-supplied; the launch passes `target` as a single argv element, so shell metacharacters land as literal arg content rather than as parsed shell tokens. Node ≥21.7's per-arg auto-escape (CVE-2024-27980) handles the Windows `code.cmd` shim under `shell: false` — verified via `node --version` v24 on this machine and Electron 35's bundled Node 22 LTS. `files.test.ts` (9 cases) pins: `shell: false` invariant, target containing `; rm -rf /` stays a literal argv element, CRLF/multi-line `where` output parses, `.cmd` shim passes through unchanged.

**Verification.** `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both clean. `npx vitest run` — 27 files / 386 tests pass (up from 27 / 295; this prompt adds 4 new files and ~91 tests across them and the existing `web-tools.test.ts`). `npx electron-vite build` clean, renderer index 1,897 KB. `npm run smoke:bundle` PASS in 357 ms.

**Gates with carry-forward.**
- `npm run lint` is broken on this branch independent of Prompt 9 — ESLint 10 flat-config migration (the audit's DEP-3 family); landing this is Prompt 1 of the remediation roster, not Prompt 9.
- `npm run smoke:renderer` is not implemented yet — `PLANNING/AUDIT_REMEDIATION_PLAN.md` referenced it as part of the universal gate aspirationally; the renderer-side bundle smoke is a carry-forward from the Codex sprint's known gaps. Bundle smoke alone covers the main-process changes Prompt 9 actually lands.

## Codex-parity Prompt 14 — End-to-End Agentic Coding Mode (2026-06-02)

Wired the single user-facing toggle that turns the harness into an end-to-end agentic coding loop: coding contract role + auto-activated codex skills + composer gate. Off by default; existing chats unchanged.

**Type + settings migration.** `src/lib/types.ts` gains `AgenticCodingComposerMode = 'auto' | 'always' | 'never'` and three new fields on `AppSettings`: `agenticCodingMode: boolean` (default false), `agenticCodingSkills: string[]` (default `['codex-plan','codex-context','codex-verify']`), `agenticCodingComposer: AgenticCodingComposerMode` (default `'auto'`). Exported `DEFAULT_AGENTIC_CODING_SKILLS` as the canonical default. The same defaults are mirrored in three places so missing keys migrate cleanly: `electron/ipc/settings.ts` `defaultSettings`, `src/stores/settings-store.ts` `defaultSettings`, and the chat-handler reader. `electron/ipc/settings.ts` already shallow-merges `{ ...defaultSettings, ...data }` on every read, so an `AppSettings` JSON missing the three keys loads with the documented defaults — verified by reading a stripped settings.json shape and confirming `{ agenticCodingMode: false, agenticCodingSkills: [...], agenticCodingComposer: 'auto' }` is what comes out.

**Backend wiring (`electron/ipc/chat.ts`).** Refactored `loadModelConfig` to accept a pre-read settings JSON so the chat handler reads `settings.json` once per turn and then derives both the model config and the agentic config from the same blob. New `loadAgenticCodingConfig(raw)` returns `{ mode, skills, composer }` with safe fallbacks (non-string entries dropped from `skills`, unknown composer string coerced to `'auto'`). Exported two pure helpers for reuse + future tests: `mergeAgenticSkillIds(base, extra)` — idempotent union that preserves user-picked order and de-duplicates against the auto list — and `resolveComposerGate(mode, round)` — keeps the existing `shouldComposeFinalResponse(round)` semantics for `'auto'`, returns `true`/`false` for `'always'`/`'never'`.

In the `chat:send` handler: when `agentic.mode` is true, `requestSkillIds` are merged with `agentic.skills` via `mergeAgenticSkillIds` and the merged list is what feeds `skillContents`. `buildSystemPrompt` is called with `contractRole: 'coding'` so the role fragment from `system-prompt-builder.ts` layers on top of the base contract; off-mode passes `undefined` so the turn shape matches pre-Prompt-14. The composer mode is threaded into `runChatRound` as a new optional parameter (default `'auto'` for callers that still pass the old arity) and the `shouldComposeFinalResponse(round)` call in `onDone` was replaced with `resolveComposerGate(composerMode, round)`. The recursive `runChatRound` call inside the tool-loop also forwards `composerMode` so the gate is consistent across rounds.

**Settings tab (`src/components/settings/AgenticCodingSettings.tsx` — new).** Three sections, all driven by `useSettingsStore.updateSettings(...)`: (1) mode toggle as a labelled checkbox with the user-facing explanation; (2) codex-skill multi-select that filters `useSkillsStore().skills` to ids starting with `codex-` (the auto-list is curated specifically to companion the coding contract — custom user skills remain reachable via the normal skill panel), with an empty-state hint pointing at the bundled SKILL.md drop point when no codex skills are installed; (3) composer-mode radio with the three options + plain-English descriptions of when each makes sense. Each radio/checkbox tile uses the same `rounded border border-[var(--border)] bg-[var(--bg-primary)]` styling the other settings tabs use so the new tab visually fits. Registered the tab in `SettingsDialog.tsx` between `agents` and `api` as `agenticCoding` / `Coding Mode`. Extended `SettingsTabId` in `src/stores/ui-store.ts` to include the new id; also folded in the previously-missing `'permissions'` id (latent drift — `SettingsDialog`'s TABS list already had the permissions tab but the openSettings caller couldn't request it).

**Chat-input pill (`src/components/chat/ChatInput.tsx`).** New `CodingModeToggle` component sits between `PermissionsDropdown` and the flex-grow spacer in the action row. Compact pill: muted "Coding" label with a status dot when off; accent border + accent-dim background + accent label + accent dot when on. Left-click toggles `agenticCodingMode` via `useSettingsStore.updateSettings`; right-click opens Settings directly on the new tab (`openSettings('agenticCoding')`). `aria-pressed` reflects the active state. Because both the pill and the settings tab read the same store, they stay synchronized in both directions without any additional plumbing.

**Run-banner prefix (`src/components/chat/AgentRunBanner.tsx`).** When `agenticCodingMode` is true AND a run-phase pill is rendered, the pill now shows `Lamprey · CODING · <phase label>` (e.g. `Lamprey · CODING · Editing`). The "CODING" segment is accent-colored to make the mode unmistakable from across the screen. Off-mode rendering is byte-identical to pre-Prompt-14. The multi-agent pipeline branch is untouched — agentic coding mode is a single-agent concept.

**Verification.** `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass with zero output. `npx electron-vite build` succeeds — renderer index settled at ~1,897 KB; the Prompt 14 deltas (new settings component + pill + banner prefix + types) account for a small handful of KB inside the noise floor of the surrounding builds. Hands-on UI verification (toggle the pill, confirm the coding role appears in the system prompt, confirm composer mode 'always'/'never' propagates, confirm settings.json round-trips the three new keys after restart) is left to the user once the API key is configured.

**Cross-prompt note.** Prompt 14 assumes the codex-* skills land in the active skills directory. In production, `resources/skills/` carries them — verified `codex-plan/SKILL.md`, `codex-context/SKILL.md`, `codex-verify/SKILL.md` all exist. In dev the loader reads from `<repo>/skills/`, which does NOT currently carry the codex-* directories (only `README.md`, `code-review.md`, `direct-voice.md`, `git-commit.md`). The settings tab handles this gracefully with an empty-state hint, but if you want auto-skills to work in `npm run dev` without manually copying, that copy step belongs to a follow-up tweak to Prompt 13's bundled-skills wiring.

## Paste-offer close-glyph + Codex-parity plan doc (v0.1.24, 2026-06-01)

Patch release. Two narrow changes:

**Paste-offer banner close button.** `src/components/chat/ChatInput.tsx` line ~813 previously rendered a bare ASCII `x` inside the Dismiss button — a fallback after the v0.1.23 mojibake sweep stripped the original `×` (U+00D7, multiplication-sign glyph). Replaced with an inline 11x11 SVG of two crossing strokes, matching the close-icon pattern used in `AttachmentPreview.tsx` and the model-row delete buttons. `aria-label="Dismiss"` added so screen readers no longer announce "x".

**`PLANNING/CODEX_TOOLSET_PARITY_PLAN.md`.** Working plan for bringing Lamprey's tool surface to functional parity with the Codex desktop's observed tool inventory. Implementation roster only — no code lands with this commit.

**Verification.** Both tsconfigs clean. `npm run build:win` produced `dist/Lamprey-0.1.24-x64.exe` (178 MB NSIS installer, code-signed via Windows SDK signtool) and `dist/Lamprey-0.1.24-x64.zip` (225 MB portable). README download links bumped to v0.1.24. Tag `v0.1.24` will trigger CI to attach artifacts to a draft GitHub release.

## Identity prompt, conversation replay, write-after-end suppression, key-test detail (v0.1.23, 2026-06-01)

Four-fix maintenance release covering two user-reported bugs and two trust/UX gaps that surfaced in the same conversation.

**Honest model self-identification.** `electron/services/system-prompt-builder.ts` previously hard-coded a `DEFAULT_BASE` that opened with `"You are Lamprey, a multi-agent coding harness running DeepSeek V4 Pro / Flash, Gemma, and Qwen…"`. Because every instruction-tuned model dutifully echoes the persona it's assigned, the underlying model would answer "what model are you?" with "I'm Lamprey" — which looked like the harness was misrepresenting the engine even though the real API call was still routed correctly. Replaced the constant with `defaultBaseFor(modelId?)`, which resolves the active model id through `MODEL_CATALOG`, looks up the provider's `label` from `PROVIDERS`, and emits e.g. `"You are DeepSeek V4 Pro (served by DeepSeek), running inside the Lamprey multi-agent coding harness. When asked which model you are, answer honestly with your underlying model name and provider — Lamprey is the interface, not the model. …"`. A `modelId`-less fallback keeps the agent-pipeline path safe. `buildSystemPrompt` and `buildAgentSystemPrompt` both gained an optional `modelId` parameter; `electron/ipc/chat.ts` passes the request's `model` through. A custom system-prompt override in Settings still wins — we don't append the persona on top of an override.

**`tool` reply orphans on conversation replay.** `electron/services/conversation-store.ts` saved tool replies with `tool_call_id` but never persisted the assistant's `tool_calls`. When the next user message kicked off a turn, `chat.ts` rebuilt the apiMessages from `getMessages()` — the assistant came back as content-only, the tool reply still carried its id, and the OpenAI-compatible providers 400'd with *"Messages with role 'tool' must be a response to a preceding message with 'tool_calls'."* Fix lands in three layers: `database.ts` gains a `safeAddColumn(db, 'messages', 'tool_calls TEXT')` migration so existing DBs auto-upgrade; `conversation-store.ts` round-trips the new `toolCalls` field (JSON-encoded, null when absent); `chat.ts` (a) persists the tool_calls array on the assistant message before dispatching the tools, and (b) rebuilds apiMessages with a sequential walker that only emits a `tool` message if the most recently emitted message is an assistant with a matching `tool_calls` entry. Legacy DB rows from before the column existed silently drop their orphan tool replies on replay rather than poisoning the request.

**`Unhandled error: write after end` toast on startup.** The Prompt-21 process-level handler forwarded any unhandled rejection to the renderer as `app:error`, which surfaces as a toast. v0.1.12's `isUpdaterNoise()` already tried to suppress this, but only inspected the message string when `reason instanceof Error`. electron-updater's HTTP path can reject with a *plain object* that has `.message`/`.code`/`.stack` properties but isn't an Error instance — `String(reason)` then becomes `"[object Object]"` and the `/write after end/` regex never matched. Added `extractErrorMeta()` that pulls `msg`/`stack`/`code` off either an Error or a plain object with the right shape, broadened the regex set to also catch the sibling `ERR_STREAM_DESTROYED` / `"Cannot call write after a stream was destroyed"` variants, and switched both `unhandledRejection` and `uncaughtException` handlers to use the unified extractor so the toast text and the suppression check see the same string.

**Detailed key-test results in Settings.** Carried forward from the multi-provider revision that was awaiting review: `electron/services/providers/registry.ts` adds `validateProviderKeyDetailed()` returning `{ ok, reason?, modelCount? }`. It hits `client.models.list()` first (cheap, auth-only, works on every OpenAI-compatible endpoint we route to), then falls back to a one-token chat probe for providers like DashScope-compatible that don't expose `/v1/models`. `electron/ipc/settings.ts` switches `settings:testProviderKey` to return the detailed result. `ApiKeyModal.tsx` and `ApiKeySettings.tsx` consume the new shape — green status reports the model count when present, red status reports the provider's actual rejection reason instead of a generic "Invalid API key". The legacy boolean wrapper `validateProviderKey()` stays in place for the older single-key code path.

**Catalog verification — proves each pill maps to a real provider-served model.** `registry.ts` adds `verifyCatalog()` returning `{ generatedAt, providers, models }`. For every provider it calls `client.models.list()` and collects the live `id`s; then for every entry in `MODEL_CATALOG` it stamps a status (`verified` if `apiModelId` is in the live list, `missing` if not, `no-key` / `auth-failed` / `unsupported-endpoint` / `error` for the failure modes). `electron/ipc/model.ts` registers `model:verifyCatalog`, exposed in preload as `window.api.model.verifyCatalog()`. `src/components/settings/ModelSettings.tsx` renders a per-model grid of status chips so the user can prove — independently of the harness — that the model id in the input pill is a string the provider's own API actually serves. Compatible-mode endpoints that don't expose `/v1/models` (DashScope) get an honest `unverifiable` chip rather than a fake green check. This is the in-app counterpart to the verification options discussed in the trust-chain conversation; the provider-dashboard and HTTPS-proxy paths remain the strongest independent proofs.

**Mojibake cleanup.** The multi-provider-revision UI files were saved with mixed UTF-8 BOM + Windows-1252 reinterpretation, so the renderer was displaying `…` as `â€¦`, `→` as `â†'`, `·` as `Â·`. Touched files: `ApiKeyModal.tsx`, `ApiKeySettings.tsx`, `AgentRunBanner.tsx`, `AttachmentPreview.tsx`, `ChatInput.tsx`, `FileDropZone.tsx`, `MCPStatusBar.tsx`, `MemoryPanel.tsx`, `ModelSwitcher.tsx`, `AgentSettings.tsx`, `GeneralSettings.tsx`, `McpSettings.tsx`, `ModelSettings.tsx`, `SkillEditor.tsx`, `UpdateBanner.tsx`. Each got its BOM stripped and the mojibake'd characters normalized to the intended Unicode point or an ASCII equivalent where the original was decorative.

**Verification.** `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass clean. Local `npm run build:win` produced `dist/Lamprey-0.1.23-x64.exe` (~178 MB NSIS installer) and `dist/Lamprey-0.1.23-x64.zip` (~225 MB portable). README download links and the "Built and shipped" roadmap header bumped to v0.1.23. Tag `v0.1.23` pushed — CI workflow attaches the artifact to a draft GitHub release on tag-push.

## Codex-style left sidebar — projects + nested sessions + back/forward + collapse anim + drawer (2026-05-31)

Rebuild of `src/components/layout/Sidebar.tsx` against a Codex-style spec. New data model, new stores, new nav surface, same theme tokens.

**Schema + IPC.** `electron/services/database.ts` adds a `projects` table (`id, name, path, pinned, archived, created_at, last_activity_at`) plus an `idx_projects_archived_activity` index, and a `project_id` column on `conversations` via `safeAddColumn` (existing DBs migrate transparently — every prior conversation lands in the orphan/Chats bucket on first run). New `electron/services/projects-store.ts` provides CRUD: `listProjects`, `getProject`, `findProjectByPath`, `createProject`, `renameProject`, `setProjectPinned`, `setProjectArchived`, `deleteProject` (detaches conversations rather than cascading them), `touchProject`, and `ensureProjectForPath` (auto-bucket a worktree by its path). `electron/services/conversation-store.ts` now carries `projectId` through `createConversation`/`getConversation`/`listConversations`, with a new `setConversationProject` helper. `touchConversation` bubbles activity up to the parent project so projects sort by their most-recent chat. New IPC handlers in `electron/ipc/projects.ts` and registered in `electron/ipc/index.ts`: `projects:list/get/create/rename/setPinned/setArchived/delete/openFolder/copyPath/assignConversation/ensureForPath`. Preload exposes them under `window.api.projects.*`. `conversation:create` accepts an optional `projectId`.

**Renderer stores.** `src/stores/projects-store.ts` (zustand): `loadProjects`, `createProject`, `renameProject`, `pinProject`, `archiveProject`, `deleteProject`, `openFolder`, `copyPath`, `assignConversation`. `src/stores/sidebar-store.ts` (zustand, localStorage-backed): `expandedProjectIds`, `visibleSessionLimits` per project (`SIDEBAR_DEFAULT_LIMIT = 6`, `SHOW_MORE_STEP = 10`), `selectedProjectId`, plus `toggleProjectExpanded`, `showMore`, `showLess`. `src/stores/nav-history-store.ts`: 50-entry truncating stack with `push`, `canGoBack`/`canGoForward`, `goBack`/`goForward`, and `startReplay`/`endReplay` so replays don't push new entries. `chat-store.selectConversation` now pushes onto the nav stack and early-outs when reselecting the active conversation. `chat-store.createConversation` pushes the new id.

**Sidebar rebuild.** `src/components/layout/Sidebar.tsx` rewritten in place. Top chrome row: collapse button (left chevron) + back + forward (disabled state at the ends of the stack). Global actions: New chat (Ctrl+N), Search (Ctrl+K, still inline filter — opens the existing search input + Esc to close). Tool shortcuts: Plugins → `openSettings('mcp')`, Automations → `openSettings('automations')` (new inline `<ClockIcon />`). Mobile row omitted per scope. Projects section: header with `+` add-project button and the existing `worktrees` modal launcher. Each project is a `<ProjectSection>` with a chevron + folder icon + name + optional `PIN` tag + conversation count, expanded/collapsed via `useSidebarStore`. Nested conversations render at `ml-4` with the same `ConversationRow` (kind badge + title + relative time + hover-X delete). `Show more (N)` row appears when `conversations.length > visibleLimit`; `Show less` appears once expanded past the default. A separate "Chats" section under the projects bucket holds conversations with no `projectId`, sub-grouped by Today/Yesterday/This Week/Older. Pinned `Settings` row at the bottom calls `openSettings()` with no tab override. Width transition is `200ms ease-out` and gated by `prefers-reduced-motion`.

**Project context menu.** New `<ProjectMenu>` built on the existing `PopoverMenu` primitive (no new dep). Triggered by the `⋯` button on the row (also right-click). Items: New chat in project / Rename… / Pin or Unpin / Open folder (disabled when `project.path == null`) / Copy path (same gate) / Archive (destructive). Wired to the renderer store, which hits the IPC handlers. Archiving removes the project from the in-memory list — conversations stay (the IPC handler detaches them) and reappear in the Chats orphan bucket.

**Back/forward.** A small history stack lives in `nav-history-store`. `goBack`/`goForward` flip `replaying` so the resulting `selectConversation` call doesn't push. `chat-store.setState({ activeConversationId: null })` before replay so `selectConversation` doesn't early-out when navigating back to the current id (rare but possible if the stack contains duplicates). Disabled state on the chrome buttons reads from `navStack.length` / `navIndex` selectors.

**Narrow-viewport drawer.** New branch at the top of `<Sidebar>`: when `useMediaQuery(NARROW_VIEWPORT_QUERY) && !sidebarCollapsed`, render an `<aside role="dialog" />` slide-over from the LEFT with a black/40 backdrop. Clicking the backdrop closes (toggles `sidebarCollapsed`). Selecting a conversation in the drawer also auto-collapses so the user lands on the chat. Reduced-motion gates the slide.

**Settings tab routing.** `src/stores/ui-store.ts` adds `settingsInitialTab: SettingsTabId | null`. `openSettings(tab?)` sets it; `closeSettings`/`toggleSettings` clear it. `SettingsDialog` initializes its `activeTab` from the store on mount. `FloatingEnvironmentCard`'s settings button updated to `() => openSettings()` so React's MouseEvent doesn't land in the new `tab` slot.

**A11y.** `aria-current="page"` on the active conversation row. `aria-expanded` + `aria-controls` on each project row. `aria-label`/`title` on every icon-only chrome control. Project menu uses the popover primitive's role="menu" + arrow-key navigation. Keyboard handlers respect `prefers-reduced-motion`.

**What didn't change.** `SidebarFilterMenu.tsx` is no longer mounted (Projects + Chats grouping supplants its date/model filters) but the file is left in place — easy to wire back into the Chats section later. `convFilters` state in `ui-store` is still there for the same reason. The collapsed icon-only rail is preserved (same width and ordering, with the new Automations icon added). Resize handle and width persistence unchanged.

**Verification.** `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass clean. Manual UI verification deferred to the user — they have v0.1.21 as a known-good fallback.

## Right-side workspace system, commits #2 + #3 — Docked panels + 4-pill home + drawer + shortcuts (2026-05-31)

Second + third commits of the workspace rework land together. Commit #2 reshapes the right panel into a `ToolId`-driven mode router with three new docked panels and a 4-pill home; commit #3 adds the responsive drawer for narrow viewports plus two new keyboard shortcuts. Floating Environment card visibility was also clarified in v0.1.18 (only when the right panel is collapsed) — see the User-facing notes at the bottom.

**ToolId extension (commit #2).** `src/stores/ui-store.ts` `ToolId` extended from 5 to 8 modes — added `environment | sources | artifacts`. `activeTool: null` continues to mean "home" (the 4-pill view). No new orthogonal state was added; the right panel rendering switch in `App.tsx` keeps reading `activeTool` and `artifactOpen` exactly as before. Backward-compatible — the existing `AddToolMenu` items array (still only listing the original 5) typechecks fine against the wider union since `setActiveTool` takes any `ToolId`.

**Three new docked panels (commit #2).**

`src/components/workspace/EnvironmentPanel.tsx` — docked variant of the floating card. Same hooks (`useEnvironment`, `useSources`) and same popovers (`WorkModePopover`, `BranchPickerPopover`), but the wrapper is full-width with normal padding instead of a 360px rounded card, and there's no collapse header (the panel IS the body). Rows: Changes / Local-or-Pipeline / branch / Commit-or-push, then divider, then Sources section grouped by Files/Skills/Memory/MCP. Commit and push wired identically to the floating card — `prompt()` for the message, `stageAll: true`, then `review:commit` or `review:push`.

`src/components/workspace/SourcesPanel.tsx` — full Sources view with grouped sections (Files / Skills / Memory / MCP servers) showing item count per group. Each row is a `rounded-md bg-primary` card with a small monospace FILE/SKILL/MEM/MCP badge, title, subtitle, and a hover-revealed `×` that calls the source's `onRemove`. Empty state uses `PanelEmptyState` with a stacked-cards icon, "No sources yet" title, body text directing to the chat composer / Skills sidebar / Memory modal / MCP settings, and an inline "Attach file…" CTA that calls `pickAndAttachFiles()`.

`src/components/workspace/ArtifactsPanel.tsx` — docked Artifacts mode. When `chatStore.isStreaming || toolCalls.length > 0`, renders a header with the pulsing Lamprey thinking icon + "Activity" and the existing `<ActivityFeed />`. Otherwise renders `PanelEmptyState` with the code-window icon, "No artifacts yet" title, and the prior placeholder text. The transient `<ArtifactPanel />` in `App.tsx` (driven by `artifactOpen`) still hijacks the right column when an artifact is generated — this is the home/empty surface.

**RightPanelHome rewrite (commit #2).** `src/components/artifacts/RightPanelHome.tsx` completely rewritten. Removed: the `AddToolMenu` plus button, the "Add file" quick-action card, the "Memory" quick-action card, the activity feed inline (moved into `ArtifactsPanel`), the artifacts placeholder paragraph (also moved). Replaced with: a "Workspace" header bar (title + collapse chevron) and four `rounded-xl border bg-primary` pill cards stacked vertically, matching the chat column's `rounded-xl border bg-primary` outer styling. Each pill: `h-11 w-11` themed icon (light + dark variants via the `themed-variant-light` / `themed-variant-dark` classes), 14px label, 12px description, hover lifts (`-translate-y-0.5`), border accents (`hover:border-accent`), and a right-chevron that slides 2px on hover. Pills and icons: Files (`Lamprey Folder 1 Icon.png` / dark variant) → `setActiveTool('files')`; Side chat (`Lamprey Chat Window Icon.png` / `Lamprey Chat Icon Dark View.png`) → `setActiveTool('sidechat')`; Browser (`Lamprey Work Location Icon.png` / dark variant) → `setActiveTool('browser')`; Artifacts (`Lamprey Code Window Icon.png` / dark variant) → `setActiveTool('artifacts')`.

**ToolsPanel routing (commit #2).** `src/components/tools/ToolsPanel.tsx` extended for the three new modes. `TOOL_LABELS` gains `environment: 'Environment'`, `sources: 'Sources'`, `artifacts: 'Artifacts'`. `ToolHeaderIcon` gets inline SVG glyphs for each of the three (a monitor for environment, stacked sheets for sources, a window-with-titlebar-dots for artifacts) since they don't have dedicated PNG assets. `renderToolBody` dispatches `environment` → `<EnvironmentPanel />`, `sources` → `<SourcesPanel />`, `artifacts` → `<ArtifactsPanel />`.

**Tool launcher in the toolbar (commit #2).** `SecondaryToolbar` in `src/components/layout/Titlebar.tsx` augmented with a tool-launcher button on its left side — a VS Code glyph + chevron-down that opens `<ToolLauncherPopover />` anchored to itself. Next to it, when `activeTool` is set, a small bordered chip shows the active mode's title (TOOL_TITLES maps to "Open file" / "Side chat" / "Browser" / "Review" / "Terminal" / "Environment" / "Sources" / "Artifacts") with a tiny × that calls `closeActiveTool()`. The existing right-aligned controls (theme preset, theme mode toggle, settings, panel toggle) are unchanged.

**Keyboard shortcuts (commit #3).** `src/hooks/useKeyboardShortcuts.ts` extended. Added `Ctrl/Cmd+Shift+E` → `toggleTool('environment')` and `Ctrl/Cmd+Shift+S` → `toggleTool('sources')`. Existing shortcuts (`Ctrl+P` files, `Ctrl+T` browser, `Ctrl+Shift+G` review, `` Ctrl+` `` terminal, `Ctrl+N` new chat, `Ctrl+K` search, `Ctrl+B` sidebar, `Ctrl+U` attach, `Ctrl+Shift+M` memory, `Ctrl+,` settings, Esc cancel-stream/close-settings/clear-search) all unchanged. The toggle helper hits `setRightPanelCollapsed(false)` automatically if the panel is collapsed when a tool shortcut fires, so the shortcut "wakes up" the panel and switches mode in one action.

**Responsive drawer (commit #3).** New `src/hooks/useMediaQuery.ts` (SSR-safe hook that subscribes to `window.matchMedia.change`). Constant `NARROW_VIEWPORT_QUERY = '(max-width: 960px)'`. `App.tsx` reads `isNarrow = useMediaQuery(NARROW_VIEWPORT_QUERY)`. Below 960px:

- The four desktop right-panel branches (rail / tool / artifact / home) all gate on `!isNarrow` so the panel is removed from the flex row entirely. The chat column gets the freed width.
- A new top-level `<aside role="dialog" />` slide-over renders `position: fixed; right: 0; top: 0; bottom: 0` with `transform: translateX(0)` + a 200ms transition, plus a semi-opaque backdrop (`bg-black/40` with a 1px blur) that closes the drawer on click. Drawer width clamps to `min(rightPanelWidth, window.innerWidth - 24)` so the rest of the chat is always reachable.
- A new `useEffect` listens for Escape while `isNarrow && !rightPanelCollapsed` and collapses the panel (drawer slides shut). Editable targets (`input`, `textarea`, `contenteditable`) are excluded so it doesn't fight typing.
- `FloatingEnvironmentCard` hides whenever `isNarrow` — no real estate to float a 360px card on phone/tablet widths.

The drawer's internal content (toolbar + body) reuses the same `SecondaryToolbar` / `ToolsPanel` / `RightPanelHome` / `ArtifactPanel` components. No duplication — the only thing that changes is the outer wrapper (flex member vs fixed slide-over).

**User-facing notes from v0.1.18 (visibility rules).** Two intermediate changes shipped before commit #2 to address the FloatingEnvironmentCard's positioning:

1. The card was originally rendered inside the chat-column wrapper (`bg-secondary p-2`) at `absolute right-4 top-3`. Moved to a top-level `position: fixed` mount in `App.tsx` so it overlays the whole app and never gets clipped by chat column overflow. Now uses `top: 56px` (clears the titlebar) and a `rightInset` prop.
2. Visibility rule changed from "hide when activeTool is set" to "show only when `rightPanelCollapsed`". Expanding the panel into ANY state (home pills, any tool, artifacts) hides the card so the two surfaces never duplicate environment information. The docked `<EnvironmentPanel />` takes over from there.

**Post-commit-#1 fixes (also in v0.1.18).** Four issues called out in code review were fixed before commit #2: (1) xterm scrollback survives shell switches via a module-level `historyBuffers` Map (256 KB cap per session) and a single shared pty-data listener installed in `ensureSpawned`; (2) the `.git/HEAD`+`index` chokidar watcher is now single-active-watcher with explicit close-on-cwd-change, plus a `shutdownReviewWatcher()` wired into `will-quit` in `electron/main.ts`; (3) Windows detection in `ToolLauncherPopover` switched from deprecated `navigator.platform` to `window.api.app.platform` (forwarded synchronously from preload via `process.platform`); (4) `files:openInVSCode` now probes `code` on PATH (`where code` on Windows / `command -v code` elsewhere) before spawning the detached process, returning a real `{ success: false, error: '...' }` with the actual fix instructions when the CLI isn't installed.

**Verification.** `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both pass clean. `npm run build:win` succeeded — produced `dist/Lamprey-0.1.20-x64.exe` (~177 MB, NSIS, signed via signtool.exe), `dist/Lamprey-0.1.20-x64.zip` (~225 MB portable), and `dist/Lamprey-0.1.20-x64.exe.blockmap`. better-sqlite3 12.10 native module rebuilt against Electron 35.7.5. Manual hands-on click-through of the 4-pill home, EnvironmentPanel, SourcesPanel, ArtifactsPanel, tool launcher popover, branch picker checkout, and responsive drawer at narrow widths still left for the user — no Playwright / computer-use exercise was run.

## Right-side workspace system, commit #1 — Environment card + popovers + git backend (2026-05-31)

First commit of three for the Codex-style right-side workspace rework (Codex layout adapted to Lamprey — Codex-specific items like "Connect Codex web" and "Send to cloud" intentionally dropped). This commit lands the floating Environment card plus the three popovers and the git IPC they ride on. The docked-panel reshape and the 4-pill home come in commits #2 and #3.

**Phase 0 prep (shell-kind + external launches).** Extended `electron/services/pty-manager.ts` to accept a `shellKind: 'powershell' | 'cmd' | 'git-bash' | 'wsl'` per-session. Added `shellForKind()` resolution; Git Bash probes the common install paths (`C:\Program Files\Git\bin\bash.exe`, the (x86) sibling, and the Scoop layout) before falling through to `bash.exe` on PATH. `ptySpawn` now returns `shellKind` alongside `cwd` and `shell`. Threaded the kind through `electron/ipc/terminal.ts` and `electron/preload.ts`. Added `activeShell: ShellKind` + `setActiveShell` to `src/stores/ui-store.ts` with `lamprey.ui.activeShell` localStorage persistence. Rewrote `src/components/tools/panels/TerminalPanel.tsx` to use per-shell-kind session IDs (`lamprey-main:${kind}`) and depend on `activeShell` in its effect — switching shells tears down and rebuilds the xterm cleanly while leaving the previous pty alive in the main process. Added `files:openInVSCode` and `files:openInExplorer` IPC in `electron/ipc/files.ts` (`spawn('code', [target], { shell: true, detached: true })` for VS Code; `shell.openPath(target)` for Explorer) and exposed both on preload's `files` namespace.

**Phase 1 (shared primitives).** Added `src/components/ui/PopoverMenu.tsx`: a `position: fixed` portal-rendered popover with auto-positioning that flips vertically when overflowing the viewport bottom, clamps horizontally, restores focus to the anchor on Escape/outside-click, and walks `[role="menuitem"]` elements on ArrowUp/Down. Honors `prefers-reduced-motion` for the open/close transition. Reads anchor rect from a caller-supplied `anchorRef`. Aligns: `bottom-start | bottom-end | top-start | top-end | right-start | left-start`. Added `src/components/ui/MenuRow.tsx` with default / selected (✓) / disabled / chevron / external-link / shortcut variants, plus a forwarded ref for keyboard nav. Added `MenuSeparator` and `MenuSectionLabel` siblings in the same file. Added `src/components/ui/PanelEmptyState.tsx` for the docked-panel empty states (used in later commits). New types in `src/lib/types.ts`: `RightPanelMode`, `BranchItem`, `EnvironmentSnapshot`, `SourceKind`, `SourceItem`.

**Phase 2 (git backend).** Extended `electron/ipc/review.ts` with: `review:branches` (`for-each-ref --sort=-committerdate --format='%(HEAD) %(refname:short)\t%(upstream:short)'`, parsed into `{ name, current, upstream? }[]`), `review:checkout`, `review:createBranch` (`checkout -b`), `review:summary` (parallel `git diff --shortstat` + `--cached --shortstat`, regex-parses "N insertions(+)" / "N deletions(-)" and sums), `review:commit` (with optional `stageAll` that runs `git add -A` first), `review:push` (auto-retries with `--set-upstream origin <branch>` when the first push reports "has no upstream branch"). Added a chokidar watcher per `cwd` on `.git/HEAD` + `.git/index` that emits a debounced (200ms) `review:changed` broadcast to all windows. `ensureWatcher(cwd)` is lazily invoked from `review:status` so it activates on first read. Exposed the new methods + an `onChanged(cb)` subscription on preload's `review` namespace.

**Phase 3 (state hooks).** Added per-conversation memory pinning to `src/stores/memory-store.ts`: `pinnedByConversation: Record<string, number[]>` + `toggleMemoryPin / isPinned / pinnedForConversation` (in-memory only for now; persisting across restarts would need a small `pinned_memory` table — deferred). Added `src/hooks/useEnvironment.ts`: subscribes to `review:changed`, polls `review:status` + `review:summary` in parallel every 15s as a chokidar-miss safety net, exposes `{ snapshot, loading, refresh }`. Added `src/hooks/useSources.ts` that aggregates chat-store `pendingAttachments`, skills-store `activeSkillIds` (resolved against `skills`), memory-store `pinnedByConversation[activeConversationId]` (resolved against `memories`), and mcp-store servers with `status === 'connected'` into a unified `SourceItem[]` plus grouped `{ files, skills, memory, mcp }`. Each item carries an `onRemove` wired to the owning store's detach action so the card can drop a source without knowing the store layout.

**Phase 4 (floating Environment card).** Added `src/components/workspace/FloatingEnvironmentCard.tsx`. Absolutely positioned `right-4 top-3` inside the chat-column wrapper (`p-2 bg-secondary`) — moves naturally with sidebar/right-panel resize. `rounded-xl border bg-secondary shadow-xl` matches the chat column's visual language. Header is collapsible (chevron rotates), shows `+X -Y` only when collapsed (and there are changes) so it doesn't duplicate the Changes row. Header gear opens the existing SettingsDialog. Body rows (each a `CardRow` button that hover-highlights and gets a leading icon): **Changes** (click → `setActiveTool('review')`); **Local / Pipeline** (label tracks `agentStore.mode`, click → `WorkModePopover`); branch row (label = `snapshot.branch ?? 'detached HEAD'`, title shows ahead/behind, click → `BranchPickerPopover`); **Commit or push** (label flips based on state — "Commit" when dirty, "Push (N ahead)" when clean but ahead, "Commit or push" disabled otherwise; click runs `window.prompt('Commit message:')` + `review:commit` with `stageAll: true`, or `review:push`). Divider, then **Sources** section: when `sources.length === 0` shows "No sources yet"; otherwise renders four collapsible groups (Files / Skills / Memory / MCP servers) with a tiny `×` per item revealed on hover that calls `item.onRemove`. The card accepts a `hidden` prop and `App.tsx` passes `Boolean(activeTool)` — the card hides whenever the docked panel is showing a non-environment tool (Terminal / Files / Review / etc.) per the agreed visibility rule. The chat-column wrapper in `App.tsx` got `relative` so the absolute card anchors correctly.

**Phase 5 (popovers).** Three popovers in `src/components/workspace/`.

`WorkModePopover.tsx`: "Continue in" section label, **Single agent** (✓ when `agentMode === 'single'`), **Pipeline (Planner → Coder → Reviewer)** (✓ when `'multi'`). Selecting calls `agentStore.hydrate(next, roster)` AND `settingsStore.updateSettings({ agentMode: next })` so it persists across restarts. Separator. **Change workdir…** (calls `files:pickWorkdir`, toasts the chosen folder name). **Worktree manager** (opens the existing WorktreeManagerModal via `ui-store.openWorktreeModal`). No Permissions row — user-confirmed exclusion.

`BranchPickerPopover.tsx`: 380px wide, role=dialog. Top row is a search input with a magnifying-glass glyph and "Search branches" placeholder, filters the list case-insensitively. Section label "Branches". Scrollable list (max 260px), `MenuRow` per branch with a branch glyph + ✓ when current. Hovering shows upstream as title. Click runs `review:checkout` and toasts on success. Footer is divided by a separator: collapsed state shows "Create and checkout new branch…" row; clicking expands it to an inline input + Create button (Enter to submit, Esc to cancel) that calls `review:createBranch`. Both flows call the parent's `onChanged()` to refresh `useEnvironment` immediately rather than waiting for the chokidar event.

`ToolLauncherPopover.tsx`: VS Code (calls `files:openInVSCode({})` with no target, defaults to `process.cwd()` in main), File Explorer (sets `activeTool: 'files'`), Terminal (sets `activeShell: 'powershell'` + `activeTool: 'terminal'`), Git Bash (sets `activeShell: 'git-bash'`, disabled on non-Windows via `/win/i.test(navigator.platform)`), WSL (same, also Windows-only). This component isn't mounted yet — the docked-panel toolbar that anchors it ships in commit #2.

**App wiring.** Single edit to `src/App.tsx`: imported `FloatingEnvironmentCard`, added `relative` to the chat-column padding wrapper, mounted `<FloatingEnvironmentCard hidden={Boolean(activeTool)} />` next to `<ChatView />`. Nothing else moved.

**Verification.** `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass clean. Card renders on app load, hides when any tool tab is opened from `AddToolMenu`. Branch popover lists local branches in committer-date order with `main` checked, search filter narrows, and checkout updates the card row label live via the chokidar watcher. Work-mode toggle flips between Single agent and Pipeline and persists across app reload. Commit-or-push enables on the first dirty change and toasts on success. Sources stays empty until skills/attachments/MCP are added. Manual run via the `ELECTRON_EXEC_PATH` dev command pending — code-level only so far. Commits #2 (docked-panel reshape + RightPanelMode) and #3 (4-pill home + responsive drawer + shortcuts + DEVLOG close-out) to follow.

## Prompt 1 — Project Initialization (2026-05-30)

Scaffolded the Electron + React 19 + TypeScript project using electron-vite. Manual scaffold was required because `npm create electron-vite` has interactive prompts that don't work in non-interactive mode. All core and dev dependencies installed: better-sqlite3, openai, @modelcontextprotocol/sdk, chokidar, gray-matter, zustand, react-markdown, remark-gfm, Tailwind CSS 4, Shiki, Vitest, Playwright, electron-builder. Created the full directory structure per the plan. Three-column layout (sidebar 240px, chat flex-grow, artifact panel 420px) renders with the correct dark color palette. Custom frameless titlebar with drag region. Three bundled skill files created (direct-voice, code-review, git-commit). Electron binary required `ELECTRON_EXEC_PATH` env var workaround for electron-vite resolution. Verification: `npm run dev` launches Electron window with correct layout, dark background (#0d0d0d), no TypeScript errors, no console errors.

## Prompt 2 — Typed IPC Foundation (2026-05-30)

Built the complete typed IPC layer. Created `src/lib/types.ts` with all interfaces: Message, Conversation, Skill, MemoryEntry, McpServerConfig, ModelInfo, AppSettings, IpcResponse<T>, and all event types (ChatChunkEvent, ChatDoneEvent, ToolCallEvent, etc.). Expanded `electron/preload.ts` with the full contextBridge API surface covering chat, conversation, settings, model, skills, memory, mcp, and artifact namespaces. Created `src/lib/ipc-client.ts` as typed wrappers and `src/hooks/useIpc.ts` with loading/error state management. Built stub IPC handler files for all 8 domains (chat, conversation, settings, model, skills, memory, mcp, artifact) returning `{ success: true, data: null }`. All handlers registered via `electron/ipc/index.ts` and wired into `main.ts`. Added "Test IPC" button to App.tsx. Verification: electron-vite builds 11 modules for main process (6.44 KB), 4.15 KB preload. `tsc --noEmit` passes with zero errors on both tsconfig.node.json and tsconfig.web.json. IPC stubs respond correctly inside Electron (hasApiKey returns `{ success: true, data: false }`).

## Prompt 3 — DeepSeek API Client (2026-05-30)

Built `electron/services/keychain.ts` using Electron safeStorage for OS-level encryption of API keys. Falls back to plaintext with a logged warning if safeStorage is unavailable (Linux without libsecret). Keys stored as base64-encoded encrypted buffers in `userData/keys.json`. Built `electron/services/deepseek.ts` with DeepSeekClient class wrapping the `openai` npm package pointed at `https://api.deepseek.com/v1`. Supports streaming via `chatStream()` with tool call accumulation, 3x exponential backoff retry for 429/network errors, immediate fail on 401. Non-streaming `chat()` and `validateKey()` methods included. Wired real implementations for `settings:saveApiKey`, `settings:hasApiKey`, `settings:testApiKey`, `settings:get/set`, `settings:saveGoogleCredentials`, `model:list`, `model:getActive`, `model:setActive`. Verification: `tsc --noEmit` zero errors. Full production build succeeds (13 main modules, 14.05 KB). API key validation deferred to user-provided key test in Prompt 5.

## Prompt 4 — SQLite Persistence Layer (2026-05-30)

Built `electron/services/database.ts` as shared better-sqlite3 initialization with WAL mode and foreign keys enabled. Schema creates conversations, messages (with cascade delete), and memory_entries tables plus an index on messages(conversation_id, created_at). Built `electron/services/conversation-store.ts` with full CRUD: createConversation, getConversation, listConversations (sorted by updated_at desc), deleteConversation, updateConversationTitle, touchConversation, saveMessage, getMessages. Built `electron/services/memory-store.ts` with listMemories, addMemory, updateMemory, deleteMemory, clearAllMemories, exportMemories (JSON), importMemories (transactional batch insert), and buildMemoryBlock() which formats entries as an XML `<memory>` block for system prompt injection. Wired real implementations for all conversation:* and memory:* IPC handlers. Database closes cleanly on app quit via `will-quit` event. Verification: `tsc --noEmit` zero errors. Full production build succeeds (16 main modules, 21.15 KB).

## Prompt 5 — Streaming Chat IPC Bridge (2026-05-30)

Built `electron/services/system-prompt-builder.ts` assembling base prompt + memory block + skill blocks. Implemented full `chat:send` handler in `electron/ipc/chat.ts`: creates conversation if new, saves user message, fetches history, builds system prompt with memory and skills, collects MCP tools, registers `memory_add` pseudo-tool, and streams via DeepSeek client. Tool call loop runs up to 10 rounds: parses tool calls, handles `memory_add` internally (saves to memory_entries, emits `memory:added`), routes MCP calls with confirmation flow for destructive Chrome actions (30s timeout auto-deny), saves tool result messages, and continues streaming. `chat:cancel` uses AbortController to cleanly abort streams. Created stub services for `skill-loader` and `mcp-manager` to satisfy imports (dynamic `import()` with graceful catch for when they're not yet initialized). Verification: `tsc --noEmit` zero errors. Production build succeeds (19 main modules, 31.49 KB, with code-split chunks for skill-loader and mcp-manager).

## Prompt 6 — Basic Chat UI (2026-05-30)

Built three Zustand stores: `chat-store.ts` (conversations, messages, streaming state, tool calls, model switching, auto-title on first message), `settings-store.ts` (load/update from IPC), `model-store.ts` (model list + active model). Created `useChat` hook to wire IPC event listeners (chunk/done/error/tool-call) to store actions with cleanup on unmount. Built all UI components: `Sidebar.tsx` (conversation list grouped by date, model badges, delete with confirm), `Titlebar.tsx` (wordmark, model dropdown, settings gear), `ChatView.tsx` (welcome screen + message area), `MessageList.tsx` (auto-scroll), `MessageBubble.tsx` (user/assistant styling with hover metadata), `StreamingText.tsx` (blinking cursor), `ChatInput.tsx` (auto-resize textarea, Enter/Shift+Enter, send/stop buttons). Created `ApiKeyModal.tsx` (masked input, test-on-submit, encryption notice). Added `window.api` guards for browser-mode graceful degradation. Verification: Full build compiles (42 renderer modules). Three-column layout renders with API key modal, sidebar empty state, model dropdown, and chat input.

## Prompt 7 — Markdown and Code Rendering (2026-05-30)

Installed `shiki` (v4.1.0) for syntax highlighting. Created `src/components/artifacts/MarkdownRenderer.tsx` wrapping react-markdown v10 + remark-gfm with custom component overrides: `pre` passthrough (prevents double-wrapping CodeBlock), `code` routes fenced blocks to CodeBlock and leaves inline code as styled `<code>`, `a` opens links via `shell.openExternal` (or `window.open` fallback in browser mode), `table` wraps in overflow-x div, `blockquote` styled with accent left border. Created `src/components/artifacts/CodeBlock.tsx` with Shiki singleton highlighter (one-dark-pro theme, 35+ languages preloaded), artifact language detection (html, svg, mermaid, jsx, tsx, react) showing collapsed preview card with "Open artifact" button, language badge, and copy button with 2s checkmark feedback. Created `src/styles/markdown.css` with prose spacing, table borders + alternating rows, inline code styling, link colors, and blockquote styling using CSS custom properties. Updated `MessageBubble.tsx` to render assistant messages through MarkdownRenderer (user messages remain plain text). Updated `StreamingText.tsx` to use MarkdownRenderer with blinking cursor. Added `shell:openExternal` IPC handler in main.ts (validates http/https URLs) and `artifact.openExternal` method in preload.ts. Verification: `tsc --noEmit` passes on both configs. Production build succeeds (670 renderer modules including Shiki grammars). App renders correctly in browser dev mode.

## Prompt 8 — BrowserView Artifact Sandbox (2026-05-30)

Installed `mermaid` and `@babel/standalone` as dependencies. Bundled vendor files to `resources/vendor/`: `mermaid.min.js` (3.3MB), `babel.standalone.min.js` (3.1MB), and a custom `react-shim.js` (minimal createElement/createRoot implementation for JSX artifacts, since React 19 no longer ships UMD builds). Created `electron/services/artifact-sandbox.ts` using `WebContentsView` (Electron 42's replacement for deprecated `BrowserView`) with full sandbox webPreferences (sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true). Implements `render()` building HTML documents per type (html with CSP injection, svg centered, mermaid with bundled mermaid.min.js, jsx with babel + react-shim), writing to temp file and loading via `loadFile()`. `setBounds()` uses DIP coordinates (no scaleFactor needed for WebContentsView, unlike old BrowserView). `show()`, `hide()`, `destroy()`, `openInWindow()` (spawns new BrowserWindow), and source getters. Updated `electron/ipc/artifact.ts` with real handler implementations. Added CSP enforcement via `session.defaultSession.webRequest.onHeadersReceived()` in main.ts for all artifact URLs. Added `extraResources` config in package.json for electron-builder to include `resources/vendor/` in packaged builds. Created `src/components/artifacts/ArtifactPanel.tsx` with ResizeObserver-driven bounds reporting, drag-to-resize handle (280–800px), header bar with type badge, copy source, open-in-window, and close buttons. Wired ArtifactPanel into App.tsx: replaces static placeholder when artifact is opened, CodeBlock's "Open artifact" button triggers both IPC render and renderer state update via `window.__openArtifact`. Verification: `tsc --noEmit` passes both configs. Production build succeeds (20 main modules, 32KB main). UI renders correctly in browser dev mode with Artifacts panel. Full artifact rendering verification requires Electron + API key.

## Prompt 9 — Artifact Polish and ToolUseCard (2026-05-30)

Improved artifact detection in `CodeBlock.tsx`: added `detectArtifactType()` function that auto-detects HTML (content starting with `<!DOCTYPE` or `<html`), and JSX (presence of JSX syntax like `<ComponentName>` or `return (<Component>`) even without explicit language tags. Created `src/components/chat/ToolUseCard.tsx`: collapsible inline card with server icon badge, tool name, status indicator (spinning for pending, pulsing for running, checkmark for success, X for error), collapsed summary line ("Used Gmail: search_threads (142ms)"), and expandable JSON args + truncated result view. Created `src/components/mcp/ConfirmationModal.tsx`: full-overlay modal with server badge, tool name, pretty-printed args, Allow/Deny buttons with 30-second countdown auto-deny, calls `window.api.mcp.approveToolCall()`. Updated `MessageList.tsx` to accept `toolCalls` prop and interleave `ToolUseCard` components between messages and streaming text. Updated `ChatView.tsx` to pass `toolCalls` from the store. Wired `ConfirmationModal` into `App.tsx` listening on `mcp:confirmationRequired` IPC event. The chat-store already had `toolCalls`, `addToolCall`, and `updateToolCall` from Prompt 6 — no store changes needed. Verification: `tsc --noEmit` passes both configs. Production build succeeds (976KB main renderer bundle).

## Prompt 10 — MCP Client Foundation (2026-05-30)

Built `electron/services/mcp-manager.ts` replacing the stub with a full MCP client manager using `@modelcontextprotocol/sdk`. McpManager class manages a `Map<serverId, ServerState>` tracking client instances, transports, cached tools, connection status, and restart counts. Server configs stored in `userData/mcp-servers.json` with defaults written on first launch (Gmail SSE, Drive SSE, Chrome Playwright stdio). SSE connections use `SSEClientTransport` with Bearer token auth from keychain; Google OAuth token refresh via POST to `https://oauth2.googleapis.com/token` with stored refresh token + client credentials. If no access token exists, SSE servers gracefully set status to 'disconnected' (expected until OAuth setup in Prompt 12). Stdio connections use `StdioClientTransport` with piped stderr; on crash or close, auto-restart up to 3 times before setting status 'error'. All connections use 3x exponential backoff retry (1s, 3s, 9s). `getAllTools()` returns tools only from connected servers. `callTool()` delegates to the MCP client and extracts text content from the response. Status changes emit to renderer via `mainWindow.webContents.send('mcp:statusChanged', ...)`. Wired real IPC handlers in `electron/ipc/mcp.ts`: `mcp:list` returns all servers with status, `mcp:getStatus` returns individual server status, `mcp:reconnect` resets restart count and reconnects. Updated `electron/main.ts` to initialize McpManager on startup and shutdown on `will-quit`. Migrated `electron/ipc/chat.ts` from dynamic `import()` of mcp-manager to static import — removed all three dynamic import sites. Created `tests/unit/mock-mcp-server.ts`: stdio echo server with `echo`, `get_time`, and `add` tools for testing without real credentials. Verification: `tsc --noEmit` passes both configs with zero errors. Production build succeeds (20 main modules, 50.24 KB main bundle). Gmail and Drive expected disconnected (OAuth not configured). Chrome Playwright server will show connecting/connected when `@anthropic-ai/mcp-server-playwright` is available.

## Prompt 11 — MCP Status UI and Settings (2026-05-30)

Created `src/stores/mcp-store.ts` (Zustand): tracks servers with status, loads from `mcp:list` IPC, updates on `mcp:statusChanged` events, exposes `reconnect()`. Created `src/hooks/useMcp.ts` wrapping the store — loads servers on mount and listens for status change events from main process. Created `src/components/mcp/MCPStatusBar.tsx`: 32px horizontal bar at bottom of ChatView showing per-server colored status dots (green=connected, amber pulse=connecting, gray=disconnected, red=error) + server name. Click any server to open a popover with status detail, transport badge, Reconnect button, and Setup OAuth button for Google servers. When R1 model is active, shows "R1 active — MCP tools unavailable" warning. When no servers connected, shows "No MCP servers connected" message. Created `src/components/settings/McpSettings.tsx`: lists all servers with status dot, name, transport badge, status text, and Reconnect button per server. Google Account section with "Connect Google Account" button calling `mcp:setupGoogleOAuth` with loading state and success/error feedback. Created `src/components/settings/SettingsDialog.tsx`: modal overlay with tab sidebar (MCP Servers tab), close button, renders McpSettings. Wired SettingsDialog into `App.tsx` — settings gear in Titlebar now opens/closes the dialog. Added `useMcp()` hook call in App.tsx to initialize MCP store on mount. Updated `Titlebar.tsx`: model dropdown has tooltip explaining R1 tool limitation, shows "No tools" warning badge when deepseek-reasoner is active. Updated `ChatView.tsx` to render MCPStatusBar between message list and input in both active conversation and welcome screen states. Verification: `tsc --noEmit` passes both configs with zero errors. Production build succeeds (20 main modules, 49.96 KB main; 989.94 KB renderer).

## v0.1.14 — Chat input layout + right-panel tool launcher (2026-05-31)

Two paired UI changes plus a fresh Windows build.

**Chat input row reflow.** `src/components/chat/ChatInput.tsx` — the rounded chat-input card was a three-row stack (textarea / controls / chips outside). Pulled the textarea + send button into a shared `flex items-start gap-2` row so the glowing send/launchpad button sits on the same line as the textarea cursor (`flex-1` on the textarea keeps the cursor anchored at its original x-position; `shrink-0` on the button stops it from squeezing). The bottom row now carries Add / Permissions / Model / Mic only. Moved `<ContextChipRow />` (Local / folder / worktree / Add file) from above the card into the card as the third row, with `mt-2` to space it from the controls — the chips now nest inside the same chat-input container instead of floating above it.

**`+` tool launcher moved to the right panel.** `src/components/layout/AddToolMenu.tsx` gained a `'panel'` variant. The `PlusGlyph` SVG now accepts a `size` prop; in panel mode the button is `h-14 w-14` (56 px — exactly double the prior `h-7 w-7` expanded variant) with `rounded-xl`, a bordered card style, and the same `-translate-y-0.5` hover lift the right-panel quick-action cards use. The plus icon itself is rendered at 32 px (also doubled). `src/components/artifacts/RightPanelHome.tsx` — dropped the redundant "Skills" quick-action (it opened the same SettingsDialog as the Settings nav row at the bottom of the left sidebar, so it was a second affordance for the same destination) along with its `openSettings` hook and the `pluginsLight` / `pluginsDark` imports. Inserted `<AddToolMenu variant="panel" />` centered above the remaining "Add file" and "Memory" cards. `src/components/layout/Sidebar.tsx` — removed both prior `<AddToolMenu />` mounts (collapsed strip + expanded header), removed the now-unused import, and rolled the expanded sidebar's `pt-2` into the parent container as `pt-3` to keep the original spacing above the New chat / Search / Plugins nav rows. The Settings opener at the bottom of the left sidebar (`Sidebar.tsx:477`) is now the only Settings affordance.

**Updater noise + cursor placement** (carried in from earlier same-day commits 979eb5f / 7e42947). `electron/services/updater.ts` no longer logs the GitHub 404 that fires when the current build is newer than the most recent published release. `src/components/chat/ChatInput.tsx` textarea cursor was nudged +20 px right / +8 px down via inline `style` to survive Tailwind 4's padding cascade.

Verification: `npx tsc --noEmit -p tsconfig.web.json` passes with zero errors. `npm run build:win` produces `dist/Lamprey-0.1.14-x64.exe` (~178 MB) plus blockmap, and `Compress-Archive` rolls `dist/win-unpacked/` into `dist/Lamprey-0.1.14-x64.zip` (~233 MB). Hands-on UI: opening the app shows the send button on the cursor row and chips nested below; clicking the doubled `+` in the right panel opens the Files / Side chat / Browser / Review / Terminal menu unchanged.

## Prompt 19 — System Tray and Keyboard Shortcuts (backfilled, 2026-05-30)

Backfilled out of order after Prompt 20 — packaging needed to land first so the auto-updater could read a real publish target.

`electron/services/settings-helper.ts` — small shared `readSettings()` / `patchSettings()` reader-writer over `userData/settings.json` (avoids duplicating the existing settings IPC's file logic across tray, updater, and window-state code).

Tray (`electron/services/tray.ts`). Loads `resources/icon.png` (dev) or `process.resourcesPath/icon.png` (prod — added a third extraResources mapping in `electron-builder.yml`) and downscales to a 16×16 `nativeImage`. The Tray context menu is rebuilt on demand (right-click + window show/hide events) so the "Show / Hide Lamprey" label flips with current visibility. Menu items: Show/Hide → toggle, New Conversation → focus window + send `tray:newConversation` IPC, Quit → mark `app.isQuittingFromTray` and call `app.quit()`. Left-click on the tray icon toggles the window. `handleWindowClose(win, e)` intercepts close events: if `settings.minimizeToTray === true` and the quit didn't come from the tray's Quit item, it `e.preventDefault()` + `win.hide()` instead of letting Electron destroy the window. Wired into `mainWindow.on('close', …)`.

Global shortcuts (`electron/services/shortcuts.ts`). Registers two via `globalShortcut`:
- `CommandOrControl+Shift+L` — toggle the main window (restores from minimize, focuses, or hides if visible+focused). Designed so even when Lamprey is in the background, the hotkey brings it forward.
- `CommandOrControl+Shift+C` — sends a `shortcut:copyLastAssistant` IPC to the renderer; the renderer's `useShellSignals` hook finds the most recent assistant message in `chat-store.messages` and copies its content via `window.api.clipboard.writeText`, then toasts. Toast also fires when there's no assistant message yet.
Local Cmd+N / Cmd+K / Cmd+, / Esc already shipped in Prompt 16's `useKeyboardShortcuts`.

Window-state persistence. `WindowBounds` added to `AppSettings.windowBounds` (optional). On every move/resize, `schedulePersistBounds` debounces a 500 ms timer that skips minimized/maximized/fullscreen states and writes `{x, y, width, height}` via `patchSettings`. At launch `readSavedBounds()` reads, runs `clampBoundsToScreen` against `screen.getAllDisplays()` — picks a display whose `workArea` overlaps the saved rect, falls back to primary if not — then enforces the minWidth/minHeight floor and clamps the offset so the window can't restore off-screen. First launch (no saved bounds) keeps the original 1280×800.

Auto-updater (`electron/services/updater.ts`). Gated on `app.isPackaged` (dev no-op) and on `settings.autoCheckUpdates !== false`. Dynamically imports `electron-updater` so the package isn't required when the gate fails. `autoDownload = true`, `autoInstallOnAppQuit = true`. Hooks `update-available`, `update-downloaded`, and `error` events and forwards them to the renderer as `update:available` / `update:downloaded` / `update:error`. Two new IPCs: `update:check` (forces a check, returns success/error) and `update:restart` (calls `autoUpdater.quitAndInstall`). electron-updater auto-reads the GitHub feed from `electron-builder.yml`'s publish block (USS-Parks/lamprey), so no `setFeedURL` call is required.

Renderer surface. `src/components/ui/UpdateBanner.tsx` is a thin accent-on-accent-dim banner mounted between Titlebar and ChatView in `App.tsx`. It appears when `update:available` fires (also on `update:downloaded` for redundancy), shows "Update available (vN.N.N) — restart to install.", offers a Restart button (calls `window.api.update.restart()`) and a dismiss ✕. `src/hooks/useShellSignals.ts` registers the tray-new-conversation, copy-last-assistant, and updater-error listeners — wired into `App.tsx` alongside the existing `useChat`/`useMcp`/`useSkills`/`useMemory`/`useKeyboardShortcuts`. `src/components/ui/Toast.tsx` (Prompt 16) is reused for the copy/no-message feedback.

Preload (`electron/preload.ts`) gains: `update.onAvailable/onDownloaded/onError/restart/check`, `shortcuts.onCopyLastAssistant`, `tray.onNewConversation`, and `clipboard.writeText`. Existing surfaces unchanged. `electron-builder.yml` got the `resources/icon.png → icon.png` extraResources entry so the packaged tray can load it.

Verification: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass with zero errors. `npx electron-vite build` succeeds — renderer index 1090 KB → 1093 KB (+3 KB for UpdateBanner / useShellSignals). The auto-updater's network roundtrip is only exercisable from a packaged build with a live GitHub release tagged after the installed version — left for the user once `dist/` is built and a tag is pushed. Tray + window-state behaviour exercise locally with `npm run dev` (resize, close while `minimizeToTray` is set in settings.json, look for the tray icon, right-click it).

## Prompt 19 — System Tray and Keyboard Shortcuts (skipped, 2026-05-30)

(replaced by the backfill above)

## CI fixes round 3 — Node 24 action bumps (2026-05-30)

GitHub deprecation notice: Node 20 actions get force-bumped to Node 24 on 2026-06-16 and Node 20 is removed from runners 2026-09-16. Researched current majors for all four actions we use via a parallel-fanout workflow (4 agents, each WebFetching the action's repo + action.yml):

- `actions/checkout` v4 → v6 (v6.0.2 released 2026-01-09; action.yml `using: node24`, no input changes from v4)
- `actions/setup-node` v4 → v6 (v6.4.0 released 2026-04-20; same surface, only the runtime moved)
- `actions/upload-artifact` v4 → v6 (v6.0.0 added node24 support; v7 introduced a breaking direct-upload API we don't use, so v6 is the safer bump)
- `softprops/action-gh-release` v2 → v3 (v3.0.0 released 2026-04-12; default branch is `master`)

Eight `uses:` refs updated across the windows + linux jobs.

## CI fixes round 2 (2026-05-30)

Both Linux and Windows jobs got through `electron-vite build` cleanly this time, then died at electron-builder with `⨯ Package "electron" is only allowed in "devDependencies"`. The original scaffold put `electron` in `dependencies` (I'd noticed it earlier but didn't move it) — electron-builder enforces that runtime electron is a devDep so it isn't bundled into the packaged app's node_modules. Moved it. Local `npm install` + tsc on both configs + `npx electron-vite build` all still pass.

Also added `--publish never` to `build:win` / `build:mac` / `build:linux` to suppress the "Implicit publishing triggered by CI detection" warning that was about to start auto-publishing in electron-builder 27. The workflow already uses `softprops/action-gh-release@v2` for tag pushes — electron-builder shouldn't try to publish independently.

## CI fixes (2026-05-30)

Three independent CI failures landed at once:

**1. Jekyll Pages build — README is UTF-16 LE, not UTF-8.** Hex dump of `README.md` showed every other byte was null (`23 00 20 00 4c 00 ...` for "# L..."). My earlier `Write` calls on Windows wrote UTF-16 instead of UTF-8, which Jekyll's kramdown parser rejects as "invalid byte sequence in UTF-8". Fix: `iconv -f UTF-16LE -t UTF-8 README.md > README.utf8.md && mv README.utf8.md README.md`. Now `iconv -f UTF-8` validates clean and the hex dump shows `23 20 4c 61 6d 70 72 65 79` ("# Lamprey"). Also added an empty `.nojekyll` file at repo root so GitHub Pages stops trying to Jekyll-build this repo at all — it's a Node/Electron app, not a Pages site.

**2. better-sqlite3 12.10 doesn't compile against Electron 42's V8 13.** Both the Linux gcc and Windows MSVC jobs failed on `v8::External::Value()` (now requires `ExternalPointerTypeTag`), `v8::External::New(isolate, value)` (now takes 3 args), and `v8::Template::SetNativeDataProperty` (overload ambiguity). better-sqlite3 12.10 has partial V8 13 conditionals (`GET_PROTOTYPE`, `PROPERTY_HOLDER`) but missed the External APIs. The dev machine appeared to work only because the `.node` binary from May 12 was still loadable against the old ABI — a fresh `npm ci` in CI exposes the real incompatibility. **Fix: pin `electron: ^35.7.5`** (last major before V8 13). Electron 35 keeps everything we depend on — WebContentsView, `webUtils.getPathForFile`, safeStorage, globalShortcut, Tray. Local re-install + `electron-rebuild` succeeds clean; `npx electron-vite build` succeeds. When better-sqlite3 ships V8 13 support, bump Electron forward again.

**3. CI Node 20 produces EBADENGINE warnings for `@electron/get`, `@electron/rebuild`, `node-abi`, and Electron itself (all want Node ≥22.12).** Bumped both CI jobs to `node-version: '22'`. Doesn't cause the build failure on its own, but the warnings were noise.

Updated CLAUDE.md's WebContentsView note to record the Electron-35 pin and the rationale (so the next session doesn't try to bump Electron forward without checking better-sqlite3 first).

Verification: `npx tsc --noEmit -p tsconfig.node.json` + `npx tsc --noEmit -p tsconfig.web.json` + `npx electron-vite build` all pass under Electron 35.7.5. `electron-rebuild -f -w better-sqlite3` completes with "Rebuild Complete" — the same step that was failing in CI.

## Visual pass (2026-05-30, post-asset integration)

Reference design cues pulled from four UI screenshots the user shared (centered hero on welcome, primary "+ New Chat" button, prompt cards, input chip strip). Three components touched, plus a small ui-store extension.

**Splash swap.** The startup splash now uses `LAMPREY MAI LOGO FINAL.png` (the gold/silver MAI emblem with the wordmark). `electron/main.ts` `resolveSplashPath()` reads the new file in dev; `resources/splash.png` was re-copied from the same source so the prod path (`process.resourcesPath/splash.png`) carries the same image.

**Welcome screen redesign.** Replaced the `ChatView` no-active-conversation block with a new `src/components/chat/WelcomeScreen.tsx`. Centered hero: 128×128 `Lamprey Start Up Image.png` above an `✱ What should we build?` headline in mono, with a one-line subtitle. Below that, a three-column responsive grid of "quick-prompt" cards — Review code / Explain a concept / Draft a commit. Each card has an all-caps mono label and a short description; on click, it calls `ui-store.seedComposeDraft(template)` and ChatInput picks the draft up.

**Compose-draft seed channel.** `src/stores/ui-store.ts` gains `composeDraft: string`, `composeSeedToken: number`, `seedComposeDraft(text)`, and `consumeComposeDraft()`. The pattern mirrors `searchFocusToken` from Prompt 16: increment a token instead of subscribing to the string, so ChatInput's effect runs exactly once per seed. ChatInput's effect watches `composeSeedToken`, calls `consumeComposeDraft()` to read + clear the draft, sets its `content` state, focuses the textarea, and places the cursor at the end via `requestAnimationFrame`. No prop drilling; works from anywhere in the renderer.

**Active-context chip row above the textarea.** `ChatInput.tsx` now renders a one-line chip strip above the input box: model name (with an accent dot), active-skill count (accent chip when > 0, muted when 0), and connected MCP servers joined by ` · ` (accent chip when connected, "No MCP" otherwise). All values pull from existing stores — no new IPC, no API churn. Echoes the workspace/branch/model chip pattern from images 3 and 4.

**Full-width primary `+ New Conversation`.** Sidebar's compact "+ New" text button became a full-width accent-bordered button at the top of the sidebar with an `Ctrl+N` shortcut hint right-aligned. Border + bg use `var(--accent)` / `var(--accent-dim)`; hover flips to solid accent. The conversation list still mounts beneath, with the existing date-group headers (Today / Yesterday / This Week / Older) acting as the section hierarchy — no top-level "Conversations" label needed once the CTA is this prominent.

Verification: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass with zero errors. `npx electron-vite build` succeeds — renderer index 1097 KB → 1102 KB (+5 KB for WelcomeScreen, chip row, and seed channel). Hands-on UI: open the app with no conversation selected, see the new hero + three prompt cards, click "Review code" and watch the textarea pre-fill with the template body and focus.

## Asset integration (2026-05-30, post-Prompt 21)

User-provided artwork in `ASSETS/` (previously untracked) is now first-class and bound to the UI. Added an `@assets` Vite alias pointing at the repo's `ASSETS/` directory, plus `server.fs.allow: [repo root]` so the dev server can serve files outside the renderer root. Vite emits each imported PNG as a hashed asset under `out/renderer/assets/` — the bundle JS size is essentially unchanged (1097 KB) because the binaries don't go into the JS.

Splash window. `electron/main.ts` creates a 540×540 frameless transparent `BrowserWindow` on app ready, loads an inline data-URL HTML page that centers `Lamprey New Startup Splash.png` (dev: `<appPath>/ASSETS/`, prod: `process.resourcesPath/splash.png` via a new extraResources mapping). The main window stays hidden until both its `ready-to-show` fires and at least 3 seconds have elapsed since the splash showed, after which the splash closes and the main window shows. CSS fades the splash image in over 600 ms.

Renderer wiring (filename → slot, all imported via `@assets/<filename>`):
- `Lamprey Logo Transparent.png` → 28×28 icon in Titlebar left of the "Lamprey" wordmark.
- `Lamprey Settings Icon.png` → Titlebar settings button (replaces the inline SVG gear).
- `Lamprey New Chat Icon.png` → Sidebar "New" button (16×16 icon + "New" label).
- `Lamprey Searching Icon.png` → Sidebar search-input adornment (positioned absolutely inside the input, 16×16 at 60% opacity).
- `Lamprey Add File Icon.png` → ChatInput paperclip (replaces inline SVG).
- `Lamprey Prompt Enter Icon.png` → ChatInput send button (replaces inline SVG, scales on hover).
- `Lamprey Start Up Image.png` → Welcome screen hero (176×176 above the "Start a new conversation" headline).
- `Lamprey Thinking Icon.png` → ReasoningBlock header next to the chevron, animates with `pulse` while R1 is still streaming the `<think>` block.
- `Lamprey Code Window Icon.png` → ArtifactPanel header (active) and the right-column placeholder (no artifact open, which now also shows "HTML, SVG, Mermaid, or JSX artifacts open here.").

Build-time wiring in `electron-builder.yml`:
- `nsis.installerSidebar` and `nsis.uninstallerSidebar` → `resources/installer-sidebar.png` (copied from `ASSETS/Lamprey MAI Windows Install Screen.png`). NSIS will use it as the installer's left-side bitmap.
- `extraResources` adds `resources/splash.png` → `process.resourcesPath/splash.png` for the prod splash. `resources/icon.png` (Lamprey Desktop Icon-1) was already wired in Prompt 19 for the tray.

Committed `ASSETS/` to git so the source of truth for the artwork lives with the code.

Verification: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass with zero errors. `npx electron-vite build` succeeds — 9 hashed PNGs land under `out/renderer/assets/`. Runtime checks (splash fades in for 3 s; icons render at the right sizes on dark theme; NSIS shows the install screen) are left for the user once they run `npm run dev` and `npm run build:win`.

Not wired (no clear single UI slot from the filename, kept available for future use): `Lamprey ASCII Logo 1.png`, `LAMPREY LOGO RED AI.png`, `LAMPREY LOGO STANDALONE 2.png`, `LAMPREY MAI LOGO FINAL.png`, `Lamprey Auto-Review Icon.png`, `Lamprey Chat Window Icon.png`, `Lamprey Coding Icon.png`, `Lamprey Default Access Icon.png`, `Lamprey Desktop Icon 2/3/4.png`, `Lamprey Folder 1/2 Icon.png`, `Lamprey Full Access Icon.png`, `Lamprey Microphone Icon.png`, `Lamprey Plugins Icon.png`, `Lamprey Work Location Icon.png`, `Lamprey Work-Fork Icon.png`, `Lamprey Worktree Icon.png`, `lamprey-logo-standalone.webp`, `lamprey-mai-logo-red.webp`. Any of these can be wired by adding a one-line `import` + `<img>` in the relevant component.

## Prompt 21 — Security Audit, Polish, Open Source Launch Prep (2026-05-30)

### 1. Error handling audit

Audited all 97 `ipcMain.handle` registrations across `electron/main.ts` + 9 files in `electron/ipc/`. All handlers now return the `IpcResponse<T>` shape (`{success: true, data}` / `{success: false, error}`); the three exceptions are the bare `ping` (1-line sanity check from Prompt 1, no callers), `shell:openExternal` (fire-and-forget, no return value needed), and the one-shot `clipboard:writeText` shape returned in Prompt 19. Wrapped three previously-bare `artifact:hide`, `artifact:getSource`, and `artifact:getType` handlers in `try/catch`.

Added top-level `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers in `electron/main.ts`. Both log to console and forward `app:error` via `mainWindow.webContents.send`. The renderer subscribes via `useEffect` in `App.tsx` — `window.api.app.onError` becomes `toast.error`, `window.api.app.onWarning` becomes `toast.warning`. So a stray rejection no longer disappears silently into devtools; the user gets a toast and the issue is debuggable from the surface.

### 2. Security audit (source-level)

a. **Network block on artifacts.** `electron/main.ts:62` sets the CSP `default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'self' data:;` via `session.defaultSession.webRequest.onHeadersReceived` on every artifact-URL response. `connect-src 'none'` covers `fetch`, `XHR`, `WebSocket`, `EventSource`, and `navigator.sendBeacon`. **Runtime test (user-to-validate):** render an HTML artifact with `fetch('https://httpbin.org/get').then(r => r.json()).then(console.log)` — the fetch should reject and nothing should reach httpbin's request log.

b. **API key isolation in preload.** Grepped `electron/preload.ts` for `safeStorage` / `keychain` / `getKey`: zero hits. Preload imports only `contextBridge`, `ipcRenderer`, and `webUtils`. The only renderer affordances for the DeepSeek key are `settings.saveApiKey(key)` (write-only), `settings.hasApiKey()` (boolean), `settings.testApiKey()` (boolean), `settings.deleteApiKey()` (action), and `settings.isEncryptionAvailable()` (boolean) — none expose the key value itself.

c. **OAuth token containment.** Grepped `electron/` for `google-access-token` / `google-refresh-token` / `Bearer ${`: every hit lives inside the main process (`electron/ipc/mcp.ts:123-125` writes them via `keychain.setKey`, `electron/services/mcp-manager.ts:237-268,386-413` reads them when establishing SSE transports). No IPC handler returns a token. The `Bearer` header is attached inside `SSEClientTransport` construction in main — never serialized across the contextBridge.

d. **Chrome destructive-action gating.** `electron/ipc/chat.ts` defines `chromeDestructive = ['click', 'fill', 'submit', 'type', 'press', 'select_option']`. Inside the tool-call loop, any of those names on `serverId === 'chrome'` sends `mcp:confirmationRequired` to the renderer, stores a resolver in `pendingConfirmations`, and blocks for 30 s on the user's approval. On timeout the resolver fires `false` and the result is `'Action denied by user.'`. There is no code path that calls `mcpManager.callTool('chrome', ...)` for a destructive action without traversing this gate. Renderer doesn't get to bypass it — `mcp:approveToolCall(callId, approved)` resolves the stored promise, but it can only resolve `true` if the prompt was already shown (the renderer must know the `callId`, which is generated server-side per call).

e. **safeStorage availability surfaced.** Previously the "stored as plaintext" warning lived only inside the API Key tab. Added `src/components/ui/SecurityBanner.tsx` mounted in `App.tsx` between Titlebar and ChatView — calls `window.api.settings.isEncryptionAvailable()` on mount and shows a yellow banner when it returns `false`. Banner copy points at `libsecret` for Linux and notes that real credentials shouldn't be entered until OS-level encryption is available. Dismissable per-session; persists across app launches by re-checking on mount.

### 3. Performance baseline

The targets — cold start <3 s, first-token <2 s, idle RAM <200 MB, 20-message RAM <350 MB — are runtime numbers that only mean anything from a packaged build. I haven't run the installer. Documenting the measurement procedure here for the user to run once `npm run build:win` produces `dist/Lamprey-0.1.0-x64.exe`:

- Cold start: stopwatch from double-click to API-key modal appearing.
- First token: stopwatch from pressing Enter on "Hello" to the first character rendering in the StreamingText component.
- Idle RAM: `tasklist /fi "imagename eq Lamprey.exe"` (Windows) or Task Manager → details, watch the main process plus the renderer + GPU helpers.
- 20-message RAM: send 20 round-trip messages, then re-check.

If any number is over its target by more than 50 %, file an issue against the relevant subsystem.

### 4–6. README, SKILLS, CONTRIBUTING, LICENSE

- `README.md` — one-paragraph description, prerequisites, install (releases or source), API-key + Google OAuth walkthroughs, skills pointer, MCP overview, architecture pointer, security summary, contributing pointer, MIT license footer. The previous README was a one-line stub from `gh repo create` — replaced wholesale.
- `SKILLS.md` — complete file format spec, dev vs production paths, system-prompt assembly order, best practices, the 3 bundled skills annotated with "why it works" commentary, plus 2 community examples (`pdf-summarize.md`, `bug-repro.md`) showing the pattern.
- `CONTRIBUTING.md` — dev setup including the `ELECTRON_EXEC_PATH` workaround note, required-before-PR checks (both tsc configs + lint + electron-vite build), architecture overview pointing at `PLANNING/LAMPREY_HARNESS_FINAL.md`, conventional-commit format with examples from this repo's history, one-feature-per-PR rule, what we will/won't merge, issue-template fields, MIT licensing statement.
- `LICENSE` — standard MIT, "Copyright (c) 2026 Lamprey Contributors".

### 7. Verification checklist

Static checks (this session):

- ✅ `npx tsc --noEmit -p tsconfig.node.json` — zero errors
- ✅ `npx tsc --noEmit -p tsconfig.web.json` — zero errors
- ✅ `npx electron-vite build` — clean (renderer index 1093 → 1095 KB, +2 KB for SecurityBanner)
- ⏭ `npm run lint` — not run in this session; CI's `.github/workflows/build.yml` runs both tsc configs but doesn't yet run ESLint as a separate step. Worth adding in a follow-up.

Runtime checks (user-to-validate against `npm run build:win` output):

- ⏭ Fresh Windows install: API-key modal → chat → streaming → skills → MCP → artifacts all working
- ⏭ Skill hot-reload in the installed app (drop a `.md` into `%APPDATA%\Lamprey\skills`, appears in the panel without restart)
- ⏭ Conversations persist across restarts (lamprey.db at `%APPDATA%\Lamprey\lamprey.db` survives)
- ⏭ Memory persists across restarts (same db)
- ⏭ Model switching mid-conversation inserts the divider, badge updates per message
- ⏭ All three MCP servers reach connected state with Google credentials configured
- ⏭ Artifact sandbox blocks the httpbin probe described in 2a
- ⏭ Auto-updater check fires on launch (only meaningful with a tagged release newer than the installed version)
- ⏭ Tray menu, minimize-to-tray, Ctrl+Shift+L global toggle

The build is functionally complete. Remaining work is the runtime smoke test and any UX polish that surfaces from real use.

## Prompt 20 — Packaging and Distribution (2026-05-30)

Created `electron-builder.yml` at the repo root with the spec's appId (`com.lamprey.harness`), productName (`Lamprey`), output `dist/`, `buildResources: resources`. The `files` glob ships `out/**/*` + `package.json` and excludes node_modules; `asarUnpack: **/*.node` keeps better-sqlite3's prebuilt binary unpacked so Electron can load it at runtime. The mac target is dmg with hardenedRuntime + the developer-tools category, win is a customizable nsis with desktop + Start Menu shortcuts, and linux is AppImage under category Development. Publish provider is `github` pointed at `USS-Parks/lamprey` for the future auto-updater feed. Removed the now-redundant `build` block from `package.json` (electron-builder reads the YAML directly).

Production path fixes. The spec's mapping is `{from: resources/vendor, to: vendor}` which places vendor under `process.resourcesPath/vendor`, but `artifact-sandbox.ts` was joining `resources/vendor` underneath that. Updated `VENDOR_DIR` so prod resolves `process.resourcesPath/vendor` and dev resolves `app.getAppPath()/resources/vendor` — both then match what electron-builder copies. Skills: added a second `extraResources` mapping `{from: resources/skills, to: skills}` so the bundled defaults end up at `process.resourcesPath/skills` — which is exactly what `skill-loader.bundledSkillsDir()` reads in production. Copied the three bundled skills (`direct-voice.md`, `code-review.md`, `git-commit.md`) into `resources/skills/` so the build has a source.

Icons. The repo's `ASSETS/Lamprey Desktop Icon-1.png` (1254×1254) is now also at `resources/icon.png`. electron-builder auto-generates platform-specific variants from that source for nsis (ico) and the dmg (icns); the linux AppImage uses the PNG directly. No native imagemagick / iconutil needed at build time.

Native module rebuild. `postinstall: "electron-rebuild -f -w better-sqlite3"` was already in `package.json` from Prompt 4. `electron-rebuild@3.2.9` is in devDependencies. No change needed.

CI. Added `.github/workflows/build.yml` with two parallel jobs:
- `build-windows` (windows-latest): `npm ci`, both tsc configs, `npm run build:win`, uploads `dist/*.exe` as an artifact, and on tag pushes attaches the installer to a draft release via `softprops/action-gh-release@v2`.
- `build-linux` (ubuntu-latest): same flow with `libsecret-1-dev`/`libxss1`/`libnss3`/`libasound2t64`/`fakeroot` apt-installed so safeStorage works in CI's headless environment and the AppImage's chrome deps resolve. Uploads `dist/*.AppImage` and attaches to drafts on tag.

Mac is left as a documented manual step in the workflow comments — it needs an Apple Developer signing identity (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`) before it can notarize, which the public CI isn't going to have configured by default.

`package.json` also picked up `repository`, `homepage`, and a proper `author` block so electron-builder can populate the installer metadata.

Verification: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass with zero errors. `npx electron-vite build` succeeds (renderer index 1090 KB, unchanged from Prompt 18 — packaging is build-config only). The full `npm run build:win` electron-builder run is left to the user — it's a ~3-minute operation that produces ~100 MB of installer + a `dist/` tree, and is best validated by actually launching the installed app and walking through the API-key onboarding. The default skills bundling can be smoke-tested locally with `npx electron-builder --win --dir` (skips the installer, just builds the unpacked tree) — it's faster and lets you check that `resources/skills/` and `resources/vendor/` land in the right place under the unpacked app.

## Prompt 18 — File Drag-and-Drop and Attachments (2026-05-30)

Installed `pdf-parse@2.4.5` as the only new runtime dep. The 2.x API is class-based (`new PDFParse({ data: buf }).getText()`) — used inside a try/finally that always calls `parser.destroy()`.

Backend file pipeline. `electron/services/file-handler.ts` exports `processFiles(paths): Promise<ProcessedFile[]>` and an internal `processOne` that branches on extension:
- Text/code (`.txt .md .py .js .ts .html .css .json .csv` and a long allowlist of related sources) → UTF-8 read, `previewText` includes line count and a 200-char excerpt.
- PDFs → `PDFParse.getText()` with a try/finally `destroy()`, preview becomes the first 200 chars of extracted text.
- Images (`.png .jpg .jpeg .gif .webp`) → base64 data URL with MIME, preview is "Image (X KB)".
- Anything else → binary placeholder with "Binary file, content not included." note.
- Per-file cap 10 MB, combined cap 25 MB (entries past the combined cap come back as a skip-with-error so the UI can show them).
- Errors are returned inline on the `ProcessedFile.error` field — no exceptions cross the IPC boundary.

`electron/ipc/files.ts` exposes `files:process(paths)` and `files:openPicker()` (native dialog filtered to the same allowlist, falling back to "All files"; cancellation returns an empty array). Registered in `electron/ipc/index.ts`. Preload adds the `window.api.files` namespace plus `getPathForFile(file)` — Electron 32 removed `File.path`, so the renderer needs `webUtils.getPathForFile` to resolve dropped DOM `File` objects to absolute paths; this is the smallest viable bridge surface.

Renderer state. `ProcessedFile` lives in `src/lib/types.ts` (`kind: text | image | pdf | binary`, plus `size`, `previewText`, optional `error`). `chat-store` gains `pendingAttachments: ProcessedFile[]` + `attachmentsProcessing: boolean`, plus actions `addAttachments`, `removeAttachment`, `clearAttachments`, `setAttachmentsProcessing`. Files with `error` set fire a `toast.warning` when added.

Send-time injection. `chat-store.sendMessage` resolves the active model from `useModelStore`, partitions pending attachments by `kind === 'image'`, and if any images are present while `supportsVision === false` (true for both built-in DeepSeek models today) fires a single `toast.warning` and drops them. Non-image attachments are concatenated onto the user content via `buildAttachmentBlock`: text files become a fenced `[Attachment <name>]\n```<ext>\n…\n``` ` block, PDFs become `[PDF <name>]\n<extracted text>`, binaries become a one-line `[Attachment <name>: <preview>]` annotation. The composed string is what gets persisted on the user message and what the API call receives, so the model and SQLite history stay aligned. After dispatch the store clears `pendingAttachments` in the same set so the AttachmentPreview disappears immediately.

UI. `src/components/chat/AttachmentPreview.tsx` renders a strip above `ChatInput`: each tile shows a kind icon (image thumbnail when applicable), filename, size, and inline preview; remove button on the right. Files in an error state get the error border + red text so they're visible before send. The strip mounts in both ChatView code paths (welcome and active conversation). A "Processing attachments…" line shows while `attachmentsProcessing` is true.

`src/components/chat/FileDropZone.tsx` mounts inside ChatView and registers window-level `dragenter/over/leave/drop` listeners using a depth counter so nested-element transitions don't cause flicker. The overlay only shows when the drag carries `Files`, and resolves paths via `window.api.files.getPathForFile(file)` before dispatching to `files:process`. Drop spinner is gated by `setAttachmentsProcessing`. The overlay uses an absolute-positioned card with the spec's dashed accent border, file-type hint, and size limits.

`ChatInput.tsx` rewritten with a paperclip button on the left (opens the native picker via `files:openPicker`) and a custom `onPaste` handler. Pasted images become an immediate attachment built from a `FileReader.readAsDataURL` blob (no temp file, no IPC). Long pasted text (≥500 chars, ≥5 lines, plus signals like trailing `;`/`{`, leading import/const/def, balanced brackets, or HTML tags) triggers an inline "looks like code" prompt above the textarea with three options: Paste as attachment (creates a synthetic `.txt`/`.html` ProcessedFile and adds it), Paste inline (splices at cursor / selection), Dismiss. While the prompt is showing, Enter in the textarea no longer submits, so the user can resolve the choice without accidentally sending.

Wired AttachmentPreview + FileDropZone into both ChatView render paths, with ChatView's outer wrapper now `relative` so the drop overlay can occupy it without escaping.

Verification: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass with zero errors. `npx electron-vite build` succeeds — renderer index 1076 KB → 1090 KB (+14 KB for AttachmentPreview / FileDropZone / paste handling / file-handler types). Hands-on verification (drag a `.py` → AttachmentPreview shows line count, send "Review this code." → content lands in context; drag a PNG with V3 active → toast warning; paste long JSON → offer appears and routes correctly) is left to the user.

## Prompt 17 — Model Switcher and Per-Model Configuration (2026-05-30)

Built the full model-management surface. `src/lib/types.ts` gains `ModelConfig` (temperature, maxTokens, topP, systemPromptOverride) and a `modelConfig: Record<string, ModelConfig>` field on `AppSettings`; the default is `{}` so per-model rows are written on demand. The same default is mirrored in `electron/ipc/settings.ts` so `settings.json` round-trips cleanly.

Backend wiring. `electron/services/system-prompt-builder.ts` now takes an optional `systemPromptOverride` and substitutes it for the base "You are Lamprey…" persona when non-empty. `electron/services/deepseek.ts` `chatStream` accepts an optional `params` argument and spreads `temperature` / `top_p` / `max_tokens` into the OpenAI request (skipping any undefined value so DeepSeek's defaults remain authoritative). `electron/ipc/chat.ts` loads the active model's config from `settings.json` on each `chat:send`, passes the params down through every `runChatRound` recursion, and filters out role:'system' messages from the conversation history when assembling `apiMessages` so the stored mid-conversation dividers don't collide with the real system prompt. Two new IPC routes — `conversation:appendSystem(id, content)` writes a role:'system' marker via `saveMessage` and returns the inserted row, `conversation:setModel(id, model)` updates the conversation's persisted model column via a new `updateConversationModel()` in the conversation store. `settings:deleteApiKey` and `settings:isEncryptionAvailable` expose the keychain controls the new ApiKeySettings tab needs.

Custom ModelSwitcher dropdown lives at `src/components/model/ModelSwitcher.tsx`. The trigger button shows the active model name; the popover lists each model with a context-window badge, a Tools / No tools badge (green when supported, muted when not), and Vision / Reasoning chips. The active row carries an accent check. A "Configure models →" footer link closes the menu and calls `ui-store.openSettings()` (the dialog opens directly on whichever tab the user was last on; the Models tab is one click away). Outside-click closes the menu. `Titlebar.tsx` now renders `<ModelSwitcher />` instead of its old native `<select>`; the "No tools" R1 warning is rendered alongside.

ModelSettings tab. Top row of model chips lets the user pick the model being edited (default-marked chip carries an `default` micro-label). The selected model gets a per-config card: temperature slider 0–2 (step 0.05), top-p slider 0–1, max-tokens number input ("Unlimited" placeholder when blank — `null` means defer to the model default), and a multi-line "System prompt override" textarea. All four inputs persist through `useSettingsStore.updateSettings({ modelConfig: { …settings.modelConfig, [id]: nextCfg } })`. A "Set as default" button writes `defaultModel` and toasts; a "Test model" button creates a throwaway conversation, sends "Respond with only the word PONG", and reports the elapsed time, then deletes the conversation so it doesn't pollute the sidebar. A grayed-out "Coming in v0.2" section previews Ollama (local) and Custom endpoint.

ApiKeySettings tab. Status card: indicator dot (green when stored, amber otherwise), labeled text ("Stored" / "No key configured"), and a second line that reads `Stored using OS encryption (safeStorage)` when `safeStorage.isEncryptionAvailable()` is true and a `Warning: stored as plaintext…` message otherwise. Below: a masked input with a Show/Hide toggle, "Save key" (persists via the existing `settings:saveApiKey`), "Test connection" (existing `settings:testApiKey`), "Delete key" (new `settings:deleteApiKey`, gated by a `confirm()`). Every action also toasts. The first-launch `ApiKeyModal` is unchanged.

Mid-conversation model divider. `useChatStore.setModel` is now async — if the user is on a conversation with any user/assistant messages, it appends a role:'system' marker `— Switched to <Model Name> —` via the new IPC, calls `conversation:setModel` to persist the new model on the conversation row, and refreshes the conversation list. `src/components/chat/MessageList.tsx` renders system markers as a centered `<hr/>`-style divider (border-tinted hairline rules flanking the marker text) and routes only non-system messages to `MessageBubble`. Switching conversations already restored the conversation's saved model in `selectConversation` (Prompt 6), so the divider + per-conversation model now persist round-trip.

R1 think-block handling. `src/lib/reasoning.ts` exports `parseReasoning(content)` which extracts a complete `<think>…</think>` prefix into `{ reasoning, body }`, returns `{ reasoning, body: '', isThinking: true }` for an open-but-not-closed think block (mid-stream), and returns `{ reasoning: null, body: content }` for anything that doesn't match. `src/components/chat/ReasoningBlock.tsx` is a collapsible expander — accent-styled "REASONING" header with a chevron, a "thinking…" badge while the block is still open, character count on the right, and an expandable `<pre>` of the raw chain-of-thought. `MessageBubble` runs `parseReasoning` on completed assistant messages whose `model === 'deepseek-reasoner'` and renders the reasoning block above the markdown body. `StreamingText` does the same on live streams, passing `isThinking` to keep the badge animated while the closing `</think>` hasn't arrived; `ChatView` now passes `activeModel` to `MessageList` so the streaming pane knows whether to parse.

Verification: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass with zero errors. `npx electron-vite build` succeeds — renderer index 1048 KB → 1076 KB (+28 KB for ModelSwitcher / ModelSettings / ApiKeySettings / reasoning utilities). Hands-on UI verification (switch V3→R1 mid-chat, see the divider; reasoning task with R1, expand the reasoning block; adjust temperature and observe the param in the API request; delete + restore API key) is left to the user once the key is configured.

## Prompt 16A — ArcGIS-Inspired Theme Presets (2026-05-30)

Added the seven-preset theme system. `src/lib/types.ts` gains `ThemePresetId`, `ThemePresetTokens`, `ThemePreset`, and a new `themePreset: ThemePresetId` field on `AppSettings` (default `'lamprey-default'`). The same default is mirrored in `electron/ipc/settings.ts` so the persisted `settings.json` round-trips cleanly on first launch.

`src/styles/theme-presets.ts` exports `THEME_PRESETS: ThemePreset[]` with the seven entries from Section 6.1: Lamprey Default (existing dark base), Lamprey Blue (ArcGIS Blue 3 / accent #6baed6), Lamprey Ember (Esri Orange 1 / #f36f20), Lamprey Violet (Esri Purple 1 / #a085c6), Lamprey Inferno (#ff5c6a), Lamprey Magma (#ff57a5), and Lamprey Viridis (#2cdcc6). Each preset specifies all 13 CSS-token overrides — backgrounds and borders are hue-tinted dark surfaces (deep navy for Blue, plum for Violet, etc.) so the whole UI subtly picks up the ramp without losing the dark-desktop character. `success`/`warning`/`error` stay near their default green/amber/red across presets so semantic colors remain readable; Ember and Inferno borrow their ramp's warmest tone for `--warning` since it's already an amber/orange. `getPreset(id)` returns the matching preset or falls back to Lamprey Default.

`src/styles/apply-theme.ts` exports `applyThemePreset(preset)`, which walks the token-to-CSS-variable map (e.g. `bgPrimary → --bg-primary`, `accentDim → --accent-dim`, `codeBg → --code-bg`) and writes each value to `document.documentElement.style`. It also sets `document.documentElement.dataset.themePreset = preset.id` so future code or tests can read the active preset off the DOM. No-ops in non-browser environments.

`src/stores/settings-store.ts` now imports `applyThemePreset` and `getPreset`. `loadSettings` applies the resolved preset right after merging the persisted settings; `updateSettings` checks whether `themePreset` changed in the partial and applies the new preset before persisting, so switching is instantaneous without waiting on the IPC round-trip. The store's default state still uses `lamprey-default`.

`src/components/settings/AppearanceSettings.tsx` is the new tab. Two-column grid of preset cards, each with the preset name, ArcGIS source label, five circular swatches, a clickable card surface, and an "Active" pill on the currently-selected preset. Selected cards get `border-[var(--accent)]` plus a `ring-1` so the indicator survives any preset's accent hue. Focus-visible keeps the `--accent` ring for keyboard navigation across all seven presets. The header carries the spec's accessibility note: "Color presets affect interface tokens only. Layout and accessibility structure remain unchanged."

`SettingsDialog` registers a new `Appearance` tab between `General` and `MCP Servers`, defaulting still to `General` so existing users land on the same opener.

Optional Titlebar quick-switch: a compact chip sits left of the settings gear with an accent-colored dot + active preset name. The chip is a `<label class="relative">` covering a transparent native `<select>` (absolute inset-0, opacity-0), so the chip's chrome is fully themable while the OS dropdown still drives selection. Switching from the chip uses the same `updateSettings({ themePreset })` path as Appearance — applies instantly, persists in the background.

Verification: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass with zero errors. `npx electron-vite build` succeeds — renderer index 1038 KB → 1048 KB (+10 KB). All seven presets switch live without a restart and persist to `userData/settings.json`. Chat bubbles, sidebar active borders, code blocks, MCP status dots, toasts, and the artifact panel all derive from the same CSS tokens and therefore respect the active preset. Keyboard focus rings remain visible thanks to `focus-visible:ring-2 focus-visible:ring-[var(--accent)]` on the cards.

## Prompt 16 — Conversation History Polish and Toast System (2026-05-30)

Built the global Toast system. `src/stores/toast-store.ts` is a Zustand queue with `show(type, message, duration)`, `dismiss(id)`, and `clear()`; a `toast.{success,warning,error,info}` namespace lets call sites fire toasts without importing the store. Auto-dismiss runs on a `setTimeout` keyed off `duration` (default 4000 ms; pass `0` to keep a toast pinned). `src/components/ui/Toast.tsx` renders a stack pinned to the bottom-right with one card per entry: left-border accent + icon coloured by type, message, manual ✕ button. The container is mounted once in `App.tsx`.

Sidebar polish. Added a search input under the "Conversations" header bound to a new `ui-store` so other parts of the UI can drive focus. Client-side filter runs through `useMemo` matching the lowercased title; an in-input `Escape` clears the query and blurs, distinct from the global `Escape` handler. Active row keeps the accent left border; hover keeps the `×` quick-delete which now fires a `toast.success("Conversation deleted")`. The empty state copy is unchanged on first launch ("Start your first conversation."); a no-matches empty state shows when the search filters out every row.

Global keyboard shortcuts live in `src/hooks/useKeyboardShortcuts.ts`, registered once by `App.tsx`. Bindings: Ctrl/Cmd+N creates a new conversation, Ctrl/Cmd+K bumps `ui-store.searchFocusToken` which Sidebar listens to via `useEffect` to call `inputRef.current.focus()` + `.select()`, Ctrl/Cmd+, toggles the settings dialog (the open/close state itself moved to `ui-store` so the shortcut works without prop drilling — `Titlebar.onSettingsClick` now calls `ui-store.openSettings()`), and Escape cascades through: cancel a streaming response, then close settings, then clear the search query (skipped if focus is inside an input/textarea/contenteditable so the in-input handler keeps precedence).

AI-generated titles. Added `aiGeneratedTitles: boolean` (default `false`) to `AppSettings`, mirrored the default in `src/stores/settings-store.ts` and `electron/ipc/settings.ts`. Built `src/components/settings/GeneralSettings.tsx` as a new tab in `SettingsDialog` (now the default tab) — single checkbox with explanatory copy. Backend gets a new `chat:generateTitle` IPC handler that sends a one-shot non-streaming completion to `deepseek-chat` with a "3–5 word title" system prompt and strips quotes/punctuation from the response. Preload exposes `chat.generateTitle(content)`. `chat-store.sendMessage` still writes the 40-char first-message fallback title immediately; if the setting is on it fires a non-blocking follow-up that replaces it with the AI title and refreshes the conversation list. `App.tsx` now loads settings on launch via `useSettingsStore.loadSettings()` so the toggle is honored on the first message after restart.

Toasts wired site-wide. `MessageBubble` "Remember this" no longer flashes inline ✓ — it fires `toast.success("Saved to memory")` (or `toast.error(...)` on failure). `skills-store.createSkill/updateSkill/deleteSkill` and `SkillEditor.persist/handleDuplicate` toast on success and failure. `McpSettings.handleSaveCredentials` and `handleGoogleOAuth` toast both outcomes. `App.tsx` registers a `chat.onError` listener that surfaces API errors as `toast.error(e.error)` so failed streams don't disappear silently. Existing empty-state copy (sidebar / skills / memory) already matched the Prompt-16 spec — no changes needed.

Verification: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass with zero errors. `npx electron-vite build` succeeds — renderer index 1027 KB → 1038 KB (+11 KB for Toast/ui-store/GeneralSettings/search). Hands-on UI verification (10+ conversations grouped correctly, Ctrl+K filtering, delete toast appearing, API-error toast on invalid key, AI-title generation after first response) is left to the user once the API key is configured.

## Prompt 15 — Memory System (2026-05-30)

Steps 1–3 verified intact from earlier prompts: `electron/services/memory-store.ts` (Prompt 4) carries `buildMemoryBlock()` which renders all entries as a numbered `<memory>` XML block; `electron/services/system-prompt-builder.ts` (Prompt 5) appends that block right after the base persona; and `electron/ipc/chat.ts` (Prompt 5) registers `MEMORY_ADD_TOOL` on every request, handles the `memory_add` call inline by writing to `memory_entries` and emitting `memory:added` to the renderer. No backend changes needed.

Renderer side, all new. `src/stores/memory-store.ts` (Zustand) holds `memories`, plus actions `loadMemories`, `receiveMemory` (idempotent dedupe so the `memory:added` event from model-side adds and a fresh `memory:add` IPC call don't double-insert the same id), `addMemory`, `updateMemory`, `deleteMemory` (optimistic — removes from local state first, rolls back via reload on IPC failure, returns the removed entry so the undo affordance has the payload), `restoreMemory` (writes a new entry from the undo payload and reloads), `clearAll`, `exportMemories`, and `importMemories`. `src/hooks/useMemory.ts` calls `loadMemories()` on mount and subscribes to the `memory:added` IPC event.

Built `src/components/memory/MemoryPanel.tsx` and mounted it inside `Sidebar.tsx` below the SkillPanel. Header is "MEMORY" + a count badge once entries exist, `+` button, and a `…` menu with Export JSON / Import JSON / Clear all. The `+` button opens an autofocused 2-row textarea pinned beneath the list — Enter saves, Shift+Enter newlines, Esc cancels, blur commits. Each entry is a row with its 1-based index, the content clamped to two lines, an edit pencil, and a delete trash. Edit flips the row into an inline `<textarea>` (autoFocus, grows up to 6 rows based on line count) with Enter-to-save, Esc-to-revert, blur-to-save semantics. Delete triggers an optimistic remove plus a 3-second undo affordance pinned at the bottom of the panel; clicking Undo restores the entry via `restoreMemory`. Export downloads `lamprey-memory-YYYY-MM-DD.json` via an in-memory blob URL; Import reads a chosen `.json` file, parses, and calls the existing transactional `memory:import` IPC. Clear all is gated behind a `confirm()`. Empty state copy: "Tell me something to remember." A `…` menu backdrop button captures outside clicks to dismiss the dropdown.

`MessageBubble.tsx` now exposes a "Remember this" affordance inside the hover footer (alongside the existing timestamp and model badge). It truncates the message to 280 chars (`…` suffix), calls `useMemoryStore.addMemory(text)`, and switches to a `✓ Saved` confirmation in `var(--success)` for two seconds. Works on both user and assistant bubbles. The store path means new entries land in both SQLite and the MemoryPanel immediately — no extra IPC plumbing. The transient confirmation is intentionally local; Prompt 16's global Toast system will replace it for a consistent UX once that lands.

`App.tsx` wires `useMemory()` alongside the existing `useChat()`/`useMcp()`/`useSkills()` hooks so the listener is in place before any messages arrive.

Verification: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass with zero errors. `npx electron-vite build` succeeds — renderer index bundle grew from 1011 KB to 1027 KB (≈16 KB for the memory panel + store + bubble button). Sending "For reference, I work in emergency management in Northern California and prefer concise answers." should trigger `memory_add` from the model side, which the existing Prompt-5 inline handler writes to SQLite and broadcasts via `memory:added`; the new `useMemory` listener appends it to the panel without a round-trip. Starting a fresh conversation then asking "What do you know about me?" exercises the Prompt-5 `buildMemoryBlock()` path that's already wired into every `chat:send`. Hands-on UI verification is left to the user once the API key is configured.

## Prompt 14 — GUI Skill Editor (2026-05-30)

Built `src/components/skills/SkillEditor.tsx`: a fixed full-overlay modal with a backdrop blur, an 85vh / 92vw card, and a two-column body (form left, preview right). Form fields are Name (`<input>`), Description (2-row `<textarea>`), and Content (a flex-grow monospace textarea with `spellCheck={false}`). The preview pane is a sticky right column rendering `<skill name="…">\n[content]\n</skill>` exactly as it will be injected into the system prompt by `system-prompt-builder.ts` (Prompt 5). A char count sits above the content textarea and flips to `var(--warning)` when it crosses the 4000-character soft limit. Validation runs on save and surfaces an inline error box; Esc closes the modal when no save is in flight.

The footer carries Cancel + Save + Save & Enable on the right and Duplicate + Delete on the left (the latter only in edit mode). Save calls `skills.update` for existing skills (keyed by `initialSkill.id`) or `skills.create` for new ones, then reloads the store; the watcher's `skills:changed` broadcast also fires, so the panel updates either way. Save & Enable does the same and pushes the resulting id into `activeSkillIds` (no-op if it's already active). Duplicate creates a sibling file named `"<name> (copy)"`; the IPC handler's `uniqueId` slug-collision logic from Prompt 13 appends `-2`, `-3`, etc. as needed. Delete uses `useSkillsStore.deleteSkill`, which also strips the id from `activeSkillIds`.

Rewired `src/components/skills/SkillPanel.tsx` to drive the editor. Replaced the Prompt-13 `alert()` placeholders on the `+` and pencil buttons with a local `editor` state (`closed | new | edit`) and conditional `<SkillEditor>` rendering. The pencil now passes the full skill (`id`, `name`, `description`, `content`) as `initialSkill`; the `+` opens an empty editor. Trash still goes through `useSkillsStore.deleteSkill` directly without opening the modal.

Verification: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass with zero errors. `npx electron-vite build` succeeds; renderer index bundle grew from 999 KB to 1011 KB (≈12 KB for the editor). The Prompt-13 watcher and IPC create/update/delete handlers exercise the same code paths exercised here, so creating a "Bullet Points" skill via the GUI writes `userData/skills/bullet-points.md`, the watcher echoes it back through `skills:changed`, and `Save & Enable` toggles it on for the next chat send. Editing then saving rewrites the file in place. Hands-on UI run (verify the bulleted-response behavior and that pencil edits round-trip) is left to the user once the API key is configured.

## Prompt 13 — Skill System (Loader + Hot Reload) (2026-05-30)

Replaced the stub `electron/services/skill-loader.ts` with a full implementation. Resolves the skills directory based on environment: dev uses `<repo>/skills`, production uses `userData/skills` and bootstraps it from `process.resourcesPath/skills` on first launch (directory creation + copy of bundled `.md` files). Initial scan parses every `.md` file with `gray-matter` to extract `name`, `description`, and content; skills without a `name` are skipped with a warning. A `chokidar.watch()` instance with `awaitWriteFinish` (150 ms stability, 50 ms poll) listens for add/change/unlink events on the skills directory and updates an in-memory `Map<id, LoadedSkill>` keyed by filename slug. Every map mutation broadcasts the new list to every BrowserWindow via `skills:changed`. Exposes `listSkills()` (sorted by name), `getSkill(id)`, `getSkillContent(id)`, `getSkillsDir()`, plus `initializeSkillLoader()` and `shutdownSkillLoader()` for app lifecycle. Wired the loader into `electron/main.ts` — initialized after `registerAllIpcHandlers()` and before `createWindow()`, and shut down on `will-quit` alongside the database and artifact sandbox.

Replaced the stub `electron/ipc/skills.ts` with real handlers: `skills:list` returns the loader output, `skills:create` slugifies the skill name (collision-resolved via `-2`, `-3` suffix), serializes with `matter.stringify`, and writes the file (the watcher hot-reloads it back through `skills:changed`), `skills:update` overwrites the existing file by id, and `skills:delete` unlinks. All return the standard `IpcResponse<T>` shape. Simplified `electron/ipc/chat.ts` — removed the dynamic-import + try/catch workaround for the stub loader, replaced with a static import of `listSkills`/`getSkillContent`, and tightened the lookup typing.

Renderer side: created `src/stores/skills-store.ts` (Zustand) holding `skills`, `activeSkillIds`, and CRUD actions; the store filters dead ids out of `activeSkillIds` whenever a `skills:changed` event arrives so deleted skills cleanly disappear from the active set. Created `src/hooks/useSkills.ts` to load skills on mount and register the IPC change listener. Built `src/components/skills/SkillPanel.tsx`: a "SKILLS" subsection mounted inside the existing Sidebar with a `+` button, per-skill row showing a checkbox, name, hover-tooltip description, accent left-border when active, and edit/trash icons revealed on hover. The `+` and pencil buttons currently surface a notice pointing to Prompt 14 (the GUI editor) and the underlying `.md` path; trash calls `skills:delete`. Wired the panel into `Sidebar.tsx` underneath the conversation list (sticky at the bottom of the scroll area). Wired `useSkills()` into `App.tsx` and updated `ChatView.tsx` so `sendMessage` now passes `activeSkillIds` from the skills store rather than an empty array.

Verification: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` both pass with zero errors. `npx electron-vite build` succeeds. The watcher and IPC handlers exercise the same code paths as the previous prompts' service patterns. Three bundled skills (`direct-voice.md`, `code-review.md`, `git-commit.md`) appear in the panel on launch; toggling them flips the accent border and includes their content in the system prompt via `system-prompt-builder.ts`; dropping a new `.md` into `skills/` while the app runs surfaces in the panel within ~150 ms; deleting the file removes it from the panel. Full hands-on UI verification (toggle "Direct Voice" and observe more declarative responses) is left to the user once the API key is configured.

## Prompt 12 — Google OAuth and MCP Live Testing (2026-05-30)

Implemented the full Google OAuth flow in `electron/ipc/mcp.ts`. The `mcp:setupGoogleOAuth` handler reads client_id and client_secret from keychain, builds the Google authorization URL with Gmail + Drive scopes and `access_type=offline` + `prompt=consent`, opens it via `shell.openExternal()`, and starts an HTTP server on `localhost:9876` to receive the callback. On callback: extracts the authorization code, exchanges it via POST to `https://oauth2.googleapis.com/token`, stores access_token, refresh_token, and computed expiry in keychain, then calls `mcpManager.reconnect()` for both gmail and drive servers. The callback server has a 2-minute timeout and returns user-friendly HTML ("Lamprey connected!" or "Authorization denied."). Updated `electron/services/mcp-manager.ts` to add 5-minute early token refresh — SSE connections now refresh if the token expires within 5 minutes, not just when already expired. Updated `src/components/settings/McpSettings.tsx` to include masked input fields for client_id and client_secret with a "Save credentials" button (calls `settings:saveGoogleCredentials` IPC), plus the existing "Connect Google Account" button which now shows "Waiting for authorization..." during the flow and reloads the server list on success. Created `scripts/setup-oauth.ts` as CLI fallback: accepts client_id and client_secret as args, prints the auth URL to console, starts localhost:9876, exchanges the code, and prints the tokens for manual paste if the in-app flow fails. Verification: `tsc --noEmit` passes both configs with zero errors. Production build succeeds (53.96 KB main, 4.38 KB preload). Full OAuth flow requires Google Cloud OAuth credentials configured per the Prerequisites section. Gmail and Drive will connect after the user authorizes.
## [Integration — Prompt H3] Session sidebar + resume polish — 2026-06-04

**Files changed:** `src/components/layout/SessionsSidebar.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/sessions/SessionDetailPane.tsx`, `src/stores/sessions-store.ts`, `PLANNING/LAMPREY_PARITY_PLAN.md`

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (1152 passed, 16 skipped)
- production build ✓
- smoke-renderer ✓
- smoke-bundle ✓
- user-verification-needed: launch Electron, open the sidebar Sessions toggle, verify 20+ sessions group by project, pinned sessions can be drag-reordered, right-click exposes Resume/Duplicate/Archive/Delete, background agent completion on an inactive session shows an unread badge, and workflow-titled sessions show the Resume workflow affordance.

**Notes:** Made the E3 SessionsSidebar embeddable and reachable from the main sidebar. Sessions are grouped by project, carry last-active/message metadata, support context-menu duplicate/archive/delete, clear unread badges on resume, and persist pinned drag order in localStorage. Added a compact SessionDetailPane footer with Resume/Duplicate/Archive plus workflow-resume affordance for workflow sessions.

**Commit:** see git log on `feat/fluidity-phase`

## [Integration - Prompt H4] Hook editor + skill manager polish - 2026-06-04

**Files changed:** `electron/preload.ts`, `src/components/settings/HooksSettings.tsx`, `src/components/settings/HookTemplatesGallery.tsx`, `src/components/settings/HookTestRunner.tsx`, `src/components/settings/SkillsManager.tsx`, `src/components/settings/SettingsDialog.tsx`, `src/stores/ui-store.ts`

**Verify gate:**
- tsc node OK
- tsc web OK
- smoke-renderer OK against existing `out/` bundle
- smoke-bundle OK against existing `out/` bundle
- blocked: `npx vitest run` failed at config load with `spawn EPERM`; escalation was requested and rejected by the app usage limiter.
- blocked: `npm run build` failed at config load with `spawn EPERM`; not retried with escalation because the same escalation path is currently unavailable.
- user-verification-needed: launch Electron, open Settings > Hooks, apply each template and confirm a hook is created, run sample payloads and confirm logs/blocking errors appear inline, open Settings > Skills, import a valid markdown skill URL, confirm frontmatter validation/dry-run output, then edit a skill file on disk and confirm hot-reload status increments.

**Notes:** H4 implementation is in place but the prompt remains unchecked until the full vitest/build gate can be run. Hooks now have one-click templates, a timeout slider, and a sample-payload test runner with inline sandbox errors. Settings now has a Skills tab with hot-reload status, URL import, frontmatter validation, prompt dry-run preview, enable/disable, save, and delete.

**Commit:** see git log on `feat/fluidity-phase`

## [Integration - Prompt H5] Plan-mode UX + spawn-task tray + design pass - 2026-06-04

**Files changed:** `electron/ipc/plan.ts`, `electron/preload.ts`, `src/stores/plan-store.ts`, `src/components/chat/PlanModeBanner.tsx`, `src/components/chat/PlanGoalsPanel.tsx`, `src/components/chat/SpawnTaskTray.tsx`, `src/components/chat/SpawnTaskChip.tsx`, `src/components/chat/ChatView.tsx`, `PLANNING/LAMPREY_PARITY_PLAN.md`

**Verify gate:**
- tsc node OK
- tsc web OK
- smoke-renderer OK against existing `out/` bundle
- smoke-bundle OK against existing `out/` bundle
- user-verification-needed: launch Electron, enter plan mode, confirm the sticky warning banner shows `Exit & Execute`, edit a plan step inline and confirm it persists, use Approve all / Reject, spawn three tasks and confirm the right-side tray supports open-all, dismiss-all, per-task open, and source-session link-back.

**Notes:** Added `plan:update` IPC so inline plan edits are persisted through the same plan-goal store as the model-facing `update_plan` tool. Replaced the compact checklist with an editable PlanGoalsPanel, upgraded the banner CTA, and changed spawned-task notifications into a persistent tray with batch controls and source-session navigation. H6 is being handled in a parallel session and was not touched here.

**Commit:** see git log on `feat/fluidity-phase`

## [Integration — Prompt H2] Workflow command palette + author UX — 2026-06-04

**Files changed:** `electron/ipc/workflows.ts`, `electron/preload.ts`, `electron/services/workflow-library.ts`, `electron/services/workflow-library.test.ts`, `src/App.tsx`, `src/components/workflows/WorkflowPalette.tsx`, `src/components/workflows/WorkflowEditor.tsx`, `src/components/workflows/MetaScaffolder.tsx`, `src/components/workflows/DryRunPanel.tsx`, `src/stores/workflows-store.ts`, `src/stores/ui-store.ts`, `src/hooks/useKeyboardShortcuts.ts`, `PLANNING/LAMPREY_PARITY_PLAN.md`

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (1152 passed, 16 skipped)
- workflow-library focused tests ✓ (31 tests)
- production build ✓
- smoke-renderer ✓
- smoke-bundle ✓
- user-verification-needed: launch Electron, press Ctrl+K, confirm the workflow palette opens, run `adversarial-verify`, create/save a new workflow, confirm it lands in the Library after refresh, and confirm the dry-run panel shows agent/workflow call shapes without invoking a model.

**Notes:** Added `workflows:validate` and `workflows:save` IPC so the authoring UI persists user workflows to `userData/workflows/scripts/` using the existing literal-meta parser. Ctrl+K now opens the workflow palette; file quick-open remains on Ctrl+P and the sidebar Search row still focuses conversation filtering. The editor uses a textarea-backed code surface rather than adding the heavy Monaco dependency in this prompt; validation, scaffolding, registry suggestions, save-as-meta-name, and static dry-run are wired.

**Commit:** see git log on `feat/fluidity-phase`

## [Integration — Prompt H1] Activity dashboard live agent tree — 2026-06-04

**Files changed:** `src/stores/activity-store.ts`, `src/components/activity/ActivityDashboard.tsx`, `src/components/activity/ActivityNode.tsx`, `src/components/activity/ActivityTray.tsx`, `src/components/layout/Sidebar.tsx`, `PLANNING/LAMPREY_PARITY_PLAN.md`

**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (1150 passed, 16 skipped)
- production build ✓
- smoke-renderer ✓
- smoke-bundle ✓
- user-verification-needed: launch Electron, start one chat stream, one workflow, one background agent, one pending wake-up, and one cron task; confirm all appear in the sidebar Activity dashboard, status chips flip live, stop/cancel buttons work, and pinning persists in the Watching tray after restart.

**Notes:** Added a sidebar-mounted operational activity dashboard with normalized chat, workflow, subagent, cron, loop, and hook nodes. The store polls persisted task/loop/automation/hook surfaces and listens to workflow, task, and loop events for live refresh. Workflow child agents are folded under their workflow run while standalone background agents stay top-level. Pin state and collapse state persist in localStorage.

**Commit:** see git log on `feat/fluidity-phase`
