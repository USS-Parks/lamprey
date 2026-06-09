# Lamprey Mechanical Proof Harness Phase - Sequential Prompt Roster

> **Status: draft for user review.** Do not execute this roster until the user explicitly approves it or says to run it STS. This P-SPR was drafted on 2026-06-07 from the current v0.9.0 repo state and the "Code as Agent Harness" research direction.

**Goal:** turn Lamprey's existing harness surfaces into a mechanical proof layer: scoped work contracts, persisted verification receipts, blocking completion gates, independent reviewer packets, and auditable failure-mode checks. The phase should reduce how much the user has to babysit ordinary coding work by making "done" depend on executable evidence rather than model self-report.

**Research basis:** Ning et al., *Code as Agent Harness: Toward Executable, Verifiable, and Stateful Agent Systems*, arXiv:2605.18747, submitted 2026-05-18. The paper frames code as an operational substrate for agent reasoning, action, environment modeling, feedback-driven control, verification, and multi-agent coordination. It organizes the field into three layers: harness interface, harness mechanisms, and scaling the harness. Its listed open challenges map directly to this phase: evaluation beyond final success, verification with incomplete feedback, regression-free improvement, shared state across agents, and human oversight for safety-critical actions.

**Primary sources:**

- Project page: https://code-as-harness.github.io/code-as-harness-webpage/
- arXiv abstract: https://arxiv.org/abs/2605.18747

**Current Lamprey substrate this phase builds on:**

- `workspace_context` already gives agents current cwd, git status, package scripts, framework hints, instruction files, and inferred verification commands.
- `verify_workspace` already runs inferred verification commands and returns structured JSON.
- `tool_calls` and `events` already persist tool lifecycle, approval, model request, agent stage, and persistence events.
- Plan mode already blocks mutating tools until the user exits planning.
- Hooks already support `promptSubmit`, `preToolUse`, `postToolUse`, and `agentStop`, with `preToolUse` able to block dispatch.
- The Planner -> Coder -> Reviewer pipeline already separates roles and records stage state.
- Workflows already support journaling, resume, budget tracking, fan-out, `askUser`, and built-in adversarial verification.
- Snip already compresses shell output so receipts can stay model-readable without losing the raw audit trail elsewhere.

**Why a new phase is still needed:** these surfaces are present, but most proof behavior is optional, advisory, or scattered. An agent can still finish after mutating code without a persisted verification receipt tied to the turn. Reviewers can still read the builder's framed summary instead of an independent evidence packet. The final answer can still cite remembered counts instead of a durable receipt. Static skills still carry process rules that should become blockers. This phase makes the harness enforce the process.

---

## 0. Session Bootstrap - Read This First

You are a fresh coding session handed this document. Before doing anything else:

### Step 1 - Confirm environment

Verify:

- Working directory is `C:\Users\17076\Documents\Claude\Lamprey Harness` or a worktree thereof.
- Current branch is not `main`. Create a branch such as `codex/mechanical-proof-harness` off `main` if needed.
- `git status --short --branch` is inspected before editing. Do not revert unrelated user changes.
- Baseline checks pass before M1 starts:
  - `npm run lint`
  - `npx tsc --noEmit -p tsconfig.node.json`
  - `npx tsc --noEmit -p tsconfig.web.json`
  - `npm test`
  - `npm run build`

If any baseline check fails, halt and report the exact failure. Do not start implementation on a broken baseline.

### Step 2 - Execute M1 -> M13 without stopping

1. Do not ask further questions unless a prompt requires a product decision only the user can make.
2. For each prompt, in order:
   - Read the listed files and nearby code before editing.
   - Implement only that prompt's scope.
   - Run the prompt's verify gate.
   - If verify fails: fix and retry up to 2 times. On the third failure, halt, write a blocked DEVLOG entry, and report.
   - If verify passes: mark the prompt `[x]` in this document, append a DEVLOG entry, then commit. Do not push.
3. One commit per prompt. No batching, no early phase wrap.
4. When all prompts complete: run the phase completion gate, write the phase-complete DEVLOG entry, and report final status.

### Step 3 - DEVLOG entry format

```markdown
## [Mechanical Proof Harness - Prompt MN] <Title> - <YYYY-MM-DD>

**Files changed:** <list>
**Verify gate:**
- lint OK
- tsc node OK
- tsc web OK
- vitest <subset or all> OK
- build/smoke/user-verification-needed: <result>

**Proof receipt:** <receipt id or "not applicable">
**Notes:** <anything surprising, deferred, or worth knowing>

**Commit:** <SHA>
```

### Step 4 - Commit discipline

- One commit per prompt.
- Never use `--no-verify`. If a hook fails, fix the underlying issue.
- Never add a `Co-Authored-By` trailer.
- Use the project's commit-message style, for example:
  - `feat(proof): M1 add proof receipt schema`
  - `feat(verify): M4 persist verify workspace receipts`
  - `feat(review): M7 build independent reviewer packet`

---

## 1. Audit Summary - Current Gaps

| # | Gap | Current evidence | Owner prompt |
|---|---|---|---|
| 1 | Verification output is structured but not durable proof. `verify_workspace` returns JSON to the model, but the receipt is not persisted as a first-class entity tied to the turn, diff, commands, and final response. | `electron/services/verify-workspace-tool.ts` returns a JSON report only; `tool_calls` stores bounded previews. | M1, M4, M5 |
| 2 | Work can be marked done after writes without a required proof gate. The system prompt asks agents to call `verify_workspace`, but a rule in prompt text is not a blocker. | `system-prompt-builder.ts` instructs verify after edits; `chat.ts` can finish regardless of missing proof. | M2, M5, M6 |
| 3 | There is no scoped, typed change contract for ordinary coding turns. Plan mode has goals, but implementation does not create a persisted contract with acceptance criteria, expected files, verification commands, and forbidden evidence weakening. | `plan-goal-store` exists, but no proof contract table or contract-bound verify gate. | M2, M3 |
| 4 | Reviewer independence is partial. The Reviewer stage reads a bounded summary of the coder's run, which can include the builder's framing. It does not first predict failure modes from the contract and then check them against raw evidence. | `agent-pipeline.ts` reviewer context comes from `summarizeRun(...)` and `REVIEW_TASK_PROMPT`. | M7, M8 |
| 5 | Agents can self-report counts. Test counts, coverage numbers, and benchmark outputs are not mechanically extracted into a quoted receipt format before the final answer. | Final responses are composed from tool summaries, not proof receipt IDs with parsed metrics. | M4, M9 |
| 6 | Static rules live in skills and prompts when they should become policy. Existing skills say how to verify/review, but the app does not enforce "mutating turn requires fresh receipt" or "review must list checked failure modes." | `skills/verify/SKILL.md`, `skills/review/SKILL.md`, and slash commands are advisory. | M5, M8, M10 |
| 7 | Dynamic context is helpful but incomplete. `workspace_context` returns current repo state, but it does not include proof policy, active contract, last failed receipts, or stale-green warnings. | `workspace-context-tool.ts` reports package/git/instructions/commands. | M3, M6 |
| 8 | Regression-free harness improvement is not closed-loop. Failed receipts and reviewer misses are persisted as generic events/tool rows, but not promoted into a failure ledger, replay target, or suggested harness rule. | `event-log` has general lifecycle events; no proof/failure taxonomy. | M11, M12 |
| 9 | UI does not present a single "can I trust this turn?" proof packet. Evidence is spread across tool cards, event timeline, After Action, Review, Activity, and logs. | Existing panels exist, but no proof packet summary surface. | M9 |
| 10 | Repo-level gates are incomplete. CI runs lint/typecheck/test/coverage and build workflows, but there is no local generated proof policy, pre-commit/pre-push helper, or `verify:proof` command that matches Lamprey's proof semantics. | `.github/workflows/ci.yml`, `.github/workflows/build.yml`, `package.json`. | M10 |

---

## 2. Architectural Invariants - Locked

1. **Mechanical evidence outranks prose.** A final answer can summarize evidence, but the source of truth is a persisted receipt created by code.
2. **Receipts are append-only.** A failed receipt is never overwritten by a later pass; later runs create new receipts linked to the same contract and correlation id.
3. **A proof receipt has enough identity to audit.** It records command, cwd, exit code, duration, started/finished times, tool call id, conversation id, correlation id, git HEAD, dirty diff hash, selected command hash, stdout/stderr hashes, bounded previews, parsed metrics, and whether output was truncated.
4. **Raw output is not stuffed into events.** Events carry metadata and bounded previews. Large raw proof artifacts live under a dedicated artifact directory or DB table with caps/redaction.
5. **Mutating turns require fresh proof or an explicit human waiver.** If a turn used write/destructive tools, Lamprey blocks or marks final completion as untrusted until a relevant proof receipt exists after the last mutation.
6. **A skipped command is a gap, not a pass.** `verify_workspace` may skip format or missing commands, but the proof gate must show skipped coverage explicitly.
7. **Review is guilty until checked.** Reviewer output must list the exact failure modes checked and the evidence consulted. "No issues" without checked modes is invalid.
8. **Reviewer context is independent.** The verification reviewer gets the contract, diff, file snapshots, proof receipts, and raw tool metadata, not the builder's narrative unless explicitly marked as builder narrative.
9. **Contracts are scoped.** A contract names expected files, acceptance criteria, verification commands, and non-goals. Scope drift becomes a review finding, not a hidden success.
10. **Rules that matter block early.** Prefer pre-tool, pre-final, and local proof gates over CI-only discovery.
11. **Human judgment remains explicit.** Product intent, acceptable risk, safety-critical waivers, and ambiguous acceptance criteria require user approval; mechanical checks do not pretend to decide them.
12. **No fake completeness.** If UI or Electron behavior cannot be exercised in automation, record `user-verification-needed` in the receipt and final answer.

---

## 3. Prompt Sequence

| # | Prompt | One-liner | Files (net new / modified) | Verify | Status |
|---|---|---|---|---|---|
| M1 | **Proof receipt schema and service** | Add append-only proof receipt storage and event types. | `electron/services/proof-receipts.ts` new, `electron/services/proof-receipts.test.ts` new, `electron/services/schema-init.ts`, `electron/services/database.ts`, `electron/services/event-log.ts`, `electron/ipc/events.ts` if filters need updates | Unit: insert/list/get receipts; payload redaction; stdout/stderr hash and preview caps; migration idempotent; lint; tsc node | [ ] |
| M2 | **Change contract store** | Persist scoped work contracts with acceptance criteria, expected files, verification policy, and waiver state. | `electron/services/change-contract-store.ts` new, tests, `electron/services/schema-init.ts`, `electron/ipc/plan.ts` or new `electron/ipc/contracts.ts`, `electron/preload.ts`, `src/lib/types.ts` | Unit: create/update/close contracts; invalid scope rejected; waiver requires reason; migration idempotent; lint; tsc node/web | [ ] |
| M3 | **Dynamic context upgrades** | Extend `workspace_context` with proof policy, active contract summary, last failed receipts, and stale-green warnings. | `electron/services/workspace-context-tool.ts`, tests, `electron/services/workspace-context-tool-pack.ts`, `electron/services/proof-policy.ts` new if useful | Unit: context includes active contract and last failed proof; cap behavior remains; no secrets; lint; tsc node | [ ] |
| M4 | **Verify workspace receipts** | Make `verify_workspace` persist full receipts and parsed metrics instead of returning ephemeral JSON only. | `electron/services/verify-workspace-tool.ts`, `electron/services/verify-workspace-tool.test.ts`, `electron/services/proof-receipts.ts`, `electron/services/shell-tool.ts` if raw artifact path needed | Unit: pass/fail/skipped receipts; command metrics parsed for vitest/tsc/eslint/build; raw hashes stable; failed command returns tool error and receipt id; lint; tsc node | [ ] |
| M5 | **Pre-final proof gate** | Before a mutating coding turn can finish as trusted, require a fresh passing receipt after the last write. | `electron/ipc/chat.ts`, `electron/services/agent-run-phase.ts`, `electron/services/tool-registry.ts`, `electron/services/final-response-composer.ts`, tests | Unit: read-only turn no gate; write turn without receipt produces blocked/untrusted completion; passing receipt after write clears gate; failed/skipped-only receipt does not clear; lint; tsc node | [ ] |
| M6 | **Proof gate UI and waiver path** | Surface blocked/untrusted proof states and require an explicit user waiver for proceeding without evidence. | `src/components/chat/*`, `src/components/tools/panels/AfterActionPanel.tsx`, `src/stores/*`, `electron/ipc/contracts.ts`, tests | Renderer tests where practical; manual Electron smoke marked if not automatable; lint; tsc web/node; build | [ ] |
| M7 | **Independent reviewer evidence packet** | Build a reviewer packet from contract + diff + receipts + tool metadata, excluding builder narrative by default. | `electron/services/review-evidence-packet.ts` new, tests, `electron/services/agent-pipeline.ts`, `electron/services/final-response-composer.ts` | Unit: packet includes contract/diff/proof ids; excludes builder prose unless flagged; 32 KB cap with explicit omissions; lint; tsc node | [ ] |
| M8 | **Failure-mode reviewer contract** | Rewrite reviewer prompt and validation so review must predict and check concrete failure modes before verdict. | `electron/services/agent-pipeline.ts`, `electron/services/multi-agent-run-tool.ts`, `skills/review/SKILL.md`, `resources/skills/review/SKILL.md`, tests | Unit: reviewer response without checked modes is rejected/retried once; verdict parser accepts SHIP/CHANGES with checked modes; no "looks good" rubber stamp; lint; tsc node | [ ] |
| M9 | **Proof packet panel and final answer receipts** | Add a user-visible proof packet summary and make final answers quote receipt IDs/metrics from receipts. | `src/components/tools/panels/AfterActionPanel.tsx` or new `ProofPanel.tsx`, `src/components/artifacts/*`, `electron/services/final-response-composer.ts`, `electron/preload.ts`, tests | UI smoke: proof packet shows contract, receipts, skipped gaps, reviewer checked modes; composer test cites receipt id and parsed metrics; lint; tsc web/node; build | [ ] |
| M10 | **Repo-local blocking policy and scripts** | Add `verify:proof`/`verify:all` scripts and optional local git hook templates aligned with the proof gate. | `package.json`, `scripts/verify-proof.cjs` new, `.github/workflows/ci.yml`, `.github/workflows/build.yml`, docs, tests if parser code exists | `npm run verify:proof` passes on clean tree; CI workflow syntax sane; existing lint/tsc/test/build still pass | [ ] |
| M11 | **Failure ledger and replay seeds** | Promote failed receipts, waivers, reviewer misses, and repeated errors into a durable failure ledger. | `electron/services/failure-ledger.ts` new, tests, `electron/services/event-log.ts`, `electron/ipc/events.ts`, maybe `src/components/activity/*` | Unit: failed proof creates/updates ledger row; repeated failure increments; waiver links reason; no secret leakage; lint; tsc node/web | [ ] |
| M12 | **Harness improvement recommendations** | Generate mechanical suggestions from the failure ledger without auto-mutating rules. | `electron/services/harness-recommendations.ts` new, tests, `src/components/settings/AgenticCodingSettings.tsx` or `ProofPanel.tsx` | Unit: repeated missing test suggests policy/check; repeated command noise suggests snip filter; recommendations require user approval; lint; tsc | [ ] |
| M13 | **Phase wrap and documentation** | Run full gate, document the proof model, update README/DEVLOG, and mark the plan complete. | `README.md`, `ARCHITECTURE/MECHANICAL_PROOF.md` new, `DEVLOG.md`, this plan | Full gate: lint, tsc node, tsc web, npm test, npm run build, smoke scripts; proof receipt for the full gate attached to DEVLOG | [ ] |

---

## 4. Prompt Details

### M1 - Proof receipt schema and service

**Goal.** Create the durable proof primitive that future prompts can rely on.

**Work.**

- Add a `proof_receipts` table through the existing schema/migration path.
- Add a `proof_receipt_artifacts` table or artifact-directory convention if raw command output exceeds DB-safe size.
- Add event types:
  - `proof.receipt.created`
  - `proof.receipt.failed`
  - `proof.gate.passed`
  - `proof.gate.failed`
  - `proof.gate.waived`
- Receipt fields must include:
  - `id`, `kind`, `status`, `conversationId`, `correlationId`, `contractId`, `toolCallId`
  - `workspacePath`, `cwd`, `gitHead`, `gitDirty`, `diffHash`
  - `command`, `commandHash`, `startedAt`, `finishedAt`, `durationMs`
  - `exitCode`, `timedOut`, `stdoutHash`, `stderrHash`
  - bounded previews and truncation flags
  - parsed metrics JSON
  - `createdBy` (`agent`, `system`, `user`, `ci`)
- Redact secret-looking keys before previews land in events.
- Provide `createProofReceipt`, `listProofReceipts`, `getProofReceipt`, and `findFreshProofForContract`.

**Acceptance.**

- Receipts are append-only.
- Oversize output is hashed and capped, not silently dropped.
- Event payloads contain metadata only, not raw large output.
- Migration is idempotent.

### M2 - Change contract store

**Goal.** Give each non-trivial coding turn a scoped, auditable contract.

**Work.**

- Add a `change_contracts` table with:
  - `id`, `conversationId`, `correlationId`, `status`
  - `goal`, `acceptanceCriteria`, `expectedFiles`, `nonGoals`
  - `verificationCommands`, `requiredReceiptKinds`
  - `createdAt`, `updatedAt`, `closedAt`
  - `waiverReason`, `waivedBy`, `waivedAt`
- Add IPC/preload API for contract create/update/close/waive.
- Create contracts from Plan mode goals when present.
- For coding turns without an explicit plan, let the main process synthesize a minimal contract from the user request and observed first write, but mark it `implicit`.
- Store contract ids on relevant proof receipts and review packets.

**Acceptance.**

- Contract creation does not require a model call.
- Scope fields are JSON-validated.
- Waivers require a human-visible reason.
- Existing Plan mode behavior remains intact.

### M3 - Dynamic context upgrades

**Goal.** Make the agent see true current proof state early, not stale static process text.

**Work.**

- Extend `workspace_context` with:
  - active contract summary
  - proof policy summary
  - last 5 proof receipts for current workspace/conversation
  - last failed receipt per command
  - stale-green warning when the latest passing receipt predates the latest mutation
  - recommended verification commands from contract + package inference
- Keep the existing cap behavior and collapse large sections with explicit notes.
- Update tool description so models know this is the first call for coding tasks.

**Acceptance.**

- Existing `workspace_context` tests continue to pass.
- New data obeys `cap_bytes`.
- No raw secrets or raw command output appear in context.

### M4 - Verify workspace receipts

**Goal.** Make verification produce receipts the model can quote, not memories it can fabricate.

**Work.**

- After each selected command, persist a proof receipt.
- Parse common metrics:
  - Vitest/Jest test counts and skipped/fail counts
  - TypeScript success/failure and project file
  - ESLint error/warning counts when available
  - build/smoke pass/fail duration
  - coverage summary when present
- Return JSON that includes receipt ids and parsed metrics.
- If `verify_workspace` skips commands, persist a `skipped` receipt or a receipt gap entry tied to the report.
- Preserve the existing command allowlist: requested commands must match inferred/contract commands unless a human-approved override is added later.

**Acceptance.**

- A failed verification returns tool status `error` and a receipt id.
- A passed verification returns status `done` and receipt ids.
- Test counts in final answers can be pulled from receipt metrics.

### M5 - Pre-final proof gate

**Goal.** Prevent "done" from meaning "the assistant sounded confident."

**Work.**

- Track last mutating tool call per correlation id:
  - `apply_patch`
  - write-capable filesystem tools
  - mutating shell commands
  - git operations that alter worktree/index
  - settings/config writes when relevant
- Before final assistant completion, evaluate:
  - Did this turn mutate code/config/docs?
  - Is there an active contract?
  - Is there a passing proof receipt after the last mutation?
  - Are required commands skipped or failed?
- If proof is missing:
  - automatically give the Coder one chance to run `verify_workspace`, when safe
  - if still missing/failing, emit an untrusted completion state instead of a trusted `done`
- Do not block read-only research or planning turns.

**Acceptance.**

- Read-only turns are unaffected.
- Mutating turn with no verify cannot be marked trusted.
- Mutating turn with passing receipt after the last write can finish normally.
- Failed proof is visible to the model and user.

### M6 - Proof gate UI and waiver path

**Goal.** Make proof status legible and allow explicit human judgment where automation ends.

**Work.**

- Add an inline proof banner on affected assistant turns:
  - `Trusted` when required proof passed
  - `Blocked` when proof failed and no final answer was accepted
  - `Untrusted` when the user waived or proof is incomplete
- Add a waiver modal with a required reason.
- Persist waiver onto the contract and event log.
- Make the banner link to the proof packet panel introduced in M9; until M9 lands, link to After Action.

**Acceptance.**

- No silent waiver.
- Waiver reason appears in event log and proof summary.
- UI copy is concise and non-alarmist.

### M7 - Independent reviewer evidence packet

**Goal.** Give the reviewer evidence, not the builder's sales pitch.

**Work.**

- Build a `ReviewEvidencePacket` service containing:
  - contract goal and acceptance criteria
  - git diff summary and changed file list
  - per-file snippets around changed hunks
  - proof receipt ids/status/metrics
  - failed/skipped commands and stale-green warnings
  - tool call lifecycle metadata
  - explicit omissions due to caps
- Exclude the builder's reasoning and final narrative by default.
- If builder narrative is included, label it as `builderNarrative`.
- Feed this packet to the Reviewer stage instead of `summarizeRun(...)` for code-review verdicts.

**Acceptance.**

- Packet size is bounded with explicit omission notes.
- Reviewer receives raw evidence and contract, not just summary prose.
- Tests assert builder narrative exclusion.

### M8 - Failure-mode reviewer contract

**Goal.** Replace rubber-stamp review with auditable checking behavior.

**Work.**

- Update reviewer prompt to require:
  - predicted failure modes before verdict
  - evidence checked for each failure mode
  - files/receipts consulted
  - explicit unchecked gaps
  - verdict `SHIP` or `CHANGES`
- Add a parser/validator for reviewer output.
- If reviewer output says "no issues" but does not list checked failure modes, retry once with a correction prompt.
- Update `review` skill and slash command to mirror the same contract.

**Acceptance.**

- "Reviewed everything, looks good" fails validation.
- "Checked X, Y, Z; none found" passes if it names evidence.
- Reviewer does not have to invent an issue to pass validation.

### M9 - Proof packet panel and final answer receipts

**Goal.** Give the user one place to inspect proof for a turn.

**Work.**

- Add a Proof Packet panel or extend After Action with:
  - contract summary
  - mutation summary
  - proof receipts table
  - parsed metrics
  - skipped/failing gaps
  - reviewer checked modes
  - waiver status
  - raw artifact links where safe
- Update final response composer so it cites receipt ids and parsed metrics:
  - Good: `verify receipt prf_123: vitest 2140 passed, 0 failed`
  - Bad: `tests passed` without receipt
- If no receipt exists, composer must say proof is missing rather than invent a count.

**Acceptance.**

- UI shows the same receipt id the final answer cites.
- Final answer tests prove counts come from receipt metrics.
- Missing proof is visible, not polished away.

### M10 - Repo-local blocking policy and scripts

**Goal.** Move project rules out of context and into commands developers/agents can run.

**Work.**

- Add `npm run verify:proof` that checks:
  - lint
  - tsc node
  - tsc web
  - test
  - smoke scripts when build output exists or after build
  - proof policy consistency
- Add `npm run verify:all` for the full local release-grade gate.
- Add optional git hook templates under `scripts/hooks/` or `.githooks/`:
  - pre-commit: lint/typecheck focused gate
  - pre-push: full proof gate
- Do not auto-install hooks without user consent.
- Update CI to call the canonical script where practical.

**Acceptance.**

- The local command exits non-zero on failure.
- CI and local docs reference the same proof policy.
- No hook is silently installed.

### M11 - Failure ledger and replay seeds

**Goal.** Turn proof failures into learning artifacts for the harness.

**Work.**

- Add `failure_ledger` storage for:
  - failed proof receipts
  - repeated command failures
  - waived gates
  - reviewer validation failures
  - stale-green attempts
  - user-reported "this was wrong" feedback when available
- Link each row to contract, receipt, event, and conversation.
- Generate replay seeds:
  - command to rerun
  - relevant diff hash
  - expected failure parser
  - suggested test file or area

**Acceptance.**

- Ledger rows are metadata-safe.
- Repeated failure increments a stable issue fingerprint.
- Waived gates remain searchable.

### M12 - Harness improvement recommendations

**Goal.** Use the ledger to suggest better harness rules without self-modifying silently.

**Work.**

- Add recommendation generation for:
  - missing verification command
  - repeated skipped command
  - noisy command needing a Snip filter
  - reviewer blind spot needing prompt/validator change
  - frequent waiver needing policy adjustment
- Show recommendations in the Proof panel or Settings.
- Require user approval before creating hooks, changing policies, or editing skills.

**Acceptance.**

- Recommendations are deterministic from ledger rows where possible.
- No automatic policy mutation.
- Each recommendation names the receipts/events behind it.

### M13 - Phase wrap and documentation

**Goal.** Make the new proof model understandable and verify the whole phase.

**Work.**

- Add `ARCHITECTURE/MECHANICAL_PROOF.md` covering:
  - contracts
  - receipts
  - gates
  - reviewer packets
  - waivers
  - failure ledger
  - limitations
- Update README feature tour.
- Append DEVLOG phase summary with:
  - prompt list and commits
  - final proof receipt id for the full gate
  - residual risks
  - manual verification gaps
- Mark all prompts `[x]` only after completion.

**Acceptance.**

- Full gate passes.
- The phase has its own proof receipt.
- Documentation makes clear that proof raises trust but does not remove human judgment.

---

## 5. Phase Completion Criteria

- All 13 prompts marked `[x]`.
- One commit per prompt.
- `npm run lint` passes.
- `npx tsc --noEmit -p tsconfig.node.json` passes.
- `npx tsc --noEmit -p tsconfig.web.json` passes.
- `npm test` passes.
- `npm run build` passes.
- `npm run verify:proof` passes and creates/cites a proof receipt.
- A mutating test turn without verification is blocked or marked untrusted.
- A mutating test turn with a fresh passing receipt is marked trusted.
- Reviewer output includes checked failure modes and evidence references.
- Proof packet UI shows contract, receipts, gaps, and waiver state.
- DEVLOG has every prompt entry plus a phase-completion summary.

---

## 6. Non-Goals

- No new model provider.
- No hosted Lamprey cloud or telemetry.
- No automatic installation of git hooks.
- No silent policy mutation from the failure ledger.
- No claim that proof can validate product intent or user taste.
- No attempt to make every possible change walk-away safe. The target is whole classes of ordinary coding work where acceptance criteria and checks are mechanical.

---

## 7. Risk / Unknown Register

1. **Receipt storage size.** Full raw output may grow quickly. Default to hashes, bounded previews, and explicit raw artifact retention limits.
2. **False blocking.** A proof gate that is too aggressive will frustrate exploratory work. Keep read-only and planning turns out of scope; add explicit waivers.
3. **Metric parser variance.** Vitest/Jest/ESLint output formats change. Parser failures must produce `metricsParseStatus: failed`, not block receipt creation.
4. **Contract quality.** Implicit contracts may be vague. Treat vague contract as a review gap and ask the user only when the missing acceptance criteria affects trust.
5. **Reviewer overfitting.** Requiring failure modes can tempt invention. The validator should require checked modes, not mandatory findings.
6. **Privacy.** Receipts must avoid storing secrets. Redaction must apply before previews/events, and raw artifacts need retention controls.
7. **Performance.** Full gates are expensive. Fresh-proof rules should support targeted commands from the contract while still surfacing gaps.

---

## 8. Approval State

**Drafted:** 2026-06-07

**Approved for STS:** Yes (executed 2026-06-07 -> 2026-06-08)

**Phase status:** Complete -- all 13 prompts shipped

---

## Correction Notes (2026-06-09)

Subsequent cross-phase audit found four documented invariants that were scaffolded but advisory-only in v0.9.0. The Wiring Closure phase (WC-0 → WC-11, v0.9.1) closed each one:

* **M2 implicit contract synthesis** was a documented intent (§4 M2 "for coding turns without an explicit plan, let the main process synthesize a minimal contract"), but `synthesizeImplicitChangeContract` had no production caller. **Closed by WC-3:** `ensureImplicitContractForFirstMutation()` at `electron/ipc/chat.ts:1149` runs inside `resolveSingleToolCall` whenever the descriptor is mutating and no active contract exists. Tests in `electron/ipc/chat-wc3-implicit-contract.test.ts`.

* **M5 trust state persistence** was implied by §2 Invariant 5 ("mutating turns require fresh proof or an explicit human waiver") and §4 M5 ("emit an untrusted completion state"), but the gate result was only appended as inline notice text on the assistant message body — no structured trust field existed. **Closed by WC-4:** migration v16 added `messages.proof_status TEXT`. The chat write-through at `electron/ipc/chat.ts:935` persists `'trusted' | 'untrusted' | undefined` derived from the gate result.

* **M6 banner state driven by persisted column.** The pre-WC banner parsed the inline notice text out of the message body. **Closed by WC-5:** `computeProofBannerState(proofStatus, hasLegacyNotice)` in `src/components/chat/proof-banner-state.ts:18` makes the column the source of truth (legacy notice retained as fallback). The waiver flow now flips `proof_status` to `'waived'` via `messages:setProofStatus`.

* **M9 receipt citation in prose** was the strongest M-phase claim that was actually advisory: §4 M9 explicitly asked for `verify receipt prf_123: vitest 2140 passed, 0 failed` in the final answer. The pre-WC composer instructed the model to do this but did not enforce it. **Closed by WC-6:** `composeFinalResponse` now appends a deterministic `**Verification:**` footer that cites each receipt id, glyph, kind, command, metrics, and exit code, regardless of what the model writes.

* **M10 CI integration** — the script existed but CI invoked an inline lint+tsc combo. **Closed by WC-7:** `.github/workflows/ci.yml:34` invokes `npm run verify:proof -- --no-tests`.

See `PLANNING/LAMPREY_WIRING_CLOSURE_PLAN.md` for the full wiring closure roster.

