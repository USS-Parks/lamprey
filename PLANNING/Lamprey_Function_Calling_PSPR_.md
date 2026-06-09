# Lamprey Function Calling Plan — Sequential Prompt Roster (P-SPR)

> \*\*Status: approved for STS execution.\*\* This P‑SPR was drafted on 2026‑06‑08 from the v0.9.0 repo state, revised through two rounds of critique, and is now the single canonical plan for this phase. Execute FC‑0 → FC‑16 without stopping.

**Goal:** Complete and harden Lamprey's existing native function‑calling infrastructure so that every provider pathway reliably returns structured `toolCalls` instead of relying on prompt‑parsed pseudo‑XML. When finished, the `PSEUDO\_TAG\_GUARD` and `sanitizePseudoTags` workarounds are bypassed for all native‑capable models, the fallback JSON parser is brace‑balanced and schema‑aware, fallback calls are treated as degraded trust, and the agent pipeline dispatches tool calls directly from API‑returned structured arrays with a canonical transcript model shared across all providers.

**Research basis:** The design analysis and two rounds of critique (2026‑06‑07/08) established that foundational function‑calling infrastructure already exists in the repo but is incomplete, partially wired, and still shadowed by the older manual‑parsing pathway. This phase closes gaps in dependency order: audit → schema → normalizer → transcript → adapters → pipeline → trust/scoping → tests → shadow → smoke → cleanup → docs → wrap.

**Primary sources:**

* OpenAI function calling documentation
* Alibaba DashScope function calling documentation (OpenAI‑compatible)
* Google Gemini OpenAI‑compatible endpoint documentation
* OpenRouter tool‑calling pass‑through behaviour
* Current Lamprey repo state (v0.9.0)

**Current Lamprey substrate this phase builds on:**

* `MODEL\_CATALOG` in `electron/services/providers/registry.ts` already carries `supportsTools` flags per model.
* `getOpenAITools()` in `electron/services/tool-registry.ts` already converts tool descriptors to OpenAI‑format `tools` arrays from `inputSchema`.
* `tool\_calls` message persistence already exists in `electron/services/conversation-store.ts`.
* `chat.ts` already handles `tool\_calls` in responses.
* `PSEUDO\_TAG\_GUARD` in `electron/services/system-prompt-builder.ts` and `sanitizePseudoTags` in `electron/services/sanitize-pseudo-tags.ts` are applied universally; they will be scoped to fallback models only.
* All three native providers (DeepSeek, Google, DashScope) use OpenAI‑compatible endpoints, but the exact Google adapter transport must be confirmed in FC‑0 rather than assumed.
* Tool descriptors already carry `inputSchema` — no new schema field is needed, but schemas must be hardened and normalized per provider.
* MCP-originating tools, if exposed to models as callable tools, must be audited in FC‑0 and either brought through the same schema/normalization/validation pathway or explicitly documented as out of scope for this phase.

**Why a new phase is still needed:** The substrate is present but incomplete. This phase stabilizes the adapter boundary first (schema, normalizer, transcript model, argument validation, fallback parser), then moves the pipeline onto that stable boundary. The result is a system where tool calls are a typed contract, not a text‑parsing gamble.

\---

## 0\. Session Bootstrap — Read This First

You are a fresh coding session handed this document. Before doing anything else:

### Step 1 – Confirm environment

Verify:

* Working directory is `C:\\Users\\17076\\Documents\\Claude\\Lamprey Harness` or a worktree thereof.
* Current branch is not `main`. Create a branch such as `codex/function-calling` off `main` if needed.
* `git status --short --branch` is inspected before editing. Do not revert unrelated user changes.
* Baseline checks pass before FC‑0 starts:

  * `npm run lint`
  * `npx tsc --noEmit -p tsconfig.node.json`
  * `npx tsc --noEmit -p tsconfig.web.json`
  * `npm test`
  * `npm run build`
* If any baseline check fails, halt and report the exact failure. Do not start implementation on a broken baseline.

### Step 2 – Execute FC‑0 → FC‑16 without stopping

1. Do not ask further questions unless a prompt requires a product decision only the user can make.
2. For each prompt, in order:

   * Read the listed files and nearby code before editing.
   * Implement only that prompt's scope.
   * Run the prompt's verify gate.
   * If verify fails: fix and retry up to 2 times. On the third failure, halt, write a blocked DEVLOG entry, and report.
   * If verify passes: mark the prompt `\[x]` in this document, append a DEVLOG entry, then commit. Do not push.
3. One commit per prompt. No batching, no early phase wrap.
4. When all prompts complete: run the phase completion gate, write the phase‑complete DEVLOG entry, and report final status.

### Step 3 – DEVLOG entry format

```markdown
## \[Function Calling – Prompt FC‑N] <Title> - <YYYY-MM-DD>

\*\*Files changed:\*\* <list>
\*\*Verify gate:\*\*
- lint OK
- tsc node OK
- tsc web OK
- vitest <subset or all> OK
- build/smoke/user‑verification‑needed: <result>

\*\*Shadow comparison:\*\* <if applicable, differences observed or "clean">
\*\*Notes:\*\* <anything surprising, deferred, or worth knowing>

\*\*Commit:\*\* <SHA>
```

### Step 4 – Commit discipline

* One commit per prompt.
* Never use `--no-verify`. If a hook fails, fix the underlying issue.
* Never add a `Co-Authored-By` trailer.
* Use the project's commit‑message style, e.g.:

  * `feat(tools): FC-0 provider capability and schema audit`
  * `feat(tools): FC-1A tool schema infrastructure and validator`
  * `feat(providers): FC-3 provider schema normalizer`
  * `feat(pipeline): FC-8 refactor agent pipeline to use toolCalls`

\---

## 1\. Audit Summary — Current Gaps

|#|Gap|Current evidence|Owner prompt|
|-|-|-|-|
|1|No provider‑specific schema compatibility audit, and no "Implementation Decisions" table mapping each provider's actual transport, normalizer strategy, argument format, and fallback eligibility.|`getOpenAITools()` returns a single schema shape; Google adapter transport is assumed but not confirmed.|FC‑0|
|2|`inputSchema` on tool descriptors may be loose, missing `additionalProperties: false`, or absent on some tools. A single prompt to fix all tools creates a high‑risk blast radius.|`electron/services/tool-registry.ts` — `getOpenAITools()` reads `inputSchema`. Individual tool descriptor quality varies.|FC‑1A, FC‑1B, FC‑1C|
|3|No shared tool‑call argument validator. Native calls bypass schema checks; fallback calls may lack validation.|Adapters parse arguments directly; no post‑parse validation gate.|FC‑1A, FC‑4|
|4|No canonical internal transcript model for tool results. Each provider expects a different shape for `role: "tool"` messages, and the internal representation is ad‑hoc.|`agent-pipeline.ts` and `chat.ts` build tool result messages inline; no shared serializer.|FC‑5|
|5|`supportsTools` flags may be incorrect, and hardcoded maps rot quickly. No runtime capability mismatch detection or downgrade path.|`MODEL\_CATALOG` entries carry `supportsTools`. Unknown accuracy; no fallback if a flagged model fails to return `tool\_calls`.|FC‑2, FC‑10|
|6|The fallback JSON parser uses a simple regex that fails on nested JSON arguments and does not validate against tool schemas. Fallback final‑answer format is undefined. Fallback calls are not treated as degraded trust.|Current parser location to be confirmed in FC‑0 audit.|FC‑6, FC‑9|
|7|`PSEUDO\_TAG\_GUARD` and `sanitizePseudoTags` run on all model output, including native‑capable models.|`system-prompt-builder.ts` — guard appended broadly. `sanitize-pseudo-tags.ts` — runs on every assistant save.|FC‑7|
|8|The agent pipeline may still fall through to manual parsing. Planner and reviewer roles lack explicit tool access boundaries. Tool access lists are not derived from registry metadata.|`agent-pipeline.ts` — code paths to audit in FC‑0.|FC‑8|
|9|Parallel vs. serial tool execution is undefined. Two mutating calls can interact badly without a transaction model.|Pipeline dispatches calls sequentially but without explicit safety rules.|FC‑8|
|10|Message‑level `tool\_calls` and per‑call audit rows lack a defined relationship.|`conversation-store.ts` stores `tool\_calls` JSON; `tool\_calls` table stores execution lifecycle. No declared source of truth.|FC‑5|
|11|No automated regression tests specifically exercise the tool‑calling pathway or the ghost‑reply failure.|Test suite passes but coverage of `toolCalls` dispatch is unknown.|FC‑11|
|12|No shadow‑comparison logging during rollout. Deleting the old parser without comparing its inferences against native `toolCalls` risks silent regressions.|No shadow parser infrastructure exists.|FC‑12|
|13|No manual smoke‑test matrix documents per‑provider tool‑calling behaviour with real API keys.|No matrix document exists.|FC‑13|
|14|MCP-originating tools may be dynamically loaded and may not use the same static `inputSchema` pathway as built-in tools. If exposed to models, they need the same normalization, validation, provenance, and permission handling.|MCP server configuration exists in Lamprey installs; FC‑0 must confirm whether MCP tools are currently surfaced as callable tools.|FC‑0, FC‑1C, FC‑3, FC‑11, FC‑15|
|15|Architecture documentation does not describe the function‑calling pathway, transcript model, normalizer, fallback trust tiers, or MCP tool boundary.|`ARCHITECTURE/` has no function‑calling document.|FC‑15|
|16|Phase is not wrapped: no final gate run, no DEVLOG summary, no plan completion marker.|This plan is draft.|FC‑16|

\---

## 2\. Architectural Invariants — Locked

1. **Structured `toolCalls` are the primary pathway.** For any provider/model with `supportsTools: true`, the harness dispatches from `response.toolCalls` and never parses text to discover tool invocations.
2. **`inputSchema` is the single source of truth.** No new schema field is added. `getOpenAITools()` derives provider‑specific `tools` arrays via the normalizer.
3. **Provider schemas are normalized.** Lamprey maintains a canonical internal tool schema; provider‑specific down‑converters adapt it for each provider's accepted subset. Core tools that cannot be normalized cause a startup‑time failure. Non‑core tools that cannot be normalized are dropped with a logged warning.
4. **Every tool argument is validated before dispatch.** Native and fallback arguments pass through the same `validateToolArguments()` gate. Adapters return a validation status; the pipeline converts invalid calls into corrective tool‑result messages.
5. **A canonical internal transcript model exists.** Tool call requests and tool results have a single internal representation; per‑provider serializers convert it for each API. Message‑level `tool\_calls` is the source of truth for provider intent; the `tool\_calls` audit table stores execution lifecycle. They are linked by `tool\_call\_id` and never treated interchangeably.
6. **Fallback tool calls are degraded trust.** Fallback‑parsed tool calls carry a `provenance: "fallback"` tag. Mutating fallback calls are never auto‑executed without explicit user opt‑in ("legacy fallback actions") and are treated as elevated risk by the permission gate. Fallback models are instructed to return `{"action": "<tool>", "input": {...}}` or `{"action": "final", "answer": "..."}`. Plain prose with no JSON is treated as final answer only after parser failure and is marked `fallback-prose`.
7. **Native path bypasses pseudo‑XML guards.** When `supportsTools` is true, `PSEUDO\_TAG\_GUARD` is not injected. When a native response includes structured `toolCalls`, `sanitizePseudoTags` is a no‑op on persist.
8. **Capability detection is dynamic with a downgrade path.** `supportsTools` is the primary flag, but if a flagged model repeatedly returns no structured calls when a tool was likely expected (user intent or model text contains tool‑like syntax), Lamprey logs a mismatch warning and can temporarily fall back.
9. **Planner, coder, and reviewer have locked tool access, derived from registry metadata where available.** Planner: read‑only + `update\_plan`. Reviewer: read‑only inspection, proof receipts, diff tools. Coder: full mutation tools subject to plan mode and permission gates. If capability tags are absent, an explicit allowlist helper is used and tested.
10. **Mutating tool calls execute serially.** Read‑only tool calls may batch. Mutating calls execute one at a time, with a fresh workspace snapshot between calls.
11. **Ghost replies must never dispatch.** A dedicated regression test verifies that prose containing `<bash>…</bash>` with empty `toolCalls` renders as plain content and never triggers tool execution.
12. **Shadow comparison runs during rollout.** A shadow parser logs what the old text‑based parser would have inferred vs. what native `toolCalls` actually contained, without executing the old path. It is removed or retained only as a disabled diagnostic dependency based on FC‑13 smoke‑test results.
13. **Streaming tool calls are deferred.** This phase targets correctness, persistence, permissions, and replay stability with complete argument objects.
14. **Existing tool execution, permission gates, plan mode, and hooks are unchanged in behaviour.** The dispatch layer receives the same `(name, arguments)` regardless of provenance, except that fallback calls carry elevated risk.
15. **Raw model output is preserved for audit.** `content\_raw` continues to store the verbatim response even when `toolCalls` were extracted.
16. **UI scope is minimal.** No new major UI component is required in this phase. Existing permission, warning, and status surfaces are sufficient.
17. **MCP tools follow the same contract or are explicitly out of scope.** MCP-originating tools, if exposed to models as callable tools, must pass through the same provider schema normalizer, `validateToolArguments()` gate, provenance tagging, transcript model, and permission gate as built-in tools. If an MCP tool schema cannot be normalized, it is excluded from the provider tool list with a logged warning unless explicitly allowed by policy. If MCP tools are not currently exposed to model tool lists, FC‑0 must document that boundary.

\---

## 3\. Prompt Sequence

|#|Prompt|One‑liner|Files (net new / modified)|Verify|Status|
|-|-|-|-|-|-|
|FC‑0|**Provider capability and schema audit**|Read‑only audit of every provider's accepted tool schema subset, tool choice mode, argument format, tool result format, and actual adapter transport; produce an "Implementation Decisions" table.|New `PLANNING/FC\_AUDIT.md`; read‑only inspection of `electron/services/providers/registry.ts`, all adapter files, provider API docs|Audit document complete; includes per‑provider "Implementation Decisions" table; baseline checks unchanged|[x]|
|FC‑1A|**Tool schema infrastructure and validator**|Add the shared `validateToolArguments()` function, harden `ToolDescriptor` type, and upgrade `getOpenAITools()` to produce valid strict schemas.|`electron/services/tool-registry.ts`, new `electron/services/tool-schema-validator.ts`, new `electron/services/tool-schema-validator.test.ts`|Validator correctly passes/fails arguments against `inputSchema`; `getOpenAITools()` output conforms to OpenAI spec; lint; tsc node; unit tests|[x]|
|FC‑1B|**Core tools schema hardening (first batch)**|Harden `inputSchema` for the 4 most critical tools: `shell\_command`, `apply\_patch`, `read\_file`, `write\_file`.|Individual tool descriptor files for the 4 tools, tests|Each tool has strict `inputSchema` with `additionalProperties: false`, explicit `required`, and property `description`s; validator passes; lint; tsc node|[x]|
|FC‑1C|**Remaining tools schema hardening**|Harden `inputSchema` for all remaining tools; add a coverage test.|All remaining tool descriptor files, `electron/services/tool-registry.test.ts` additions|Every tool in registry has strict `inputSchema`; coverage test passes; lint; tsc node|[x]|
|FC‑2|**Audit and correct `supportsTools` flags**|Verify every `MODEL\_CATALOG` entry has correct `supportsTools` per FC‑0 decisions; wire routing logic to gate on it.|`electron/services/providers/registry.ts`, provider adapter files if routing needs adjustment, tests|Flags correct per FC‑0; routing gates on flag; lint; tsc node|[x]|
|FC‑3|**Provider schema normalizer**|Build per‑provider schema down‑converters; core tools fail fast if incompatible, non‑core tools drop with warning.|New `electron/services/providers/schema-normalizer.ts`, new tests, modifications to provider adapters|Normalizer adapts schemas per FC‑0 decisions; core‑tool incompatibility fails fast; non‑core drops with warning; lint; tsc node; unit tests|[x]|
|FC‑4|**Canonical transcript model and tool‑result serializers**|Define internal `ToolCallRequest` / `ToolResult` types; build per‑provider serializers; declare message‑level `tool\_calls` as source of truth.|New `electron/services/transcript-model.ts`, new tests, `electron/services/conversation-store.ts`, all provider adapters updated|Canonical types used throughout; per‑provider serializers correct; message‑level and audit‑table tool calls linked, not interchangeable; lint; tsc node; unit tests|[x]|
|FC‑5|**Native tool argument validation gate**|Adapters return validation status for each tool call; pipeline converts invalid calls into corrective tool‑result messages.|All provider adapter files, `electron/services/tool-schema-validator.ts`, `electron/services/agent-pipeline.ts`|Adapters attach `ToolCallValidationResult`; pipeline creates corrective messages for invalid calls; lint; tsc node; unit tests|[x]|
|FC‑6|**Brace‑balanced fallback parser with schema validation**|Replace naive regex JSON extraction with brace‑balanced extractor; add `validateToolArguments()`; tag calls `provenance: "fallback"`; define fallback final‑answer contract.|New `electron/services/fallback-tool-parser.ts`, new tests, replace old parser invocation|Handles nested JSON; rejects invalid calls; tags fallback calls; fallback models instructed to use `{"action": "final", "answer": "..."}` for final answers; lint; tsc node; unit tests|[x]|
|FC‑7|**Scope `PSEUDO\_TAG\_GUARD` and `sanitizePseudoTags` to fallback models**|For `supportsTools: true` models, do not inject guard and skip sanitizer.|`electron/services/system-prompt-builder.ts`, `electron/services/sanitize-pseudo-tags.ts`, `electron/services/conversation-store.ts` save path, `electron/services/agent-pipeline.ts`|Native‑model prompts lack guard; native responses skip sanitizer; fallback models unchanged; lint; tsc node; tsc web|[x]|
|FC‑8|**Refactor agent pipeline to use native tool‑calling pathway**|Dispatch from `response.toolCalls`; lock role tool access via registry metadata or explicit allowlists; enforce serial mutating execution; use transcript model for results.|`electron/services/agent-pipeline.ts`, `electron/ipc/chat.ts`, tests|Pipeline dispatches from `toolCalls`; role access locked; mutating calls serial; results use transcript model; lint; tsc node; integration tests|[x]|
|FC‑9|**Fallback trust degradation and permission elevation**|Treat fallback‑parsed calls as degraded trust; mutating fallback calls require explicit user opt‑in.|`electron/services/permissions-store.ts`, `electron/ipc/permissions.ts`, `electron/services/tool-dispatcher.ts`, tests|Fallback mutating calls trigger elevated approval; provenance logged in audit; lint; tsc node; unit tests|[x]|
|FC‑10|**Capability mismatch detection and downgrade path**|Detect when a `supportsTools: true` model repeatedly returns no structured calls when tool use was likely expected; log warning and temporarily fall back.|`electron/services/providers/registry.ts`, new `electron/services/providers/capability-tracker.ts`, tests|Mismatch detected only when tool‑like syntax present or user intent suggested tool use; repeated failures trigger session‑scoped downgrade; lint; tsc node|[x]|
|FC‑11|**Regression test suite**|Comprehensive tests for schema, normalizer, validator, parser, serializers, pipeline dispatch, guard bypass, ghost‑reply fixture, product‑guidance provenance, MCP tool boundary, fallback trust, and capability downgrade.|New and modified test files|All new tests pass; ghost‑reply fixture verifies `<bash>` prose never dispatches; product‑guidance fixture blocks unverified claims; existing suite unchanged; lint; tsc node|[x]|
|FC‑12|**Shadow‑comparison logger**|Log what the old text parser would have inferred vs. native `toolCalls`, without executing the old path.|New `electron/services/shadow-parser.ts`, integration into pipeline, tests|Shadow log emitted per turn; differences surfaced; no dispatch from shadow; can be disabled via config; lint; tsc node|[x]|
|FC‑13|**Manual smoke‑test matrix with shadow enabled**|Create a test matrix document and execute each row against real provider endpoints with shadow logging active.|New `docs/function-calling-matrix.md`|Matrix rows cover all providers; shadow logs recorded; results documented; `user‑verification‑needed` for missing keys; document committed|[x]|
|FC‑14|**Remove or disable shadow logger and old parser**|If FC‑13 matrix shows no concerning mismatches, remove shadow logger and old parser. Otherwise disable shadow by default, retain old parser as disabled diagnostic dependency, and document deferred cleanup.|`electron/services/shadow-parser.ts` (remove or disable), `electron/services/agent-pipeline.ts` (cleanup), tests|Conditional cleanup per FC‑13 results; pipeline execution has exactly two active pathways in either case; lint; tsc node|[x]|
|FC‑15|**Architecture documentation**|Write `ARCHITECTURE/FUNCTION\_CALLING.md` covering the full pathway, normalizer, transcript model, fallback trust tiers, and how to add a tool or provider.|New `ARCHITECTURE/FUNCTION\_CALLING.md`, possible `README.md` update|Document is accurate, references real file paths, sufficient for a new maintainer; lint/tsc unaffected|[x]|
|FC‑16|**Phase wrap**|Run full gate, mark all prompts complete, write DEVLOG summary, and close the phase.|`DEVLOG.md`, this plan file|Full gate: lint, tsc node, tsc web, npm test, npm run build, matrix reviewed; all prompts `\[x]`; DEVLOG phase summary written|[x]|

\---

## 4\. Prompt Details

### FC‑0 — Provider capability and schema audit

**Goal.** Produce a read‑only audit document that captures exactly what each provider accepts and returns for function calling, determine the actual Google adapter transport, and produce a binding "Implementation Decisions" table that all later prompts must follow.

**Work.**

* Read every provider adapter file and the provider registry.
* Research each provider's function‑calling documentation.
* **Determine the actual Google adapter transport:** Inspect `electron/services/providers/` to confirm whether Google uses the Gemini native SDK, Google's OpenAI‑compatible endpoint, or another wrapper. The rest of the plan must use this discovered name.
* **Audit MCP tool exposure:** Determine whether MCP-originating tools are currently exposed to model tool lists, how they are loaded, whether they provide JSON Schema `inputSchema` equivalents, whether they are static or dynamic, and whether they already pass through the same permission gate as built-in tools. If they are not exposed to model tool lists, document MCP as out of scope for this phase with the exact boundary.
* Write `PLANNING/FC\_AUDIT.md` with sections per provider:

  * **Accepted schema subset:** `additionalProperties`, `enum`, nested objects, max depth, `$ref`/`oneOf`/`anyOf`.
  * **Tool choice mode:** `auto`, `required`, `none`, or provider‑specific variants.
  * **Argument format:** String that must be `JSON.parse`d, or already‑parsed object? Can arguments be empty string?
  * **Tool result format:** Required shape for `role: "tool"` messages; is `tool\_call\_id` required?
  * **Known quirks:** Documented edge cases.
* **Add an "Implementation Decisions" table** that all later prompts must follow:

|Provider|Endpoint type|Normalizer strategy|Arg parsing|Result serializer|Fallback eligible|Unsupported keywords|
|-|-|-|-|-|-|-|
|DeepSeek|OpenAI‑compatible|Pass‑through with minor adjustments|`JSON.parse` string|OpenAI format|No (native)|None known|
|DashScope|OpenAI‑compatible|Enum depth limits|`JSON.parse` string|OpenAI format|No (native)|None known|
|Google|*Discovered in audit*|*Per audit*|*Per audit*|*Per audit*|No (native)|*Per audit*|
|OpenRouter|Pass‑through|Pass‑through for native; prompt‑inject for fallback|`JSON.parse` string or object|OpenAI format|Yes (non‑tool models)|None known|

* Make no code changes.

**Acceptance.**

* `PLANNING/FC\_AUDIT.md` exists with per‑provider details and the Implementation Decisions table.
* The actual Google adapter transport is confirmed and documented.
* MCP tool exposure is confirmed and documented, including whether MCP tools are in scope or explicitly out of scope for this phase.
* Baseline checks still pass (no code was changed).

\---

### FC‑1A — Tool schema infrastructure and validator

**Goal.** Build the shared `validateToolArguments()` function that every tool call path must pass through, and ensure `getOpenAITools()` produces strict, valid schemas.

**Work.**

* Create `electron/services/tool-schema-validator.ts`:

  * `validateToolArguments(toolName: string, args: unknown, schema: object): { valid: true, parsed: Record<string, unknown> } | { valid: false, errors: string\[] }`
  * Handle: already‑parsed objects, JSON strings needing parse, empty input, missing input.
  * Use a lightweight hand‑rolled JSON Schema validator for the subset used (type, properties, required, additionalProperties, enum, items for arrays).
* Harden `getOpenAITools()` in `electron/services/tool-registry.ts`:

  * Output shape: `{ type: "function", function: { name, description, parameters } }`.
  * `parameters` is the `inputSchema` object verbatim.
  * Dev‑mode assertion that output conforms to expected shape.
* Write unit tests for `validateToolArguments`: valid flat args, valid nested args, missing required, wrong type, extra property, empty input, JSON string input, invalid JSON.

**Acceptance.**

* `validateToolArguments` correctly passes and fails arguments per schema.
* `getOpenAITools()` produces valid OpenAI‑format tool arrays.
* All unit tests pass.
* Lint and tsc node pass.

\---

### FC‑1B — Core tools schema hardening (first batch)

**Goal.** Harden `inputSchema` for the 4 most critical tools to establish the pattern.

**Work.**

* For `shell\_command`, `apply\_patch`, `read\_file`, `write\_file`:

  * Harden `inputSchema`: `type: "object"`, every property has `description`, `required` array lists mandatory properties, `additionalProperties: false`, nested objects/arrays fully typed.
  * Write unit tests validating example arguments (valid and invalid) against each schema.

**Acceptance.**

* All 4 tools have strict `inputSchema`.
* `validateToolArguments` passes valid args and rejects invalid args for each.
* Lint and tsc node pass.

\---

### FC‑1C — Remaining tools schema hardening

**Goal.** Harden `inputSchema` for every remaining tool and add a coverage test.

**Work.**

* For every tool not covered in FC‑1B (browser tools, search tools, workspace context, verify workspace, frontend QA, git tools, multi‑agent run, etc.):

  * Harden `inputSchema` to the FC‑1B standard.
* If FC‑0 confirms MCP-originating tools are exposed through the same callable tool registry, include representative MCP tool schemas in the coverage path. If MCP tools are out of scope, assert that they are not included in `getOpenAITools()` / normalized provider tool lists and document the boundary.
* Write a coverage test:

  * Enumerate all tools in the registry.
  * Assert each has non‑empty `inputSchema` with `type: "object"` and `additionalProperties: false`.
  * Assert `validateToolArguments` does not throw on any tool's schema.
* Document any tool that resists a strict schema as a known gap.

**Acceptance.**

* Every built-in callable tool has a hardened `inputSchema`.
* MCP-originating tools are either included in the same schema validation pathway or explicitly proven/documented out of scope for this phase.
* Coverage test passes.
* Lint and tsc node pass.

\---

### FC‑2 — Audit and correct `supportsTools` flags

**Goal.** Ensure every model in `MODEL\_CATALOG` has the correct `supportsTools` value per the FC‑0 Implementation Decisions table.

**Work.**

* Review every entry in `MODEL\_CATALOG` against FC‑0 decisions.
* Audit routing logic in `chatStream`, `chatOnce`, and agent pipeline:

  * `supportsTools: true` → send normalized `tools` array, expect `tool\_calls`.
  * `supportsTools: false` → use fallback prompt and parser (FC‑6).
* If routing does not yet gate on the flag, add the gating now.

**Acceptance.**

* All model entries have accurate `supportsTools` values per FC‑0.
* Routing logic gates on the flag.
* Lint and tsc node pass.

\---

### FC‑3 — Provider schema normalizer

**Goal.** Build per‑provider schema down‑converters. Core tools fail fast if incompatible; non‑core tools drop with warning.

**Work.**

* Create `electron/services/providers/schema-normalizer.ts`:

  * `normalizeToolsForProvider(tools: ToolDescriptor\[], provider: ProviderId): ProviderTools\[]`
  * Per‑provider transformations per FC‑0 Implementation Decisions.
  * **Core tools** (defined as: `workspace\_context`, `read\_file`, `list\_files`, `shell\_command`, `apply\_patch`, `verify\_workspace`) that cannot be normalized cause a startup‑time failure with a clear error message naming the tool and provider.
  * **Non‑core tools** that cannot be normalized are dropped with a logged warning naming the tool, provider, and reason.
* Update provider adapters to call `normalizeToolsForProvider` instead of `getOpenAITools()` directly.
* If MCP-originating tools are in scope, route them through `normalizeToolsForProvider` after adapting their MCP schema representation into the canonical internal tool schema. MCP tools that cannot be normalized are excluded with a logged warning unless policy explicitly allows them.
* Write unit tests: per‑provider normalized schemas match expected shapes; core‑tool incompatibility throws; non‑core tool drops gracefully.

**Acceptance.**

* Each provider receives a schema adapted to its accepted subset.
* Core tool incompatibility fails fast.
* Non‑core tool drops are logged.
* MCP-originating tools, if in scope, are normalized or excluded with clear warnings.
* Unit tests pass.
* Lint and tsc node pass.

\---

### FC‑4 — Canonical transcript model and tool‑result serializers

**Goal.** Define the internal types, build per‑provider serializers, and declare the relationship between message‑level `tool\_calls` and the audit table.

**Work.**

* Create `electron/services/transcript-model.ts`:

  * `ToolCallRequest`: `{ id: string, name: string, arguments: Record<string, unknown>, provenance: "native" | "fallback" }`
  * `ToolResult`: `{ toolCallId: string, name: string, content: string, isError: boolean }`
  * `serializeToolResult(result: ToolResult, provider: ProviderId): ProviderToolMessage`
  * `serializeAssistantToolCalls(requests: ToolCallRequest\[], provider: ProviderId): ProviderAssistantMessage`
* Update `electron/services/conversation-store.ts`:

  * Message‑level `tool\_calls` (JSON column) stores `ToolCallRequest\[]` — source of truth for provider intent.
  * The `tool\_calls` audit table stores execution lifecycle. Link by `tool\_call\_id`.
  * Add a comment clarifying they are never treated interchangeably.
* Update all provider adapters to use the serializers when building tool messages.
* Write unit tests for serializer output shape per provider.

**Acceptance.**

* Canonical types used throughout the pipeline.
* Each provider's tool messages are correctly formatted per FC‑0 decisions.
* Message‑level and audit‑table tool calls are linked but distinct.
* Lint, tsc node, unit tests pass.



\---

### FC‑5 — Native tool argument validation gate

**Goal.** Adapters return validation status for each tool call. The pipeline converts invalid calls into corrective tool‑result messages using the transcript model.

**Work.**

* In `electron/services/tool-schema-validator.ts` (or a new shared types file), add:

```ts
  type ToolCallValidationResult =
    | { status: "valid"; call: ToolCallRequest }
    | { status: "invalid"; attemptedCall: { id: string; name: string; rawArguments: unknown }; errors: string\[] };
  ```

* In each provider adapter:

  * After extracting `toolCalls` from the response, for each call:

    * Look up the tool's `inputSchema`.
    * Call `validateToolArguments(toolName, rawArgs, inputSchema)`.
    * Return `ToolCallValidationResult` (valid or invalid) — do NOT append synthetic tool messages in the adapter.
* In the agent pipeline (`electron/services/agent-pipeline.ts`):

  * For each `ToolCallValidationResult`:

    * If `valid`, dispatch the `ToolCallRequest` as normal.
    * If `invalid`, use the canonical transcript serializer from FC‑4 to build a `role: "tool"` message with the original `tool\_call\_id` and structured error content: `{ "error": "argument\_validation\_failed", "details": \[...errors] }`. Append this to the conversation so the LLM can correct its arguments on the next turn.
* Write unit tests per adapter: mock a response with invalid arguments, verify the validation result is `invalid` with correct errors.

**Acceptance.**

* Adapters return validation status; they do not mutate the transcript.
* Invalid arguments produce corrective tool‑result messages via the pipeline.
* Valid arguments dispatch as normal.
* All adapter tests pass.
* Lint and tsc node pass.

\---

### FC‑6 — Brace‑balanced fallback parser with schema validation

**Goal.** Replace naive regex JSON extraction with a brace‑balanced extractor, add schema validation, tag calls `provenance: "fallback"`, and define the fallback final‑answer contract.

**Work.**

* Locate the existing fallback parser (confirmed in FC‑0 audit).
* Create `electron/services/fallback-tool-parser.ts`:

  * `extractBalancedJson(text: string): string | null` — linear‑scan brace‑balanced extractor. No regex or recursive backtracking.
  * `parseFallbackToolCalls(text: string, tools: ToolDescriptor\[]): ToolCallRequest\[] | null`:

    * Extract candidate JSON.
    * Parse it.
    * Match `action` or `name` field to a known tool.
    * If the action is `"final"`, return `null` (this is a final answer, not a tool call).
    * Call `validateToolArguments()` against the tool's `inputSchema`.
    * If valid, return a single `ToolCallRequest` with `provenance: "fallback"` and a generated `id`.
    * If invalid or no match, return `null`.
* **Fallback instruction contract:** Fallback models must be instructed (via the fallback prompt) to return either:

  * `{"action": "<tool\_name>", "input": {...}}` for tool calls.
  * `{"action": "final", "answer": "..."}` for final answers.
  * Plain prose with no JSON is treated as a final answer only after parser failure and is tagged `fallback-prose` in the transcript metadata.
* Write unit tests: flat JSON, nested JSON with multi‑line strings, multiple JSON blocks, hallucinated tool name, correct name but invalid arguments, `"action": "final"` returning null, no JSON returning null, unbalanced braces returning null.

**Acceptance.**

* Parser handles nested arguments correctly.
* Schema validation rejects invalid calls.
* `"action": "final"` is not dispatched as a tool.
* Fallback provenance tag is set.
* All unit tests pass.
* Lint and tsc node pass.

\---

### FC‑7 — Scope `PSEUDO\_TAG\_GUARD` and `sanitizePseudoTags` to fallback models

**Goal.** For models with `supportsTools: true`, bypass the pseudo‑XML guard injection and content sanitizer.

**Work.**

* In `electron/services/system-prompt-builder.ts`:

  * Only append `PSEUDO\_TAG\_GUARD` when the active model has `supportsTools: false`.
* In the sanitizer save path:

  * If the message has `toolCalls` populated (native pathway), skip sanitization.
  * `content\_raw` remains `NULL` (no rewriting occurred).
* In the agent pipeline, ensure no post‑hoc guard application on native‑model responses.
* Write tests: native system prompt lacks guard; fallback prompt includes it; native message saved without sanitization; fallback message sanitized.

**Acceptance.**

* Native‑model conversations have no guard and no sanitizer pass.
* Fallback‑model conversations are unchanged.
* Existing sanitizer tests still pass.
* Lint, tsc node, tsc web pass.

\---

### FC‑8 — Refactor agent pipeline to use native tool‑calling pathway

**Goal.** Dispatch from `response.toolCalls` as the primary pathway. Lock role tool access using registry metadata where available, with explicit allowlist fallback. Enforce serial mutating execution. Use the transcript model for tool results.

**Work.**

* For native‑capable models (`supportsTools: true`):

  * Retrieve active tools, filter by role:

    * **Planner:** tools that are read‑only (`mutatesWorkspace: false` or `capabilities.includes("read")`) + `update\_plan`.
    * **Reviewer:** read‑only tools + proof receipt tools + diff tools (`capabilities.includes("read")` or `capabilities.includes("verify")`).
    * **Coder:** all tools, gated by plan mode and permissions.
    * If registry metadata (`mutatesWorkspace`, `readOnly`, capability tags) is absent, use an explicit allowlist helper with a tested list of tool names per role.
  * Send filtered tools via the normalizer.
  * On response: if `toolCalls` is non‑empty, process each `ToolCallValidationResult`.
  * Mutating calls execute serially with a fresh workspace snapshot between each.
  * Read‑only calls may batch.
  * Use `serializeToolResult()` from the transcript model for all tool result messages.
  * If `toolCalls` is empty/null, treat `content` as final answer. Never scan content for tool invocations.
* For fallback models (`supportsTools: false`):

  * Run `parseFallbackToolCalls()` on content.
  * If a valid fallback call: dispatch (subject to FC‑9 trust rules).
  * If null: treat content as final answer.
* Write integration tests: native dispatch from `toolCalls`, multiple calls, role access enforcement, serial mutating execution, tool results use transcript model.

**Acceptance.**

* Pipeline uses `toolCalls` for native models, never text parsing.
* Role tool access is enforced via metadata or allowlist.
* Mutating calls execute serially.
* Transcript model used for all tool messages.
* Integration tests pass.
* Lint and tsc node pass.

\---

### FC‑9 — Fallback trust degradation and permission elevation

**Goal.** Fallback‑parsed tool calls are treated as degraded trust. Mutating fallback calls require explicit user opt‑in.

**Work.**

* The `provenance` field is already on `ToolCallRequest` from FC‑5.
* In the permission gate:

  * If `provenance === "fallback"` and the tool is mutating (has risk tags indicating writes/destruction):

    * "Always allow" policies do not apply.
    * User must explicitly approve each fallback mutating call.
    * A setting `legacyFallbackActions: boolean` (default `false`) can globally disable fallback mutating tools.
  * If `provenance === "native"`, existing permission behaviour is unchanged.
* Log `provenance` in the audit trail.
* Write tests: fallback mutating call requires explicit approval; fallback read‑only follows normal rules; native calls unaffected.

**Acceptance.**

* Fallback mutating tools cannot auto‑execute.
* User must explicitly opt in.
* Audit trail records provenance.
* Lint and tsc node pass.

\---

### FC‑10 — Capability mismatch detection and downgrade path

**Goal.** Detect when a `supportsTools: true` model repeatedly returns no structured calls when tool use was likely expected, and temporarily fall back.

**Work.**

* Create `electron/services/providers/capability-tracker.ts`:

  * Track per‑model, per‑conversation: consecutive turns where `tools` were sent AND `toolCalls` was empty AND (the user's intent likely required a tool OR the model's text contains tool‑like syntax such as `<bash>`, `<tool>`, `{"action":`).
  * A turn where the model simply answers without tool‑like syntax does NOT count as a mismatch.
  * After N consecutive mismatches (default 3), log a `capability\_mismatch` warning event.
  * Surface a non‑blocking notice using the existing notification/status infrastructure (no new major UI component).
  * Temporarily treat the model as `supportsTools: false` for the remainder of the conversation.
* Do not permanently mutate the model catalog.
* Write unit tests: mismatch accumulation, non‑tool answers not counted, downgrade activation.

**Acceptance.**

* Only tool‑like responses trigger mismatch counting.
* Repeated mismatches trigger session‑scoped downgrade and logged warning.
* No new major UI component required.
* Lint and tsc node pass.

\---

### FC‑11 — Regression test suite

**Goal.** Comprehensive tests for schema, normalizer, validator, parser, serializers, pipeline dispatch, guard bypass, ghost-reply fixture, product-guidance provenance, MCP tool boundary, fallback trust, and capability downgrade.

**Work.**

* Write or expand tests for:

  * `getOpenAITools()` + normalizer: all tools, per‑provider shapes.
  * `validateToolArguments()`: full coverage.
  * Fallback parser: all FC‑6 cases including `"action": "final"` returning null.
  * Transcript serializers: per‑provider output shapes.
  * Pipeline dispatch: mocked LLM returning `toolCalls`, single/multiple calls, serial mutating, role access.
  * Guard bypass: native prompts lack guard; fallback prompts include it.
  * **Ghost‑reply regression test (dedicated fixture):**

    * Mock a native‑model response with empty `toolCalls` and content containing `Let me run that for you:\\n<bash>npm test</bash>`.
    * Assert: no tool is dispatched.
    * Assert: content renders as plain assistant text (never executed as a tool).
  * **Fallback ghost‑reply boundary test:**

    * For a native‑capable model, pseudo‑XML prose with empty `toolCalls` is never sent to the fallback parser.
    * For a fallback model, pseudo‑XML is not accepted as a valid tool call unless it satisfies the new brace‑balanced JSON fallback contract.
  * **MCP tool boundary test:**

    * If MCP tools are in scope, representative MCP tool schemas normalize and validate before dispatch.
    * If MCP tools are out of scope, assert they are excluded from provider tool lists and documented as such.
  * Capability downgrade: repeated mismatches, fallback activation.
  * Fallback trust: mutating fallback call requires explicit approval.
* Ensure existing test suite passes; update mocks affected by earlier prompts.

**Product‑guidance provenance fixture**

*Fixture ID:* `product-guidance-provenance`

*Setup:*

* The add‑project `+` UI control is known to be broken (no working project creation flow).
* The harness has not observed a project discovery mechanism (no code citation, no runtime test, no UI observation of folder appearance).
* The Coder has not created a test folder, has not restarted or refreshed the harness, and has not inspected workspace‑registry or project‑indexer code.

*User prompt:*

> "Where do I start a new project in this harness?"

*Coder behaviour (simulated):*

* Coder returns a draft answer claiming: *"The harness discovers projects by scanning the workspace directory. Create a folder under the workspace root and it will be detected."*
* The run log contains `SKIPPED: No actual project was created` or equivalent.
* No code citation, runtime observation, or UI screenshot is attached to the claim.

*Reviewer response (simulated):*

* Reviewer returns `VERDICT: CHANGES` with primary failure `unverified\_product\_behavior\_claim`.
* Reviewer notes: claim is presented as verified fact but is supported only by inference; the add‑project UI is known broken; no end‑to‑end test of folder creation and discovery was performed; the term "project" is undefined.

*Expected harness behaviour:*

* The `CHANGES` verdict blocks the final answer from shipping to the user.
* The Coder must either:

  * Revise the answer to state uncertainty explicitly (e.g., *"I cannot currently verify the project creation pathway; the add‑project button is broken and I have not confirmed whether manual folder creation results in an observable project"*), OR
  * Perform the missing verification (create a test folder, restart/refresh, observe whether it appears in any UI, listing, or command output) and attach a tool‑result receipt to the final answer.
* If the Coder revises the answer to state uncertainty, the answer must be marked `provenance: unverified` and must not present the folder‑creation instruction as confirmed behaviour.

*Assertions:*

* **Assert 1:** An answer containing an unverified product‑behaviour claim (claim of directory scanning without evidence) is not delivered to the user as a final response while the Reviewer verdict is `CHANGES`.
* **Assert 2:** The final answer that does ship either (a) cites a specific code path or runtime observation backing the claim, or (b) is explicitly marked as uncertain and does not instruct the user to rely on unverified behaviour.
* **Assert 3:** The transcript records the provenance of the final claim (`observed‑code`, `runtime‑tested`, `unverified`, etc.).
* **Assert 4:** The `SKIPPED` verification step in the run log is surfaced in the evidence packet available to the Reviewer, not silently omitted.
* **Assert 5:** A Reviewer verdict of `CHANGES` with `BLOCK\_FINAL: true` prevents final answer delivery unless a correction pass produces either verified evidence or an explicitly uncertain answer.

**Acceptance.**

* All new tests pass.
* Ghost‑reply fixture proves `<bash>` prose never dispatches.
* Product-guidance provenance fixture proves unverified product-behavior claims cannot ship after a blocking `CHANGES` review.
* MCP tool boundary fixture proves MCP tools are either normalized/validated or explicitly excluded from provider tool lists.
* Existing suite passes with no regressions.
* Lint and tsc node pass.

\---

### FC‑12 — Shadow‑comparison logger

**Goal.** During rollout, log what the old text parser would have inferred vs. native `toolCalls`, without executing the old path.

**Work.**

* Create `electron/services/shadow-parser.ts`:

  * `runShadowComparison(content: string, nativeToolCalls: ToolCallRequest\[] | null, tools: ToolDescriptor\[]): ShadowReport`
  * Runs the old text parser (or a lightweight approximation) on `content`.
  * Compares against `nativeToolCalls`.
  * Returns `ShadowReport` with `native`, `legacyInferred`, and `difference` (`"none"` | `"nativeOnly"` | `"legacyOnly"` | `"mismatch"`).
  * **Never dispatches** tool calls.
* Integrate into the agent pipeline: after each native turn, call `runShadowComparison` and log the report at debug level.
* Add a config flag `shadowParserEnabled` (default `true` during this phase).
* Write unit tests for shadow comparison logic.

**Acceptance.**

* Shadow reports logged per native turn.
* Differences surfaced in debug logs.
* No dispatch from shadow path.
* Config flag can disable.
* Lint and tsc node pass.

\---

### FC‑13 — Manual smoke‑test matrix with shadow enabled

**Goal.** Exercise the full pathway against real provider endpoints with shadow logging active, documenting results and shadow comparisons.

**Work.**

* Create `docs/function-calling-matrix.md` with a table:

|Provider|Model|`supportsTools`|Prompt|Expected tool|Result|Shadow comparison|Notes|
|-|-|-|-|-|-|-|-|
|DeepSeek|V4 Pro|true|"run git status"|`shell\_command`||||
|DeepSeek|V4 Flash|true|"run git status"|`shell\_command`||||
|DashScope|Qwen3‑Plus|true|"search for lamprey"|`search\_web`||||
|Google|*per FC‑0*|true|"apply patch"|`apply\_patch`||||
|OpenRouter|Llama 3.1 70B|true|"run git status"|`shell\_command`||||
|OpenRouter|Mistral 7B|false|"run git status"|`shell\_command` (fallback)||||

* For each row, attempt the prompt in a dev build with shadow logging enabled and the relevant API key configured.
* Record the result, shadow comparison output, and any anomalies.
* If a key is unavailable, record `user‑verification‑needed`; do not block the phase.
* Verify fallback provenance tagging and trust elevation for fallback rows.

**Acceptance.**

* Matrix document exists with all rows filled or marked `user‑verification‑needed`.
* At least one native provider row verified passing.
* Shadow comparisons recorded for all executed rows.
* Document committed.

\---

### FC‑14 — Remove or disable shadow logger and old parser

**Goal.** Based on FC‑13 results: if no concerning mismatches, remove the shadow logger and old parser. Otherwise disable shadow by default, retain the old parser as a disabled diagnostic dependency only, and document deferred cleanup. In both cases, the active execution pathways are exactly two: native and fallback‑validated.

**Work.**

* Review the FC‑13 matrix:

  * **If shadow comparisons are clean** (no `"legacyOnly"` or `"mismatch"` differences for native models):

    * Remove `electron/services/shadow-parser.ts`.
    * Remove the shadow comparison invocation from the pipeline.
    * Remove the `shadowParserEnabled` config flag.
    * Remove the old manual text parser entirely.
  * **If concerning mismatches exist:**

    * Set `shadowParserEnabled` default to `false`.
    * Leave the shadow logger in place (disabled, never executes during normal operation).
    * Retain the old parser only as a disabled diagnostic/shadow dependency — it must never be an active execution pathway. The pipeline's only active tool‑call pathways remain native and fallback‑validated.
    * Document the mismatches in `docs/function-calling-matrix.md` as deferred cleanup with `TODO(shadow-cleanup):` comments in the shadow logger file referencing the matrix.
* Update any tests that referenced the shadow parser to reflect its disposition.

**Acceptance.**

* If FC‑13 shadow comparisons are clean:

  * Shadow logger is removed.
  * Old parser is removed.
  * Pipeline has exactly two active pathways: native and fallback‑validated.
* If FC‑13 reveals concerning mismatches:

  * Shadow logger remains but is disabled by default.
  * Old parser remains only as a disabled diagnostic/shadow dependency, never as an execution path.
  * Pipeline execution still has exactly two active pathways: native and fallback‑validated.
  * Deferred cleanup is documented with `TODO(shadow-cleanup)` and matrix references.
* All tests pass.
* Lint and tsc node pass.

\---

### FC‑15 — Architecture documentation

**Goal.** Document the complete function‑calling architecture.

**Work.**

* Create `ARCHITECTURE/FUNCTION\_CALLING.md` covering:

  * **Overview:** native vs. fallback pathways, the canonical transcript model.
  * **Tool descriptors and `inputSchema`:** how to define a tool with a strict schema.
  * **`getOpenAITools()` and the normalizer:** how schemas are adapted per provider; core‑tool fail‑fast behaviour.
  * **`validateToolArguments()`:** the shared argument validation gate.
  * **Provider pathways:** `supportsTools` gating; capability mismatch detection.
  * **MCP tool boundary:** whether MCP-originating tools are in scope, how they are loaded, normalized, validated, permissioned, or explicitly excluded from provider tool lists.
  * **Transcript model:** internal types, per‑provider serializers, message‑level vs. audit‑table `tool\_calls`.
  * **Fallback parser:** brace‑balanced extraction, schema validation, provenance tagging, final‑answer contract.
  * **Fallback trust degradation:** elevated approval for mutating fallback calls.
  * **Role‑based tool access:** planner/reviewer/coder tool filtering via registry metadata or allowlists.
  * **Serial mutating execution rule.**
  * **Guard and sanitizer bypass.**
  * **Ghost‑reply protection.**
  * **Shadow logger:** what it was, when it ran, its disposition (removed or deferred).
  * **Adding a new tool:** step‑by‑step.
  * **Adding a new provider:** what needs normalization.
  * **Adding or exposing MCP tools:** required schema, normalization, validation, and permission steps, or the documented out-of-scope boundary.
* Reference real file paths and function names throughout.
* Optionally update `README.md`.

**Acceptance.**

* `ARCHITECTURE/FUNCTION\_CALLING.md` exists and is accurate.
* A new maintainer can understand the full pathway from the document.

\---

### FC‑16 — Phase wrap

**Goal.** Run the full verification gate, mark all prompts complete, write the DEVLOG summary, and close the phase.

**Work.**

* Run the full gate:

  * `npm run lint`
  * `npx tsc --noEmit -p tsconfig.node.json`
  * `npx tsc --noEmit -p tsconfig.web.json`
  * `npm test`
  * `npm run build`
* If any check fails, fix and re‑run.
* Mark all prompts `\[x]` in this plan.
* Write the phase‑completion DEVLOG entry summarising:

  * All prompt commits.
  * Final gate results.
  * Any deferred items, `user‑verification‑needed` rows, or shadow‑cleanup TODOs.
  * Residual risks.
* Commit this plan with all `\[x]` marks.

**Acceptance.**

* Full gate passes.
* All 17 prompts `\[x]`.
* DEVLOG has a phase‑completion entry.
* Plan is archived as complete.

\---

## 5\. Phase Completion Criteria

* All 17 prompts (FC‑0 through FC‑16) marked `\[x]`.
* One commit per prompt.
* `npm run lint` passes.
* `npx tsc --noEmit -p tsconfig.node.json` passes.
* `npx tsc --noEmit -p tsconfig.web.json` passes.
* `npm test` passes.
* `npm run build` passes.
* Native function calling works for DeepSeek, Google, and DashScope without pseudo‑XML parsing.
* `validateToolArguments()` gates every tool call before dispatch.
* Provider schema normalizer adapts schemas per FC‑0 decisions; core tools fail fast if incompatible.
* MCP-originating tools, if exposed to model tool lists, pass through the same normalization, validation, provenance, transcript, and permission pathway; otherwise MCP is explicitly documented as out of scope.
* Canonical transcript model used for all tool messages; message‑level and audit‑table `tool\_calls` linked but distinct.
* Fallback parser handles nested JSON, validates against schemas, tags calls `fallback`, and respects the `"action": "final"` contract.
* Fallback mutating calls require elevated user approval.
* `PSEUDO\_TAG\_GUARD` and `sanitizePseudoTags` bypassed for native‑capable models.
* Agent pipeline dispatches from `response.toolCalls`; role tool access locked via metadata or allowlists; mutating calls execute serially.
* Capability mismatch detection correctly distinguishes tool‑like responses from normal answers.
* Ghost‑reply regression test passes.
* Shadow logger has run during smoke testing; its disposition (removed or deferred) is documented.
* Old manual parser is removed, or retained only as a disabled shadow/diagnostic dependency if FC‑13 documented concerning mismatches. It must not remain an active execution pathway.
* Manual smoke‑test matrix committed.
* `ARCHITECTURE/FUNCTION\_CALLING.md` exists and is accurate.
* DEVLOG has every prompt entry plus a phase‑completion summary.

\---

## 6\. Non‑Goals

* No new tools or changes to tool execution behaviour.
* No new model providers.
* No changes to the permission gate's core logic except provenance‑based elevation for fallback calls.
* No changes to plan mode, hooks, or skill systems beyond guard bypass scoping.
* No hosted service, telemetry, or cloud component.
* No automatic installation of git hooks or policies.
* **No streaming tool calls** — deferred to a separate future phase.
* **No new major UI component.** Existing permission, warning, and status surfaces are sufficient.
* No new schema field — `inputSchema` is hardened, not replaced.

\---

## 7\. Risk / Unknown Register

1. **Provider schema incompatibilities deeper than FC‑0 reveals.** Mitigation: FC‑3 isolates normalization; new quirks are fixed there without pipeline changes. FC‑13 smoke tests catch real‑world gaps.
2. **Incomplete `inputSchema` coverage.** FC‑1B/FC‑1C document gaps explicitly; validator is tolerant when the schema permits it.
3. **`supportsTools` misclassification.** FC‑2 sets flags per FC‑0; FC‑10 detects mismatches at runtime; FC‑13 matrix tests real behaviour.
4. **Brace‑balanced parser performance.** Linear‑scan O(n), no backtracking. If needed, add byte cap before extraction.
5. **Sanitizer bypass scope.** FC‑7 checks both `supportsTools` and whether `toolCalls` is populated.
6. **Google endpoint divergence.** FC‑0 confirms actual transport; FC‑3 normalizer and FC‑13 matrix surface issues.
7. **Missing API keys for smoke testing.** FC‑13 allows `user‑verification‑needed`; phase does not require all keys.
8. **Shadow comparison reveals concerning mismatches.** FC‑14 defers cleanup and documents mismatches; old parser is NOT removed in that case. The shadow logger remains disabled by default for later investigation. The pipeline's active execution pathways remain exactly two: native and fallback‑validated.
9. **MCP schema variance.** MCP-originating tools may use dynamic schemas or JSON Schema features outside Lamprey's supported subset. FC‑0 must determine whether MCP tools are in scope; FC‑3 and FC‑11 either normalize/validate representative MCP tools or prove they are excluded from provider tool lists.
10. **Test mock drift.** FC‑11 explicitly verifies existing suite passes after all changes.
11. **Fallback parser may be overly strict.** Error messages returned to the LLM include details, giving the model a chance to correct arguments.
12. **Capability mismatch false positives.** FC‑10 requires both "tools were sent" AND "model text contains tool‑like syntax" before counting a mismatch. Normal answers do not trigger downgrade.

\---

**End of Plan.**

