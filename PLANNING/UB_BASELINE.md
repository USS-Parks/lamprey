# UB_BASELINE.md — Unburdening Phase pre-excision inventory (UB-0)

Captured 2026-06-10 at commit `0283e6c` (post-retirement: pipeline already
unreachable from dispatch; this phase deletes the carcass).

## Condemned modules (X1–X7), line counts

| Lines | File | Excised in |
|---:|---|---|
| 819 | electron/services/agent-pipeline.ts | UB-1 |
| 952 | electron/services/agent-pipeline.test.ts | UB-1 |
| 347 | electron/services/agent-pipeline-safety.ts | UB-1 |
| 422 | electron/services/agent-pipeline-safety.test.ts | UB-1 |
| 325 | electron/services/review-evidence-packet.ts | UB-1 |
| 147 | electron/services/review-evidence-packet.test.ts | UB-1 |
| 178 | electron/services/agent-router.ts | UB-3 |
| 218 | electron/services/agent-router.test.ts | UB-3 |
| 75 | electron/services/router-telemetry.ts | UB-3 |
| 83 | electron/ipc/after-action-router-telemetry.test.ts | UB-3 |
| 107 | electron/services/proof-rigor.ts | UB-4 |
| 147 | electron/services/proof-rigor.test.ts | UB-4 |
| 209 | electron/services/proof-gate.ts | UB-4 |
| 153 | src/components/chat/ProofGateBanner.tsx | UB-4 |
| 38 | src/components/chat/proof-gate-notice.ts | UB-4 |
| 22 | src/components/chat/proof-banner-state.ts | UB-4 |
| 401 | electron/services/final-response-composer.ts | UB-5 |
| 365 | electron/services/final-response-composer.test.ts | UB-5 |

**Subtotal: 5,008 lines** in whole-module deletions, before the chat.ts multi
branch (~150), system-prompt-builder surfaces (UB-2), UI plumbing (UB-6),
settings/types (UB-7), and partial test rewrites.

## Explicitly KEPT (verified separable)

- `multi-agent-run-tool.ts` / `multi-agent-run-tool-pack.ts` /
  `subagent-runner.ts` — the model-callable `multi_agent_run` tool (Task-tool
  analog; era-accurate, model-initiated, not harness-imposed).
- `proof-receipts.ts` / `change-contract-store.ts` / `failure-ledger` — store
  layers stay per K2 (schema + historical rows); chat-path consumers go.
- `verify:proof` repo gate (K4), ghost-reply guard, sanitizer, spill valve.

## Gate baseline

v0.13.0+retirement: vitest 2,379 passed / 123 skipped; coding-mode prompt
4,039 B (< 4,400 guard); contract 3,401 B (< 3,700 guard).
