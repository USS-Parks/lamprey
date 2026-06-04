# Lamprey Fluidity Phase — Sequential Prompt Roster

**Goal:** close the **micro-interaction gap** between Lamprey and Claude Code so the harness feels like a single moving surface rather than an app with screens. Functional parity is complete (Tracks 1–3 + Integration Phase H1–H6 shipped). What remains is **flow, reflex, and visual restraint** — the things that make Claude Code "thinkable" rather than "navigable."

**Execution model:** **single session, single worktree off `main`, sequential J1 → J11.** No track-splits — every prompt builds on the previous one's transcript / input-bar / store changes.

**Companion to:** [`LAMPREY_PARITY_PLAN.md`](LAMPREY_PARITY_PLAN.md) (the prior 36-prompt build + H1–H6 integration phase, all shipped).

---

## 0. SESSION BOOTSTRAP — READ THIS FIRST

You are a fresh Claude Code session handed this document. Before doing anything else:

### Step 1 — Confirm environment

Verify:
- Working directory is `C:\Users\17076\Documents\Claude\Lamprey Harness` (or a worktree thereof).
- Current branch is **not** `main` — set up `feat/fluidity-phase` as a worktree off `main` first if it doesn't exist (per `feedback_parallel_session_worktree` memory).
- `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both pass cleanly *before* you start.
- `npx vitest run` exits 0.

If any of those fail, halt and report. Do not start on a broken baseline.

### Step 2 — No track question

Unlike the parity plan, this is a single linear phase. **Do not ask the user which track** — there is only one path. Confirm with the user that you're starting the Fluidity Phase and proceed.

### Step 3 — Execute J1 → J11 without stopping

1. **Do not ask further questions** unless a prompt requires a decision only the user can make (a real architectural fork the plan doesn't resolve, or a genuine blocker).
2. **For each prompt, in order:**
   a. Read the "Files (net new / modified)" list. Read the existing files first to ground the change in the real component shape — these prompts edit shipped code, not greenfield.
   b. Implement the change. Edit existing files in place; create new ones only when the prompt calls for them.
   c. Run the **verify gate** (the "Verify" column). Always: both tsc configs + relevant unit tests. UI-touching prompts also list manual smoke steps — execute them via the preview tools (`mcp__Claude_Preview__*`) when they touch the renderer. Electron-shell-only smoke steps are written into DEVLOG and explicitly marked **"user-verification-needed"** rather than claimed (see `feedback_no_fake_polish` memory).
   d. If verify fails: fix and retry up to **2 times**. On the third failure, halt, write a "blocked" entry to `DEVLOG.md` with the failure context, report to the user.
   e. If verify passes: mark the prompt `[x]` in this document via `Edit`, write a DEVLOG.md entry (see Step 4), then commit (do not push — user pushes per CLAUDE.md).
   f. Move to the next prompt.
3. **Do not push to GitHub.** One commit per prompt. The user reviews and pushes.
4. **When all 11 prompts complete:** write a final phase-completion summary in DEVLOG.md listing every shipped prompt with its commit SHA, and announce completion in chat.

### Step 4 — DEVLOG entry format

```markdown
## [Fluidity — Prompt JN] <Title>  —  <YYYY-MM-DD>

**Files changed:** <list>
**Verify gate:**
- tsc node ✓
- tsc web ✓
- vitest <subset> ✓ (N tests)
- <manual smoke steps + result, OR "user-verification-needed: <what to check>">

**Notes:** <anything surprising, deferred, or worth knowing>

**Commit:** <SHA>
```

### Step 5 — Commit discipline

- One commit per prompt. No batching, no amending across prompts.
- Never use `--no-verify`. If a pre-commit hook fails, fix the underlying issue.
- Never add the `Co-Authored-By: Claude` trailer (per `feedback_no_coauthor_trailer` memory).
- Use the project's commit-message style — `feat(chat): J3 @file inline mention autocomplete`.

---

## 1. Audit Summary — what exists vs. what's missing

A direct comparison of Lamprey's current Integration-Phase state against the Claude Code experience identified eleven specific fluidity gaps. Functional features are not missing — **micro-interactions, reflex bindings, and visual restraint are.**

| Surface | Current state | Claude Code's behaviour | Owner prompt |
|---|---|---|---|
| ESC mid-stream | Cancel via send-button-becomes-stop (mouse) | Single `ESC` keystroke kills generation cleanly | **J1** |
| Prompt history | No `↑` recall in `ChatInput` | `↑` walks prior user prompts in-line | **J1** |
| Permission mode entry | Dropdown menu beside send button | `Shift+Tab` cycles `default → auto-review → full` at input | **J2** |
| Plan mode entry | Button in input row | Same `Shift+Tab` cycle extends into plan mode | **J2** |
| File attachment | `FileDropZone` + paperclip click | `@filename` inline-completes a file ref | **J3** |
| Memory write | `MemoryModal` dialog | `#…` writes a memory directly from the prompt line | **J4** |
| Tool approval | `ToolApprovalModal` (full screen) | Inline chip in the transcript with `1`/`2`/`Y`/`N` keys | **J5** |
| Completed tools | `ToolUseCard` stays fully expanded | Auto-collapse to one-line summary on success, click to re-expand; failures stay open | **J6** |
| Subagent rendering | `AgentRunBanner` + `MultiAgentRunCard` (banner + sidebar feel) | Inline indented `▸ Agent: <description>` group nested under the turn | **J7** |
| Status line content | `model · workflow · wakeups · tokens · rag` | `model · ctx% · cwd · branch` with amber tone above 70% | **J8** |
| Notification chrome | `ToastContainer`, `AsyncEventToast`, `WakeupPill`, `UpdateBanner`, `SecurityBanner` (5 surfaces) | One surface (the transcript) for async signals; toasts reserved for errors | **J9** |
| File references in prose | Explicit markdown links only | Bare `path/to/file.ts:42` is auto-linked | **J10** |
| Right panel default | Pinned open by default | Collapsed by default; opens on artifact / tool launch | **J11** |

**Non-goals (this plan):** new tools, new IPC namespaces, new schemas, new providers, new RAG behaviour, new workflow patterns. Every prompt is a **surface refinement** over the shipped Integration-Phase substrate.

---

## 2. Architectural Invariants — Locked

These apply across all 11 prompts. Treat as binding.

1. **No new IPC channels.** Every prompt reuses existing channels. If a prompt seems to need one, halt and reconsider — the substrate is already there.
2. **No new SQLite columns or tables.** Same reason.
3. **No new model-callable tools.** Eleven prompts, zero new tool descriptors registered. (`ToolUseCard` collapse, subagent inline rendering, etc. are renderer-only.)
4. **Keyboard handlers are scoped tightly.** Global keystroke listeners (J1 `ESC`, J2 `Shift+Tab`) must guard against firing while focus is in `INPUT`/`TEXTAREA`/`contentEditable` (except when that IS the intent) and must check `e.isComposing` to avoid IME interference. Pattern from `App.tsx`'s existing Esc-closes-drawer handler is the template.
5. **No removal of existing surfaces — additive replacement only.** J5's inline approval chip lives alongside `ToolApprovalModal`; the modal remains for first-time + `destructive` tier. J9 consolidates toasts into the transcript but `Toast` itself stays for genuine error pathways. Code is hidden behind dispatch logic, not deleted.
6. **Auto-collapse / auto-route is governed by tool descriptor metadata** already on `tool-registry.ts` (risk tier, mutates flag). No new metadata fields added — read existing.
7. **Renderer respects the `feedback_no_fake_polish` memory:** if a smoke step cannot be exercised via `mcp__Claude_Preview__*` (e.g. an Electron-shell-only event), it is written into DEVLOG as `user-verification-needed`, never claimed.
8. **All keyboard reflexes are documented in the placeholder or a one-line hint** under `ChatInput` so users discover them. Hidden shortcuts are a fluidity *loss*, not a win.

---

## 3. The Eleven Prompts

### Prompt sequence

| # | Prompt | One-liner | Files (net new / modified) | Verify | Status |
|---|---|---|---|---|---|
| J1 | **`ESC` cancels stream + `↑` recalls prompt history** | Global `ESC` listener in `useChat` (or `useKeyboardShortcuts`) calls the existing cancel path. `↑` / `↓` in empty-or-prefix-matching `ChatInput` walks `chat-store.messages` filtered to `role === 'user'`, restoring text + caret to end. Guard `↑` so it only fires when caret is on the first line of the textarea. | `src/hooks/useChat.ts` (Esc binding), `src/components/chat/ChatInput.tsx` (history binding), `src/stores/chat-store.ts` (extend with `getRecentUserPrompts()` selector) | unit: `getRecentUserPrompts` returns last 50 user prompts most-recent-first · jsdom: `ESC` while `isStreaming` calls `cancel()`; `ESC` while idle is a no-op · jsdom: `↑` on empty input loads most-recent prompt; `↑` again loads next; `↓` walks back; `Esc` resets index · placeholder text mentions "↑ for history" · both tsc | [x] |
| J2 | **`Shift+Tab` cycles permission mode + plan mode at input** | Global `Shift+Tab` listener (guarded against IME + against `Shift+Tab` inside textareas where it's a navigation key — only fire when input has focus AND content is empty OR ChatInput "captures the chord" via a small data-attribute). Cycle: `default → auto-review → full → plan → default`. Plan-mode entry calls the existing `plan:enter` IPC; exit calls `plan:exit`. Visible label under the input bar reads the current mode name, animated on change. | `src/components/chat/ChatInput.tsx` (binding + label), `src/stores/ui-store.ts` (cycle helper), `src/hooks/usePlanMode.ts` (new tiny wrapper around existing `plan:` IPC) | unit: cycle helper goes through 4 states wrapping back · jsdom: `Shift+Tab` in empty ChatInput advances mode, label updates · jsdom: `Shift+Tab` mid-text in textarea does **not** consume the keystroke (native Tab nav still works) · plan-mode entry persists across reload via existing `conversations.plan_mode_active` column · both tsc | [x] |
| J3 | **`@file` inline mention autocomplete in `ChatInput`** | When the user types `@`, surface a popover (reuse `SlashCommandPalette` styling) listing matching workspace files via existing `workspace:listFiles` IPC (or `files:search` if present — discover during implementation). Selection inserts the absolute path token (collapsed display: `@foo.ts`) and registers an attachment on the next send through the existing `ProcessedFile` path. `Esc` cancels; `Tab`/`Enter` accepts. | `src/components/chat/AtFileMention.tsx` (new — popover), `src/components/chat/ChatInput.tsx` (extend `/` detection to also handle `@`), `src/stores/chat-store.ts` (extend pending attachments) | unit: file-rank function returns matches scored by name overlap (extension matches dominate) · jsdom: type `@chat`, popover shows `ChatInput.tsx` first, Enter inserts token, send dispatches with attachment metadata · jsdom: `@` inside a code fence does **not** trigger the popover (parse minimal markdown context) · both tsc | [x] |
| J4 | **`#…` memory-write inline shortcut** | When the user types `#` at the start of a line, switch the send action into "write a memory" mode: send button label changes to "Remember," body is interpreted as the memory description, and submission opens `MemoryEditor` pre-filled (no immediate write — confirm-before-save preserves the `feedback_no_fake_polish` invariant). Existing memory IPC handles the persistence. | `src/components/chat/ChatInput.tsx` (mode detection + button swap), `src/components/memory/MemoryEditor.tsx` (accept `seedDescription` prop), `src/stores/memory-store.ts` (no schema change, just call site) | unit: `#` at column 0 of line 1 toggles mode; `#` mid-text does not · jsdom: type `# remember to ask about RAG`, click Remember → MemoryEditor opens with description prefilled, Save persists, transcript shows a single "saved memory" inline marker · `Esc` in MemoryEditor cancels without writing · both tsc | [x] |
| J5 | **Inline tool approval chips (default + write tier)** | When a tool approval is requested AND descriptor's `risk` does not include `destructive` AND server is already approved at least once (track in `permissions-store`), render the approval as a chip-row INSIDE the transcript (`[1] Approve  [2] Deny  [3] Always allow this tool`) instead of opening `ToolApprovalModal`. Keystrokes `1`/`2`/`3` resolve when chip is focused (auto-focus on appear). Modal still renders for first-time-server + destructive tier — those keep the heavyweight confirmation. | `src/components/chat/InlineApprovalChip.tsx` (new), `src/components/tools/ToolApprovalModal.tsx` (gate behind the routing rule), `src/App.tsx` (routing decision — chip vs modal) | unit: routing decision returns `modal` when descriptor risks include `destructive` OR server not in approved-once set; returns `chip` otherwise · jsdom: emit an approval-required for a known read-tier tool → chip appears in transcript, `1` resolves with approved=true; `2` denies · destructive tier still opens the modal · both tsc · manual (preview): trigger a `read_file` approval, see the chip render under the assistant's latest message | [x] |
| J6 | **Auto-collapse successful tool cards** | `ToolUseCard` adds a `collapsed` state derived from `status === 'success' && !risks.includes('destructive')`. Collapsed shape: one line — `<status-glyph> <tool-name> <short-arg-summary> · <elapsed>`. Click anywhere on the row re-expands; re-collapse via the chevron. Failures and `destructive` results stay expanded. Persist user's manual expand-overrides in component state — don't push to a store; this is ephemeral UI. | `src/components/chat/ToolUseCard.tsx` (collapse logic + view variants), `src/lib/tool-card-helpers.ts` (add `collapsedSummary()` helper) | unit: `collapsedSummary` truncates args to 60 chars with ellipsis · jsdom: success card mounts collapsed; click expands; chevron collapses; failure mounts expanded · `destructive` success stays expanded · re-render does not flip user's manual expand back · both tsc | [x] |
| J7 | **Inline subagent rendering — retire the banner feel** | Replace `AgentRunBanner` + the dedicated `MultiAgentRunCard` block layout with an inline group nested under the parent turn. Visual treatment mirrors a `ToolUseCard`: a `▸` chevron with the agent description, status chip, elapsed, token estimate; expand to show the agent's emitted text. Pipeline of N agents renders as N nested chevron rows under one "Multi-agent run" header. `AgentRunBanner` stays in the file but only renders for **off-conversation** background runs (i.e. those started from `tasks:spawn` with `runInBackground: true`); the in-turn pipeline uses the inline group. | `src/components/chat/AgentRunInlineGroup.tsx` (new), `src/components/chat/MessageList.tsx` (route inline vs banner), `src/components/chat/MultiAgentRunCard.tsx` (delegate to inline group when in-turn), `src/components/chat/AgentRunBanner.tsx` (narrow to background-only) | unit: routing function returns `inline` when the run is owned by the active turn, `banner` when `runInBackground` is true · jsdom: run a 3-agent pipeline → 3 chevron rows nested under one header; expand row 2 shows its output; collapse-all collapses all · background-only run still shows the banner · both tsc · manual (preview): run a Planner→Coder→Reviewer pipeline, confirm inline rendering | [x] |
| J8 | **Status line: context% slot + amber-warn at 70%** | Replace the `tokens` slot with a `context` slot showing `N% used` where N = `tokenSpend / activeModel.contextWindow * 100`. Apply amber tone at >= 70%, red at >= 90% (use the existing `wakeups` amber + a new red derived from `--error`). Add a `branch` slot reading the current git branch via existing `workspace:branch` IPC. The five rendered slots become: `model · context · workflow · branch · wakeups`. Defaults in `statusline-config.ts` reflect the new order; user `userData/statusline.md` overrides still honored. `rag` slot kept but moved off-default. | `src/components/layout/StatusLine.tsx` (slot + tone), `electron/services/statusline-config.ts` (defaults), `src/lib/types.ts` (extend `SlotId` if needed) | unit: tone resolver returns `amber` at 70, `red` at 90, neutral below · unit: context% computation handles missing `contextWindow` gracefully (slot hidden) · vitest existing statusline-config tests still pass with updated defaults · manual (preview): force a long transcript past 70% → slot turns amber; past 90% → red · both tsc | [x] |
| J9 | **Notification consolidation — wake-ups + async events as inline transcript rows** | Reroute `WakeupPill` + `AsyncEventToast` payloads into a new transcript-row component `<TranscriptNotice>` rendered inline by `MessageList` between message bubbles, ordered by timestamp. Toast container reserved for **error toasts only** (rename internal use-sites to `toast.error()` audit). `UpdateBanner` + `SecurityBanner` stay (they are persistent / cross-cutting, not async events). `WakeupPill` file kept but routes through `<TranscriptNotice>` for in-conversation events; toasts only fire when no active conversation is open. | `src/components/chat/TranscriptNotice.tsx` (new), `src/components/chat/MessageList.tsx` (interleave notices), `src/components/chat/AsyncEventToast.tsx` (delegate when conv is active), `src/components/chat/WakeupPill.tsx` (same), `src/stores/toast-store.ts` (no schema change — audit call sites) | unit: interleave function sorts messages + notices by ts · jsdom: a `loops:wakeup-fired` event for the active conv appears as an inline notice, not a toast · same event for a different conv appears as a toast · `toast.success()` / `toast.info()` call sites audited — none should fire for routine background completions · both tsc · manual (preview): force a wake-up while viewing the owning conversation → inline row appears | [x] |
| J10 | **`path:line` autolinking in `MarkdownRenderer`** | Post-process text nodes in `MarkdownRenderer` through a regex matching `[\w./\\-]+\.(ts|tsx|js|jsx|md|json|css|scss|html|sh|py)(?::(\d+))?` and wrap matches in a clickable span that opens the file (reuse `__openArtifact` global on `window` from `App.tsx` or fire a new renderer-internal `file:open` event the host handles). Skip matches inside `<code>` / `<pre>` — markdown-react already wraps those. Add a small underline-on-hover style; avoid full link color so plaintext file refs don't visually shout. | `src/components/artifacts/MarkdownRenderer.tsx` (text-node visitor + wrap), `src/lib/path-autolink.ts` (new — regex + wrap helper, fully unit testable), `src/App.tsx` (handle `file:open` if needed) | unit: regex matches `src/foo.ts`, `src/foo.ts:42`, `./bar.tsx`, `path\\to\\baz.json` · regex does not match plain words ending in `.md.` or URLs · jsdom render: a paragraph with `Look at src/App.tsx:42 for the fix` produces one clickable span around `src/App.tsx:42` · text inside `<code>` is left alone · both tsc | [x] |
| J11 | **Right panel default collapsed + auto-open triggers** | Change the default seed for `rightPanelCollapsed` in `ui-store.ts` to `true` for **new conversations** (existing conversations remember their last state). Auto-open the panel when (a) an artifact is emitted (`__openArtifact` fires), (b) a tool launches that targets the tools panel (existing `activeTool` change), or (c) the user manually expands. When auto-opened due to (a) or (b), record the trigger so collapsing it once stays collapsed for that conversation until a NEW trigger fires (no toast-style "re-pops" annoyance). | `src/stores/ui-store.ts` (per-conversation panel state map + new-conv default), `src/App.tsx` (auto-open triggers + collapse-sticky logic), `src/stores/chat-store.ts` (emit `conversation:created` when new conv starts) | unit: ui-store getter returns `collapsed=true` for a never-seen conv id, `last-state` for known ones · jsdom: new conv mounts with collapsed panel; emit `__openArtifact` → expands; user collapses → stays collapsed even on subsequent same-tool open; new artifact `__openArtifact` reopens · both tsc · manual (preview): start a fresh conversation → right panel collapsed, chat takes full width | [x] |

### Phase completion criteria

- All 11 prompts marked `[x]`.
- 11 commits on the `feat/fluidity-phase` worktree branch.
- `npx tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean.
- `npx vitest run` exits 0.
- **Manual end-to-end smoke (user-verification-needed):** launch Electron, open a fresh conversation, exercise: `ESC` cancels a stream; `↑` recalls a prior prompt; `Shift+Tab` cycles permission + plan mode; `@chat` autocompletes to a file; `#` opens MemoryEditor with seed; an approval renders inline as a chip; a completed tool collapses; a multi-agent run renders inline-nested; status line shows context% turning amber past 70%; a wake-up fires as an inline transcript row; a `src/foo.ts:42` reference in assistant output is clickable; right panel is collapsed by default and auto-opens on artifact emission.
- `DEVLOG.md` has 11 prompt entries + one phase-completion summary.
- `README.md` "Fluidity" subsection added under the existing parity wrap-up.

---

## 4. Quick-Reference Tables

### Surfaces touched (no new IPC, no new schemas)

| Layer | Files touched |
|---|---|
| Hooks | `useChat.ts`, `useKeyboardShortcuts.ts`, `usePlanMode.ts` (new tiny wrapper) |
| Stores | `chat-store.ts`, `ui-store.ts`, `memory-store.ts`, `toast-store.ts` (audit only) |
| Chat components | `ChatInput.tsx`, `MessageList.tsx`, `ToolUseCard.tsx`, `MultiAgentRunCard.tsx`, `AgentRunBanner.tsx`, `AsyncEventToast.tsx`, `WakeupPill.tsx`, `AtFileMention.tsx` (new), `AgentRunInlineGroup.tsx` (new), `InlineApprovalChip.tsx` (new), `TranscriptNotice.tsx` (new) |
| Layout | `App.tsx`, `StatusLine.tsx` |
| Settings / config | `statusline-config.ts`, `MemoryEditor.tsx` (extend props) |
| Markdown | `MarkdownRenderer.tsx`, `path-autolink.ts` (new) |
| Tool registry | `tool-card-helpers.ts` (extend) |
| Modal | `ToolApprovalModal.tsx` (route-gating only — no removal) |

### Keyboard reflexes introduced

| Keystroke | Behavior | Prompt |
|---|---|---|
| `ESC` (global) | Cancel active stream | J1 |
| `↑` / `↓` (in empty `ChatInput`) | Walk prior user prompts | J1 |
| `Shift+Tab` (with `ChatInput` focus) | Cycle `default → auto-review → full → plan` | J2 |
| `@` (at word boundary in `ChatInput`) | Open file-mention popover | J3 |
| `#` (at column 0 of line 1 in `ChatInput`) | Switch to memory-write mode | J4 |
| `1` / `2` / `3` (when `InlineApprovalChip` focused) | Approve / Deny / Always-allow | J5 |
| Click on collapsed `ToolUseCard` | Expand | J6 |
| Click on inline subagent chevron | Expand that agent's output | J7 |
| Click on `path:line` span in assistant output | Open file in artifacts | J10 |

### What is intentionally NOT in this plan

- No new tools, IPC channels, or database columns.
- No backwards-compatibility shims — Lamprey is pre-1.0 and users opt into the latest behaviour by upgrading. Old toast/banner pathways are routed through the new transcript notice; nothing is renamed or deprecated for "later removal."
- No design-system overhaul — colour tokens, spacing, type all unchanged. The fluidity gain is in **routing and reflex**, not pixels.
- No Monaco-grade autocomplete for `@file` — name-overlap ranking is enough; full LSP-style completion is out of scope.
- No removal of `ToolApprovalModal` or any other surface. J5 routes around it for the common path; the modal still owns first-time + destructive.
- No tutorial / onboarding overlay. Keystroke hints in placeholder text are the only discoverability layer.

### Risk register

| Risk | Mitigation |
|---|---|
| `Shift+Tab` collides with focus navigation | Only consume the chord when `ChatInput` is the active element AND its content is empty (J2 spec encodes this). |
| `↑` prompt history blocks textarea line nav | Only fire when caret is on line 1 of the textarea AND there is no selection (J1 spec encodes this). |
| Inline approval chip ignored mid-stream | Auto-focus on appear + a subtle pulse animation; the modal remains the fallback for `destructive` so safety isn't degraded. |
| `@file` regex misfires inside code fences | J3 spec requires a minimal markdown parse: don't trigger inside ` ``` ` or single-backtick spans. |
| Auto-collapse hides a tool result the user wanted to read | Only success collapses. Failures and destructive results stay expanded. Manual expand sticks for the lifetime of the card. |
| `path:line` autolink matches false positives (`README.md.` in punctuation, version strings) | Regex requires the dot to be followed by 1–4 lowercase letters then a non-`.` boundary. Comprehensive unit fixture matrix in J10. |
| Right panel default-collapsed surprises power users | Existing conversations remember their last state — only NEW conversations open collapsed. Setting can be flipped from settings if user wants the old default. |

---

## 5. Sequencing Rationale

The eleven prompts are ordered so each later prompt assumes the earlier ones' invariants are in place:

- **J1 + J2** (input keyboard reflexes) lay down the global-listener pattern the rest of the plan reuses.
- **J3 + J4** (`@` and `#` inline triggers) extend the `ChatInput` parsing established by the existing `/` slash detection — same code path, three new prefixes.
- **J5 + J6** (approval chips + auto-collapse) declutter the transcript so the **subagent inline rendering in J7** lands in a transcript that's already quiet enough to read.
- **J7** (inline subagents) finishes the transcript-as-single-surface story.
- **J8** (status line) and **J9** (notification consolidation) reduce competing surfaces.
- **J10** (`path:line` autolinking) is independent and could ship anywhere; placed late because it's the lowest-risk visual change.
- **J11** (right panel default) is intentionally last — by then the transcript has been refined enough that hiding the right panel by default is an obvious win rather than a controversial choice.

Each prompt's verify gate is independently exercisable; if a prompt is blocked for a non-trivial reason (rare), the next prompt can usually proceed because the substrate isn't yet shared.

---

## 6. Sign-off

When all 11 prompts are `[x]`, append:

```markdown
## [Fluidity Phase Complete] — <YYYY-MM-DD>

**Prompts completed:** J1 ESC + ↑ history, J2 Shift+Tab cycle, J3 @file mention, J4 # memory shortcut, J5 inline approval chips, J6 tool-card collapse, J7 inline subagents, J8 status-line context%, J9 notification consolidation, J10 path:line autolinking, J11 right-panel default-collapsed.

**Phase verify:**
- tsc node ✓
- tsc web ✓
- vitest ✓ (N files / N tests)
- production build ✓
- smoke-renderer ✓
- smoke-bundle ✓
- user-verification-needed: full end-to-end smoke per §3 completion criteria.

**Notes:** Lamprey now matches Claude Code on conversational fluidity — single moving surface, keyboard-first reflexes, transcript-as-source-of-truth. Functional parity (Tracks 1–3 + H1–H6) was already in place; this phase closes the remaining "feel" gap.

**Commit range:** <first-sha>..<last-sha>
```
