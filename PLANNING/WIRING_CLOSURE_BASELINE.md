# Wiring Closure Baseline — WC-0

**Date:** 2026-06-09
**Branch:** `claude/vigorous-nightingale-5697db` (worktree off `main` HEAD `8f33b60`)
**Purpose:** Read-only re-confirmation that the seven audited gaps are still present at HEAD before WC-1 begins implementation.

---

## Baseline Gate

| Check | Result |
|---|---|
| `npm run lint` | ✅ pass |
| `npx tsc --noEmit -p tsconfig.node.json` | ✅ pass |
| `npx tsc --noEmit -p tsconfig.web.json` | ✅ pass |
| `npm test` | ✅ 2150 passed / 122 skipped (better-sqlite3 native binding) |
| `npm run build` | ✅ pass (electron-vite build in 3.96s) |

---

## Gap re-confirmation

### Gap 1 (HIGH) — `normalizeToolsForProvider` is dead code → WC-1

**Grep `normalizeToolsForProvider`:**
- `electron/services/providers/schema-normalizer.ts` (definition)
- `electron/services/providers/schema-normalizer.test.ts` (unit test)
- **Zero production callers.**

Tools reach the provider API without per-provider schema adaptation. Core-tool fail-fast is not enforced at runtime. `ARCHITECTURE/FUNCTION_CALLING.md` line 25 / 96 / 221 describe this as live; it is not.

### Gap 2 (HIGH) — `filterToolsForRole` is dead code → WC-2

**Grep `filterToolsForRole`:**
- `electron/services/role-tool-access.ts` (definition only)
- **Zero production callers, zero test callers.**

Every agent role (Planner, Coder, Reviewer) currently receives the same tool list. `ARCHITECTURE/FUNCTION_CALLING.md` line 31 / 204 / 232 describe role filtering as live; it is not.

### Gap 3 (HIGH) — `synthesizeImplicitChangeContract` never called → WC-3

**Grep `synthesizeImplicitChangeContract`:**
- `electron/services/change-contract-store.ts` (definition)
- `electron/services/change-contract-store.test.ts` (unit test)
- **Zero callers in `chat.ts`, `agent-pipeline.ts`, or any other production path.**

Unplanned mutating coding turns finish without a contract, so M5's gate has nothing to evaluate against `requiredReceiptKinds`.

### Gap 4 (MEDIUM) — `messages.proof_status` column does not exist → WC-4

**Grep `proof_status` / `proofStatus`:** zero hits in the codebase.

`electron/services/schema-init.ts` `messages` schema has no trust column. `electron/ipc/chat.ts` line ~915 appends a `proofGateNotice(gate)` to the message body but no structured field is persisted.

### Gap 5 (MEDIUM) — Proof gate does not block trusted completion → WC-5

Inherits from Gap 4. With no persisted status, neither the UI banner nor the composer can read trust state structurally. `src/components/chat/ProofGateBanner.tsx` reads from the inline notice text rather than from a message field.

### Gap 6 (MEDIUM) — Final answer prose does not cite receipt IDs → WC-6

`electron/services/final-response-composer.ts:256` formats receipts inside the *composer's instruction to the model* (system context), expecting the model to follow through. The user-visible final answer body is the model's reply — which may or may not include the receipt id verbatim.

The plan §4 M9 specifically asked for inline citations like `verify receipt prf_…: vitest 142 passed, 0 failed` that we author deterministically, not trust the model to produce.

### Gap 7 (MEDIUM) — `verify:proof` not in CI → WC-7

**Grep `verify:proof` / `verify-proof` in `.github/`:** zero hits.

`.github/workflows/ci.yml:33–34` runs `npm run lint && npx tsc … node && npx tsc … web` as the "Proof policy static gate" — but `package.json:27–28` `verify:proof` / `verify:all` scripts are never invoked from CI.

### Gap 8 (MEDIUM) — No PRJ-10 end-to-end Sidebar regression test → WC-8

**Glob `src/components/layout/Sidebar.*test*`:** zero hits.

`src/lib/projects.test.ts` has 22 validation unit tests. There is no component-level test that mounts `<Sidebar />`, clicks the "+", and asserts `<NewProjectModal />` renders. The original PRJ "+" defect has no regression test that would have failed against the old `window.prompt()` implementation.

---

## What changed between draft and execution

Nothing observable in code under the seven gap fingerprints. All seven gaps are still present exactly as the cross-phase audit described them. WC-1 may proceed.

---

## Out of scope for this phase

Per plan §6 Non-Goals — no new tools, no new providers, no new UI panels, no UX cleanups beyond what wiring exposes. Patch-level v0.9.1 release at WC-11.

**End of baseline.**
