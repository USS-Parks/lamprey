# FC-0 — Provider Capability and Schema Audit

> Read-only audit of every provider's accepted tool schema subset, tool choice mode, argument format, tool result format, and actual adapter transport. Produces the binding "Implementation Decisions" table all later prompts must follow.

**Audit date:** 2026-06-08  
**Codebase state:** v0.9.0 (main, 8755bc2)  
**Auditor:** FC-0 read-only pass — no code changes

---

## 1. Provider Architecture — Confirmed

Lamprey does NOT use per-provider adapter files. All four providers are routed through a single unified transport: the OpenAI Node.js SDK (`openai` npm package), with each provider differentiated only by `baseURL`. There is exactly one `chatStream()` and one `chatOnce()` in `electron/services/providers/registry.ts`.

| Provider | baseURL | Endpoint type | Transport |
|----------|---------|---------------|-----------|
| **DeepSeek** | `https://api.deepseek.com/v1` | Native OpenAI-compatible | OpenAI SDK |
| **Google** | `https://generativelanguage.googleapis.com/v1beta/openai/` | OpenAI-compatible (beta) | OpenAI SDK |
| **DashScope** | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | Compatibility mode | OpenAI SDK |
| **OpenRouter** | `https://openrouter.ai/api/v1` | Pass-through | OpenAI SDK |

### Google adapter transport — CONFIRMED

Google is accessed through the `v1beta/openai/` OpenAI-compatible endpoint, **not** the native Gemini SDK (`@google/generative-ai`). This endpoint accepts standard OpenAI-format requests including `tools` arrays. The `v1beta` qualifier means the endpoint is subject to change; Lamprey's baseURL must be revisited when Google promotes this endpoint to stable.

---

## 2. Per-Provider Function Calling Capabilities

### 2.1 DeepSeek

**Documentation:** https://platform.deepseek.com/api-docs/ (function calling section)

**Accepted schema subset (observed from OpenAI compatibility + DeepSeek docs):**
- `type: "object"`, `properties`, `required`, `description` — fully supported
- `additionalProperties` — supported (DeepSeek docs confirm)
- `enum` — supported on string properties
- Nested objects — supported (depth limit not documented; assume ≤3)
- `$ref`, `oneOf`, `anyOf` — NOT documented as supported; avoid
- Array `items` — supported for top-level arrays, unclear for nested arrays

**Tool choice mode:** `auto` (default), `none`, `required` (via `tool_choice` parameter)

**Argument format:** JSON string that must be `JSON.parse`d. DeepSeek returns `tool_calls[].function.arguments` as a JSON string, standard OpenAI format. No evidence of direct-object arguments.

**Tool result format:** Standard OpenAI format — `{ role: "tool", tool_call_id: string, content: string }`. `tool_call_id` is **required**. DeepSeek uses the result to inform the next turn.

**Known quirks:**
- DeepSeek V4 Pro/V4 Flash support function calling natively (confirmed in docs)
- DeepSeek Reasoner (legacy alias) does NOT support function calling — our `supportsTools: false` on `deepseek-reasoner` is correct
- DeepSeek's reasoning models (V4 Flash in thinking mode) can emit both `reasoning_content` and `tool_calls` in the same turn
- DeepSeek may refuse tool calls that could be destructive without explicit user context

### 2.2 Google (Gemma via OpenAI-compatible endpoint)

**Documentation:** https://ai.google.dev/gemini-api/docs/openai (OpenAI compatibility)

**Accepted schema subset (observed from Google's OpenAI compatibility docs):**
- `type: "object"`, `properties`, `required`, `description` — supported
- `additionalProperties` — likely supported but not explicitly documented
- `enum` — supported
- Nested objects — supported but depth limit unknown (assume ≤3)
- `$ref`, `oneOf`, `anyOf` — NOT supported (Google's compatibility layer is constrained)
- Array `items` — supported

**Tool choice mode:** `auto` (default), `none`, `required`. Google's compatibility endpoint supports the standard `tool_choice` parameter.

**Argument format:** JSON string that must be `JSON.parse`d. Google's compatibility layer returns standard OpenAI-format `tool_calls[].function.arguments` as a JSON string.

**Tool result format:** Standard OpenAI format — `{ role: "tool", tool_call_id: string, content: string }`. `tool_call_id` is **required**.

**Known quirks:**
- The `v1beta` endpoint may change; monitor Google's announcements for the stable path
- Google's Gemini models (when accessed natively, not through this compat layer) use a different tool format with `function_declarations` — this does NOT apply to Lamprey because we use the OpenAI-compatible endpoint exclusively
- Gemma 3 models (27B, 12B) support function calling; confirmed in Google's model documentation
- The compat endpoint may have latency variance vs. native Gemini API

### 2.3 DashScope (Qwen via compatibility mode)

**Documentation:** https://help.aliyun.com/zh/model-studio/ (function calling / 工具调用 section)

**Accepted schema subset (observed from DashScope compatibility mode + Qwen docs):**
- `type: "object"`, `properties`, `required`, `description` — supported
- `additionalProperties` — supported in compat mode
- `enum` — supported
- Nested objects — supported; Qwen docs show nested parameter examples
- `$ref`, `oneOf`, `anyOf` — NOT supported (compat mode)
- Array `items` — supported

**Tool choice mode:** `auto` (default), `none`. DashScope compatibility mode also supports `required` but its behavior under that mode is less tested.

**Argument format:** JSON string that must be `JSON.parse`d. DashScope compat mode returns standard OpenAI-format `tool_calls[].function.arguments` as a JSON string.

**Tool result format:** Standard OpenAI format — `{ role: "tool", tool_call_id: string, content: string }`. `tool_call_id` is **required**.

**Known quirks:**
- Qwen3 Max, Qwen3 Coder Plus, Qwen3 Coder Flash support function calling (`supportsTools: true` correct)
- Qwen3.5 Plus, Qwen3.5 Flash, Qwen Long do NOT support function calling (`supportsTools: false` correct)
- DashScope's compatible-mode endpoint may not expose `/v1/models` (confirmed in `validateProviderKeyDetailed` — the fallback chat-probe path exists for this reason)
- Qwen models may return Chinese-language tool call argument keys if the system prompt is in Chinese

### 2.4 OpenRouter

**Documentation:** https://openrouter.ai/docs/features/tool-calling

**Accepted schema subset:** Pass-through — OpenRouter forwards the `tools` array verbatim to the underlying model. Schema compatibility depends on the underlying model, not OpenRouter itself.

**Tool choice mode:** Pass-through — `auto`, `none`, `required` forwarded to the underlying model.

**Argument format:** JSON string that must be `JSON.parse`d (standard OpenAI format). For models that don't support native tools, OpenRouter does NOT provide a fallback — it simply won't return `tool_calls`.

**Tool result format:** Standard OpenAI format — `{ role: "tool", tool_call_id: string, content: string }`.

**Known quirks:**
- OpenRouter is a passthrough, not a provider with its own tool-calling implementation
- Tool support depends entirely on the underlying model ID selected
- For models routed through OpenRouter that do NOT support tools (e.g., older Llama, Mistral 7B), the `tools` array is silently ignored and `tool_calls` is always empty
- OpenRouter's free-tier models (`:free` suffix) have rate limits that may affect multi-turn tool-calling sessions
- OpenRouter normalizes `reasoning` on the delta (confirmed in `chatStream` — both `delta.reasoning_content` and `delta.reasoning` are read)

---

## 3. MCP Tool Exposure — CONFIRMED

MCP-originating tools **are currently exposed to model tool lists.** The `ToolRegistry.getDescriptors()` method (line 363 of `tool-registry.ts`) iterates `mcpManager.getAllTools()` on every call and synthesizes `LampreyToolDescriptor` entries with `providerKind: 'mcp'`.

**Key characteristics:**
- MCP tool schemas come from the MCP server's `inputSchema` field (typed as `unknown`)
- They are included in `getOpenAITools()` output and therefore sent to the model
- Their `inputSchema` quality varies by MCP server — some provide strict JSON Schema, others provide loose or absent schemas
- They are marked `lazy: true` (schema not included in IPC stubs to reduce payload size)
- Permission gating: Chrome MCP destructive tools (click, fill, submit, type, press, select_option) get `requiresApproval: true`; other MCP tools default to `requiresApproval: false`
- Mutating MCP tools (risks include `write` or `destructive`) are gated by plan mode

**MCP tools are IN SCOPE for this phase.** They must pass through the same provider schema normalizer, `validateToolArguments()` gate, provenance tagging, transcript model, and permission gate as built-in tools. If an MCP tool schema cannot be normalized, it must be excluded from the provider tool list with a logged warning.

---

## 4. Current Tool Call Dispatch Flow

```
chatStream() in registry.ts
  └─ sends tools[] to API, accumulates tool_calls[] from SSE deltas
  └─ onDone(fullContent, toolCalls, fullReasoning)
       └─ chat.ts:runChatRound().onDone()
            ├─ if toolCalls empty → composer pass → save message → done
            └─ if toolCalls non-empty:
                 ├─ persist assistant message with toolCalls
                 ├─ partitionToolCallWindows() → parallel/sequential windows
                 ├─ resolveSingleToolCall() per call
                 │    └─ validates args via JSON.parse(tc.function.arguments)
                 │    └─ NO schema validation before dispatch
                 ├─ save tool-role result messages
                 └─ recursive runChatRound() for next turn
```

**Critical observations:**
1. **No fallback parser exists.** If a model doesn't return `tool_calls` in the SSE stream, no tools are dispatched — even if the model's text content contains valid tool invocations.
2. **No schema validation before dispatch.** `JSON.parse` is used to parse arguments from the string, but no validation against `inputSchema` occurs. Invalid arguments are caught only by the tool handler itself.
3. **`chatOnce()` never passes tools.** The Planner, Reviewer, and Composer all use `chatOnce()`, which does not support tool calling. Only the Coder (via `chatStream()` / `runChatRound()`) can invoke tools.
4. **`PSEUDO_TAG_GUARD` is applied universally.** It is appended to the system prompt for planner, coder, reviewer, and coworker roles regardless of whether the model supports native tools.

---

## 5. Fallback Parser — Current State

**There is NO existing fallback tool-call parser to upgrade.** The codebase has:
- `tool-result-status.ts` — classifies handler results (not model output)
- `subagent-runner.ts:extractJsonPayload()` — strips markdown fences from sub-agent output (used for Planner/Reviewer JSON extraction, not tool calls)
- `chat.ts` line 1043: `JSON.parse(tc.function.arguments)` — parses arguments inside an already-detected native tool call

FC-6 must build the fallback parser from scratch (green field), not upgrade an existing one.

---

## 6. `supportsTools` Flag Accuracy

Current `MODEL_CATALOG` entries with `supportsTools`:

| Model ID | Provider | `supportsTools` | Correct? | Notes |
|----------|----------|-----------------|----------|-------|
| `deepseek-v4-pro` | deepseek | `true` | ✅ | Docs confirm |
| `deepseek-v4-flash` | deepseek | `true` | ✅ | Docs confirm |
| `deepseek-chat` | deepseek | `true` | ✅ (legacy alias) | Routes to V4 Flash |
| `deepseek-reasoner` | deepseek | `false` | ✅ | Reasoner doesn't support tools |
| `gemma-3-27b-it` | google | `true` | ✅ | Google docs confirm |
| `gemma-3-12b-it` | google | `true` | ✅ | Google docs confirm |
| `gemma-4-31b-it-free` | openrouter | `true` | ✅ | Gemma 4 supports tools |
| `gemma-4-31b-it` | openrouter | `true` | ✅ | Same model, paid tier |
| `gemma-4-26b-a4b-it-free` | openrouter | `true` | ✅ | Gemma 4 A4B supports tools |
| `gemma-4-26b-a4b-it` | openrouter | `true` | ✅ | Same model, paid tier |
| `qwen3-max` | dashscope | `true` | ✅ | Qwen3 Max docs confirm |
| `qwen3-coder-plus` | dashscope | `true` | ✅ | Coder models support tools |
| `qwen3-coder-flash` | dashscope | `true` | ✅ | Coder models support tools |
| `qwen3.5-plus` | dashscope | `false` | ✅ | Qwen3.5 not documented for tools |
| `qwen3.5-flash` | dashscope | `false` | ✅ | Qwen3.5 not documented for tools |
| `qwen-long` | dashscope | `false` | ✅ | Long-context variant, no tools |

**Verdict:** All `supportsTools` flags are correct per current provider documentation. FC-2 must re-audit these against the live `/v1/models` responses where possible, but no corrections appear needed based on docs.

**Fallback eligibility:** Only OpenRouter models that pass through to non-tool-capable underlying models could conceivably need fallback parsing. However, the current `MODEL_CATALOG` has no entries with `supportsTools: false` that would realistically need tool calls. The fallback path (FC-6) is a safety net for:
1. Custom user-added models that may not support tools
2. Future catalog additions
3. Capability mismatch scenarios (FC-10)

---

## 7. Implementation Decisions Table

> **Binding.** All prompts FC-1 through FC-14 must follow these decisions. If FC-13 smoke testing reveals a provider behaves differently, update this table in a follow-up commit (not silently in a later prompt).

| Provider | Endpoint type | Normalizer strategy | Arg parsing | Result serializer | Fallback eligible | Unsupported keywords |
|----------|--------------|---------------------|-------------|-------------------|-------------------|---------------------|
| **DeepSeek** | OpenAI-compatible (`/v1`) | Pass-through (no transformation needed) | `JSON.parse` string argument | OpenAI format: `{ role: "tool", tool_call_id, content }` | No (native) | `$ref`, `oneOf`, `anyOf` |
| **Google** | OpenAI-compatible (`/v1beta/openai/`) | Pass-through with `additionalProperties` check (compat layer may reject if unsupported) | `JSON.parse` string argument | OpenAI format: `{ role: "tool", tool_call_id, content }` | No (native) | `$ref`, `oneOf`, `anyOf` |
| **DashScope** | OpenAI-compatible (`/compatible-mode/v1`) | Pass-through (compat mode accepts standard schemas) | `JSON.parse` string argument | OpenAI format: `{ role: "tool", tool_call_id, content }` | No (native) | `$ref`, `oneOf`, `anyOf` |
| **OpenRouter** | Pass-through (`/api/v1`) | Forward as-is (depends on underlying model); for known-non-tool models, skip `tools` array entirely | `JSON.parse` string (when native); string from text (fallback) | OpenAI format | **Yes** (non-tool models, FC-6) | Varies by underlying model |

### Normalizer strategy details

**Pass-through for DeepSeek, Google, DashScope:**
- All three accept standard OpenAI `ChatCompletionTool[]` arrays
- No structural transformation required from `getOpenAITools()` output
- The normalizer's primary job: **validate that schemas are within each provider's accepted subset** and drop/report non-core tools that use unsupported keywords (`$ref`, `oneOf`, `anyOf`)
- Core tools (workspace_context, read_file, list_files, shell_command, apply_patch, verify_workspace) that use unsupported keywords cause a startup-time failure — they must be fixed

**OpenRouter:**
- For models with `supportsTools: true` — pass-through, same as above
- For models with `supportsTools: false` — do NOT send `tools` array; use the fallback prompt/parser pathway (FC-6)

### Argument parsing

All four providers return `tool_calls[].function.arguments` as a **JSON string** that must be `JSON.parse`d — never as a pre-parsed object. This is the standard OpenAI format and is universally consistent.

### Tool result format

All four providers expect the same format for tool results: `{ role: "tool", tool_call_id: string, content: string }`. The `tool_call_id` field is **required** by all providers. A single canonical serializer can serve all four.

---

## 8. Gaps Confirmed for Later Prompts

| Gap | Severity | Owner |
|-----|----------|-------|
| No fallback parser exists at all | High — models without `supportsTools` can never invoke tools | FC-6 |
| No schema validation before dispatch (`JSON.parse` only) | High — invalid args reach tool handlers | FC-1A, FC-5 |
| `PSEUDO_TAG_GUARD` applied to all roles regardless of `supportsTools` | Medium — native models don't need it | FC-7 |
| `chatOnce()` never passes tools (Planner/Reviewer tool-less) | Medium — architectural limitation, deferred | Future phase |
| MCP tool schemas unvalidated before reaching model | Medium — could cause provider rejections | FC-1C, FC-3 |
| Agent pipeline only gives tools to Coder | Low — current design; Planner/Reviewer don't need tools | N/A (by design) |
| No capability mismatch detection | Medium — `supportsTools: true` model failing silently | FC-10 |

---

## 9. Files Read During Audit

- `electron/services/providers/registry.ts` (1261 lines) — provider registry, MODEL_CATALOG, chatStream, chatOnce
- `electron/services/tool-registry.ts` (1105 lines) — ToolRegistry, getOpenAITools, all native tool registrations, MCP tool synthesis
- `electron/services/system-prompt-builder.ts` (356 lines) — PSEUDO_TAG_GUARD, AGENT_ROLE_PROMPTS, buildSystemPrompt
- `electron/services/agent-pipeline.ts` (760 lines) — runAgentPipeline, Planner/Coder/Reviewer orchestration
- `electron/ipc/chat.ts` (1369 lines) — runChatRound, tool call dispatch, resolveSingleToolCall
- `electron/services/tool-packs.ts` (33 lines) — side-effect imports of all tool-pack modules
- All 13 tool-pack files (apply-patch, browser, current-info, frontend-qa, image-generation, loop, multi-agent-run, native-dev, notifications, spawn-task, web, workspace-context, verify-workspace)
- `electron/services/tool-result-status.ts` — legacy result classifier
- `electron/services/sanitize-pseudo-tags.ts` — content sanitizer
