# Lamprey

> A multi-provider, multi-agent coding harness with a Codex-class IDE on top of DeepSeek, Google Gemma, Alibaba Qwen, and OpenRouter.

## Verification

Run `npm run verify:proof` before handing off a coding change. It runs lint, both TypeScript projects, tests, and smoke checks when build output already exists.

Run `npm run verify:all` for the release-grade local gate: build first, then run the proof gate with smoke checks required.

Optional hook templates live in `scripts/hooks/`. They are not installed automatically.

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

## ⬇ Download v0.14.0

Pick one — the `.exe` is the standard installer, the `.zip` is the portable bundle (unzip and run `Lamprey.exe` directly, no install required).

| Format | File | Direct link |
|---|---|---|
| **NSIS installer** (Windows) | `Lamprey-x64.exe` | [Download .exe](https://github.com/USS-Parks/lamprey/releases/download/v0.14.0/Lamprey-x64.exe) |
| **Portable ZIP** (Windows) | `Lamprey-x64.zip` | [Download .zip](https://github.com/USS-Parks/lamprey/releases/download/v0.14.0/Lamprey-x64.zip) |

Or browse all releases → <https://github.com/USS-Parks/lamprey/releases>

**New in v0.14.0 — Unburdening Phase.** The deletion release. Thirteen prompts (UB-0 through UB-12) that strip out — not gate, remove — every subsystem the Claude Code / Opus 4.5 era product never had: the **multi-agent Planner→Coder→Reviewer pipeline** and its dispatch, the **auto-routing heuristic** and its telemetry, the **mechanical proof gate** (rigor scoping, change-contract synthesis, receipts scan, "Untrusted completion" banners), the **final-response composer** (the reply you read is now the model's reply, byte-for-byte), and all of their chrome — stage chips, pipeline traces, stage budgets, mode toggles, the Agents settings tab. **Net −7,400 lines.** Historical pipeline messages keep a single muted "Pipeline (legacy)" chip; the DB schema and store layers stay so nothing you wrote is lost; git history at the v0.13.0 tag holds the last full-machinery build. The system prompt contract drops to ~3.1 KB and the byte guards tightened accordingly. What remains is the product as declared: one model per turn with its full tool catalog, read–edit–verify, skills, MCP, research, RAG, the panels aesthetic, and the model-callable `multi_agent_run` tool for when the *model* chooses to fan out. Verify gate: lint clean, tsc node + web clean, full vitest green, build OK, `verify:proof` exit 0. See [PLANNING/LAMPREY_UNBURDENING_PLAN.md](PLANNING/LAMPREY_UNBURDENING_PLAN.md) and [PLANNING/UB_BASELINE.md](PLANNING/UB_BASELINE.md).

**Previously in v0.13.0 — Sweet Spot Phase.** A 13-prompt phase (SP-0 through SP-12) that locks Lamprey to its declared target: the look, feel, and default behavior of Claude Code in the Opus 4.5 era (November 24, 2025 → January 24, 2026). **Era defaults** — fresh installs now run a single agent with its full tool catalog and no proof-gate machinery (`agentMode: 'single'`, `proofGate: 'off'`, `toolSurface: 'full'`), and the final-response composer only runs when agentic coding mode is explicitly on — the reply you read is the model's own reply. Multi-agent, auto-routing, the mechanical proof harness, and the lazy tool surface all remain one click away as opt-ins; nothing was removed. **Seven defects closed** from a four-track code audit: the renderer/main defaults drift that made fresh installs nondeterministic (now one canonical `DEFAULT_APP_SETTINGS` + a parity lock test), the stall watchdog that fired on actively-working stages (kick now wired through stream chunks and tool completions), the spill directory that grew unbounded (startup GC: 7-day age sweep + 256 MB cap), the sticky mutation flag that armed the proof gate for entire conversations (cleared per turn), ghost replies when a turn failed before any output (a system notice now always lands), the router-telemetry IPC that was documented but never existed (After action panel gains a Routing section), and the silent better-sqlite3 test-skip cohort (verify:proof now prints explicit skip accounting). **Era chrome pass** — pipeline banners read "Planning / Writing code / Reviewing" instead of raw stage ids, "(orphan)" jargon is gone, and contract/receipt ids moved out of user-visible copy into tooltips. Verify gate: lint clean, tsc node + web clean, vitest 2384 passed / 123 skipped (+52 new tests), build OK, `verify:proof --no-tests` exits 0. See [PLANNING/LAMPREY_SWEET_SPOT_PLAN.md](PLANNING/LAMPREY_SWEET_SPOT_PLAN.md) and [PLANNING/SP_BASELINE.md](PLANNING/SP_BASELINE.md).

**Previously in v0.12.0 — Cogency Restore Phase.** A 13-prompt phase (CR-0 through CR-12) closing eight regressions surfaced by the L9 LL_SMOKE_PLAYBOOK against v0.11.0/v0.11.1. **Project vocabulary restored** — STS, P-SPR, Stem to Stern, Bucket, and "vocab clarifications are not build directives" (F13) live in a new `Project conventions` block in the contract, so the Planner stops hallucinating "P-SPR = Plan for Specifying and Performing" and the Coder stops scaffolding entire Python packages from terse user clarifications. **Abort-safe rollback for multi-agent pipelines** — when the pipeline bails after the Coder mutated files (a stage threw, or stalled), Lamprey now synthesises a `role:'system'` message naming the modified paths so the user has a clear `git restore` target instead of finding broken files on disk with no chat reply. Plus a `StageInactivityWatchdog` (F15) for the silent stall pattern observed in playbook Ask 6. **Router decision logging** — every routing decision now carries a `matchedRule` id (`default_single`, `phase_phrase`, `multi_file_phrase`, etc.) recorded in an in-memory ring buffer for diagnostics. Confirms via test that the heuristic is correct — the v0.11.0/v0.11.1 multi-routing on simple asks was the user's `agentMode='multi'` setting bypassing the router, not a heuristic regression. **Rigor predicate gated on mutation_attempted** — the proof-gate "Untrusted completion" pill no longer fires on multi-dispatch turns that didn't actually mutate anything; plan-mode turns and pure-question multi-dispatch turns stay clean. **Reviewer terse exemplar** — one compact worked example in `renderContract()` showing the desired review shape (cite by file:line, raise at most one concern, verdict on its own line). **Coder operational rules** — shell-syntax adapt after one failure (F7), never edit files via shell pipelines (F9 — `apply_patch` is the only safe edit path), default to the smallest correct fix (F13), and escalate to `ask_user_question` after three consecutive zero-match searches (F14). CR-6 and the CR-7 scope-creep half land as no-ops per revision 3 of the P-SPR — v0.11.1's Reviewer Packet Hotfix already closed those symptoms. Verify gate: tsc node + web clean, vitest 2332 passed / 123 skipped, `verify:proof --no-tests` exits 0. See [PLANNING/LAMPREY_COGENCY_RESTORE_PLAN.md](PLANNING/LAMPREY_COGENCY_RESTORE_PLAN.md), [PLANNING/CR_BASELINE.md](PLANNING/CR_BASELINE.md), and [PLANNING/CR_AFTER.md](PLANNING/CR_AFTER.md).

**Previously in v0.11.1 — Reviewer Packet Hotfix.** Fixes a load-bearing wiring defect in the M7 reviewer evidence packet that was making every multi-agent turn feel like merciless flogging. `runAgentPipeline` was passing the Coder's reply to `buildReviewEvidencePacket` as `builderNarrative`, but the builder gated inclusion behind a separate `includeBuilderNarrative` flag that no caller ever set. The Reviewer therefore reviewed a packet with the work product silently missing, then correctly returned `CHANGES` — for every turn, including casual ones — because it had no answer to evaluate. v0.11.1 inverts the API: `builderNarrative` is now included whenever supplied. The defense against the Coder's self-report persuading the Reviewer lives in the reviewer prompt and the field's explicit name (a labelled *claim*, not evidence), not in hiding the work product. The two tests that codified the old "must not contain coder narrative" invariant are flipped to assert the opposite, plus a positive assertion in M7 that the Coder's content reaches the Reviewer sub-agent's serialized packet. Verify gate: lint, tsc node + web, vitest 2265 passed / 123 skipped, `verify:proof --no-tests` exits 0.

**New in v0.11.0 — Hygiene Phase.** An 8-prompt context-economy phase (HY0–HY7) derived from a direct audit of the Claude Code harness against Lamprey: the differentiators were context hygiene and a thinner harness, not missing features. **Lazy tool surface** — instead of shipping all ~46 native tools' full JSON schemas to the model on every turn, Lamprey now sends a 12-tool always-on core set plus a `tool_search` meta-tool; the model unlocks the rest on demand via a search→resolve→unlock round-trip, cutting tool-schema bytes per turn by **63.8%** (native-only; the lazy surface stays flat as MCP connectors are added, so the real-world saving is larger). Falls back to the full catalog automatically for models that can't drive the round-trip, and is switchable via `toolSurface: 'lazy' | 'full'`. **Tool-result spill valve** — a large tool result (a big `git log`, a wide grep) is written to disk and the model receives a head+tail preview plus a `read_tool_result` ref, so one fat result no longer rides along in every later turn's context. **Lazy skill bodies** — active skills inject a name+description stub and load their full instructions on demand via `skill_open`. **Rigor-scoped proof gate** — the mechanical proof gate and change-contract machinery now engage only on verification-grade turns (audit / verify / prove, or multi-agent runs), leaving casual turns clean; L8 adaptive routing is unchanged. **Exemplar steering** — one compact worked example in the contract, which steers instruction-tuned models better than another prose rule. Verify gate: tsc node + web clean, vitest 2271 passed / 117 skipped, build OK, `verify:proof` exits 0. See [PLANNING/LAMPREY_HYGIENE_PLAN.md](PLANNING/LAMPREY_HYGIENE_PLAN.md) and [PLANNING/HY_AFTER.md](PLANNING/HY_AFTER.md).

**New in v0.10.0 — Lampshade Phase.** An 11-prompt prompt-cogency phase (L1–L11) that peels the over-instruction layer that was torturing outputs from DeepSeek / Gemma / Qwen and made them feel mechanical instead of cogent. **L1** baseline measurement found every coding-mode turn shipped ~2,725 tokens of operator instruction before the user message was even read; the Reviewer stage shipped 11,016 bytes of which ~89% was shared boilerplate. **L2** collapsed the 9-section / 52-bullet `Codex Agent Contract` into a single 13-bullet `How you work` block (9,311 → 2,113 bytes, −77.3%). **L3** made the `<think>` block conditional instead of mandatory on every turn (was: *"Every single assistant turn MUST begin with a `<think>` block. No exceptions — text-only replies, tool-call turns, one-line acknowledgements…"*; now: *"When the answer involves planning, multiple options, or a non-obvious decision, work through it inside a `<think>` block…"*); for native-reasoning models (those with a captured `reasoning_content` channel) the bullet is stripped entirely. **L4** slimmed the six role fragments from paragraphs of meta-explanation to 2–3 tight imperatives each (~70% average drop). **L5** stripped the full identity + contract from every agent sub-stage prompt; sub-agents now receive a one-line slim identity head + their role text, plus (coder only) a 3-line operating-principles excerpt. Reviewer drops 11,016 → 697 bytes (−93.7%). **L6** dropped `PSEUDO_TAG_GUARD` from every prompt site; the persist-side `sanitizePseudoTags` (HX3/HX4) remains the safety net and `messages.content_raw` still preserves verbatim originals. **L7** slimmed `COMPOSER_SYSTEM` (dropped the mandatory `<think>`, softened the structure mandate to a soft suggestion, kept the proof-receipt citation rule verbatim because the M-phase gate depends on it). **L8** added a new `'auto'` agent-mode option that became the default for new installs — a pure heuristic in `electron/services/agent-router.ts` decides per turn whether to dispatch through single-agent or the multi-agent pipeline based on prompt shape (long prompts / phase phrases like P-SPR / STS / build-from-scratch / multi-file refactor / sequential markers / multiple deliverables → multi; everything else → single). Power users can still pin Single or Multi explicitly in Settings. **L9** added 5 envelope-shape guard tests + a fully-authored 8-ask cogency playbook (`PLANNING/LL_SMOKE_PLAYBOOK.md`) for hands-on regression testing. Final numbers: `renderContract()` 9,311 → 2,113 bytes (−77.3%); coding-mode single-agent prompt 10,897 → 2,753 (−74.7%); reviewer agent prompt 11,016 → 697 (−93.7%); planner 10,630 → 311 (−97.1%). All shipped tools, UX, panels, function-calling infrastructure, mechanical-proof harness, RAG, Snip, Skills, Plugins, Reasoning-Trace Viewer, and Bucket pipeline untouched. Verify gate: tsc node + web clean, vitest 2222 passed / 123 skipped, `verify:proof` exits 0. See [PLANNING/LAMPREY_LAMPSHADE_PLAN.md](PLANNING/LAMPREY_LAMPSHADE_PLAN.md) and [PLANNING/LL_AFTER.md](PLANNING/LL_AFTER.md).

**New in v0.9.2 — Schema Bootstrap Hotfix.** Fixes a v0.9.1 P0 bug where the chat input would reject every send with `table messages has no column named proof_status`. Root cause: the `conversation_rag_attachments` DDL in `schema-init.ts` used a `PRIMARY KEY (conversation_id, COALESCE(collection_id, ''), COALESCE(document_id, ''))` constraint, but SQLite rejects expressions inside `PRIMARY KEY` / `UNIQUE` *table* constraints (`expressions prohibited in PRIMARY KEY and UNIQUE constraints`). Every launch on an existing DB hit that throw partway through segment 5 of `initLegacySchema`, which aborted before `runMigrations(db)` was reached. Result: `user_version` stayed at 0, every migration v1-v16 was skipped, and the WC-4 `INSERT INTO messages (..., proof_status, ...)` had no column to write to. The `schema-init.test.ts` regression test that should have caught this silently skipped under the better-sqlite3 NODE_MODULE_VERSION mismatch (vitest's Node v137 ≠ Electron's v133) on every CI + local run. Fix: the uniqueness rule moves to a `CREATE UNIQUE INDEX (conversation_id, COALESCE(collection_id, ''), COALESCE(document_id, ''))` — SQLite *does* allow expression columns in `UNIQUE INDEX`, and the existing `ON CONFLICT(...)` upsert in `rag/store.ts` matches the new index byte-for-byte. On next launch every v0.9.1 user's DB completes `initLegacySchema` (creating the previously-missing `sessions_fts` / `snip_events` / `snip_command_log` / `message_stage_metrics` / `conversation_rag_attachments` tables), then `runMigrations` runs v1 → v16 in order, idempotently — `messages.proof_status` is added, `proof_receipts` / `change_contracts` / `failure_ledger` are created, and the next chat send succeeds.

**New in v0.9.1 — Wiring Closure Phase.** An 11-prompt correctness phase (WC-0 → WC-11) that closes seven documented-but-dead-code gaps from the three preceding major phases. (1) `normalizeToolsForProvider` was exported in v0.9.0 but never invoked — every outgoing tool list now passes through the FC-3 normalizer (core-tool fail-fast on incompatibility, non-core drop with warning) via `toolRegistry.getNormalizedToolsForProvider`. (2) `filterToolsForRole` (FC-8) was similarly dead code — the chat dispatch now invokes the role-aware getter with `'coder'` so Planner / Reviewer subsets are honored. (3) Implicit change contracts (M2) are now actually synthesized — `ensureImplicitContractForFirstMutation` runs inside `resolveSingleToolCall` before the first mutating tool call on any correlation id without an active contract, so the M5 proof gate finally has scope to evaluate against on ordinary coding turns. (4) Migration v16 adds `messages.proof_status TEXT` so trust state is a structured column instead of parsed prose; the M5 gate's verdict is now persisted alongside the message. (5) The `ProofGateBanner` reads trust state from `messages.proof_status` via the new `computeProofBannerState` helper (with legacy notice fallback for pre-WC-4 rows); on successful waiver, a new `messages:setProofStatus` IPC flips the column to `'waived'` so the banner stays gone on reload. (6) The composer (M9) now appends a deterministic `**Verification:**` footer that cites each receipt id, glyph, kind, command, parsed metrics, and exit code — the model's reply is preserved exactly so receipt ids reach the user regardless of model behavior. (7) `verify:proof` is now invoked by CI: `.github/workflows/ci.yml` runs `npm run verify:proof -- --no-tests` as the M10 static gate, replacing the inline lint+tsc combo. (8) The PRJ-10 regression test was validation-only; new `Sidebar.project-flow.test.ts` adds 13 source-reading wiring-contract assertions including the negative `window.prompt(` check that locks the original sidebar "+" defect. Architecture docs and the three audited plans now carry `Invoked from: <file>:<line>` citations and append-only correction notes pointing at this phase. Final verify gate: lint OK, tsc node + web OK, vitest 2193 passed | 123 skipped, build OK, verify:proof exits 0. See [PLANNING/LAMPREY_WIRING_CLOSURE_PLAN.md](PLANNING/LAMPREY_WIRING_CLOSURE_PLAN.md).

**v0.9.0 — Persistence & Seed Phase.** A 24-prompt phase across three tracks that hardens the persistence floor under Lamprey to a level a regulated-industry user (HIPAA, ITAR, attorney-client privilege) can actually rely on, and finally wires the "per-hunk chat seeding" UI promise into real behaviour. **Track A — Persistence Hardening (PS1–PS10):** versioned migration ledger gated by `PRAGMA user_version` (transactional, downgrade-guarded); WAL `TRUNCATE` checkpoint on graceful shutdown plus a periodic 5-minute checkpoint so an ungraceful exit can no longer leave a multi-hundred-MB WAL; `busy_timeout = 5000` pragma + `withWriteRetry` helper around `saveMessage` and `insertToolCall` so multi-process write contention can no longer silently drop a chat row or audit row; `PRAGMA integrity_check` at every startup surfaced through a non-dismissible **IntegrityBanner** with restore + read-only actions; daily `db.backup()` snapshot to `userData/backups/lamprey-YYYY-MM-DD.db` with 14-day rolling retention and a one-click restore that atomically moves the corrupt DB to `.corrupt-<ts>`; the 700-line `initSchema` partitioned into seven named per-domain segments in `schema-init.ts` (`database.ts` shrinks from 754 → 356 lines); vec0 dimension guard via a singleton `rag_embedder_meta` table that throws a structured `EmbedderDimensionMismatchError` when a future embedder swap mismatches dims; per-stage transactional commit of message + stage metric pairs in `agent-pipeline.ts` plus `findOrphanPipelineStages` for cross-stage orphans; optional SQLCipher passphrase encryption gated on `better-sqlite3-multiple-ciphers` (off by default, no new hard dependency); and a new Settings → **Persistence** panel surfacing every lever with live DB / WAL / SHM sizes, last checkpoint, last integrity check, latest backup, and encryption status. **Track B — Fork & Seed Surface (PS11–PS20):** schema migration for fork lineage (`forked_from_id`, `forked_from_message_id`, `seed_blob`, `seed_source_kind`); full `conversation:fork` IPC parameter surface (sourceConversationId, sourceMessageId, seedKind, seedContent, includeRagAttachments, workspaceMode, titleOverride); workspace re-anchor on fork (closes the silent footgun where forks inherited the source's worktree path mid-context-switch); RAG attachment copy on fork; a sentinel-prefixed `<seed_context>` first-user-turn channel (PSEUDO_TAG_GUARD whitelisted); the Fork button on every assistant bubble now opens a real ForkDialog and creates a seeded conversation instead of showing "coming soon"; per-code-block "Extract to side chat" chip on every fenced ` ```code``` ` region; the Side-chat panel accepts a `seedMessageId` prop; a forked-from chip walks up to 10 levels of lineage in the conversation header; and a token-budget guard with auto-attach-as-RAG fallback when seed > 8K chars. **Track C — wrap (PS21–PS24):** Pin-as-memory wiring (the adjacent Fork sibling stub now creates a real chapter via `session:markChapter`); event-spine telemetry for `persistence.checkpoint` / `persistence.integrity` / `persistence.backup` / `persistence.recovery` (plus Track B's `conversation.forked` / `conversation.seed.attached` / `conversation.seed.truncated`); ARCHITECTURE/PERSISTENCE.md rewritten with Migration ledger + Backup/integrity/recovery + Legacy schema partition + Optional encryption sections; this README. Final verify gate: **tsc node + web pass; vitest 2014 passed | 94 skipped (143 files)** — zero failures across the full suite vs the pre-phase 1996/43/134 baseline.

**New in v0.9.x � Mechanical Proof Harness.** A 13-prompt phase (M1�M13) that turns Lamprey's agent framework into a mechanical proof layer: scoped change contracts with typed acceptance criteria, append-only verification receipts (vitest/tsc/eslint metrics parsed from command output), a pre-final proof gate that blocks untrusted completions until a fresh passing receipt exists after the last mutation, an independent reviewer evidence packet (raw evidence, not the builder's narrative), a failure-mode reviewer contract that rejects rubber-stamp reviews, a durable failure ledger with stable fingerprints that auto-promotes from proof events, and deterministic harness improvement recommendations that name the specific evidence behind each suggestion. See [ARCHITECTURE/MECHANICAL_PROOF.md](ARCHITECTURE/MECHANICAL_PROOF.md).

**New in v0.8.4 — Robustness Hotfix.** Two user-reported defects closed: (1) double-clicking the desktop launcher (or re-launching mid-splash) used to spawn a second independent Electron process — each opening its own SQLite handle on `lamprey.db`, its own MCP clients, its own watchers. v0.8.4 adds the standard `app.requestSingleInstanceLock()` to the main process: the second process exits immediately and the existing window restores + focuses (headless `lamprey --headless …` CLI invocations are exempted so parallel one-shot runs still work from a shell). (2) The bash-as-prose ghost-reply defect that survived the RT1 reviewer guard — coder occasionally emitted `<bash>find …</bash>` (or `<tool>`, `<run>`, `<shell>`, `<execute>`, `<command>`, `<terminal>`, `<output>`, `<result>`, `<stdout>`, `<stderr>`) as final prose instead of invoking a real tool, the bubble rendered the pseudo-XML verbatim, and the user had to re-prompt to wake the model up. v0.8.4 ships a belt-and-braces fix: the RT1 guard is extracted into a shared `PSEUDO_TAG_GUARD` constant and applied across every model-facing role (planner, coder, reviewer, coworker) + the composer system block, AND a persist-side `sanitizePseudoTags` rewriter that converts stray pseudo-XML pairs into honest fenced markdown blocks before the row hits the chat bubble. A new `content_raw` column on `messages` preserves the verbatim original for the audit trail — UI continues to read the sanitized `content`; the raw column is opt-in for future Reasoning-Trace Viewer extensions.

**New since v0.8.0 — the Reasoning-Trace Viewer panel + right-panel polish.** v0.8.1 ([Reasoning-Trace Phase](PLANNING/LAMPREY_REASONING_TRACE_PLAN.md)) closes the five "out of scope" items from the v0.8.0 Reasoning Audit Phase: (1) the Reviewer is now guarded against `<bash>`-as-prose pseudo-tool hallucinations; (2) every assistant message persists a `message_stage_metrics` row (single mode → one `stage='single'` row, multi-agent → three rows for planner / coder / reviewer) so per-stage token cost is real-time visible as `StageTokenChips` on the bubble and a live `stage:<role>` segment on the streaming status line; (3) a new model-callable `get_conversation_history` tool lets the model address prior turns by index (low-risk, no approval gate, opt-in stage metrics + tool calls); (4) a dedicated **Reasoning Trace Viewer** is now the 11th right-panel pill — lists every assistant turn, expands each to per-stage subsections with debounced text search and stage-filter chips (All / Planner / Coder / Reviewer / Single); (5) audit-trail export to `.md` or `.csv` via the local `dialog.showSaveDialog`, reasoning content verbatim. v0.8.2 + v0.8.3 are right-panel polish: all nine pills now seat inside the panel at default width and distribute evenly with `flex-1 basis-0 min-h-[58px]`, the Background tasks icon was dilated 6.3% → 7.9% opaque to stop reading "faded" under the dark-mode invert filter, and the Reasoning trace pill finally has its own paired-PNG icon (Light + Dark View) instead of reusing the Plan icon. See [the spec](PLANNING/LAMPREY_REASONING_AUDIT_PLAN.md) for the v0.8.0 Reasoning Audit Phase that the v0.8.1+ work builds on.

**Windows 10/11 x64.** Linux and macOS are buildable from source (`npm run build:linux` / `npm run build:mac`).

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

### Claude Code parity layer

Lamprey now includes the UI Mastery parity surfaces:

- **Activity dashboard**: live sidebar tree for conversations, workflows, subagents, cron jobs, wake-ups, loops, and hooks, with status chips and a watch tray.
- **Workflow palette and runtime**: `Ctrl+K` opens built-in and saved workflows; author workflows with validation, dry-run previews, journaling, resume, memory helpers, and structured `askUser(...)` pauses.
- **Sessions continuity**: grouped sessions, unread background-result badges, pin ordering, duplicate/archive/delete actions, and workflow resume affordances.
- **Plan-mode gate**: mutating tools are blocked at dispatch while read-only tools still run; the UI provides editable plan goals, approve/reject controls, and `Exit & Execute`.
- **Spawn-task tray**: spawned tasks collect in a persistent tray with per-task open, source-session link-back, open-all, and dismiss-all.
- **Hooks and skills management**: hook templates, sandbox test payloads, inline errors, skill hot-reload status, frontmatter validation, dry-run preview, and URL import.
- **Status line and AskUserQuestion UI**: configurable bottom status line plus chip-style user-choice modal for agents and workflows.

### Fluidity layer

Eleven micro-interactions that close the "feel" gap with Claude Code:

- **ESC cancels mid-stream** and **↑ / ↓ recalls past user prompts** in the input bar (caret-on-line-1 + no-selection guard so multi-line drafts still navigate natively).
- **Shift+Tab cycles** permission / plan modes — `default → auto-review → full → plan → default` — with a slim animated mode label under the bar. Only claimed when the textarea is empty so native focus navigation still works mid-draft.
- **`@file` inline mention** opens a workspace-file popover ranked by name overlap (extension matches dominate); Tab/Enter inserts a collapsed `@basename` token and queues the file as a regular attachment.
- **`#…` memory shortcut** flips the Send pill to "Remember" and routes the typed line into a pre-filled MemoryEditor (confirm-before-save — no silent writes).
- **Inline approval chips**: previously-approved, non-destructive (server, tool) pairs render as an in-transcript chip with `1`/`2`/`3` keystrokes (Approve / Deny / Always); the modal still owns first-touch and every destructive path.
- **Auto-collapse tool cards**: successful read/write/network tool cards mount collapsed; failures and destructive successes stay expanded. User toggles override the auto-rule for the life of the card.
- **Inline subagent group**: `multi_agent_run` tool calls render as nested chevron rows under one "Multi-agent run" header instead of a banner.
- **Status line context%**: replaces the tokens slot with `N% ctx` driven by `tokenSpend / activeModel.contextWindow`, tinting amber ≥ 70%, red ≥ 90%. New `branch` slot reads the current git branch.
- **Notification consolidation**: async background events for the active conversation surface as inline `TranscriptNotice` rows; toasts are reserved for off-conversation events and errors.
- **`path:line` autolinking**: bare `src/foo.ts:42` references in assistant prose render as clickable, dotted-underline spans that open the file panel at the right line.
- **Right panel default-collapsed**: new conversations start with the chat full-width; the panel auto-opens on artifact emit or tool launch, per-trigger and per-conversation, so a single dismiss sticks for that trigger until a different one fires.

### Deep Research

Twelve prompts that turn research-shaped chat turns into traceable, multi-source reports:

- **Auto-trigger**: an intent classifier routes research-worthy turns into the pipeline. Code-edit verbs (`fix`/`write`/`refactor`/…), path tokens, and plan mode are short-circuited so coding turns never escalate.
- **`/research <q>` slash command** forces the pipeline. **`--no-research`** prefix forces normal dispatch. Settings flag `deepResearch.autoTrigger` disables globally.
- **Provider cascade**: DuckDuckGo (no key required, ships as default) → Brave → SerpAPI by default. Configurable order in `deepResearch.providerCascade`. 429 / 5xx / empty SERPs fall through; results dedupe across providers by canonical URL.
- **Query planner**: 3 / 5 / 8 sub-queries (quick / standard / exhaustive) spanning factual baseline, recent news, opposing view, comparative, technical deep-dive.
- **Source collector**: parallel fan-out, canonical-URL dedup, per-domain cap (≤3 from each registrable domain so a single publisher can't dominate), spam blocklist, trust ranking (`.gov`/`.edu` + curated allowlist). Top N by depth tier: 12 / 25 / 50.
- **Readable-text extractor**: `<article>` / `<main>` / largest-block heuristic via `node-html-parser`, boilerplate/ad/cookie pruning, 30 KB cap per page.
- **Atomic claim extraction**: per source, LLM emits declarative facts with verbatim source spans (no opinions/marketing/nav text).
- **Multi-source corroboration**: claims clustered by RAG-embedding cosine ≥ 0.78. Independence counted by **registrable domain** (sibling sub-domains count once). ≥2 domains → `accepted`; 1 domain → `single-source`. Topical-overlap candidate pairs sent to a small LLM for opposition detection; contradicting pairs → `[disputed]`.
- **Strict-citation synthesizer**: every paragraph cites the source pool by index; single-source claims must use "According to [n]," disputed claims must cite both sides. Post-generation validator rejects any `[n]` not in the source pool — fabricated citations **fail the run** (one retry, then `FabricatedCitationError`). Bibliography is built deterministically from the source URLs, never from the model.
- **Artifact emission**: report lands at `userData/artifacts/research/research-<slug>-<timestamp>.md`. Chat message embeds an executive summary, sources/accepted/disputed counts, and an `[Open full report](artifact://research/...)` link that opens the right panel via `MarkdownRenderer` + `ResearchArtifact`. Download button drives the native save dialog.
- **Live progress banner** above MessageList: stage label, count progression (sources found / fetched / claims extracted / accepted / disputed), elapsed time, Cancel button. Cancellation honoured at every stage boundary via `AbortSignal`.

### Sandbox parity layer (shell_command)

Thirteen prompts that bring `shell_command` to functional parity with Claude Code's Bash tool:

- **Persistent cwd**: `cd <path>` / `Set-Location <path>` carries forward to the next call within the same conversation. Workspace boundary still enforced — escapes are silently dropped.
- **Shell selector**: `shell: "auto" | "bash" | "powershell"`. On Windows, `"bash"` resolves to Git Bash → WSL → clean error; on POSIX, `"powershell"` resolves to `pwsh` if installed.
- **Per-platform OS sandbox**:
  - macOS → `sandbox-exec` SBPL profile (deny default, workspace + tmpdir writable, configurable network egress).
  - Linux → `bubblewrap` (read-only system mounts, workspace + tmpdir rw, `--unshare-net` for `deny`).
  - Windows → no kernel sandbox; the result reports `Sandbox: none (windows host)` so the model and the user both see the weaker tier.
- **`dangerously_disable_sandbox: true`** opt-out for the rare case the sandbox blocks legitimate work. Forces the approval modal every call (no "always allow" applies), and tags the audit trail with `+sandbox-bypass`.
- **Monitor / list / stop / output aux tools** mirroring Claude Code's Monitor / TaskList / TaskStop / TaskOutput surface — drives the existing background-shell bus.
- **2-minute default timeout** (up from 30s) matching Claude Code; ceiling stays 10 minutes.
- **Anti-polling sleep guard**: solo `sleep N > 30s` outside a loop is rejected with a remediation hint pointing at `shell_monitor` + `untilPattern`. Override with `dangerously_disable_sandbox: true`.
- **Richer tool description** with PowerShell 5.1 quirks, HEREDOC patterns, no-interactive-command rule, "prefer dedicated tools" guidance, and `gh` for GitHub work.
- **`'sandboxBypass'` risk tag** in the permission vocabulary so audit rows and renderers can isolate bypass approvals from regular `tool:approval` events.

Spec: [PLANNING/LAMPREY_SANDBOX_PARITY_PLAN.md](PLANNING/LAMPREY_SANDBOX_PARITY_PLAN.md). Build entries: see DEVLOG (the "Sandbox Parity" entries from 2026-06-05).

### Snip — in-process shell-output token filter

Same concept as [rtk](https://github.com/rtk-ai/rtk) (Rust Token Killer) and [snip](https://github.com/edouard-claude/snip), implemented as a native layer inside Lamprey's main process. Every foreground `shell_command` runs through a declarative YAML pipeline before reaching the model, turning verbose tool output into the signal-only summary the LLM needs.

- **~120 built-in filters** covering git, JS/TS, Go, Rust, Python, Ruby, .NET, Docker/K8s, cloud/infra (terraform/helm/kubectl/aws/gcloud), build tools, files/search (ls/find/grep/rg), linting, package managers, system/network, and misc (gh/jira/ollama/sops). Ships with the app under `resources/snip-filters/`, bootstrapped into `userData/snip/filters/built-in/` on first launch.
- **YAML-extensible**: drop a `.yaml` file under `userData/snip/filters/` and chokidar hot-reload picks it up in ~1 second. User filters override built-ins of the same `name`. Primer: [docs/snip-filter-primer.md](docs/snip-filter-primer.md).
- **`gain` dashboard** at Settings → Snip: tokens-saved counter, avg-savings %, 14-day sparkline, top-5 filters by savings, recent activity, filter library with source badges (built-in vs. user vs. user-overrides-built-in).
- **`discover` panel** (rtk analogue): scans the shell-call history for commands that ran without a matching filter, ranks by total tokens spent, surfaces them as "consider writing a filter for X" suggestions with category hints and a "Write a filter" button that opens the user filter dir.
- **Per-call `bypass_snip: true`** on `shell_command` (rtk `proxy <cmd>` analogue): the model can force raw output for one call when the verbose body IS the signal (debugging a filter regression, forensic dig). Documented in the descriptor schema.
- **Master kill-switch** `snipEnabled` (default `true`): flips the entire layer to pass-through with zero DB writes, zero matcher runs.
- **Verbose mode** for the dashboard's activity log; never decorates the text the model sees (Invariant 13 — would corrupt structured tool output).
- **Status-line slot** `snip: 1.2k saved` shows today's savings in emerald; hidden until the first event; click opens the dashboard.
- **Best-effort tracking**: DB write errors swallowed silently (Invariant 5) — a locked SQLite never blocks the model from receiving the filtered output.
- **Failure pass-through by default**: filters run only on exit code 0 unless they opt in via `match.exitCodes`. The model always sees raw error text for failed commands.

Spec: [PLANNING/LAMPREY_SNIP_PLAN.md](PLANNING/LAMPREY_SNIP_PLAN.md). Build entries: see DEVLOG (the "Snip" entries from 2026-06-05).

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

`Shift+Tab` toggles plan mode anywhere in the chat input. When ON, Lamprey blocks mutating tools at dispatch while read-only tools keep working. The chat shows a sticky `Exit & Execute` banner and an editable plan-goals panel; approve all marks the plan done and exits the gate, while reject clears the current plan.

### Worktrees + thread kinds

- Conversations carry a `kind` (`local` / `cloud` / `worktree`) and an optional `worktreePath`.
- Sidebar shows a small `wt` / `cl` badge next to non-local threads.
- The **Worktrees** action in the sidebar opens a manager modal: list `git worktree list`, create with `git worktree add -b <branch> <path>`, remove with `git worktree remove`. After creating, optionally seeds a new conversation tagged to that worktree.

### AGENTS.md

If your repo has `AGENTS.md` (or `agents.md`/`Agents.md`) at its root, Lamprey reads it on every chat send and injects it into the system prompt as `<agents_md>…</agents_md>`. 20 KB cap; cached for 5 seconds. Same idea as Codex's spec — repo-specific instructions the model needs to know that aren't obvious from the code.

### Hooks (Settings → Hooks)

User-defined JavaScript sandbox hooks that fire on lifecycle events:

- `sessionStart` — once on app launch
- `promptSubmit` — every chat send
- `agentStop` — every chat completion
- `preToolUse` / `postToolUse` — before and after tool dispatch

`preToolUse` hooks can block a tool by throwing. Settings includes templates, timeout controls, sandbox test payloads, and inline error output.

### Automations (Settings → Automations)

5-field cron-scheduled prompts. Pure-JS cron parser supports `*`, exact, lists `a,b,c`, ranges `a-b`, step `*/N`. Pick a model, write a prompt, set the schedule, see last-run output collapsed under each entry. Local-only — your computer needs to be running for the schedule to fire.

### Skills + MCP

- **Skills**: hot-reloading markdown system-prompt fragments (chokidar watcher, grey-matter frontmatter, ~150 ms reload). Drop a `.md` in `userData/skills/`, toggle it on, it's part of the system prompt. Settings includes a skill manager with validation, dry-run preview, and URL import.
- **MCP servers**: SSE + stdio transports. Gmail + Drive (Google OAuth) and Chrome (Playwright) ship by default. Destructive Chrome actions require explicit user approval with a 30-second timeout.

---

## Quick start

1. **Download** the [v0.14.0 installer](https://github.com/USS-Parks/lamprey/releases/download/v0.14.0/Lamprey-x64.exe) and run it.
2. **Get a key.** Easiest: <https://platform.deepseek.com> → sign up → create key → load $5. Lamprey also accepts Google AI Studio (Gemma), Alibaba DashScope (Qwen), and OpenRouter keys.
3. **Paste your key** in the first-run modal. It's stored with `safeStorage` (OS keychain) under `userData/keys.json`.
4. **Type something.** That's it.

Optional: add `AGENTS.md` to your repo to give the assistant repo-specific context on every send.

**Connect GitHub (optional).** Settings → GitHub → Connect to clone private repos, push branches, and open pull requests from inside Lamprey. See [docs/github-setup.md](docs/github-setup.md) for the three auth paths (bundled OAuth, BYO OAuth App, local `gh` CLI).

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

Built and shipped (v0.12.x):

- ✅ **Unburdening Phase** (v0.14.0) — full scaffolding excision (UB-0 through UB-12): multi-agent pipeline, auto-router, runtime proof machinery, and composer deleted outright (−7,400 lines); era chrome only; contract down to ~3.1 KB. Lamprey breathes.
- ✅ **Sweet Spot Phase** (v0.13.0) — 13-prompt era-lock + defect-closure phase (SP-0 through SP-12): defaults realigned to the Claude Code / Opus 4.5 era (single agent, full tool surface, proof gate off, composer opt-in), seven audited defects closed (defaults drift, dead watchdog kick, unbounded spill dir, sticky mutation flag, ghost replies, missing telemetry IPC, silent test skips), UI chrome neutralized. Power machinery intact as opt-ins.
- ✅ **Cogency Restore Phase** (v0.12.0) — 13-prompt phase (CR-0 through CR-12) closing eight regressions surfaced by the L9 LL_SMOKE_PLAYBOOK run against v0.11.0/v0.11.1. Project vocabulary (STS / P-SPR / Stem to Stern / Bucket / F13 vocab-vs-build) restored to the contract via a new `Project conventions` block so the Planner stops hallucinating "P-SPR = Plan for Specifying and Performing" and the Coder stops scaffolding entire systems from terse user clarifications. **Abort-safe rollback** for the multi-agent pipeline — when a stage throws or stalls after the Coder mutated files, a synthesised `role:'system'` message names the modified paths so the user has a clear `git restore` target instead of finding broken files on disk with no chat reply. Includes a `StageInactivityWatchdog` (F15) for the silent stall pattern observed in playbook Ask 6. **Router decision logging** — every routing decision now carries a `matchedRule` id recorded in a 50-entry in-memory ring buffer for diagnostics. Lock tests confirm the heuristic is correct on all 7 LL_SMOKE_PLAYBOOK asks; the v0.11.0/v0.11.1 multi-routing observed at runtime was the user's `agentMode='multi'` setting bypassing the router, not a heuristic regression. **Rigor predicate gated on `mutation_attempted`** — the proof-gate "Untrusted completion" pill no longer fires on multi-dispatch turns that didn't actually mutate anything; plan-mode and pure-question turns stay clean. New `rigorRequiresMutation` setting (default `true`) gates the behavior. **Reviewer terse exemplar** — one compact worked example in `renderContract()` showing the desired review shape. **Coder operational rules** — shell-syntax adapt after one failure (F7), never edit files via shell pipelines (F9), default to the smallest correct fix (F13), escalate after three zero-match searches (F14). CR-6 and the CR-7 scope-creep half land as no-ops per revision 3 of the P-SPR — v0.11.1's Reviewer Packet Hotfix already closed those symptoms. Verify gate: tsc node + web pass, vitest 2332 passed / 123 skipped, `verify:proof --no-tests` exits 0.

Built and shipped (v0.11.x):

- ✅ **Reviewer Packet Hotfix** (v0.11.1) — fixes a load-bearing wiring defect in the M7 reviewer evidence packet that was making the Reviewer return `CHANGES` on every multi-agent turn (including casual ones) because the Coder's reply was being silently dropped from the packet. `runAgentPipeline` was passing the Coder's content to `buildReviewEvidencePacket` as `builderNarrative`, but inclusion was gated behind a separate `includeBuilderNarrative` flag no caller ever set, so the Reviewer was reviewing a packet with the work product missing and correctly noting its absence. v0.11.1 inverts the API: `builderNarrative` is now included whenever supplied — the defense against the Coder narrating its way past review lives in the reviewer prompt + the field's explicit name (labelled *claim*, not evidence), not in hiding the work product. Two tests that codified the old invariant flipped; a positive assertion added that the Coder's content reaches the Reviewer sub-agent's serialized packet. Verify gate: lint, tsc node + web, vitest 2265 passed / 123 skipped, `verify:proof --no-tests` exits 0.

- ✅ **Hygiene Phase** (v0.11.0) — 8-prompt context-economy + thin-harness phase derived from a direct audit of the Claude Code harness vs. Lamprey. Lazy tool surface (12-tool always-on CORE + `tool_search` meta-tool; rest unlocked on demand) cut model tool-schema bytes per turn by −63.8% native-only, flat regardless of MCP connector count. Tool-result spill valve writes oversize results to disk and gives the model a head+tail preview + `read_tool_result` ref. Lazy skill bodies inject name+description stubs + `skill_open` on demand. Rigor-scoped proof gate (`proof-rigor.ts`) leaves casual turns clean; engages only on verification verbs / multi-agent / `proofGate:'always'`. One compact few-shot exemplar embedded in the contract for instruction-tuned model steering. New optional settings (`toolSurface`, `toolResultSpill`, `proofGate`) with safe defaults. Verify gate: tsc node + web pass, vitest 2271 passed / 117 skipped, build OK, `verify:proof` exits 0.

Built and shipped (v0.10.x):

- ✅ **Lampshade Phase** (v0.10.0) — 11-prompt prompt-cogency phase that peels the over-instruction layer that was making DeepSeek / Gemma / Qwen output feel tortured. Collapsed the 9-section / 52-bullet `Codex Agent Contract` to a single 13-bullet `How you work` block (9,311 → 2,113 bytes, −77.3%). Made the `<think>` block conditional instead of mandatory on every turn; native-reasoning models get it stripped entirely. Slimmed the six role fragments from paragraphs to 2–3 tight imperatives each. Stripped the full identity + contract from every agent sub-stage prompt — Reviewer drops 11,016 → 697 bytes (−93.7%). Dropped `PSEUDO_TAG_GUARD` from every prompt site; the persist-side `sanitizePseudoTags` (HX3/HX4) remains the safety net. Slimmed `COMPOSER_SYSTEM` while keeping the load-bearing proof-receipt citation rule verbatim. **Adaptive `'auto'` agent-mode** — a new heuristic in `electron/services/agent-router.ts` decides per turn whether to dispatch single-agent or multi-agent based on prompt shape (length, phase phrases, build-from-scratch, multi-file refactor, sequential markers, deliverable count). `'auto'` is the new default for new installs; Single / Multi remain as explicit pins. New 8-ask cogency playbook in `PLANNING/LL_SMOKE_PLAYBOOK.md` for hands-on regression testing. All shipped tools, UX, panels, function-calling infrastructure, mechanical-proof harness, RAG, Snip, Skills, Plugins, Reasoning-Trace Viewer, and Bucket pipeline untouched. Final verify gate: tsc node + web pass, vitest **2222 passed / 123 skipped**, `verify:proof` exits 0.

Built and shipped (v0.9.x):

- ✅ **Wiring Closure Phase** (v0.9.1) — 11-prompt correctness phase that closed seven documented-but-dead-code gaps from the three preceding major phases. `normalizeToolsForProvider` + `filterToolsForRole` (FC) now actually wired through the dispatch path; implicit change contracts synthesized on first mutation (M2); `messages.proof_status` column persists trust state structurally (M5); ProofGateBanner reads persisted status; composer appends a deterministic `**Verification:**` footer citing receipt ids; `verify:proof` invoked by CI as the M10 static gate; PRJ-10 wiring contract regression test pinning the sidebar "+" flow.

- ✅ **Persistence & Seed Phase** (v0.9.0) — 24-prompt phase across three tracks. **Track A — Persistence Hardening:** versioned migration ledger gated by `PRAGMA user_version` (transactional, downgrade-guarded); WAL `TRUNCATE` checkpoint on shutdown + periodic 5-min checkpoint; `busy_timeout` + `withWriteRetry` around `saveMessage`/`insertToolCall`; `PRAGMA integrity_check` at startup surfaced through a non-dismissible `IntegrityBanner` with restore + read-only actions; daily `db.backup()` snapshot with 14-day rolling retention; the 700-line `initSchema` partitioned into seven named per-domain segments (`database.ts` 754 → 356 lines); vec0 dimension guard via `rag_embedder_meta` + structured `EmbedderDimensionMismatchError`; per-stage transactional commit + `findOrphanPipelineStages`; optional SQLCipher passphrase encryption gated on `better-sqlite3-multiple-ciphers` (no new hard dep); new Settings → **Persistence** panel surfacing every lever with live status. **Track B — Fork & Seed Surface:** schema migration for fork lineage; full `conversation:fork` IPC parameter surface; workspace re-anchor on fork (closes silent footgun); RAG attachment copy on fork; sentinel-prefixed `<seed_context>` first-user-turn channel; Fork button now wires through ForkDialog → IPC instead of "coming soon"; per-code-block "Extract to side chat" chip; Side-chat panel `seedMessageId` prop; forked-from chip with 10-level lineage walk; token-budget guard with auto-attach-as-RAG fallback when seed > 8K chars. **Track C — wrap:** Pin-as-memory wired (Fork sibling stub closed); event-spine telemetry for `persistence.*` + `conversation.forked` + `conversation.seed.*`; ARCHITECTURE/PERSISTENCE.md rewritten. Final verify gate: tsc node + web pass; vitest **2014 passed | 94 skipped (143 files)**, zero failures vs the pre-phase 1996/43/134 baseline.

Built and shipped (v0.8.x):

- ✅ **Robustness Hotfix** (v0.8.4) — duplicate-app launches blocked via `app.requestSingleInstanceLock()` (second process exits + restores/focuses the existing window; headless CLI invocations exempted). Bash-as-prose ghost-reply defect closed end-to-end: shared `PSEUDO_TAG_GUARD` constant now applied to planner / coder / reviewer / coworker + composer, and a persist-side `sanitizePseudoTags` rewriter converts stray `<bash>` / `<tool>` / `<run>` / `<shell>` / `<execute>` / `<command>` / `<terminal>` / `<output>` / `<result>` / `<stdout>` / `<stderr>` pairs into honest fenced markdown blocks. New `content_raw` column on `messages` preserves the verbatim original for audit. UI continues to read sanitized `content`; the raw column is opt-in for future RT-Viewer extensions.
- ✅ **Right-panel polish** (v0.8.2 + v0.8.3) — all nine right-panel pills (Files → Reasoning trace) seat inside the panel at default width and distribute evenly via `flex-1 basis-0 min-h-[58px]`. Background tasks icon dilated 6.3% → 7.9% opaque so it stops reading "faded" next to peers under the dark-mode `brightness(0) invert(1)` filter. Reasoning trace icon finally has its own paired-PNG art (Light + Dark View) instead of reusing the Plan icon.
- ✅ **Reasoning-Trace Viewer** (v0.8.1) — 11th right-panel pill that lists every assistant turn, expands each to per-stage subsections (Planner / Coder / Reviewer / Single), debounced text search, stage-filter chips, `.md` + `.csv` audit-trail export via local `dialog.showSaveDialog`. Live `StageTokenChips` on every assistant bubble + live `stage:<role>` segment on the streaming status line, backed by a new `message_stage_metrics` table. New model-callable `get_conversation_history` tool lets the model address prior turns by index. Reviewer system prompt hardened against `<bash>`-as-prose pseudo-tool hallucinations.
- ✅ **Reasoning Audit** (v0.8.0) — every model-emitted chain-of-thought (Planner, Coder per-round + cumulative, Reviewer, Composer) preserved on disk, surfaced in the chat UI behind a "Show pipeline trace ▾" toggle on the Coder/Composer bubble, and re-fed into the API stack on follow-up turns (gated, default ON). Closes the "no session history tool exists" gap. SDK-boundary fix: `chatOnce` now reads both `message.reasoning` (OpenRouter) and `message.reasoning_content` (DashScope / deepseek-reasoner).

Built and shipped (v0.7.x):

- ✅ Skill import from Claude Code (v0.7.0) — read-only on-disk discovery + per-skill enabled chips + "ext" warning chips
- ✅ Research reliability — Tavily promoted to primary in the cascade (`tavily → brave → serpapi → wikipedia → duckduckgo`), Wikipedia adapter as zero-key floor
- ✅ Panels Phase (v0.6.0) — Claude-Code-style two-tone substrate with two rounded sidebar panels; chat column transparent
- ✅ Stall & Timeout Phase — SSE inactivity watchdog + per-call MCP timeout + per-stage wall-clock budgets + streaming-vitals heartbeat
- ✅ Soft drop-shadow under both sidebars in Light Mode (v0.8.0)

Built and shipped (v0.3.1):

- ✅ Universal chain-of-thought — every model leads each turn with `<think>…</think>`, harness routes it into the dedicated `reasoning` column at save time, Reasoning panel lights up for every provider (not just DeepSeek's native-thinking variants)
- ✅ Permanent fix for stream-error data loss — partial content + reasoning persist as an interrupted-marked assistant message instead of evaporating on auth fail / retries-exhausted / network drop
- ✅ Background Tasks card now permanent session tool log — full call history (not just live), each row expandable to args + raw result
- ✅ Right-sidebar Plan card with editable goals + Approve/Reject; chat-input pip collapses to a one-line `Plan · N/M · gated` jump button; auto-opens on plan-mode gate engage
- ✅ Contract hardened against false "task complete" — zero-match grep is a stop signal, UI symptoms must be observed in the UI, no "nothing left" until the user's symptom is observably remediated

Earlier line (v0.2.x):

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

UI Mastery parity sprint:

- Complete activity dashboard, workflow palette, sessions sidebar, hook editor, skill manager, plan-mode UX, spawn-task tray, status line, and AskUserQuestion modal.
- Workflow library and runner support parallel agents, journaling/resume, model-tier routing, memory consolidation, and structured user questions.
- Background agents, async task notifications, cross-session messaging, self-paced wake-ups, cron scheduling, and session archive/search are wired into the desktop surface.

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
- ✅ Seven bundled workflow skills (`plan`, `context`, `debug`, `review`, `verify`, `frontend-qa`, `fan-out`)
- ✅ End-to-end agentic coding mode (input pill + auto-loaded skills)

Next up:

- Reasoning-level selector on the model switcher
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
