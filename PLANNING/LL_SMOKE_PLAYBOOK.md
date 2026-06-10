# LL_SMOKE_PLAYBOOK.md — Lampshade Phase L9 cogency playbook

**Purpose:** A hands-on test pass to confirm the Lampshade phase delivered cogency, not just byte savings. The snapshot tests in `system-prompt-builder.test.ts` lock the *envelope shape*. This playbook locks the *behavior*. The user (you) runs it after install and judges by ear.

**How to run it:** Open Lamprey on v0.10.0 with default settings (agentMode = `'auto'`, default roster). For each ask, paste the verbatim prompt, watch the reply, and check the boxes that match what you actually see. Each ask names the expected auto-routing decision; mismatches are themselves a finding worth reporting.

**Why these eight:** The set spans the full ask space — single-line trivia, surgical edits, open-ended debugging, mid-size feature builds, cross-file refactors, phase work, and plan drafts. Two asks are deliberately close to the auto-router's boundary so the heuristic is exercised, not just confirmed.

---

## Ask 1 — Trivia (expect: SINGLE, terse, no forced `<think>`)

> **Paste this:** `What does the keychain module do?`

**Expected routing:** `single` (short ask, no signals)

**Cogency checks**
- [ ] Reply is **under 200 words**
- [ ] **No `<think>` preamble** in the user-visible body (the model may emit one internally; it should not appear in the bubble)
- [ ] The answer cites at least one concrete symbol (`safeStorage`, `keychain.ts`, `getKey`, etc.)
- [ ] Does **not** open with "Great question!" / "Let me explain" / similar warm-up filler
- [ ] Does **not** end with "Let me know if you need anything else!"

**Failure mode:** if the model emits a long preamble and reads as essay-shaped, the L3 conditional-think rule didn't land.

---

## Ask 2 — One-line edit (expect: SINGLE, concrete diff)

> **Paste this:** `Rename runChatRound to dispatchSingleAgentTurn in electron/ipc/chat.ts`

**Expected routing:** `single` (single-file mention, surgical scope)

**Cogency checks**
- [ ] The model calls **at most 2 read tools** before proposing the edit (one `shell_command` grep or one `apply_patch` is plenty)
- [ ] Final reply names the file + the symbol(s) changed (e.g. "renamed `runChatRound` → `dispatchSingleAgentTurn` in `electron/ipc/chat.ts`")
- [ ] Final reply mentions the call sites it updated, **not** "I've updated everywhere it's used" without naming them
- [ ] Does **not** include unrelated cleanup ("I also tidied the import order…")

**Failure mode:** if the model goes into a long planning ritual before editing, or rewrites unrelated parts of the file, the L4 role-fragment slim didn't land.

---

## Ask 3 — Typo fix (expect: SINGLE, with verify hint)

> **Paste this:** `Fix the typo 'Lampshde' in the README`

**Expected routing:** `single` (short, single-file, mechanical)

**Cogency checks**
- [ ] The model performs **one read** of the README to confirm the typo exists (zero-match safety per the new "How you work" bullet)
- [ ] The fix lands as a single `apply_patch` change
- [ ] Final reply names the line / heading where the fix landed
- [ ] If the typo isn't found, the model **asks** what scope to look in, **not** "I couldn't find it, marking complete"

**Failure mode:** "couldn't find, task complete" without observing the README is the L2 "zero matches means wrong scope" failure mode the contract collapsed into one bullet.

---

## Ask 4 — Bug investigation (expect: SINGLE, read-then-act loop)

> **Paste this:** `Why is the build failing?`

**Expected routing:** `single` (open-ended diagnostic, no multi-file signals)

**Cogency checks**
- [ ] The model **runs the build command** rather than speculating from filenames
- [ ] If the build is currently passing, the model says so directly and asks what failure the user saw, **not** "let me check a few things…" followed by 8 tool calls
- [ ] If the build is failing, the answer cites the actual error message line, **not** a paraphrase
- [ ] The answer proposes a fix or asks one question — never both at length

**Failure mode:** if the model fabricates a build failure that doesn't exist, the L9 "no `task complete` hedging" lock isn't enough on its own; the model is over-eager.

---

## Ask 5 — Feature build (boundary case — single OR multi acceptable)

> **Paste this:** `Add a button to the chat header that exports the transcript as markdown`

**Expected routing:** `single` (~95 chars, single sentence; would only promote on the build-from-scratch regex if "complete" or "full" appeared)

**Cogency checks (single path)**
- [ ] The model reads the existing chat-header file before adding the button
- [ ] One `apply_patch` lands the button; one more lands the export handler
- [ ] `verify_workspace` is called after edits
- [ ] Final reply names file paths, the new symbol(s), and what was verified
- [ ] The model **asks for the dev-server URL** rather than claiming the UI was checked

**Cogency checks (multi path — also acceptable for this ask)**
- [ ] Planner emits a numbered list of ≤ 5 steps
- [ ] Coder runs without re-stating the plan
- [ ] Reviewer ends on **one verdict word** (`SHIP` or `CHANGES`), not paragraphs

**Failure mode:** either path is fine for this ask; mixed-mode hedging ("I'll plan first, then code, then review, then verify…" all in one bubble) means the routing fired but the prompts haven't fully decongested.

---

## Ask 6 — Cross-file refactor (expect: MULTI, matches multi-file phrase rule)

> **Paste this:** `Refactor the chat store to use Zustand 5 slices across every consuming component`

**Expected routing:** `multi` (matches the `refactor … across every` regex)

**Cogency checks**
- [ ] The chat-route hint surfaces ("Routed to multi-agent because: multi-file phrase…") in the dispatch log or banner
- [ ] **Planner** lists the slices it'll create + every consumer file it'll touch — no code in this stage
- [ ] **Coder** does the actual edits and runs `verify_workspace` at the end
- [ ] **Reviewer** flags any consumer the Coder missed and ends with `SHIP` or `CHANGES`
- [ ] The Reviewer reply is **short** (the L6 slim cut its boilerplate; should read like a code review, not a checklist of process rules)

**Failure mode:** if the Reviewer's reply is dominated by self-instruction prefatory text ("I am the Reviewer. I will critique…"), the L5 contract-strip didn't propagate to runtime — re-check that the worktree built from this commit and not an older one.

---

## Ask 7 — Phase ship (expect: MULTI, STS phrase)

> **Paste this:** `STS the new error-boundary phase`

**Expected routing:** `multi` (STS phrase match)

**Cogency checks**
- [ ] Auto-routing recognises STS as a phase phrase and dispatches multi
- [ ] The Planner produces a numbered roster of prompts, **not** an immediate code change
- [ ] Once the user approves, the Coder executes prompt-by-prompt with a `verify_workspace` per prompt
- [ ] No stage prefaces its reply with PSEUDO_TAG_GUARD-style "Output format: plain Markdown only…" boilerplate (L6 cut that)

**Failure mode:** STS routing to single means the regex compilation failed at build time. Phase phrase appearing in the Reviewer's body means the Reviewer is restating the contract verbatim — L5 didn't strip.

---

## Ask 8 — Plan draft (expect: MULTI — boundary case)

> **Paste this:** `Show me the P-SPR for adding telemetry`

**Expected routing:** `multi` (matches the `P-SPR` phrase rule)

**Note:** the heuristic catches `P-SPR` and routes to multi because phase-shaped vocabulary is the user's signal that the work is large enough to fan out. That's correct — drafting a plan IS plan-heavy work. **However**, the model must NOT write code or touch files in this turn: the planning-mode contract role takes care of that.

**Cogency checks**
- [ ] Auto-routes to multi
- [ ] **No** `apply_patch` calls
- [ ] **No** `shell_command` writes (read-only commands fine for measurement)
- [ ] Output is a roster of numbered prompts each with files / acceptance / verify gate
- [ ] Final line asks the user to approve, amend, or STS

**Failure mode:** if the model writes code instead of producing a plan, the contract-role `planning` fragment didn't take. Re-check `ROLE_FRAGMENTS.planning` is the L4 slim version ("Produce a plan, not code — no apply_patch calls").

---

## Summary table

| # | Ask shape | Expected route | Primary cogency signal |
|---|---|---|---|
| 1 | Trivia | single | No `<think>` preamble in body |
| 2 | One-line edit | single | ≤ 2 reads, concrete diff |
| 3 | Typo fix | single | Reads README before fixing |
| 4 | Bug investigation | single | Runs build instead of speculating |
| 5 | Feature build | single or multi | Asks for dev-server URL before claiming UI checked |
| 6 | Cross-file refactor | multi | Reviewer ends with verdict, not boilerplate |
| 7 | Phase ship | multi | Planner emits roster, not code |
| 8 | Plan draft | multi | No code; final line asks for approval |

## When to file a regression

If 2+ asks fail their primary cogency signal, the Lampshade phase has regressed at runtime even though the snapshot tests pass. Open a Lampshade-Regression note in `DEVLOG.md` with:
1. Which asks failed
2. Which signal each missed
3. The model id under test (DeepSeek V4 Pro / Flash / Gemma / Qwen3 Coder — they degrade differently)
4. A copy of the offending reply

The next phase can then read those notes to decide whether the fix is a router rule, a prompt rule, or a sanitizer rule.


---

## v0.12.0 pass criteria (CR-10, 2026-06-09)

The Cogency Restore Phase (CR-0 through CR-12) lands on `claude/cogency-restore` from
`v0.11.1`. The post-CR build adjusts which signals each Ask is graded on. Pre-v0.12.0
expectations above stay intact for diff against v0.11.0 / v0.11.1 runs; this block
adds the v0.12.0-specific bars.

### Per-ask v0.12.0 expectations

**Ask 2 — One-line edit (`Rename runChatRound to dispatchSingleAgentTurn ...`)**
- Route: SINGLE under `agentMode='auto'` (CR-3 lock confirms heuristic is correct).
- If observed multi: user's settings are `agentMode='multi'` — that pin bypasses the
  router per CR-4 docs; not a router regression.
- Coder: ≤ 2 read tools, then `apply_patch` with file + symbols named.

**Ask 3 — Typo fix (`Fix the typo 'Lampshde' in the README`)**
- Route: SINGLE under `agentMode='auto'`.
- L2 zero-matches behavior: state "no matches found in scope X" and ask scope. CR-1
  bullet ("Unsure of project shorthand? Ask once") reinforces.

**Ask 4 — Build investigation (`Why is the build failing?`)**
- Route: SINGLE.
- Workspace_context tool call → ask clarifying questions if no project found.
- **CR-7 scope-creep half no-op verification:** model should NOT volunteer optimization
  fixes for unrelated warnings. v0.11.1 + CR-7 together fully suppress this pattern.

**Ask 5 — Feature build (`Add a button to the chat header ...`)**
- Route: SINGLE.
- **CR-9 exploration budget:** Coder should escalate to `ask_user_question` after 3
  zero-match searches. v0.11.0/v0.11.1 ran 14-15 rounds; v0.12.0 target ≤ 5 rounds.

**Ask 6 — Cross-file refactor (`Refactor the chat store to use Zustand 5 slices ...`)**
- Route: MULTI via `multi_file_phrase` rule.
- **F13 lock from CR-1 + CR-8:** if scope expands beyond the literal request, Coder
  should ask before scaffolding parallel architecture. v0.11.1 silently scaffolded
  full Vite + 6 components; v0.12.0 target: confirms before building > 1 file from
  the clarification.
- **F15 stall safety net from CR-2:** if stage stalls after mutations, abort-safe
  rollback synthesizes a `role:'system'` message naming modified paths.

**Ask 7 — Phase ship (`STS the new error-boundary phase`)**
- Route: MULTI via `phase_phrase` rule.
- **CR-1 vocab restoration:** Planner recognizes STS as project shorthand for
  Stem-to-Stern (v0.11.0/v0.11.1 hallucinated "State Transition System").
- **CR-2 abort-safe rollback:** if Coder mutations land + a stage throws, system
  message names modified paths. v0.11.0 silently left 7 files broken on disk.

**Ask 8 — Plan draft (`Show me the P-SPR for adding telemetry`)**
- Route: MULTI via `phase_phrase` rule.
- **CR-1 vocab restoration:** Planner recognizes P-SPR as Plan + Sequential Prompt
  Roster. Produces a roster, asks for approval. Does NOT scaffold a Python p_spr/
  package.
- **CR-7 scope-creep half no-op verification:** model does not volunteer a side doc.

### v0.12.0 phase pass criteria

≥ 6 of 7 asks (2–8) hit primary signal cleanly. Ask 7 (abort-safe rollback) is
non-negotiable per the P-SPR §4.

### What CR-6 and CR-7 partial no-ops imply for the playbook

Per revision 3 of `PLANNING/LAMPREY_COGENCY_RESTORE_PLAN.md`:
- **CR-6 no-op**: F5 (verdict-line) already resolved by v0.11.1. Continue grading
  verdict-line presence in re-run; expect 100% first-try hits.
- **CR-7 reviewer half**: executed — terse exemplar added to `renderContract()`. Watch
  for Reviewer outputs ≤ 12 lines AND no 5-section enumerated template.
- **CR-7 scope-creep half no-op**: F12 already resolved by v0.11.1. Continue confirming
  no volunteer fixes for unasked content (Ask 4 specifically).

