# SP_BASELINE.md — Sweet Spot Phase pre-change snapshot (SP-0)

Captured **2026-06-10** on worktree `hardcore-swanson-5561d9` at commit `78b730e`
(v0.12.0, CR-12 wrap). All numbers below are the BEFORE state the phase changes.

---

## §1 Defaults divergence (D1) — verbatim from both sources

| Key | Renderer (`src/stores/settings-store.ts`) | Main (`electron/ipc/settings.ts`) |
|---|---|---|
| `agentMode` | `'auto'` (line 22) | **`'single'`** (line 41) |
| `proofGate` | *(absent — runtime default `'rigor'`)* | *(absent)* |
| `toolSurface` | *(absent — runtime default `'lazy'`)* | *(absent)* |
| `includePastReasoningInContext` | `true` (line 40) | **(missing entirely)** |
| `agenticCodingComposer` | `'auto'` (line 31) | `'auto'` (line 46) |
| theme/font/model/roster/snip/seed keys | present | present (values match) |

The two default objects are maintained by hand in two files and have already drifted
on two keys. `settings:get` merges `{...defaultSettings, ...data}` main-side, so the
**main-process values win** for any key the user never set — meaning fresh installs
actually run `agentMode: 'single'` despite L8 documenting `'auto'` as the default.

Runtime-only defaults (never in either object): `proofGate → 'rigor'` (proof-rigor.ts),
`toolSurface → 'lazy'` (chat.ts:1058), `toolResultSpillBytes → 8192`,
`rigorRequiresMutation → true` (proof-rigor.ts:30), `stageInactivityMs → 0`.

## §2 Prompt-surface byte sizes (unchanged by this phase; guard values)

| Surface | Bytes | Guard |
|---|---|---|
| `renderContract()` | 3,401 | < 3,700 |
| single coding mode | 4,039 | < 4,400 |
| planner sub-agent | 309 | < 1,500 |
| coder sub-agent | 1,293 | < 1,500 |
| reviewer sub-agent | 695 | < 1,024 |
| `IDEAL_REVIEWER_EXEMPLAR` | 281 | ≤ 300 |

## §3 Defect register (from the 2026-06-10 four-track audit)

| # | Defect | Location |
|---|---|---|
| D1 | agentMode default mismatch + missing keys in main defaults | settings-store.ts:22 vs electron/ipc/settings.ts:41 |
| D2 | StageInactivityWatchdog.kick() only called from armStage() | agent-pipeline-safety.ts:206-240 |
| D3 | Spill files never GC'd | tool-result-spill.ts:66-77, zero delete sites |
| D4 | mutationAttempted never cleared per turn | chat.ts:1567, proof-rigor.ts |
| D5 | Ghost-reply: pre-stream throw / no-mutation pipeline throw persist nothing | chat.ts:732-755 |
| D6 | Router telemetry has NO IPC handler (CR-3 doc said "exposed") | router-telemetry.ts:30-56 |
| D7 | better-sqlite3 ABI skips invisible in verify:proof output | scripts verify pipeline |

## §4 Era divergences (defaults moving this phase)

| # | Today | Target (per plan §4 decision register) |
|---|---|---|
| E1 | effective dispatch fans out via router | `agentMode: 'single'` everywhere |
| E2 | `proofGate` runtime default `'rigor'` | `'off'` |
| E3 | composer rewrites reply at round ≥ 1 regardless of agenticCodingMode | composer requires `agenticCodingMode && agenticCodingComposer !== 'never'` |
| E4 | `toolSurface` runtime default `'lazy'` | `'full'` |
| E5 | raw internals in UI (stage names, contract/receipt ids, assistant-styled system rows) | neutral labels, ids to tooltip, system-notice styling |

## §5 Test baseline

v0.12.0 final gate (CR-12): vitest **2,332 passed / 123 skipped**, tsc node + web OK,
`verify:proof --no-tests` exit 0. The 123 skips are the better-sqlite3
NODE_MODULE_VERSION cohort (D7 — currently invisible at gate time).
