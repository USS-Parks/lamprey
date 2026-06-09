# Mechanical Proof Architecture

> Lamprey v0.9.x — Mechanical Proof Harness Phase (M1-M13)

## Overview

The Mechanical Proof Harness turns Lamprey's existing agent framework into a **mechanical proof layer**: scoped work contracts, persisted verification receipts, blocking completion gates, independent reviewer packets, and auditable failure-mode checks. The phase reduces how much the user has to babysit ordinary coding work by making "done" depend on executable evidence rather than model self-report.

Research basis: Ning et al., *Code as Agent Harness: Toward Executable, Verifiable, and Stateful Agent Systems*, arXiv:2605.18747.

## Key Concepts

### 1. Proof Receipts (`proof_receipts`)

Append-only records of verification commands. Each receipt captures:

- Command, exit code, duration, stdout/stderr hashes
- Git HEAD, dirty flag, diff hash
- Parsed metrics (vitest test counts, tsc status, eslint errors, build duration, coverage)
- Bounded previews with secret redaction

Receipts can be `passed`, `failed`, or `skipped`. A receipt is never overwritten — later runs create new receipts linked to the same contract.

**Storage:** `proof_receipts` table (migration v12), plus `proof_receipt_artifacts` for large output overflow.

**Service:** `electron/services/proof-receipts.ts`

### 2. Change Contracts (`change_contracts`)

Scoped work contracts with typed acceptance criteria:

- Goal, acceptance criteria, expected files, non-goals
- Verification commands, required receipt kinds
- Lifecycle: `active` → `closed` or `waived`
- Implicit contracts synthesized for unplanned coding turns

Contracts are created from Plan mode goals when present, or synthesized as `implicit` contracts for coding turns without an explicit plan.

**Storage:** `change_contracts` table (migration v13)

**Service:** `electron/services/change-contract-store.ts`

### 3. Proof Gate

Before a mutating coding turn can finish as trusted, the proof gate checks:

1. Did this turn mutate code/config?
2. Is there an active contract?
3. Is there a passing proof receipt after the last mutation?

If proof is missing:
- The Coder gets one automatic chance to run `verify_workspace`
- If still missing/failing, the turn is marked **untrusted**
- Read-only and planning turns are unaffected

**Service:** `electron/services/proof-gate.ts`

**UI:** `src/components/chat/ProofGateBanner.tsx` — inline `Trusted`/`Blocked`/`Untrusted` banner on affected turns.

### 4. Waivers

When automation cannot decide, the user can issue an explicit waiver with a required reason. Waivers are persisted on the contract and event log. No silent waiver is possible.

**IPC:** `contracts:waive`

### 5. Independent Reviewer Evidence Packet

The Reviewer stage receives raw evidence, not the builder's narrative:

- Contract goal and acceptance criteria
- Git diff summary and changed file list
- Per-file snippets around changed hunks
- Proof receipt IDs, statuses, metrics
- Failed/skipped commands and stale-green warnings
- Tool call lifecycle metadata

Builder narrative is excluded by default. If included, it is labeled `builderNarrative`.

**Service:** `electron/services/review-evidence-packet.ts`

### 6. Failure-Mode Reviewer Contract

Reviewer output must include:

- Predicted failure modes
- Evidence checked for each failure mode
- Files/receipts consulted
- Explicit unchecked gaps
- Verdict: `SHIP` or `CHANGES`

"Looks good" without checked modes fails validation. The reviewer gets one retry with a correction prompt.

**Validator:** `electron/services/reviewer-output-validator.ts`

### 7. Proof Packet (After Action Panel)

The After Action panel in the right sidebar shows:

- Contract summary, mutation summary
- Proof receipts table with status and metrics
- Parsed metrics (test counts, typecheck status, etc.)
- Skipped/failing command gaps
- Reviewer checked modes
- Waiver status

Final assistant answers cite receipt IDs and parsed metrics. If no receipt exists, the answer must say proof is missing rather than inventing counts.

### 8. Failure Ledger (`failure_ledger`)

Durable storage for proof failures:

- `proof_failed` — verification receipts that failed
- `command_failed` — repeated command failures
- `gate_waived` — human-waived proof gates
- `review_invalid` — reviewer validation failures
- `stale_green_attempt` — stale-green warnings
- `user_reported` — user-reported correctness feedback

Each row carries a stable fingerprint (SHA-256 of kind + command + contract + diff hash) so repeated failures of the same type are counted rather than duplicated. Supports replay seed generation (command to rerun, diff hash, failure parser kind).

Rows are auto-promoted from `proof.receipt.failed`, `proof.gate.failed`, and `proof.gate.waived` events.

**Storage:** `failure_ledger` table (migration v14)

**Service:** `electron/services/failure-ledger.ts`

### 9. Harness Improvement Recommendations

Deterministic recommendations generated from the failure ledger:

| Recommendation | Trigger | Severity |
|---|---|---|
| Missing verification | ≥3 proof_failed for same command | warning |
| Repeated skip | ≥3 skipped receipts | warning |
| Noisy command | ≥2 receipts with large output | info |
| Reviewer blindspot | ≥3 review_invalid failures | warning |
| Frequent waiver | ≥2 waivers for same contract | info |
| Stale green | ≥3 stale_green_attempt failures | warning |

Each recommendation names the specific evidence behind it. No automatic policy mutation — user approval is required.

**Service:** `electron/services/harness-recommendations.ts`

**UI:** Recommendations section in the After Action panel.

### 10. Repo-Local Policy

- `npm run verify:proof` — lint, tsc, test, and smoke checks (when build output exists)
- `npm run verify:all` — build then full proof gate with required smokes
- Optional hook templates in `scripts/hooks/pre-commit` and `scripts/hooks/pre-push`
- CI uses canonical proof steps

## Data Flow

```
User prompt → Plan/Contract created
  → Coder mutates code
  → verify_workspace runs → proof receipt persisted
  → Proof gate evaluates (fresh receipt after last mutation?)
  → If failed: untrusted completion + waiver path
  → Reviewer gets independent evidence packet
  → Reviewer must check failure modes → SHIP/CHANGES
  → Failure ledger auto-promotes failed receipts/waivers
  → Recommendations generated from ledger patterns
```

## Migration Versions

| Version | Prompt | Description |
|---|---|---|
| 12 | M1 | Proof receipt and artifact tables |
| 13 | M2 | Change contracts table |
| 14 | M11 | Failure ledger table |

## Limitations

1. **Receipt storage size.** Raw command output is hashed and preview-capped. Full raw output is not stored by default.
2. **Metric parser variance.** Vitest/Jest/ESLint output formats change. Parser failures produce `metricsParseStatus: failed` without blocking receipt creation.
3. **Contract quality.** Implicit contracts may be vague. Vague contracts are treated as review gaps.
4. **Reviewer overfitting.** Requiring failure modes can tempt invention. The validator requires checked modes, not mandatory findings.
5. **Privacy.** Receipts avoid storing secrets through redaction. Raw artifacts need explicit retention controls.
6. **Proof ≠ product intent.** Mechanical proof validates that checks ran, not that the product is correct. Human judgment remains explicit for product intent, acceptable risk, and ambiguous criteria.
