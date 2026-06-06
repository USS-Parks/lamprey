# Lamprey Panels Phase — Sequential Prompt Roster

**Goal:** replace Lamprey's border-heavy layout chrome with a Claude-Code-style **panel surface system**. Two rounded sidebar panels (left + right) float on a warm two-tone substrate; the chat column between them is **transparent**, with content flowing directly on the substrate. The only chrome-bearing surfaces in the chat column are the prompt input pill and its adjacent dock pills/chips. The right-panel interior cards (recents, tool shortcuts, docked environment card) are explicitly **preserved as-is** — only their outer container becomes rounded. `FloatingEnvironmentCard` is **untouched** entirely (look, feel, action, functions, fade behavior, position math).

**Execution model:** **single session, single worktree off `main`, sequential P1 → P10.** No track-splits — every prompt builds on the previous one's tokens / shell / sweep state.

**Companion to:** [`LAMPREY_FLUIDITY_PLAN.md`](LAMPREY_FLUIDITY_PLAN.md) (which left functional parity at v0.5.x; this phase is the *visual* parity closer).

---

## 0. SESSION BOOTSTRAP — READ THIS FIRST

You are a fresh Claude Code session handed this document. Before doing anything else:

### Step 1 — Confirm environment

Verify:
- Working directory is `C:\Users\17076\Documents\Claude\Lamprey Harness` (or a worktree thereof).
- Current branch is **not** `main` — set up `feat/panels-phase` as a worktree off `main` first if it doesn't exist (per `feedback_parallel_session_worktree` memory).
- `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` both pass cleanly *before* you start.
- `npx electron-vite build` exits 0.

If any of those fail, halt and report. Do not start on a broken baseline.

### Step 2 — No track question

This is a single linear phase. **Do not ask the user which track** — there is only one path. Confirm with the user that you're starting the Panels Phase and proceed.

### Step 3 — Execute P1 → P10 without stopping

1. **Do not ask further questions** unless a prompt requires a decision only the user can make (a real visual fork the plan doesn't resolve, or a genuine blocker — e.g. a theme preset where no `--app-bg` / `--panel-bg` choice reads acceptably).
2. **For each prompt, in order:**
   a. Read the "Files (net new / modified)" list. Read existing files first to ground the change in the real component shape — these prompts edit shipped code.
   b. Implement the change. Edit existing files in place; create new ones only when the prompt calls for them (this phase creates zero new files — every change is a className swap or a token addition).
   c. Run the **verify gate** (the "Verify" column). Always: both tsc configs + `npx electron-vite build`. UI-touching prompts (P2–P9) also list manual smoke steps — execute them via the preview tools (`mcp__Claude_Preview__*`) when they touch the renderer. Electron-shell-only smoke steps are written into DEVLOG and explicitly marked **"user-verification-needed"** rather than claimed (see `feedback_no_fake_polish` memory).
   d. If verify fails: fix and retry up to **2 times**. On the third failure, halt, write a "blocked" entry to `DEVLOG.md` with the failure context, report to the user.
   e. If verify passes: mark the prompt `[x]` in this document via `Edit`, write a DEVLOG.md entry (see Step 4), then commit (do not push — user pushes per CLAUDE.md and `feedback_push_when_told` memory).
   f. Move to the next prompt.
3. **Do not push to GitHub.** One commit per prompt. The user reviews and pushes.
4. **When all 10 prompts complete:** write a final phase-completion summary in DEVLOG.md listing every shipped prompt with its commit SHA, and announce completion in chat.

### Step 4 — DEVLOG entry format

```markdown
## [Panels — Prompt PN] <Title>  —  <YYYY-MM-DD>

**Files changed:** <list>
**Verify gate:**
- tsc node ✓
- tsc web ✓
- electron-vite build ✓
- <manual smoke steps + result, OR "user-verification-needed: <what to check>">
- light + dark mode eyeball: <pass / which preset needs tuning>

**Notes:** <anything surprising, deferred, or worth knowing>

**Commit:** <SHA>
```

P2's entry **must** include a before/after screenshot or detailed visual description — it is the visually load-bearing prompt and the rest of the phase amplifies whatever it ships.

### Step 5 — Commit discipline

- One commit per prompt. No batching, no amending across prompts.
- Never use `--no-verify`. If a pre-commit hook fails, fix the underlying issue.
- Never add the `Co-Authored-By: Claude` trailer (per `feedback_no_coauthor_trailer` memory).
- Use the project's commit-message style — `feat(panels): P2 two rounded sidebar panels on transparent chat substrate`.

---

## 1. Audit Summary — what exists vs. what's missing

A direct comparison of Lamprey's current Customize-Phase visual state (v0.5.2) against the Claude Code chrome vocabulary identified ten specific panel-system gaps. Functional features are not missing — **layout chrome restraint is.**

| Surface | Current state | Claude Code's treatment | Owner prompt |
|---|---|---|---|
| Workspace shell | One-tone `--bg-primary`; sidebars demarcated by 1px `--border` lines | Two-tone substrate (`--app-bg` shell, `--panel-bg` cards); sidebars float as rounded panels | **P1 + P2** |
| Theme tokens | `--bg-primary/secondary/tertiary` + `--border` only | Adds `--app-bg`, `--panel-bg`, `--panel-border`, `--panel-radius`, `--panel-gap` | **P1** |
| Left sidebar | Hard `border-r` against chat; internal `border-t` section dividers + footer-strip border | Rounded `--panel-bg` panel on substrate; internal divisions = whitespace + headers | **P2 + P3** |
| Right sidebar outer | Hard `border-l` against chat; rail and expanded states both 90°-cornered | Rounded `--panel-bg` panel in both rail and expanded states; substrate gap replaces hairline | **P2** |
| Right sidebar interior | Existing cards on `--bg-secondary` with `--bg-tertiary` lift — **already correct** | **Preserved as-is**; only outer container changes | **P4** (trim only) |
| Chat column | `bg-[var(--bg-secondary)]` inset with `p-2` (reads as a third card) | **Transparent** — messages flow directly on `--app-bg` | **P2 + P5** |
| ChatInput pill | Hard `border-[var(--border)]` perimeter | Softened `--panel-border` perimeter on `--panel-bg` pill | **P5** |
| In-chat banners (Plan, Deep Research, Agent run) | `border border-[var(--border)]` perimeter cards | Accent stripe or faint tonal lift, no perimeter | **P7** |
| Inline tool cards | Bordered card per call | Collapsed = inline text; expanded = `--bg-tertiary/50` tonal lift, no border | **P7** |
| Modal interior sections | Inner hairline dividers between sections | Spacing + headers; outer frame keeps border, interior doesn't | **P6** |
| Aux panels (Activity, Automations, Memory, ui/* primitives) | `border-[var(--border)]` throughout | Substrate-consistent treatment; form/floating exceptions documented | **P8** |
| `FloatingEnvironmentCard` | Existing card with `--border` perimeter — **already correct in look** | **Preserved 100% as-is** (look, feel, action, functions, fade behavior) | (untouched) |

**Non-goals (this plan):** no new IPC, no new schemas, no new tools, no new providers, no design-token-scale or typography overhaul, no Tailwind v3↔v4 migration, no `radix-ui` or `lucide-react` swap, no component-library rewrite. Every prompt is a **token addition or className swap** over the shipped Customize-Phase substrate.

---

## 2. Architectural Invariants — Locked

These apply across all 10 prompts. Treat as binding.

1. **No new IPC channels.** Renderer-only phase. If a prompt seems to need one, halt and reconsider — chrome is presentational.
2. **No new SQLite columns or tables.** Same reason.
3. **No new model-callable tools, no new providers, no new skills/connectors/plugins.** Customize Phase shipped those; this phase doesn't touch them.
4. **No removal of existing components.** Borders are stripped/softened, not deleted from component files. Component files stay; only their className strings change.
5. **Floating UI keeps its borders.** Popovers, dropdowns, slash-command palette, agent/model pickers, modal outer frames, toasts — all keep their hairlines. They float over content and need edge definition.
6. **Form controls keep their borders.** `<input>`, `<textarea>`, `<select>` — functional edges, not structural chrome.
7. **Semantic stripes stay.** Risk-tier color stripe on `ToolApprovalModal`, diff-line gutters on `CodeBlock`, agent-role accent stripe on `AgentRunBanner`. These are color-coded indicators, not chrome.
8. **The chat column is NOT a panel.** It sits transparent on `--app-bg`. The bottom dock pill cluster is its only chrome.
9. **Right-panel interior cards are preserved.** Background, border, spacing, behavior — untouched. P4 only trims outermost-edge hairlines that double the panel boundary after P2's wrap.
10. **`FloatingEnvironmentCard` is preserved entirely.** Zero className, prop, position math, fade behavior, or width-tracking changes. It is named in the allow-list and re-named in P5 + P9 as explicitly untouched.
11. **Per `feedback_no_fake_polish`:** if a smoke step cannot be exercised via `mcp__Claude_Preview__*` (e.g. an Electron native-window event), it is written into DEVLOG as `user-verification-needed`, never claimed.
12. **Theme-preset coexistence:** every existing preset (dark, light, peach/cream, plus any others in `theme-presets.ts`) must read correctly with the new tokens. P1 enforces "every preset has all five tokens defined"; P9 enforces "every preset reads as two-panel-plus-transparent-chat."

---

## 3. The Ten Prompts

### Prompt sequence

| # | Prompt | One-liner | Files (net new / modified) | Verify | Status |
|---|---|---|---|---|---|
| P1 | **Surface tokens + theme-preset feed-through** | Define five CSS custom properties — `--app-bg` (warm cream / dark shell), `--panel-bg` (panel surface), `--panel-border` (low-alpha edge), `--panel-radius` (12px), `--panel-gap` (8px) — in `index.css` `:root` + `:root[data-theme-mode='light']`. Add them to every preset in `theme-presets.ts` + `apply-theme.ts` so theme switching keeps them in sync. **Constraint:** light-mode `--panel-bg = #ffffff` must keep existing `--bg-tertiary` cards reading as a step *down/cooler* against it; dark-mode `--panel-bg = --bg-secondary` keeps them reading as a step *up*. No component changes this prompt. | `src/styles/index.css`, `src/styles/theme-presets.ts`, `src/styles/apply-theme.ts`, `src/lib/types.ts` (interface extension) | both tsc · `electron-vite build` · launch · inspect `:root` in DevTools: all 5 tokens resolve to non-empty values for each preset · theme toggle updates them · no visual change yet (no consumers) | [x] |
| P2 | **App shell wrap: two rounded sidebar panels on a transparent chat substrate** | The visible flip. Outer flex → `bg-[var(--app-bg)]`. Three-column row gets `gap-[var(--panel-gap)] p-[var(--panel-gap)]`. **Middle column stays transparent** — swap `bg-[var(--bg-secondary)]` for `bg-transparent` at App.tsx:420, keep `p-2`. Left sidebar (rail + main + drawer) and right sidebar (collapsed rail + expanded shell + drawer) all get `bg-[var(--panel-bg)]` + `rounded-[var(--panel-radius)]` and drop their `border-l/r border-[var(--border)]`. `SecurityBanner` + `UpdateBanner` stay as substrate-floating ribbons (no panel wrap). Vertical resize handles sit in the panel gap. | `src/App.tsx` (lines ~382, ~414, ~417, ~420, ~429, ~445, ~469, ~500), `src/components/layout/Sidebar.tsx` (lines ~666, ~729, ~787) | both tsc · `electron-vite build` · launch · **two rounded panels read on substrate, chat transparent in between** · resize right panel still works · drawer still opens with rounded left edge · light + dark eyeball both pass · **DEVLOG entry includes before/after screenshot** — load-bearing prompt | [x] |
| P3 | **Left sidebar interior cleanup** | With the sidebar now a panel, strip the interior hairlines that read as redundant divisions inside the card. Delete top-level section-divider `border-t/b` lines (Workspace / Recents / Pinned / Settings footer); bump spacing one notch where hierarchy now reads ambiguously. Delete the footer-strip `border-t` at line ~1143; if footer feels orphaned, swap its bg to `--bg-tertiary` tint. Hover/active row outlines stay (interaction affordance). Search input border (line ~1028) stays (form control). | `src/components/layout/Sidebar.tsx` | both tsc · `electron-vite build` · launch · sidebar reads continuous, no "boxed inside a box" effect · project list scrolling + hover states still work · light + dark eyeball both pass | [x] |
| P4 | **Right panel interior: preserve cards, trim only vestigial chrome** | Outer rounded panel already landed in P2. This prompt is conservative: only delete outermost-edge hairlines that now double the panel boundary. Specifically: (a) any `border-r/l` along the outer edge of `RightPanelHome` view; (b) the `border-t` on the very top header strip if it doubles the panel's top edge; (c) `SecondaryToolbar`'s `border-b` (swap to `bg-[var(--bg-tertiary)]` tint if toolbar loses its distinctness). **DO NOT** change card backgrounds, borders, spacing, or layouts inside the right panel. Cards stay. The docked environment card stays. `WebContentsView` sandbox boundary in `ArtifactPanel` stays (intentional "external content" edge). | `src/components/artifacts/RightPanelHome.tsx`, `src/components/tools/ToolsPanel.tsx`, `src/components/artifacts/ArtifactPanel.tsx`, `src/components/layout/Titlebar.tsx` (SecondaryToolbar) | both tsc · `electron-vite build` · launch · **right-panel interior cards look identical to before P2/P4** — same backgrounds, shape, spacing · no double-bounded effect at panel's outer edges or top · open artifact / swap to tools / expand docked env card all still work · light + dark eyeball both pass | [x] |
| P5 | **Chat column transparent; only bottom dock carries chrome; `FloatingEnvironmentCard` untouched** | `ChatView` strips every background surface around the message stream and the input area. Messages flow directly on `--app-bg`. The bottom-dock region keeps its vertical stacking but gets **no panel background** — its pills carry their own chrome individually. `ChatInput` outer pill keeps a defined edge: soften `border-[var(--border)]` to `border-[var(--panel-border)]`, keep `--panel-bg` background + rounded shape. Adjacent dock pills (model picker chip, mode toggle, attachment chips, agent toggle) each keep individual pill chrome, softened. Popover dropdowns (slash, agent, model — lines ~184/271/395/603) keep their borders (floating UI). **`FloatingEnvironmentCard` preserved entirely — zero className, prop, or behavior changes.** | `src/components/chat/ChatView.tsx`, `src/components/chat/ChatInput.tsx` | both tsc · `electron-vite build` · launch · **chat column reads as content flowing on substrate** · only chrome = input pill + dock pills + `FloatingEnvironmentCard` (untouched) · popovers still float with edges · banner border-cleanup deferred to P7 · light + dark eyeball both pass | [x] |
| P6 | **Modal interior surface cleanup** | Modals are floating UI, so their outer frames stay bordered. Strip **inner** section dividers in each modal so sections read as one continuous surface. `CustomizeView`'s three-column internal divisions (Skills / Connectors / Plugins) become rounded `--panel-bg` panels on the modal's surface, separated by `--panel-gap` (mirrors the workspace shell pattern inside the modal). `ToolApprovalModal`'s risk-tier color stripe stays (semantic, not chrome). | `src/components/settings/SettingsDialog.tsx`, `src/components/customize/CustomizeView.tsx`, `src/components/settings/ApiKeyModal.tsx`, `src/components/memory/MemoryModal.tsx`, `src/components/chat/AskUserModal.tsx`, `src/components/tools/ToolApprovalModal.tsx` | both tsc · `electron-vite build` · launch · open each modal · sections inside read continuous · outer frames still float cleanly · `ToolApprovalModal` risk stripe still visible · light + dark eyeball both pass | [x] |
| P7 | **In-chat surfaces: zero card chrome; tonal lift only where distinction is required** | Banners (`AgentRunBanner`, `DeepResearchBanner`, `PlanModeBanner`, `AgentRunInlineGroup`) drop perimeter borders. Replace with either (a) faint `bg-[var(--bg-tertiary)]/60` rounded block, no border, or (b) 2px left accent stripe in role color, no bg. Pick whichever reads less heavy per banner; commit reasoning in DEVLOG. Inline tool result cards: collapsed = inline text with icon, no surface; expanded = `bg-[var(--bg-tertiary)]/50` rounded, no border. Message bubbles: drop any perimeter border on both speakers; user bubbles get optional very-subtle tonal lift (`bg-[var(--bg-tertiary)]/40`) — drop if it muddies substrate. Inline approval chips + attachment chips: borders → `--panel-border` or drop. | `src/components/chat/AgentRunBanner.tsx`, `src/components/chat/DeepResearchBanner.tsx`, `src/components/chat/PlanModeBanner.tsx`, `src/components/chat/AgentRunInlineGroup.tsx`, `src/components/chat/ToolUseCard.tsx`, `src/components/chat/MessageList.tsx`, `src/components/chat/InlineApprovalChip.tsx`, `src/components/chat/AttachmentPreview.tsx` | both tsc · `electron-vite build` · launch · chat column reads as single flowing column · banners read as substrate-floating notes (stripe or tonal lift) · tool results read via tonal lift, never outline · no perimeter borders on any in-chat element · **DEVLOG records `grep -n 'border.*var(--border)' src/components/chat/`** — remaining hits must all be popovers/forms/dock | [x] |
| P8 | **Auxiliary panel sweep** | Catch the remaining structural-chrome borders in panels off the main hot path. Walk Activity (Dashboard, Timeline, Tray), Automations (Panel, CronEditor, RunHistoryViewer), Memory (close out anything left from P6), StatusLine top border, UpdateBanner / SecurityBanner / Toast in `ui/*`. Use `grep -rn 'border-\[var(--border)\]' src/components/` as the worklist. Each occurrence: structural chrome → swap to `--panel-border` or delete; form control / floating UI / semantic stripe → keep. | `src/components/activity/*.tsx`, `src/components/automations/*.tsx`, `src/components/memory/*.tsx`, `src/components/layout/StatusLine.tsx`, `src/components/ui/*.tsx` (Toast, UpdateBanner, SecurityBanner) | both tsc · `electron-vite build` · launch · open Activity / Automations / Memory — each reads as part of the panel system, not a different visual language · **DEVLOG records final `grep -rn 'border-\[var(--border)\]' src/components/` tally** showing remaining hits are all in the allow-list categories | [x] |
| P9 | **Light + dark QA, peach/cream preset polish, screenshot grid** | Walk every theme preset end-to-end. Per preset eyeball: two sidebar panels read as floating; chat column reads transparent (not a third card); chat-column text legible on `--app-bg` (WCAG AA); bottom dock pill cluster is the only chat-column chrome; **right-panel interior cards look unchanged** (same backgrounds, shape, spacing); **`FloatingEnvironmentCard` looks and behaves exactly as pre-phase** (fade timing identical on right-panel expand/collapse); banners read as substrate notes; modals float cleanly. Tune preset values in `theme-presets.ts` for any preset that doesn't pass. Screenshot per preset: workspace + a modal + a chat-with-banner + a chat-with-tool-card. Save to `ASSETS/panels-phase/<preset>-<surface>.png`. | `src/styles/theme-presets.ts` (tuning only), `ASSETS/panels-phase/*.png` (screenshots) | both tsc · `electron-vite build` · every preset reads as two-panel-plus-transparent-chat in workspace + modal surfaces · WCAG AA text contrast on `--app-bg` (verify via DevTools or eyeball + spot-check) · interior cards unchanged pre/post pair-comparison · `FloatingEnvironmentCard` fade timing identical (manual: trigger expand/collapse) · keyboard sweep (ESC, Cmd+K, Cmd+/) no regression · screenshot grid embedded in DEVLOG | [x] |
| P10 | **Phase wrap: version bump, devlog summary, memory + CLAUDE.md update** | Close out the phase. Bump `package.json` `0.5.2 → 0.6.0` (panel system = user-visible chrome change → minor bump, not patch). Write `## Panels Phase complete` summary in DEVLOG.md listing all 10 prompts with commit SHAs. Update `memory/project_build_status.md` adding a Panels row. Update `CLAUDE.md` "Current State" section: add Panels bullet citing this plan as reference-only; update execution rule §1 wording to add "Panels Phase" to the shipped-phases list. Update `memory/MEMORY.md` Build status line to include Panels Phase + v0.6.0. | `package.json`, `DEVLOG.md`, `memory/project_build_status.md`, `CLAUDE.md`, `memory/MEMORY.md` | both tsc · `electron-vite build` · `git status` clean after commit · plan officially reference-only · ready for user push | [x] |

### Phase completion criteria

- All 10 prompts marked `[x]`.
- 10 commits on the `feat/panels-phase` worktree branch.
- `npx tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json` both clean.
- `npx electron-vite build` exits 0.
- **Manual end-to-end smoke (user-verification-needed):** launch Electron, walk every theme preset, confirm: two rounded sidebar panels float on the substrate; chat column is transparent; prompt input pill + dock pills are the only chat-column chrome; `FloatingEnvironmentCard` behaves identically to pre-phase; right-panel interior cards look unchanged; banners read as substrate notes; modals float cleanly; no `border-[var(--border)]` structural chrome remains outside the allow-list categories.
- `DEVLOG.md` has 10 prompt entries + one phase-completion summary.
- `package.json` version is `0.6.0`.

---

## 4. Quick-Reference Tables

### Tokens introduced

| Token | Dark value | Light value | Used by |
|---|---|---|---|
| `--app-bg` | `#0a0a0a` (one notch darker than `--bg-primary`) | `#ece8e2` (warm cream substrate) | App shell outer flex, transparent chat column substrate |
| `--panel-bg` | alias `--bg-secondary` (`#161616`) | `#ffffff` | Both sidebar panels; ChatInput pill; modal interior panels in CustomizeView |
| `--panel-border` | `rgba(255, 255, 255, 0.06)` | `rgba(15, 17, 21, 0.06)` | Softened pill edges; optional sidebar panel edge |
| `--panel-radius` | `12px` | `12px` | All panel `rounded-*` swaps |
| `--panel-gap` | `8px` | `8px` | Space between panels and chat column |

### Surfaces touched (no new IPC, no new schemas)

| Layer | Files touched |
|---|---|
| Styles / theme | `src/styles/index.css`, `src/styles/theme-presets.ts`, `src/styles/apply-theme.ts` |
| Layout shell | `src/App.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/Titlebar.tsx`, `src/components/layout/StatusLine.tsx` |
| Right-panel exterior | `src/components/artifacts/RightPanelHome.tsx`, `src/components/tools/ToolsPanel.tsx`, `src/components/artifacts/ArtifactPanel.tsx` |
| Chat column | `src/components/chat/ChatView.tsx`, `src/components/chat/ChatInput.tsx` |
| In-chat surfaces | `AgentRunBanner.tsx`, `DeepResearchBanner.tsx`, `PlanModeBanner.tsx`, `AgentRunInlineGroup.tsx`, `ToolUseCard.tsx`, `MessageList.tsx`, `InlineApprovalChip.tsx`, `AttachmentPreview.tsx` |
| Modals | `SettingsDialog.tsx`, `CustomizeView.tsx`, `ApiKeyModal.tsx`, `MemoryModal.tsx`, `AskUserModal.tsx`, `ToolApprovalModal.tsx` |
| Auxiliary panels | `src/components/activity/*.tsx`, `src/components/automations/*.tsx`, `src/components/ui/Toast.tsx`, `src/components/ui/UpdateBanner.tsx`, `src/components/ui/SecurityBanner.tsx` |
| **Explicitly untouched** | `src/components/workspace/FloatingEnvironmentCard.tsx` (zero changes) · right-panel interior card components (background/shape/spacing preserved; only outermost-edge hairlines trimmed in P4) |
| Phase wrap | `package.json`, `DEVLOG.md`, `CLAUDE.md`, `memory/MEMORY.md`, `memory/project_build_status.md` |

### What stays chromed (explicit allow-list)

These are deliberately *not* swept. Adding "no border / no chrome" to any of them is a regression.

1. **The two sidebar panels** — left + right are the *only* shell panels. They carry `--panel-bg` + rounded corners. Chat column does not.
2. **Right-panel interior cards** — every card currently inside the right sidebar is preserved. Background, border, spacing, behavior — untouched.
3. **The bottom dock pill cluster** — prompt input pill + adjacent pills (model picker, mode toggle, attachment chips, agent toggle) are the only in-chat-column chrome surfaces. Soft `--panel-border` edges.
4. **`FloatingEnvironmentCard`** — preserved entirely. No className, prop, position math, fade behavior, or width-tracking change.
5. **Floating UI** — popovers, dropdowns, slash-command palette, agent/model pickers. Need hairlines so they don't blend into substrate or panel below.
6. **Modal frames** — outer `<div>` of every modal stays bordered (it floats). Interior sections lose borders.
7. **Form controls** — `<input>`, `<textarea>`, `<select>` keep their borders. Functional, not structural.
8. **Semantic stripes** — risk-tier on `ToolApprovalModal`, diff gutter on `CodeBlock`, agent-role accent on `AgentRunBanner`. Color-coded indicators, not chrome.
9. **Resize handles** — vertical handles between sidebars and chat keep visible 2px center on hover/drag. Resting-state hairline goes (panel-gap replaces it); active state stays.
10. **Sandbox boundaries** — `WebContentsView` slot in `ArtifactPanel` may keep a border to make "this is external content" legible. Decision noted in P4 DEVLOG.

### What is intentionally NOT in this plan

- No new theme preset designed *for* the panel system (e.g. a Claude-Code-look-alike with their specific neutrals). The plan only ensures every existing preset survives.
- No animation on panel mount or panel resize. Snap-to-grid panel resize is a natural next step but adds scope.
- No replacement of `radix-ui` primitives' default styling. Their popovers have their own borders we leave alone.
- No mobile responsive treatment beyond what `useMediaQuery(NARROW_VIEWPORT_QUERY)` already handles.
- No design-system overhaul — color tokens (other than the five new ones), spacing scale, type scale all unchanged.
- No removal of any existing component. Borders are softened or stripped from className strings; component files stay.
- No `clsx`/`cn` helper introduction. Strings stay strings.
- No Tailwind v3↔v4 migration. Tailwind 4 stays; `@theme` block stays.

### Risk register

| Risk | Mitigation |
|---|---|
| **P2 visual regression** — load-bearing prompt; if panels don't read right, every subsequent prompt amplifies the problem | P2 acceptance includes a before/after screenshot in DEVLOG; if it looks wrong, stop and tune tokens before P3. Every prompt is a single commit → `git revert <sha>` rolls back cleanly. |
| **Theme-preset drift** — a preset missing one of the new tokens falls back to `:root` defaults; fine for dark, produces inverted contrast for some peach variants | P1 acceptance enforces "every preset has all five tokens defined"; P9 catches any contrast miss via eyeball + WCAG check. |
| **Chat-column text legibility on warm substrate** — body text on `--app-bg` must clear WCAG AA | P9 acceptance includes WCAG AA verification via DevTools or eyeball + spot-check; tune `--app-bg` tone if needed. |
| **Right-panel interior card contrast loss** — light-mode `--panel-bg = #ffffff` against existing `--bg-tertiary = #eef0f3` cards | P1 explicit constraint: `--panel-bg` must keep `--bg-tertiary` cards reading. P9 eyeball verifies. |
| **`FloatingEnvironmentCard` regression** — accidental className/prop change | P5 spec explicitly says "zero changes"; allow-list entry #4 reinforces. P9 verifies fade timing identical via manual right-panel expand/collapse. |
| **ChatInput pill blending into substrate** — too-subtle `--panel-border` could make the pill disappear visually | Pill keeps `--panel-bg` background — the bg contrast against transparent substrate carries even if border is invisible. If pill still blends, tune `--panel-border` alpha up in P9. |
| **Banner heaviness in P7** — replacing border with bg-tertiary tonal lift could read as "still a card" | P7 spec offers two options per banner (tonal lift vs. accent stripe); pick the lighter-reading option and commit reasoning to DEVLOG. Deep Research banner explicitly leans toward accent stripe. |
| **Resize handle invisibility** — without a resting-state hairline, users might miss the resize affordance | Active-state 2px center on hover/drag stays (allow-list #9); panel-gap visually invites cursor into the gap. If users report missing it, restore a low-alpha at-rest indicator. |
| **Modal interior section ambiguity** — without dividers, multi-section modals (SettingsDialog tabs, CustomizeView columns) could read mushy | P6 swaps dividers for spacing + headers + (in CustomizeView's case) inner rounded `--panel-bg` panels. P9 eyeball each modal. |

---

## 5. Sequencing Rationale

The ten prompts are ordered so each later prompt assumes the earlier ones' invariants are in place:

- **P1** (tokens) lands first so every subsequent prompt is a className swap, not a redesign. Zero visual change yet — defers risk.
- **P2** (shell wrap) is the visible flip. It establishes the substrate + two-panel layout so every subsequent prompt has somewhere to sit. **This is the load-bearing prompt** — if it doesn't read right, P3+ are wasted work. DEVLOG screenshot mandatory.
- **P3** (left sidebar interior) + **P4** (right panel interior trim) are independent sweeps inside the two panel containers landed by P2. They can in principle run parallel but stay sequential to keep verify gates simple.
- **P5** (chat column transparent + input pill softening) finishes the workspace-shell story — the chat column needed P2's substrate to exist before it could be made transparent against it.
- **P6** (modal interior cleanup) is independent of the chat work and could ship anywhere from P3 onward; placed mid-phase because CustomizeView's three-column inner panels mirror the workspace pattern P2 lands, so the conceptual transfer is fresh.
- **P7** (in-chat surfaces) comes after P5 so the chat column's transparent substrate is already in place when banners and tool cards lose their borders — they read against the right backdrop from the start.
- **P8** (auxiliary sweep) catches stragglers using the `grep -rn` worklist; placed late so the "shape" of what survives the allow-list filter is clear from P3–P7 precedent.
- **P9** (light + dark QA + preset polish) is the visual gate. It catches any preset whose token values don't read; it also enforces the two preservation guarantees (interior cards unchanged, `FloatingEnvironmentCard` behavior identical) via explicit eyeball checks.
- **P10** (phase wrap) is bookkeeping.

Each prompt's verify gate is independently exercisable; if a prompt is blocked for a non-trivial reason, the next prompt can usually proceed because the substrate isn't yet shared at the className level. The two exceptions are **P2 → P3/P4** (P2 must land before sidebar interior cleanup can be evaluated against the new outer container) and **P5 → P7** (P5 must transparent-the-chat-column before in-chat banner restyling can be eyeballed against substrate).

---

## 6. Sign-off

When all 10 prompts are `[x]`, append:

```markdown
## [Panels Phase Complete] — <YYYY-MM-DD>

**Prompts completed:** P1 surface tokens + theme feed-through, P2 two rounded sidebar panels on transparent chat substrate, P3 left sidebar interior cleanup, P4 right panel interior trim (cards preserved), P5 chat column transparent + input pill softened (FloatingEnvironmentCard untouched), P6 modal interior section cleanup, P7 in-chat surfaces zero card chrome, P8 auxiliary panel sweep, P9 light + dark QA + preset polish + screenshot grid, P10 phase wrap (v0.6.0).

**Phase verify:**
- tsc node ✓
- tsc web ✓
- electron-vite build ✓
- light + dark eyeball across all theme presets ✓
- right-panel interior cards unchanged (pre/post pair-comparison) ✓
- FloatingEnvironmentCard behavior identical (fade timing verified on right-panel expand/collapse) ✓
- user-verification-needed: full end-to-end smoke per §3 completion criteria.

**Notes:** Lamprey now matches Claude Code on chrome restraint — two rounded sidebar panels on a warm substrate, transparent chat column with content flowing on the substrate, the bottom dock pill cluster as the only in-chat chrome. Right-panel interior cards preserved as-is per the existing-look-is-good constraint; FloatingEnvironmentCard untouched. Customize Phase (v0.5.x) shipped the first-class skills/connectors/plugins surface; this phase (v0.6.0) closes the visual gap that was left.

**Commit range:** <first-sha>..<last-sha>
```

---

**Status.** Drafted 2026-06-05. Awaiting explicit green light to start P1.
