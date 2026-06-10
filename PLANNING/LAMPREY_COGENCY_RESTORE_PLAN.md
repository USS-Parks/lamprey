# LAMPREY_COGENCY_RESTORE_PLAN.md — Cogency Restore Phase (CR0–CR12)

> **Status: PENDING APPROVAL.** This is a drafted P-SPR. It is not authorized to run STS
> until the user explicitly approves it. Nothing in this file constitutes self-authorization.
>
> **Revision 2 (2026-06-09):** v0.11.1 — Reviewer Packet Hotfix (`d28cf7c fix(pipeline):
> forward coder reply to reviewer via inverted builderNarrative API`) shipped to `main`
> after the original LL_SMOKE_PLAYBOOK run. That hotfix targets the *exact* symptom the
> Reviewer was exhibiting across Asks 3–8 ("no Coder output to review, verdict CHANGES").
> Two of the playbook findings I originally attributed to Lampshade regressions —
> **F5 (verdict-line intermittent)**, **F6 (Reviewer essay-shape)**, and **F12 (scope
> creep at composer wrap-up)** — were suspected to have been *downstream symptoms* of
> the Reviewer-packet bug, not contract regressions. CR-6 and CR-7 were gated behind
> a mandatory v0.11.1 playbook re-run.
>
> **Revision 3 (2026-06-09, post-re-run):** The v0.11.1 playbook re-run for Asks 3, 4,
> 5, 8 is complete (Ask 6 stalled mid-Coder during slice scaffolding and is excluded —
> see new finding **F15** below). Empirical results vs. the CR-6/CR-7 gates:
>
> | Gate | Threshold | Result | Decision |
> |---|---|---|---|
> | CR-6 verdict-line | ≥ 90% first-try across Asks 3,4,5,6,8 | **4 / 4 first-try hits (Ask 6 N/A)** | **CR-6 no-ops** |
> | CR-7 reviewer-exemplar half | median ≤ 12 lines AND template absent in ≥ 4/5 | **template present in 4/4, ~15-22 lines each** | **CR-7 reviewer half EXECUTES** |
> | CR-7 scope-creep half (F12) | Ask 4 stops without volunteer optimization fixes | **Asks 4 + 5 both asked / stopped, no volunteer fixes** | **CR-7 F12 half no-ops** |
>
> Additionally, the re-run surfaced **three new findings** that did not appear in the
> original playbook:
>
> - **F13 — Coder over-interprets vocabulary clarifications as build directives.**
>   Confirmed twice (Asks 6 + 8 v0.11.1). User says "P-SPR = Plan + Sequential Prompt
>   Roster" → Coder scaffolds a full Python p_spr/ package with 42 tests + telemetry
>   design doc. User approves "build a React chat app" → Coder scaffolds full Vite +
>   TypeScript + Zustand 5 + 6 components. Both are massive scope-up from terse user
>   clarifications. Distinct from F12 (volunteer fixes for unasked work). Fix lands as
>   a bullet in CR-1 + a bullet in CR-8.
> - **F14 — Coder exploration loop unboundedness was not resolved by v0.11.1.** Ask 5
>   v0.11.1 ran 14 rounds (v0.11.0 had 15); Ask 6 v0.11.1 ran 54 tool calls before
>   stalling. CR-9 confirmed needed.
> - **F15 — Multi-agent pipeline can stall mid-mutation without erroring.** Ask 6
>   v0.11.1 stopped responding after 54 tool calls during Vite scaffolding + slice
>   creation. Distinct from F2 (silent abort after stage throws) — here no stage threw,
>   the pipeline just went quiet. CR-2 expands to cover BOTH thrown-stage and
>   inactivity-timeout paths.

---

## §0 — Governance

### Goal (one sentence)
Close the eight cogency regressions surfaced by the L9 smoke playbook (LL_SMOKE_PLAYBOOK.md,
session 2026-06-09) — restore project planning vocabulary, fix the auto-router's over-promotion
to multi, scope the proof gate correctly, prevent silent destructive aborts, and restore the
Reviewer's terse contract — without giving back any of the byte savings from L2/L6 or the
context-economy gains from HY1–HY6.

### Why this phase (the playbook finding)
The Lampshade phase shipped real byte savings (contract 9,311 → 2,113 bytes, Reviewer fragment
11,016 → 697 bytes) and the Hygiene phase shipped real schema savings (−63.8% tool bytes/turn).
The envelope-shape snapshot tests in `system-prompt-builder.test.ts` lock those gains.

A hands-on playbook run on v0.11.0 (DeepSeek V4 Flash for stages 1–3, V4 Pro for composer)
found that several **behaviors** the byte-cut prompts depended on regressed even though every
snapshot test passed. Recap of the headline failures:

1. **Project vocabulary lost.** Asks 7 ("STS the new error-boundary phase") and 8 ("Show me
   the P-SPR for adding telemetry") both prove the Planner has no concept of STS / P-SPR /
   Stem-to-Stern. Ask 7's first reasoning block reads verbatim: *"I suspect 'STS' might refer
   to a tool or action, perhaps 'State Transition System'? Or maybe it's a typo for 'Set' or
   'Start'?"* These terms are canonical per the user's CLAUDE.md execution rules but were not
   in the live `renderContract()` output. L2's contract collapse cut them as "redundant prose."
2. **Silent abort after destructive mutation.** Ask 7's Coder modified 7 files in the user's
   `league-of-legends-clone` project via `apply_patch` + PowerShell file-mutation fallback,
   broke the build (16 TS errors from misplaced braces + UTF-8 mojibake), and the multi-agent
   pipeline terminated without firing the Reviewer stage, without writing a Composer wrap-up,
   and without emitting a user-visible chat message. The user was left with broken files on
   disk and no notification.
3. **Auto-router over-promotes to multi.** Three of four expected-single asks (Asks 2, 3, 4)
   routed multi. Ask 4 ("Why is the build failing?") routed multi with zero file mentions —
   so the bad rule isn't purely file-noun-based. The L8 router fires too eagerly on something
   that's not currently logged.
4. **Proof gate fires on no-mutation turns.** Asks 2, 3, 4, 5, 6, 8 all displayed
   "Untrusted completion / No fresh passing proof receipt after the last mutation" pills
   even though no `apply_patch` or `shell_command` mutation was attempted. HY5's rigor predicate
   is triggering on multi-agent dispatch alone instead of `multi-dispatch && mutation_attempted`.
5. **Reviewer verdict-line intermittent.** Asks 3 and 5 produced reviews that omitted the
   `SHIP` / `CHANGES` verdict line and had to be re-prompted by the validation gate. Asks 4, 6,
   8 included it first try. ~40% miss rate on a load-bearing rule.
6. **Reviewer output remains essay-shaped despite L6 byte cut.** Every reviewer output across
   eight asks emits the same 5-category enumerated risk template ("Checked failure modes /
   risks", "Files, receipts, diffs, contracts consulted", "Unchecked gaps", "Specific
   findings", "Verdict"). L6's byte cut removed prose-rule bullets but the model defaults to
   the verbose template from training inertia. **A terse exemplar is needed, not just deletion.**
7. **Coder shell-syntax loop.** Asks 5, 6, 7 each show three or more sequential PowerShell
   syntax failures with no in-turn adaptation (e.g., `dir /s /b … 2>nul | head -10` repeated
   three times before pivot to `Get-ChildItem`).
8. **Coder exploration unbounded.** Ask 5 ran 15 rounds of negative searches before giving up.
   No "give up after N negative results" budget in the Coder contract.

The cogency claim of the Lampshade phase was that DeepSeek/Gemma/Qwen turns would feel less
tortured because the contract no longer drowned them in process rules. The byte savings landed.
The cogency mostly didn't. This phase closes that gap surgically — restoring the small number
of load-bearing rules that L2/L5/L6 cut as "redundant," instrumenting and tuning the router,
adding a safety net for destructive aborts, and keeping every other shipped behavior intact.

### Effect of v0.11.1 on the eight findings (revision 2 reassessment)
The v0.11.1 — Reviewer Packet Hotfix shipped 2026-06-10T02:01:25Z to `main` with the
description *"forward coder reply to reviewer via inverted builderNarrative API"*. The bug
was that the Reviewer's evidence packet did not include the Coder's reply text, so the
Reviewer was reviewing essentially an empty packet for every multi-agent turn. Every
Reviewer output in the playbook ran the same shape: "I cannot find a Coder output to
review, no diff, no receipts, verdict CHANGES." That is a downstream symptom, not an
independent Reviewer-contract regression.

Reassessment per finding (revision 3 — empirical results from v0.11.1 re-run):

| ID | Original attribution | v0.11.1 empirical result | CR action |
|---|---|---|---|
| F1 | Vocab missing from contract (STS/P-SPR) | confirmed still broken — Ask 8 v0.11.1 Planner hallucinated "Plan for Specifying and Performing" | **CR-1 EXECUTE** |
| F2 | Silent abort after destructive mutation | not retested in re-run; unchanged by v0.11.1 | **CR-2 EXECUTE** (expanded for F15) |
| F3 | Router over-promotes to multi | confirmed — Asks 3, 4, 5 still routed multi | **CR-3 / CR-4 EXECUTE** |
| F4 | Proof gate fires on no-mutation turns | confirmed — "Untrusted completion" pill on Asks 3, 5 | **CR-5 EXECUTE** |
| F5 | Reviewer verdict-line intermittent | **RESOLVED by v0.11.1** — 4/4 first-try hits (Asks 3, 4, 5, 8) | **CR-6 NO-OP** |
| F6 | Reviewer essay-shape persists | confirmed still broken — 4-section template in 4/4 reviews, 15-22 lines each | **CR-7 reviewer-exemplar half EXECUTE** |
| F7 | Coder shell-syntax loop | partially confirmed — Ask 3 had one grep → Select-String adapt | **CR-8 EXECUTE** |
| F8 | `apply_patch` reliability | deferred (separate phase needed) | unchanged |
| F9 | PowerShell UTF-8 corruption | not retested (no successful patch path in re-run) | **CR-8 EXECUTE** |
| F10 | Coder exploration unbounded | renamed **F14** below — confirmed not resolved | **CR-9 EXECUTE** |
| F11 | L2 zero-matches behavior intermittent | confirmed — Ask 3 v0.11.1 searched, found zero matches, then asked self-contradictory question listing 5 readmes it had just confirmed empty | rolled into CR-1 |
| F12 | Scope creep at composer wrap-up | **RESOLVED by v0.11.1** — Asks 4 + 5 both asked clarification, no volunteer fixes | **CR-7 scope-creep half NO-OP** |
| **F13** | **NEW — Coder over-interprets vocabulary clarification as build directive** | confirmed Asks 6 + 8 v0.11.1; user says "X = vocab term" or briefly approves "build X" → Coder scaffolds full architecture (42 tests + telemetry doc; Vite + 6 components) | **CR-1 + CR-8 EXTEND** (new bullets) |
| **F14** | **NEW — Coder exploration loop unboundedness (rename of F10)** | confirmed — Ask 5 v0.11.1: 14 rounds; Ask 6 v0.11.1: 54 tool calls before stall | **CR-9 EXECUTE** (same as F10) |
| **F15** | **NEW — Multi-agent pipeline can stall mid-mutation without erroring** | confirmed Ask 6 v0.11.1 — pipeline stopped responding after 54 tool calls during Vite scaffolding + slice creation; no stage threw, just went quiet | **CR-2 EXPAND** (add inactivity timeout path) |

**Net effect of revision 3 on the phase:**
- **CR-6 no-ops** (verdict-line behavior resolved by v0.11.1) — saves ~80 bytes
- **CR-7's scope-creep half no-ops**; reviewer-exemplar half executes — saves ~150 bytes
- **CR-1 gains a fifth bullet** for F13 (vocab-clarification = consume, not build) — adds ~80 bytes
- **CR-2 expands** to cover both thrown-stage and stall paths (F2 + F15) — no contract impact (code-side change)
- **CR-8 gains a bullet** for F13 (default to smallest correct fix, no parallel-system scaffolding) — Coder-fragment add, not main contract
- **Byte budget unchanged at ≤ 600 bytes total contract regrowth** (CR-1 ≤ 300 + CR-7 reviewer half ≤ 300). CR-6 and CR-7-scope-creep no-ops free up the budget the F13 bullet uses.

### Scope (what this phase touches)
- `electron/services/system-prompt-builder.ts` — `renderContract()` gains a 4-bullet "Project
  conventions" block; reviewer fragment regains the verdict-line rule + a terse exemplar;
  scope-creep guard bullet added to composer; coder fragment gains shell-adapt and exploration
  budget bullets and an explicit "no shell-based file edits as fallback" rule.
- `electron/services/agent-router.ts` — emits a structured `routerDecision` log per dispatch
  showing matched rule. Router tuning lands in a separate prompt after baseline data exists.
- `electron/services/proof-rigor.ts` — `isRigorTurn` predicate scoped to `(rigor &&
  mutation_attempted && !planMode)`. Multi-agent dispatch alone no longer trips rigor.
- `electron/ipc/chat.ts` — `runMultiAgent()` wrapped with a stage-failure handler that
  synthesizes a user-visible `role:'system'` message and an optional revert prompt when a
  downstream stage fails after mutations have already landed.
- `electron/services/agent-pipeline.ts` — `SubAgentRunner` / `ForkAgentRunner` typed error
  paths so the chat handler can distinguish "stage threw" from "stage produced empty output."
- New `electron/services/router-telemetry.ts` — small append-only ring buffer of router
  decisions surfaced under `/debug` for diagnosis; opt-in via setting.
- `AppSettings` — three new optional toggles (`abortRollbackPrompt`, `routerTelemetry`,
  `rigorRequiresMutation`); safe defaults preserve current behavior where prudent and improve
  it where the playbook found regressions.
- Tests: `agent-router.test.ts` gains expected-route assertions for each of the 8 playbook
  asks; `system-prompt-builder.test.ts` snapshot updates for vocab + reviewer exemplar;
  new `chat.abort-rollback.test.ts` for the silent-abort safety net.
- `DEVLOG.md`, `README.md`, `CLAUDE.md` Current State, `package.json` version bump to
  **v0.12.0** (CR-12 only).
- `PLANNING/LL_SMOKE_PLAYBOOK.md` — pass criteria updated to v0.12.0 expectations.
- `PLANNING/CR_BASELINE.md` + `PLANNING/CR_AFTER.md` (CR-0 and CR-12) — before/after
  measurements grounded in the playbook reruns, not synthetic metrics.

### Non-goals (explicitly out of scope)
- **No removal** of the multi-agent pipeline, change contracts, proof-receipt format,
  mechanical-proof harness, `**Verification:**` footer (WC-6), `sanitizePseudoTags` net
  (HX3/HX4), or any tool / skill / connector / panel / plugin shipped through prior phases.
- **No change to the proof-receipt JSON format, the receipt-ledger schema, the change-contract
  schema, or the failure-ledger fingerprinting** — only *when the gate engages* (predicate
  change only) and *how a failed dispatch surfaces to the user* (post-mutation safety net).
- **No re-introduction of PSEUDO_TAG_GUARD prompt text** (L6 cut it; HX3/HX4 sanitizer is the
  persist-side net and stays as-is).
- **No tuning of the auto-router rules in CR-3** — CR-3 only instruments. CR-4 tunes based on
  the data CR-3 produced. Two prompts so the router fix is data-driven, not speculative.
- **No investigation of `apply_patch` reliability or UTF-8 round-trip corruption** in this
  phase. Those are real findings (Ask 7 hunk-mismatch + mojibake) but require their own
  investigation phase against the patch tool's normalization logic. Acknowledged in §3; deferred.
- **No AskUserQuestion 4-option cap fix** — playbook surfaced this but it's tool-envelope
  contract work, not cogency work. Deferred.
- **No re-spawning of the user's broken `league-of-legends-clone` files from Ask 7**. The user
  decides whether to revert via `git restore` or keep + repair the 16 TS errors. Out of scope.
- No UI/panel redesign; no `bucket.ps1` / release-pipeline changes; no version bump on any
  prompt other than CR-12.

### Key design constraint (read before CR-1) — revised in revision 3
The Lampshade and Hygiene phases' byte savings stay. CR-1 adds **at most 300 bytes** to the
contract (5 bullets, ≤ 60 bytes each on average — F13 fifth bullet added in revision 3).
CR-7 adds **at most 300 bytes** to the reviewer/composer slim — one terse exemplar review
(~5 lines). CR-7's scope-creep guard half no-ops per revision 3 empirical results.
Total contract regrowth target: **≤ 600 bytes**, against L2 savings of 7,198 bytes. Verify
gate measures the post-CR contract bytes in CR-0 / CR-12 baseline files; if regrowth exceeds
600 bytes, the bullets are too verbose and need recompression before commit.

### Verify gate (every prompt must pass before commit)
1. `npx tsc --noEmit -p tsconfig.node.json` — clean
2. `npx tsc --noEmit -p tsconfig.web.json` — clean
3. `npx vitest run <test files this prompt touches>` — clean (existing 2271 passing must remain
   green; new tests must pass; the 117 skipped from better-sqlite3 NODE_MODULE_VERSION are
   acknowledged unchanged)
4. Any prompt touching `electron/ipc/chat.ts`, `agent-router.ts`, `proof-rigor.ts`, or
   `system-prompt-builder.ts` also runs `npm run verify:proof -- --no-tests` — exits 0
5. Final phase gate (CR-12): full `npx vitest run` + `npm run build` + `npm run verify:proof`
   + manual re-run of LL_SMOKE_PLAYBOOK Asks 2–8 against a known-good workspace (NOT the
   user's `07 CCPC` Documents folder); ≥ 6 of 7 asks must hit primary signal cleanly

### Commit discipline
- One commit per prompt, present-tense imperative subject (`feat(router): CR-3 …`,
  `fix(rigor): CR-5 …`, etc.)
- DEVLOG entry per prompt under a new `## <date> — Cogency Restore Phase` section
- No squashing; no Co-Authored-By trailer (per project convention)
- No push until CR-12 unless the user explicitly says push earlier

### Branch / worktree
- Branch: `claude/cogency-restore` cut from `main` after the user approves this plan. Land in
  a dedicated worktree if running parallel to another track. If the user wants this run in the
  existing `loving-buck-6756d7` worktree where the plan was drafted, that's fine — the worktree
  is already on the right base.

### Completion criteria
- CR-0 through CR-12 all `[x]`, final gate green
- DEVLOG phase-complete entry under date `<date>` matching the format of HY7's wrap entry
- CLAUDE.md Current State updated with the CR phase summary (a paragraph mirroring the
  Lampshade and Hygiene entries) and `LAMPREY_COGENCY_RESTORE_PLAN.md` added to the
  reference-only execution-rules list under §1
- `package.json` bumped to **v0.12.0**
- README.md "New in v0.12.0" paragraph + roadmap top entry + table URL bumps
  (per the standing rule in `feedback_readme_is_part_of_ship`)
- LL_SMOKE_PLAYBOOK re-run results recorded in `PLANNING/CR_AFTER.md` with Asks 2–8 graded
  pass/fail against primary cogency signals. **Pass criteria: 6 of 7 asks hit primary signal
  cleanly.** Ask 7 (destructive build break) MUST hit its primary signal because the abort-safe
  rollback is one of this phase's headline fixes.
- Byte budget gate met: post-CR contract bytes ≤ pre-CR + 500 bytes
- Optional: Bucket pipeline run after `main` lands (`pwsh scripts\bucket.ps1`) if the user
  says "Bucket"

### Approval state
- **PENDING APPROVAL.** User reviews this file, says "approved" / "STS" / "Bucket" to start.
  Without that, this plan is reference text and no code changes occur.

---

## §1 — Prompt Roster

> Each prompt is independently verifiable, ships its own commit + DEVLOG entry, and leaves
> the tree green. Order matters: each prompt builds incrementally on prior diagnostics or
> instrumentation. CR-3 instruments the router; CR-4 uses CR-3's data to tune. CR-2 lands
> the abort-safe net early because the next Coder turn after CR-1 could be destructive on a
> user workspace, so the safety net should already be there.
>
> **Revision 3 (post v0.11.1 re-run):** The early partial of CR-11 (Asks 3, 4, 5, 8
> against v0.11.1; Ask 6 stalled — see F15) has been executed and recorded above.
> Empirical results: **CR-6 is no-op** (verdict-line behavior resolved, 4/4 first-try
> hits). **CR-7's scope-creep guard half is no-op** (F12 resolved, Asks 4 + 5 verified
> no volunteer fixes). **CR-7's reviewer-exemplar half executes as drafted** (essay-shape
> persisted in 4/4 reviews). The re-run also surfaced three new findings: **F13** (Coder
> over-interprets vocabulary clarification as build directive — addressed via new bullets
> in CR-1 + CR-8), **F14** (Coder exploration loop unboundedness, renamed from F10 —
> addressed by CR-9 unchanged), and **F15** (multi-agent pipeline stall mid-mutation —
> CR-2 expanded to cover both thrown-stage and stall paths).

### **CR-0 — Baseline measurement → `PLANNING/CR_BASELINE.md`**
- [ ] Measure and record, against the current `claude/loving-buck-6756d7` worktree at HEAD
      (v0.11.0):
  - Total bytes of contract injected per turn by `renderContract({ stage: 'single' })`,
    `renderContract({ stage: 'planner' })`, `renderContract({ stage: 'coder' })`,
    `renderContract({ stage: 'reviewer' })`, `renderContract({ stage: 'composer' })` — one
    table row per stage.
  - The exact text of the contract for each stage (paste verbatim into the doc) so the CR-12
    `CR_AFTER.md` diff is byte-honest.
  - Grep for the strings `STS`, `P-SPR`, `Stem to Stern`, `Sequential Prompt Roster`, `Plan +`
    in `electron/services/system-prompt-builder.ts` — record presence/absence per stage.
    This is the empirical confirmation of the F1 hypothesis before CR-1 acts on it.
  - Sample the eight LL_SMOKE_PLAYBOOK asks and record the routerDecision strings (this
    requires CR-3 — note it as a deferred row, filled retroactively after CR-3 lands; record
    the row labels now so the table structure is set).
  - The `proof-rigor.ts` predicate verbatim (current `isRigorTurn` body) so CR-5's diff is
    auditable.
- No code or behavior changes in this prompt. Documentation only.
- Verify: tsc×2 (markdown doc only — no compile impact). Commit `docs(planning): CR-0 baseline
  measurement`.
- DEVLOG entry: under a new `## <date> — Cogency Restore Phase` section, single bullet citing
  the file and the contract-byte total.

### **CR-1 — Project vocabulary restored to contract** (revision 3 — F13 bullet added)
- [ ] In `electron/services/system-prompt-builder.ts`, locate the post-L2 `renderContract()`
      body and add exactly one new section after the existing "How you work" block, titled
      **"Project conventions"**. Five bullets, ≤ 55 bytes per bullet average:
  - `STS / Stem to Stern: the user has approved a P-SPR and wants every prompt run end to
    end with verify + commit per prompt. Don't ask mid-run.`
  - `P-SPR: Plan + Sequential Prompt Roster — a PLANNING/*.md file defining one phase end to
    end. "Show me the P-SPR" = produce one and stop.`
  - `Bucket: run pwsh scripts/bucket.ps1. The full ship pipeline. Don't try to do the steps
    manually.`
  - `When unsure of project shorthand, ask once. Don't grep for it as a filename.`
  - **(F13 — new revision 3)** `When the user clarifies a project-specific term, consume it
    as vocabulary. Don't build a system named that term unless the user explicitly asks
    for one.`
- [ ] Add a single tiny snapshot test in `system-prompt-builder.test.ts` that asserts the
      four canonical phrases (`STS`, `P-SPR`, `Bucket`, `Stem to Stern`) appear in the
      rendered single-stage contract. Keeps future cuts from silently re-dropping them.
- [ ] Confirm Planner/Coder/Reviewer/Composer slim heads (the L5 short identity heads) still
      inherit these bullets. Snapshot tests for each stage updated by the test runner's
      `--update` mode (review the diff manually — should be exactly the five-bullet block).
- Acceptance: contract bytes grow by ≤ 250 (was 200; F13 bullet adds ~50); new snapshot
  tests pass; canonical-phrase test passes; the four phrases appear exactly once per
  stage's rendered contract.
- Verify: tsc×2 + `npx vitest run electron/services/system-prompt-builder.test.ts` +
  `verify:proof --no-tests`. Commit `feat(contract): CR-1 restore project conventions block`.

### **CR-2 — Abort-safe rollback + stall detection for multi-agent pipeline** (revision 3 — F15 expansion)
- [ ] In `electron/ipc/chat.ts` `runMultiAgent()` (the function added in the original Prompt
      21 + multi-provider revision), wrap the planner → coder → reviewer → composer loop
      with a single `try/finally` whose `finally` block runs an `ensureUserVisibleClosure()`
      helper. New helper (export from chat.ts or a new `electron/services/agent-pipeline-
      safety.ts`):
  - Inputs: the conversation id, the original user message id, the set of file paths the
    Coder mutated this turn (tracked via existing `apply_patch` + `shell_command` write
    instrumentation), the highest-completed stage, the error (if any), and the
    termination reason (one of `'normal' | 'thrown' | 'stalled' | 'cancelled'`).
  - Behavior:
    - If the loop reached Composer cleanly (`'normal'`): do nothing. Existing path unchanged.
    - If the loop bailed after Coder mutations landed but before Composer wrote a user-
      visible reply (`'thrown'` OR `'stalled'`): synthesise a `role: 'system'` message
      with the template:
      `Multi-agent turn ended at the {stage} stage ({reason}). {N} file(s) were modified
      before the turn aborted: {bulleted list of paths}. Reply 'revert' to restore, or
      'continue' to let me try Recovery.` — persisted via the existing `saveMessage` path
      with `stage: 'system'`. The message lands in chat history immediately.
    - If `settings.abortRollbackPrompt === 'auto-revert'`: additionally fire a `git stash`
      of just the modified paths under a generated stash name keyed by turn id, so the user
      can `git stash pop` or `git stash drop` at their leisure. Default setting: `'prompt'`
      (synthesised message only, no auto-stash). Setting can also be `'off'` to preserve
      pre-CR behaviour for users who don't want any synthesised messages.
- [ ] **F15 stall detection (new revision 3).** Reuse the existing T1 SSE-inactivity
      watchdog pattern (`streamInactivityMs`, default 60s) by introducing
      `settings.stageInactivityMs` (default 90s). Each agent stage starts a per-stage
      inactivity timer that resets on every tool call result + every model.request.chunk
      event. If the timer fires, the stage is marked `'stalled'` and the `try/finally`
      handler runs as if the stage threw — synthesizes the user-visible system message,
      kicks rollback if configured. 0 disables. The existing T3 per-stage wall-clock
      budgets (`stageBudgetMs.{planner,coder,reviewer}`) continue to function unchanged
      as a separate ceiling; stall detection is a tighter inactivity check, budget is the
      outer hard cap.
- [ ] Wire the Coder stage to populate the mutated-paths set as it runs. The `apply_patch`
      handler already returns the modified path; `shell_command` writes can be detected by
      diffing `git status --porcelain` before vs after the call (best-effort; if git isn't
      available the set is just empty and the closure helper degrades to "couldn't determine
      modified files; check `git status` manually").
- [ ] Add `chat.abort-rollback.test.ts` with five integration scenarios (expanded from 3):
  - Coder mutates 2 files, Reviewer throws → assert system message persisted with those 2
    paths, `stage='system'`, and `reason='thrown'`.
  - Coder mutates 0 files, Reviewer throws → assert NO synthesized system message.
  - Coder mutates 1 file, Composer completes cleanly → assert no system message.
  - **(F15)** Coder mutates 2 files, Coder stage exceeds `stageInactivityMs` → assert
    system message persisted with `reason='stalled'` and the 2 paths.
  - **(F15)** Coder mutates 0 files, Coder stalls → assert NO synthesized system message
    (stall during planning / read-only investigation doesn't warrant a recovery prompt).
- Acceptance: integration tests pass; the synthesised message format is locked by snapshot;
  `runMultiAgent()` always reaches the closure helper even on uncaught throws or stalls.
- Verify: tsc×2 + `vitest run electron/ipc/chat.abort-rollback.test.ts` +
  `verify:proof --no-tests`. Commit `feat(chat): CR-2 abort-safe rollback + stall
  detection for multi-agent pipeline`.

### **CR-3 — Router decision logging**
- [ ] In `electron/services/agent-router.ts`, augment `resolveAgentDispatch()` (or whatever
      the current entrypoint is) to return a structured `RouterDecision` object alongside
      the route:
  ```ts
  type RouterDecision = {
    route: 'single' | 'multi';
    matchedRule: string;        // e.g. "STS_phrase", "multi_file_phrase",
                                //      "default_single", "default_multi_fallback"
    promptHash: string;          // first-8-char hash so the log is scrubbable
    promptLength: number;
    timestamp: number;
  };
  ```
- [ ] Every code path that picks a route names the rule it matched. No silent fallthroughs:
      if a path returns multi without a matched rule string, the path is wrong and the test
      gate catches it.
- [ ] Add `electron/services/router-telemetry.ts`: a small in-memory ring buffer (last 50
      decisions) plus a `router:lastDecisions` IPC channel exposed via preload that the
      renderer's `/debug` surface (if any) can consume. Gated by
      `settings.routerTelemetry: 'on' | 'off'`, default `'on'` for this phase so users can
      diagnose mis-routes; flip to `'off'` post-CR-4 once tuned.
- [ ] `chat.ts` consumes the `RouterDecision` and either logs it via the existing
      structured-event channel or attaches it to the planner-row metadata persisted by R10's
      `messages.stage='planner'` row. Choose whichever is less invasive — the goal is just
      to make the decision visible after the fact for the CR-4 prompt.
- [ ] Update `agent-router.test.ts` so every existing test asserts the new `matchedRule`
      string in addition to `route`. This catches silent rule renames in future phases.
- Acceptance: every routing test names its expected matched rule; the in-memory telemetry
  buffer can be inspected via IPC; no rendering changes to existing UI.
- Verify: tsc×2 + `vitest run electron/services/agent-router.test.ts` +
  `verify:proof --no-tests`. Commit `feat(router): CR-3 structured RouterDecision logging`.

### **CR-4 — Router rule tuning based on CR-3 data**
- [ ] Manually re-run LL_SMOKE_PLAYBOOK Asks 2–8 against a clean workspace (Lamprey repo
      itself is fine as the test target — the asks are deliberately generic). For each ask,
      record the `RouterDecision` in `PLANNING/CR_BASELINE.md` (filling the deferred rows
      from CR-0). This is data, not behavior change.
- [ ] Tune `agent-router.ts` based on the matched-rule data. Expected diffs (verify against
      data — DO NOT pre-emptively change rules the data doesn't justify):
  - Likely: a "single file mention" regex is too broad — e.g., matches "rename X in path.ts"
    and promotes multi when it shouldn't. Replace with a more specific rule (mention >= 3
    paths OR phrase like "across all consumers" required for promotion).
  - Likely: the catch-all fallback is biased toward multi. Flip to default-single unless an
    explicit signal fires.
  - Possibly: STS / P-SPR phrase rules need re-confirmation — they're correct per Asks 7+8,
    but the rule strings should be named explicitly (`STS_keyword`, `PSPR_keyword`) for
    diagnostics.
- [ ] Update `agent-router.test.ts` with explicit assertions for each playbook ask:
  ```ts
  expect(resolveAgentDispatch('Rename runChatRound to ... in electron/ipc/chat.ts'))
    .toMatchObject({ route: 'single', matchedRule: 'default_single' });
  expect(resolveAgentDispatch('STS the new error-boundary phase'))
    .toMatchObject({ route: 'multi', matchedRule: 'STS_keyword' });
  // etc — one assertion per playbook Ask, with the expected route from the playbook
  ```
- [ ] Run the playbook informally a second time to confirm the routes match expectations.
      Record in `CR_BASELINE.md` under a "post-CR-4 routes" sub-table.
- Acceptance: ≥ 7 of the 8 LL_SMOKE_PLAYBOOK asks resolve to their expected route per the
  playbook's expectation column; the test file locks every expected route.
- Verify: tsc×2 + `vitest run electron/services/agent-router.test.ts` +
  `verify:proof --no-tests`. Commit `fix(router): CR-4 tune dispatch rules per playbook data`.

### **CR-5 — Rigor predicate requires mutation**
- [ ] In `electron/services/proof-rigor.ts`, update `isRigorTurn()` to require BOTH the
      original rigor signal AND `mutation_attempted` to evaluate to true. Track
      `mutation_attempted` via a new field on the per-turn dispatch context that flips true
      on the first `apply_patch` or mutating `shell_command` invocation in the current turn.
- [ ] In `electron/ipc/chat.ts`, the proof-gate check (the code that currently sets
      `proofStatus: 'untrusted'`) consults the new predicate. Plan-mode turns (where
      `apply_patch` and `shell_command` are blocked) and casual question turns (where the
      model emits no mutating tool calls) bypass the gate entirely — `proofStatus` stays
      `undefined`, no "Untrusted completion" pill.
- [ ] Verify: the existing change-contract synthesis at `chat.ts:1149`
      (`ensureImplicitContractForFirstMutation`) still fires correctly when the first
      mutation lands. The change here is at the GATE level, not at the CONTRACT level — a
      contract is still synthesized on first mutation; the gate just doesn't punish the
      USER for turns where no mutation occurred.
- [ ] Add `settings.rigorRequiresMutation: boolean`, default `true` (the new behavior), with
      an escape hatch to set `false` to preserve the v0.11.0 "rigor fires on dispatch alone"
      behavior. Document in README.md "New in v0.12.0".
- [ ] Test additions in `chat.proof-gate.test.ts` (create if missing):
  - Multi-agent dispatch + zero mutations → assert `proofStatus === undefined`.
  - Multi-agent dispatch + 1 `apply_patch` + no fresh receipt → assert `proofStatus === 'untrusted'`.
  - Plan-mode turn (where `apply_patch` is blocked) → assert `proofStatus === undefined`.
  - Single-agent dispatch + 1 `apply_patch` + fresh passing receipt → assert
    `proofStatus === 'trusted'`.
  - `rigorRequiresMutation: false` + multi-agent dispatch + zero mutations → assert
    `proofStatus === 'untrusted'` (v0.11.0 behavior preserved when the flag is off).
- Acceptance: the "Untrusted completion" pill no longer fires on Asks 2, 3, 4, 5, 8 of the
  playbook (verified by manual re-run); existing M-phase WC-4 wiring and WC-6 verification
  footer remain unaffected on actual rigor turns with mutations.
- Verify: tsc×2 + `vitest run electron/services/proof-rigor.test.ts
  electron/ipc/chat.proof-gate.test.ts` + `verify:proof --no-tests`. Commit
  `fix(rigor): CR-5 scope proof gate to mutation-attempting rigor turns`.

### **CR-6 — Reviewer verdict-line rule restored** ✅ NO-OP (revision 3)
**Empirical resolution:** v0.11.1 playbook re-run (2026-06-09) recorded **4 / 4
first-try verdict-line hits** across Asks 3 (`CHANGES`), 4 (`SHIP`), 5 (`CHANGES`),
and 8 (`CHANGES`). Ask 6 stalled before reaching Reviewer (see F15) and is excluded
from the sample. Hit rate 100% on n=4 evaluated samples.

The verdict-line miss pattern observed in v0.11.0 was a downstream symptom of the
Reviewer Packet bug, not a contract regression. The Reviewer Packet Hotfix shipped in
v0.11.1 (`d28cf7c`) gave the Reviewer real Coder output to grade, and the verdict-line
rule now fires correctly first try.

- [x] **No contract change required.** DEVLOG entry: `CR-6: verified resolved by v0.11.1
      Reviewer Packet Hotfix (verdict-line hit rate 100% on n=4 samples) — no contract
      changes needed. n=5 sample target unmet due to Ask 6 stall (see F15 / CR-2 expansion).`
- Skip directly to CR-7.
- [ ] Update the reviewer-fragment snapshot test to assert the verdict-line bullet is
      present in the rendered prompt verbatim.
- [ ] Add a behavioral test that simulates a Reviewer response without a verdict line and
      confirms the validation gate re-prompts. (The validation gate already does this in
      v0.11.0 — Asks 3 and 5 prove it works at runtime. The test just locks the contract
      that the gate's expected behavior remains.)
- [ ] Optional micro-optimization: investigate whether the verdict-line rule should be moved
      from `ROLE_FRAGMENTS.reviewer` into the L5 slim identity head so it's literally the
      LAST thing the model reads before generating. Skip if it complicates the slim head
      logic; the placement at the end of the role fragment is sufficient.
- Acceptance: snapshot updated; ≥ 90% Reviewer turn verdict-line first-try hit rate when
  measured against the LL_SMOKE_PLAYBOOK manual re-run (vs ~60% in v0.11.0 measurements).
- Verify: tsc×2 + `vitest run electron/services/system-prompt-builder.test.ts` +
  `verify:proof --no-tests`. Commit `fix(reviewer): CR-6 restore verdict-line rule to
  reviewer fragment`.

### **CR-7 — Reviewer terse exemplar + scope-creep guard** ⚠ SPLIT (revision 3)
**Empirical resolution per half:**
- **Reviewer-exemplar half: EXECUTE AS DRAFTED.** v0.11.1 re-run showed the 4-section
  enumerated template ("Checked failure modes / Files consulted / Unchecked gaps /
  Verdict") present in 4 / 4 evaluated Reviewer turns at 15-22 lines each. The pattern
  is consistent across radically different ask shapes (typo fix, build diagnosis,
  feature build, plan request). The L6 byte cut removed prose rules but the model
  defaults to the verbose review template from training inertia — an exemplar is
  needed, not just deletion. Execute as drafted below.
- **Scope-creep guard half (F12): NO-OP.** v0.11.1 re-run showed clean asks-then-stops
  behavior on Asks 4 and 5 with no volunteer optimization fixes for unasked-about
  warnings. F12's "Composer pads with off-task suggestions" symptom appears to have
  been a downstream of the Reviewer Packet bug. DEVLOG entry: `CR-7 scope-creep half:
  verified resolved by v0.11.1 (Asks 4 + 5 both asked clarification without volunteer
  fixes) — no contract addition.`

Note: A *new* scope-creep variant — **F13 (Coder over-interprets vocabulary
clarification as build directive)** — was surfaced by the re-run and is addressed in
CR-1 (project-conventions bullet) and CR-8 (minimum-correct-fix bullet), not here.

- [ ] In `renderContract()`, immediately after the L4 role-fragment block, add ONE compact
      few-shot exemplar specifically for the Reviewer stage (sibling to the HY6 read→edit→
      verify exemplar). Target shape, 4–5 lines max:
  ```
  Example reviewer output:
  Reviewed: src/parser.ts:48 changed the off-by-one in tokenize(); src/parser.test.ts
  added two coverage cases; tsc + vitest clean per receipt v_03.
  One concern: tokenize() now drops the trailing newline — confirm the caller doesn't
  rely on it.
  CHANGES
  ```
- [ ] Add an envelope-byte guard test that asserts the reviewer exemplar bytes ≤ 300, so
      future verbose additions to the exemplar trigger CI failure.
- [ ] **Scope-creep guard bullet — SKIP (revision 3 no-op).** v0.11.1 already prevents
      the F12 Composer-padding pattern on negative-result asks. Do not add a contract
      bullet for it.
- Acceptance: post-CR-7 contract bytes ≤ pre-CR-7 + 300; **reviewer outputs in the CR-11
  re-run show median ≤ 12 lines AND no enumerated 5-section template in ≥ 4 / 5
  Reviewer turns** (against any clean known-good workspace, n ≥ 5 sample).
- Verify: tsc×2 + `vitest run electron/services/system-prompt-builder.test.ts` +
  `verify:proof --no-tests`. Commit `feat(contract): CR-7 reviewer exemplar`.

### **CR-8 — Coder operational rules** (revision 3 — F13 bullet added)
- [ ] In `ROLE_FRAGMENTS.coder` (the L4-slimmed coder body), add exactly three bullets at the
      end:
  - `If a shell command fails with a syntax error, switch to the host shell's native syntax
    before retrying. Don't repeat the same shape three times — pivot after one failure.`
  - `Never edit files via shell pipelines (Set-Content, sed, awk, [System.IO.File]::Write).
    If apply_patch fails, read the file with the appropriate -Encoding utf8 flag and retry
    the patch with the literal content. If it still fails, ask the user — do not fall back
    to shell-based editing. UTF-8 corruption from shell pipelines is silent and destructive.`
  - **(F13 — new revision 3)** `Default to the smallest correct fix. When the user
    authorizes building a new thing, build only what the literal request names — one
    file, one component, one test. Don't scaffold parallel architectures (slice patterns,
    test suites, abstraction layers, supplementary docs) unless the user explicitly asks.`
- [ ] Optional micro-optimization for the host-shell rule: prefix the rendered coder
      fragment with one line stating the current host shell name (e.g., `Host: PowerShell
      7.x on Windows`) computed at startup so the model doesn't have to infer. Keep it ≤
      40 bytes.
- [ ] Add snapshot test for all three new bullets.
- [ ] Add a behavioral test that simulates a planner with a request to edit a file with
      non-ASCII characters and asserts the coder does NOT emit a `shell_command` with
      `Set-Content` or `[System.IO.File]::WriteAllText` (lint-style rule, optional —
      ship if straightforward, defer if it requires significant test scaffolding).
- Acceptance: contract bytes grow ≤ 350 (was 200; F13 bullet adds ~150); snapshots
  updated; the playbook re-run's Coder stage on Asks 5, 6, 7 no longer shows ≥ 3
  sequential failures of the same syntax shape; Asks 6 + 8 don't trigger full-system
  scaffolding from brief clarifications (F13 lock).
- Verify: tsc×2 + `vitest run electron/services/system-prompt-builder.test.ts` +
  `verify:proof --no-tests`. Commit `fix(coder): CR-8 shell-adapt + no-shell-edit + minimum-fix rules`.

### **CR-9 — Coder exploration budget**
- [ ] In `ROLE_FRAGMENTS.coder`, add exactly one bullet:
      `If three consecutive searches return zero matches on the user's named entities,
      escalate to the user via ask_user_question. Do not loop into a fourth search.`
- [ ] Optional structural backstop in `chat.ts`: track `consecutive_negative_search_count`
      across tool calls in the current turn; emit a `console.warn` (not a hard stop —
      respect model autonomy) at threshold 4 so future regressions surface in dev logs.
      Skip if it adds significant complexity.
- [ ] Snapshot test for the new bullet.
- Acceptance: contract bytes grow ≤ 100; the playbook re-run's Ask 5 (chat-header export
  button against the wrong workspace) escalates to AskUserQuestion within 4–5 rounds
  rather than the 15 rounds observed on v0.11.0.
- Verify: tsc×2 + `vitest run electron/services/system-prompt-builder.test.ts` +
  `verify:proof --no-tests`. Commit `fix(coder): CR-9 exploration budget`.

### **CR-10 — LL_SMOKE_PLAYBOOK pass criteria updated for v0.12.0**
- [ ] In `PLANNING/LL_SMOKE_PLAYBOOK.md`, append a new section "v0.12.0 pass criteria"
      reflecting what each Ask should now do. Specifically:
  - Ask 2: route single (CR-4 fix), Coder edits ≤ 2 reads, concrete diff with file paths.
  - Ask 3: route single (CR-4), L2 zero-matches bullet fires (CR-1 reinforces this).
  - Ask 4: route single (CR-4), runs build, asks "what failure did you see?" rather than
    volunteering chunk-size fixes (CR-7 scope-creep guard).
  - Ask 5: route single, Coder escalates within 4 rounds rather than 15 (CR-9 budget).
  - Ask 6: route multi (unchanged); plan-mode proof gate does NOT fire (CR-5); 5+ invisible
    turns is acknowledged as a separate UX defect deferred to a future phase.
  - Ask 7: route multi (unchanged); STS recognized as project vocab (CR-1); if Coder
    mutations land and a stage fails, abort-safe rollback synthesises a system message
    (CR-2).
  - Ask 8: route multi (unchanged); P-SPR recognized as project vocab (CR-1); Planner
    produces a roster, not a file search.
- [ ] Do NOT remove the v0.11.0 expectations — the playbook is comparative. Add the new
      section, label it "v0.12.0", keep the original "v0.11.0 expectations" intact above
      it.
- [ ] Commit `docs(planning): CR-10 v0.12.0 pass criteria for LL_SMOKE_PLAYBOOK`. No code,
      no version bump.

### **CR-11 — Manual playbook re-run → `PLANNING/CR_AFTER.md`**
**Note (revision 3):** The *early partial* of this prompt (Asks 3, 4, 5, 8 against
v0.11.1; Ask 6 stalled — F15 finding) has already been executed (2026-06-09) and is
summarized in §0 revision 3. CR-6 + CR-7 scope-creep half were resolved as no-ops.
The full re-run below runs at this prompt's slot in the sequence after CR-0 through
CR-10 have all landed, against a clean known-good workspace with the v0.12.0 builds.

- [ ] Run a fresh Lamprey instance against a clean, known-good workspace (NOT `07 CCPC`)
      — a fresh clone of the Lamprey repo itself is the canonical test target. Set `cwd` to
      that clone.
- [ ] Execute LL_SMOKE_PLAYBOOK Asks 2–8 verbatim. For each:
  - Record the routerDecision string from the structured log (CR-3).
  - Record whether the primary cogency signal hit per the v0.12.0 criteria (CR-10).
  - Paste the model's verbatim final reply for diff against v0.11.0 baselines.
  - For Asks 7 + 8, paste the Planner's first reasoning block to confirm STS / P-SPR are
    recognized (CR-1 effect).
  - For Ask 7 specifically: if any stage fails post-mutation, verify the abort-safe system
    message landed and named the modified paths.
- [ ] Compute the post-CR contract byte totals per stage and record the delta vs CR-0
      baseline. Confirm regrowth ≤ 500 bytes total.
- [ ] If any Ask fails its v0.12.0 primary signal: open a "Cogency Restore residual gap"
      note in CR_AFTER.md explaining which finding wasn't fully addressed. This is honest
      bookkeeping — the phase may need a CR-12.5 patch prompt before wrap.
- [ ] No code changes in this prompt. Documentation only. Commit
      `docs(planning): CR-11 manual playbook re-run results`.

### **CR-12 — Phase wrap & ship**
- [ ] Final phase gate: `npx vitest run` (full suite — must be 2271 passed + the new CR
      tests, e.g. 2280 passed; 117 skipped unchanged), `npm run build` (clean), `npm run
      verify:proof` (exit 0), `npx tsc --noEmit -p tsconfig.node.json` (clean),
      `npx tsc --noEmit -p tsconfig.web.json` (clean).
- [ ] If CR-11 surfaced residual gaps and they're surgical (one-bullet contract additions,
      one-line test fixes), patch them now under this prompt's commit. Otherwise document
      them as known limitations in CR_AFTER.md and the DEVLOG phase-complete entry.
- [ ] `package.json`: bump version to `0.12.0`.
- [ ] `CLAUDE.md` Current State: add the Cogency Restore Phase entry mirroring the
      Lampshade and Hygiene entries — one paragraph summarizing CR-0 through CR-12,
      headline byte numbers (pre + post contract bytes, regrowth delta), and the playbook
      re-run pass count. Add `LAMPREY_COGENCY_RESTORE_PLAN.md` to the §1 reference-only
      execution-rules list.
- [ ] `DEVLOG.md`: phase-complete entry under date `<date>` matching the HY7 + L11 format —
      include each prompt's commit SHA, the byte regrowth measurement, the playbook re-run
      pass count, and explicit links to CR_BASELINE.md / CR_AFTER.md / LL_SMOKE_PLAYBOOK.md.
- [ ] `README.md`: "New in v0.12.0" paragraph + roadmap top entry; if any artifact-table
      URLs need bumping per `feedback_readme_is_part_of_ship`, update them now.
- [ ] Optional, only if user says "Bucket" or "ship to Bucket": run `pwsh scripts\bucket.ps1`
      end-to-end. The bucket-needs-pwsh7 memory documents installation if `Get-Command pwsh`
      fails. Do NOT bucket without explicit instruction — the user is the pusher per the
      standing rule.
- [ ] Final commit: `chore(release): CR-12 Cogency Restore Phase wrap — v0.12.0`.
- Verify: final phase gate above. Commit and stop. Await user instruction on push / bucket.

---

## §2 — Files touched (summary)

| Path | Phase prompts touching it |
|---|---|
| `electron/services/system-prompt-builder.ts` | CR-1, CR-6, CR-7, CR-8, CR-9 |
| `electron/services/system-prompt-builder.test.ts` | CR-1, CR-6, CR-7, CR-8, CR-9 |
| `electron/services/agent-router.ts` | CR-3, CR-4 |
| `electron/services/agent-router.test.ts` | CR-3, CR-4 |
| `electron/services/router-telemetry.ts` (new) | CR-3 |
| `electron/services/proof-rigor.ts` | CR-5 |
| `electron/services/proof-rigor.test.ts` | CR-5 |
| `electron/ipc/chat.ts` | CR-2, CR-3, CR-5, CR-9 (optional backstop) |
| `electron/ipc/chat.abort-rollback.test.ts` (new) | CR-2 |
| `electron/ipc/chat.proof-gate.test.ts` (new) | CR-5 |
| `electron/services/agent-pipeline-safety.ts` (new, optional helper extract) | CR-2 |
| `src/lib/types.ts` (AppSettings shape) | CR-2, CR-3, CR-5 |
| `PLANNING/CR_BASELINE.md` (new) | CR-0, CR-4 (data fill) |
| `PLANNING/CR_AFTER.md` (new) | CR-11, CR-12 |
| `PLANNING/LL_SMOKE_PLAYBOOK.md` | CR-10 |
| `DEVLOG.md` | every prompt + CR-12 phase wrap |
| `CLAUDE.md` | CR-12 only |
| `README.md` | CR-12 only |
| `package.json` | CR-12 only |

---

## §3 — Risks, deferrals, and rollback strategy

### Risks
- **Reviewer verbosity may not respond to one exemplar.** CR-7 adds one terse exemplar; if
  the model defaults to verbose templates from training inertia anyway, the cogency win is
  smaller than projected. Mitigation: CR-11 measures actual reviewer line count; if median
  > 15 lines, document as a residual gap and open a follow-up (likely needing a stronger
  reviewer-mode example, or a content-length cap in the validation gate).
- **Router rule tuning may break a use case not in the playbook.** CR-4 relies on
  playbook coverage. The playbook has 8 asks; real usage spans more shapes. Mitigation: the
  new `agent-router.test.ts` assertions are explicit per-ask rather than over-broad regex;
  if real usage surfaces a mis-route after ship, add an assertion + tune in a CR-12.x patch.
- **Abort-safe rollback's `git stash` path could surprise users.** Default is `'prompt'` (no
  stash, only synthesised message). Users who set `'auto-revert'` are opting in and own the
  stash hygiene. Mitigation: synthesised-message wording must explicitly name `git stash
  list` so the user can find the auto-stash. Test the wording in CR-2's snapshot.
- **Vocabulary bullets could leak into outputs.** CR-1 adds project-shorthand to the
  contract; the model might emit "P-SPR" in places that should say "plan." Mitigation:
  CR-11's manual re-run checks for awkward shorthand emission in user-facing outputs across
  several non-playbook asks (e.g., a generic "explain X" prompt). If observed, soften the
  bullet phrasing.
- **`mutation_attempted` tracking via `git status` diff is best-effort on non-git
  workspaces.** CR-2's mutated-paths set degrades gracefully (empty set; closure message
  says "couldn't determine modified files"). Acceptable.

### Explicit deferrals (not blocking this phase)
- **`apply_patch` reliability** — Ask 7 hunk-mismatch failures need their own investigation
  phase against the patch tool's normalization (line endings, BOM, Unicode). Out of scope
  here.
- **PowerShell UTF-8 round-trip corruption** — CR-8 bans shell-based file editing as a
  contract rule, which closes the symptom. The underlying defect (no UTF-8-safe shell
  pipeline) needs the dedicated patch-tool phase above to address fully.
- **AskUserQuestion 4-option cap** — tool envelope contract, not cogency. Deferred to a
  future tool-envelope cleanup.
- **5+ invisible assistant turns per multi-agent run** — real UX issue surfaced in Ask 6's
  after-action report. Status-line context% pill (J8) may already partially mitigate; a
  proper fix is its own Fluidity-style phase.
- **User's broken `league-of-legends-clone`** from Ask 7 — user decides whether to revert
  or repair. Not Lamprey's job to roll back the user's other workspaces; CR-2 makes the
  abort-safe surface visible going forward.
- **User's `07 CCPC` workspace residue from playbook re-run** (revision 3) — the v0.11.1
  re-run left `src/systems/ErrorHandler.ts`, `src/ui/ErrorOverlay.ts`, a `p_spr/` Python
  package with 42 tests, and a partially-scaffolded React + Vite + Zustand project (Ask 6
  stall point) in `C:\Users\17076\Documents\07 CCPC`. User decides cleanup. CR-2's
  abort-safe rollback would have surfaced these as system messages naming the paths;
  going forward this debris pattern should be visible at turn-end instead of silent.
- **Single-sample CR-7 scope-creep half no-op** — only n=2 samples (Asks 4 + 5) confirm
  F12 resolved. If real-world usage surfaces F12-style scope creep post-ship, file a
  CR-7.x patch prompt to add the scope-creep guard bullet that was deferred here.

### Rollback strategy
- Every prompt's changes are reversible by `git revert <commit>` because the phase uses one
  commit per prompt with present-tense imperative subjects. The final `chore(release)`
  commit in CR-12 is the only commit that touches version + README + CLAUDE.md, so
  reverting just CR-12 returns to "all changes landed but version unbumped" — useful if the
  user wants to skip the version bump.
- The three new `AppSettings` flags (`abortRollbackPrompt`, `routerTelemetry`,
  `rigorRequiresMutation`) each have escape-hatch values that restore pre-CR behavior. If a
  user files a regression that's specific to one of the new behaviors, they can flip the
  flag locally without waiting for a hotfix.

---

## §4 — Completion criteria (recap, revised in revision 3)

- [ ] CR-0, CR-1, CR-2, CR-3, CR-4, CR-5, CR-7 (reviewer-exemplar half), CR-8, CR-9,
      CR-10, CR-11, CR-12 all `[x] executed`
- [x] **CR-6 `[x] no-op (v0.11.1 resolved verdict-line behavior, 4/4 first-try hits)`** —
      pre-resolved by revision 3, DEVLOG entry lands at CR-12 wrap
- [x] **CR-7 scope-creep half `[x] no-op (v0.11.1 resolved F12, Asks 4 + 5 verified
      asked-not-volunteered)`** — pre-resolved by revision 3, DEVLOG entry lands at CR-12 wrap
- [ ] Final phase gate green (tsc × 2 + vitest + build + verify:proof)
- [ ] Contract byte regrowth ≤ 600 bytes (measured in CR_AFTER.md). CR-1 ≤ 300 (5 bullets
      including F13). CR-7 reviewer-exemplar half ≤ 300.
- [ ] ≥ 6 of 7 LL_SMOKE_PLAYBOOK Asks 2–8 hit primary signal in the v0.12.0 manual re-run
- [ ] **Ask 7 specifically** hits its primary signal (abort-safe rollback fires + system
      message landed) — non-negotiable, this is the most severe v0.11.0 defect
- [ ] **Ask 6 specifically** completes without stalling (CR-2's F15 stall-detection path
      fires if it does, surfacing the modified-paths system message instead of silence)
- [ ] **Asks 6 + 8 do NOT trigger full-system scaffolding from a brief clarification** —
      F13 lock from CR-1 + CR-8 holds
- [ ] DEVLOG phase-complete entry recorded
- [ ] CLAUDE.md Current State + reference-only list updated
- [ ] package.json bumped to v0.12.0; README "New in v0.12.0" paragraph added
- [ ] User reviews + says "push" / "Bucket" → push + bucket. Otherwise wait.

---

## §5 — Approval state

- **PENDING APPROVAL.** User reviews this file and replies with:
  - `approved` / `STS` / `go` → branch cut, prompts run in sequence stem-to-stern per §0
    governance, no mid-loop permission asks
  - `amend X` → discuss the amendment; revise this file; re-present
  - `not now` → file stays here as reference

No code changes occur until the user explicitly authorizes one of the above.
