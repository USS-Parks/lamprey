# LAMPREY_UNBURDENING_PLAN.md — Unburdening Phase (UB-0 … UB-12)

**Status: DRAFT — awaiting explicit user approval (STS). On STS, the phase runs
end-to-end INCLUDING ship + Bucket, with no further prompts.**

Drafted 2026-06-10, immediately after the same-day pipeline retirement commit
(`2f40e68`: banner deleted, toggles removed, dispatch hard-pinned single,
stale pins coerced).

---

## §0 Conventions

Verify gate per prompt: tsc ×2 + targeted vitest; full vitest + lint + build +
`verify:proof` at UB-11. Commit per prompt (`feat(unburden): UB-N …`). DEVLOG
per prompt. **UB-12 includes push to main, version 0.14.0, `npm run build:win`
from primary, artifact check at the exact dist paths, and `pwsh
scripts\bucket.ps1` — the full P-SPR → STS → Bucket chain in one authorized
run.** Worktree: current (`hardcore-swanson-5561d9`).

## §1 Goal — strip, don't gate

The v0.13.0 lesson, learned twice: machinery that is "off by default" or
"opt-in" still tortures the product — it leaks through stale settings, dead
UI, prompt bytes, reviewer essays, and 4,000-line modules every change has to
tiptoe around. This phase **deletes** the scaffolding that the Opus 4.5-era
product never had, so Lamprey's working set is the era product's working set:
**one model, full tools, thin prompt, read–edit–verify, honest reply.**

Git history keeps everything (v0.13.0 tag = last full-machinery build). This
is not data loss; it is a smaller, breathable codebase.

## §2 What gets EXCISED (not gated — removed)

| # | Subsystem | Main carcass |
|---|---|---|
| X1 | Multi-agent pipeline | `runAgentPipeline` + stage machinery in `agent-pipeline.ts`; `agent-pipeline-safety.ts` (CR-2 wrapper served only multi); `review-evidence-packet.ts` (M7); chat.ts multi branch (~150 lines); `AgentDispatchDecision` collapses to a plain single call |
| X2 | Sub-agent prompt surfaces | `buildAgentSystemPrompt`, `AGENT_ROLE_PROMPTS` (planner/reviewer/coworker heads stay ONLY for coworker side-chat), `IDEAL_REVIEWER_EXEMPLAR`, `COMPOSER_SYSTEM`, verdict-line contract text |
| X3 | L8 router + telemetry | `agent-router.ts`, `router-telemetry.ts`, SP-8 IPC + After-action "Routing" section, `'auto'` mode from types |
| X4 | Runtime proof machinery | `proof-rigor.ts`, `proof-gate.ts`, WC-3 implicit change-contract synthesis, receipts scan in chat path, `ProofGateBanner` + `proof-banner-state` + `messages:setProofStatus`, contracts waive IPC, After-action "Proof" section, settings `proofGate` / `rigorRequiresMutation` |
| X5 | Final-response composer | `composeFinalResponse` runtime path + Verification footer + `agenticCodingComposer` setting (`agenticCodingMode` keeps ONLY skills + coding contract role) |
| X6 | Stage chrome + plumbing | stage chips, "Show pipeline trace" toggle, `attachedPlanner` plumbing, stage-metrics writers, `stageBudgetMs` / `stageInactivityMs` settings (stream + MCP timeouts stay) |
| X7 | Roster | Agents tab shrinks to one **Co-worker model** picker (side chat keeps it); `agentRoster` setting retired in favor of `coworkerModel` |

## §3 What STAYS (explicitly)

Coworker side chat · Deep Research · RAG · Snip · Skills/Connectors/Plugins ·
Panels aesthetic · Reasoning audit + trace viewer (R8 was user-directed;
filters simplify) · Timeouts (stream/MCP) · Ghost-reply guard · Spill valve +
GC · Pseudo-tag sanitizer · Memory/Projects/Chapters · `verify:proof` repo
gate (dev tooling for building Lamprey, not runtime UX) · Project-conventions
contract block (STS/P-SPR/Bucket vocabulary).

## §4 Decision register (stances — amend before STS)

| # | Decision | Stance |
|---|---|---|
| K1 | Delete vs keep-dormant | **Delete.** Dormant code is the torture; history is the archive. |
| K2 | DB schema (proof_receipts, change_contracts, stage columns, draft, stage metrics) | **Keep schema, remove writers.** No destructive migrations; historical rows stay readable. |
| K3 | Historical multi-agent rows | Render with one neutral muted chip ("Pipeline (legacy)") — no toggles, no traces. Reasoning-trace viewer still shows their reasoning. |
| K4 | `verify:proof` dev gate | **Keep** (it gates OUR builds; the era product analog is CI, which it had). |
| K5 | Contract bytes | Expect coding-mode prompt to drop below 3,800 B; guards tightened, never raised. |
| K6 | Tests | Suites for excised modules are deleted with them; integration locks rewritten as "absence locks" (era-chrome pattern). Expect net test count to FALL — that is correct, not regression. |

## §5 Roster

- **UB-0** Baseline: line counts + module inventory of everything in §2; `PLANNING/UB_BASELINE.md`.
- **UB-1** Excise pipeline core (X1) + chat.ts multi branch; dispatch becomes a direct single call.
- **UB-2** Excise sub-agent prompt surfaces (X2); coworker head survives.
- **UB-3** Excise router + telemetry (X3); After-action section removed.
- **UB-4** Excise runtime proof machinery (X4); ghost-reply + sanitizer untouched.
- **UB-5** Excise composer (X5); reply = model's reply, always.
- **UB-6** Stage chrome + plumbing sweep (X6); legacy-row neutral chip (K3).
- **UB-7** Settings/types cleanup: retire keys, `coworkerModel`, Agents tab shrink (X7); DEFAULT_APP_SETTINGS + parity test updated; readSettings drops dead keys from the merged view.
- **UB-8** Contract + prompt re-measure; tighten byte guards (K5).
- **UB-9** Docs: CLAUDE.md current-state, README, ARCHITECTURE/* marked historical, DEVLOG.
- **UB-10** Playbook v0.14.0: one configuration, eight asks, era contract only.
- **UB-11** Full gate: lint, tsc ×2, full vitest, build, `verify:proof`.
- **UB-12** Ship arc v0.14.0: version bump, push main, build:win from primary, verify `dist\Lamprey-x64.exe` + `dist\Lamprey-x64.zip` timestamps + latest.yml version, **Bucket**, README check sequence.

## §6 Completion criteria

1. `grep -r "runAgentPipeline\|proofGate\|routeAgentMode\|composeFinalResponse" electron/ src/` → zero live references (history only).
2. A fresh install AND the user's existing install behave identically: single agent, full tools, no machinery chrome anywhere, no settings key able to resurrect it.
3. Net LOC meaningfully down (target ≥ 3,000 lines removed); prompt bytes down; full gate green.
4. v0.14.0 installed via CDN within the same run (Bucket included).

## §7 Approval

**DRAFT.** Reply **"STS"** → UB-0 through UB-12 including Bucket, no further questions. Amend any §4 stance first if I've misread the strip depth.
