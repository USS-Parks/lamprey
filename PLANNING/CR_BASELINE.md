# CR_BASELINE.md — Cogency Restore Phase baseline (CR-0)

Captured **2026-06-09** against branch `claude/cogency-restore` at HEAD (parent commit
`61a8119` = origin/main, v0.11.1 Reviewer Packet Hotfix shipped). All measurements
taken via a throwaway vitest harness (`electron/services/__cr0-measure.test.ts`)
deleted in the same commit as this file.

---

## §1 — Contract byte totals per stage

`renderContract()` is stage-agnostic post-L2; the role-fragment block is added on top
when the chat handler picks a contractRole. So per-stage total = `renderContract()`
bytes + role fragment bytes (no fragment for the default single-agent path).

| Stage | Identity head | Contract body | Role fragment | Total bytes |
|---|---|---|---|---|
| single (no role) | identityHead bytes (n/a-stable) | **2560** | 0 | **2560** |
| coding | identityHead | 2560 | **180** | **2740** |
| review | identityHead | 2560 | **237** | **2797** |
| planning | identityHead | 2560 | **219** | **2779** |
| frontend | identityHead | 2560 | **259** | **2819** |
| document | identityHead | 2560 | **220** | **2780** |
| non_technical_user | identityHead | 2560 | **237** | **2797** |

Additional load-bearing prompts (not part of `renderContract()`):
- `COMPOSER_SYSTEM`: **774 bytes**
- `IDEAL_TURN_EXEMPLAR` (embedded inside `renderContract()` per HY6): **453 bytes**
  (included in the 2560 above; called out for byte-budget tracking)

Pre-CR contract body excluding the HY6 exemplar: ~2107 bytes.

---

## §2 — Project vocabulary grep

`grep -c "STS\|P-SPR\|Stem to Stern\|Sequential Prompt Roster\|Plan +" electron/services/system-prompt-builder.ts` → **0 hits**.

The Planner / Coder / Reviewer / Composer prompts contain zero references to the
project-specific planning vocabulary defined in CLAUDE.md. F1 is empirically confirmed:
the Planner cannot recognize STS, P-SPR, Stem to Stern, Sequential Prompt Roster, or
"Plan + …" terminology at runtime. CR-1's Project conventions block addresses this.

Additional grep findings:
- `Bucket` (ship pipeline shorthand): **0 hits** — also missing
- `routeAgentMode` location: `electron/services/agent-router.ts:83` (PHASE_RE at line 56
  matches `STS / P-SPR / stem to stern / Phase / phase wrap`, so the ROUTER recognizes
  the vocab even though the CONTRACT does not).

---

## §3 — Proof-rigor predicate verbatim (pre-CR-5)

Source: `electron/services/proof-rigor.ts`.

```ts
const RIGOR_RE =
  /\b(audit|verif(?:y|ied|ication)|prove|proof|review|validate|validation|double[- ]?check|rigor(?:ous)?|certify|guarantee|sign[- ]?off)\b/i

/** Pure: does the prompt explicitly ask for verification-grade rigor? */
export function isRigorRequest(text: string): boolean {
  return RIGOR_RE.test(text ?? '')
}

/** Resolve the effective rigor decision for a turn. */
export function resolveProofRigor(input: {
  proofGateMode?: string
  dispatchKind?: 'single' | 'multi'
  content: string
}): boolean {
  if (input.proofGateMode === 'always') return true
  if (input.proofGateMode === 'off') return false
  return input.dispatchKind === 'multi' || isRigorRequest(input.content)
}
```

**F4 root cause confirmed:** `dispatchKind === 'multi'` is sufficient to enable rigor,
regardless of whether any mutation is attempted. CR-5 expands this predicate to require
both `multi-dispatch (or rigor verb)` AND `mutation_attempted` AND `!planMode`.

---

## §4 — Router code base reference (pre-CR-3)

Source: `electron/services/agent-router.ts` (174 lines). `routeAgentMode(userText)`
returns `{ mode, reason, cleanedText }` with `reason` strings such as:

- `"explicit --single flag in the prompt"`
- `"long prompt (NNN chars > 800)"`
- `"phase phrase matched: \"STS\""`
- `"build-from-scratch phrase (build/create/scaffold + full/app/system/etc)"`
- `"multi-file phrase (refactor/audit/rewrite + across/entire/all)"`
- `"sequential-step markers (N ≥ 2)"`
- `"N deliverables (bullets/commas ≥ 3)"`
- `"short, single-deliverable ask"` (default → single)

The dispatch chain in `chat.ts:545` reads:
```ts
const dispatch = resolveAgentDispatch(settingsRaw, content)
if (dispatch.routeReason) {
  console.info(`[chat] auto-routed to ${dispatch.kind}: ${dispatch.routeReason}`)
}
```

Decisions are logged to console only; not surfaced to UI, not persisted, not in a
ring buffer the user can inspect after the fact. CR-3 adds structured telemetry.

---

## §5 — Router decisions for LL_SMOKE_PLAYBOOK asks (data, pre-CR-3)

Manually traced through `routeAgentMode()` for each ask (sourced from
`electron/services/agent-router.ts` regexes above):

| Ask | Verbatim prompt | Predicted route per router | v0.11.0 observed | v0.11.1 observed |
|---|---|---|---|---|
| 2 | `Rename runChatRound to dispatchSingleAgentTurn in electron/ipc/chat.ts` | **single** (default; no phase / build / refactor / sequential / deliverable hit) | multi | n/a |
| 3 | `Fix the typo 'Lampshde' in the README` | **single** (default) | multi | multi |
| 4 | `Why is the build failing?` | **single** (default — "build" alone doesn't match BUILD_FROM_SCRATCH_RE) | multi | multi |
| 5 | `Add a button to the chat header that exports the transcript as markdown` | **single** (default) | multi | multi |
| 6 | `Refactor the chat store to use Zustand 5 slices across every consuming component` | **multi** (MULTI_FILE_RE matches "refactor … across every") | multi | multi (stalled) |
| 7 | `STS the new error-boundary phase` | **multi** (PHASE_RE matches `STS`) | multi | n/a |
| 8 | `Show me the P-SPR for adding telemetry` | **multi** (PHASE_RE matches `P-SPR`) | multi | multi |

**Discrepancy:** Asks 2, 3, 4, 5 SHOULD route single per the heuristic but were observed
multi in both v0.11.0 and v0.11.1. This means either:
1. The user's effective `agentMode` is NOT `'auto'` (could be `'multi'`)
2. `resolveAgentDispatch` is being called with a different signature than expected
3. There's a wrapper / override layer in `chat.ts` not visible in the local trace

CR-3's structured `RouterDecision` will surface which rule fires (or whether the
auto-router is being consulted at all) per-turn for diagnosis. CR-4 acts on that data.

### CR-4 update (2026-06-09) — root cause confirmed

CR-3 telemetry + the new LL_SMOKE_PLAYBOOK lock tests confirm: **the router itself is
correct.** The heuristic routes Asks 2/3/4/5 to single and Asks 6/7/8 to multi exactly
as documented in §5's "predicted route" column.

The user's runtime observation of multi-routing on Asks 2-5 was caused by the
**dispatch-layer bypass**: when `settings.agentMode === 'multi'` (vs. `'auto'`),
`resolveAgentDispatch` skips `routeAgentMode` entirely and goes straight to the
multi pipeline. That's by design — explicit-multi means the user pinned it. The
playbook's setup notes assumed `agentMode='auto'` but the user's effective settings
were `'multi'`.

**Conclusion: no router rule tuning needed.** CR-4 ships as the test lock + this doc
note + the dispatch-bypass test (`CR-4: agentMode=multi BYPASSES routeAgentMode …`).
The fix for the user's actual experience is a settings change (flip to `'auto'`), not
a code change.

Future signal to watch: if users report "the heuristic mis-routed my single ask to
multi" with `agentMode='auto'` confirmed in their settings, that's a CR-4.x patch
prompt to tune the regex. CR-3's telemetry ring buffer makes that trivially
diagnosable via the /debug view.

---

## §6 — `isRigorTurn` snapshot (the F4 trip wire)

Trip path that produces "Untrusted completion" pill on no-mutation turns:

1. User sends Ask 3 / 4 / 5 / 8 (asks without mutating verbs)
2. `resolveAgentDispatch` → `kind: 'multi'` (per §5 discrepancy)
3. `chat.ts:554` calls `setProofRigor(conversationId, resolveProofRigor(...))`
4. `resolveProofRigor` returns `true` because `dispatchKind === 'multi'`
5. Proof-gate trust evaluation runs (`isProofRigorActive` true)
6. Coder makes zero mutations during the turn
7. No `verify` receipt synthesized
8. Proof gate flags `proofStatus: 'untrusted'` → pill renders

CR-5's mutation_attempted predicate breaks this chain at step 4.

---

## §7 — Files not yet measured (deferred until later CR prompts)

- **Per-stage `agent.stage.*` event byte counts** — would need a live turn capture
- **Reviewer-fragment exemplar — not yet present, will be added in CR-7**
- **Stage inactivity timing baseline** — Ask 6 v0.11.1 stalled at 54 tool calls; need
  a CR-2 live capture to set a sensible `stageInactivityMs` default (90s is the
  starting proposal but may need tuning)

---

## §8 — Re-run procedure for CR_AFTER.md (CR-11 / CR-12)

After CR-12 lands, re-run the throwaway harness once more under a fresh checkout of
the post-CR branch to confirm:
- Contract bytes: pre + ≤ 600 (target 2560 + 600 ≤ 3160)
- CR-1 vocab grep: 4-5 hits in `system-prompt-builder.ts` (one per bullet)
- Rigor predicate verbatim diff: shows `mutation_attempted && !planMode` clause
- Per-ask router decisions captured live (via CR-3 telemetry)
