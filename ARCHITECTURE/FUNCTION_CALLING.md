# Lamprey Function Calling Architecture

> FC-15 — Complete documentation of the function-calling pathway, normalizer, transcript model, fallback trust tiers, and how to add a tool or provider. Sufficient for a new maintainer.

---

## 1. Overview

Lamprey uses **two parallel pathways** for tool calling:

| Pathway | When used | How tools are discovered | Trust level |
|---------|-----------|--------------------------|-------------|
| **Native** | Model has `supportsTools: true` | API returns structured `tool_calls[]` in SSE stream | Full trust — dispatched directly |
| **Fallback** | Model has `supportsTools: false` or capability-downgraded | Text parsed for JSON contract `{"action":"...","input":{...}}` | Degraded trust — mutating calls require explicit approval |

All four providers (DeepSeek, Google, DashScope, OpenRouter) use OpenAI-compatible endpoints with identical tool schemas.

---

## 2. Key Files

| File | Purpose |
|------|---------|
| `electron/services/providers/registry.ts` | `MODEL_CATALOG`, `chatStream()`, `chatOnce()`, provider baseURLs |
| `electron/services/providers/schema-normalizer.ts` | `normalizeToolsForProvider()` — strips unsupported keywords, fail-fast on core tools. **Invoked from:** `electron/services/tool-registry.ts:530` (WC-1) |
| `electron/services/providers/capability-tracker.ts` | Detects `supportsTools` mismatches, temporarily downgrades models. **Invoked from:** `electron/ipc/chat.ts:769` |
| `electron/services/tool-registry.ts` | `ToolRegistry` singleton, `getOpenAITools()`, `getNormalizedToolsForProvider()`, `getNormalizedToolsForRole()`, all native tool registrations |
| `electron/services/tool-schema-validator.ts` | `validateToolArguments()` — shared validation gate. **Invoked from:** `electron/ipc/chat.ts:1169` |
| `electron/services/transcript-model.ts` | `ToolCallRequest`, `ToolResult`, per-provider serializers |
| `electron/services/fallback-tool-parser.ts` | `extractBalancedJson()`, `parseFallbackToolCalls()`, `FALLBACK_TOOL_INSTRUCTION`. **Invoked from:** `electron/ipc/chat.ts:803` |
| `electron/services/role-tool-access.ts` | `filterToolsForRole()` — Planner/Reviewer/Coder tool allowlists. **Invoked from:** `electron/services/tool-registry.ts:541` (WC-2) |
| `electron/services/system-prompt-builder.ts` | `PSEUDO_TAG_GUARD`, `buildSystemPrompt()`, `buildAgentSystemPrompt()` |
| `electron/services/conversation-store.ts` | `saveMessage()` — sanitizer bypass for native tool calls |
| `electron/ipc/chat.ts` | `runChatRound()` — main dispatch loop, fallback parsing integration |

---

## 3. Tool Descriptors and `inputSchema`

Every tool registered with `toolRegistry.registerNative()` must have a strict `inputSchema`:

```typescript
{
  type: 'object',
  properties: {
    command: { type: 'string', description: '...' }
  },
  required: ['command'],
  additionalProperties: false
}
```

**Rules:**
- `type: "object"` at the top level
- Every property has a `description`
- `required` array lists mandatory properties
- `additionalProperties: false` (prevents hallucinated extra args)
- Nested objects follow the same rules
- Enum values use `enum: [...]`
- Array properties use `items: { type: '...' }`

**Unsupported JSON Schema keywords** (any provider): `$ref`, `oneOf`, `anyOf`, `allOf`, `$schema`, `$id`, `patternProperties`, etc. These are stripped by the normalizer for non-core tools; core tools fail at startup.

---

## 4. `validateToolArguments()` — Shared Validation Gate

Located in `electron/services/tool-schema-validator.ts`. Every tool call passes through this function before dispatch:

```typescript
validateToolArguments(
  toolName: string,
  args: unknown,        // object, JSON string, undefined, or null
  schema: object        // the tool's inputSchema
): { valid: true, parsed: Record<string, unknown> }
 | { valid: false, errors: string[] }
```

**What it checks:**
- Required properties present
- Property types match (string, number, boolean, object, array)
- No unexpected properties (`additionalProperties: false`)
- Enum values match allowed set
- Array items match declared type
- Nested objects recursively validated
- JSON string arguments parsed before validation

**What it does NOT check** (by design — provider-side validation is the second line):
- `$ref`, `oneOf`, `anyOf`, `allOf` — ignored, assume provider handles
- `pattern`, `minLength`, `maxLength`, `minimum`, `maximum` — not implemented

---

## 5. Provider Schema Normalizer

`normalizeToolsForProvider(tools, provider)` in `schema-normalizer.ts`:

1. **Strips non-structural unsupported keywords** (`$schema`, `$id`, `patternProperties`, etc.)
2. **Drops non-core tools** with structural unsupported keywords (`$ref`, `oneOf`, `anyOf`, `allOf`)
3. **Fails fast** for core tools with structural unsupported keywords (startup error)
4. **Ensures `type: "object"`** is present on every tool's parameters

All four providers use the same normalizer logic (identical accepted subsets per FC-0 audit).

**Invocation (WC-1, 2026-06-09):** The normalizer is reached through `toolRegistry.getNormalizedToolsForProvider(provider)` (and the role-aware variant `getNormalizedToolsForRole(role, provider)`) at `electron/services/tool-registry.ts:518/541`. The chat dispatch at `electron/ipc/chat.ts:467` calls the role-aware getter with `role: 'coder'` so every outgoing tool list is normalized for the active provider before reaching `chatStream` / the API. Tests in `electron/services/tool-registry.test.ts` (`WC-1 schema normalizer wiring` block) assert the path is hot.

**Core tools** (fail-fast on incompatibility):
`workspace_context`, `view_image`, `shell_command`, `apply_patch`, `verify_workspace`, `shell_list`, `shell_monitor`, `shell_stop`, `shell_output`

---

## 6. Transcript Model

Internal types in `electron/services/transcript-model.ts`:

```typescript
interface ToolCallRequest {
  id: string            // OpenAI call id or fallback "fb_*"
  name: string          // Tool name matching registry
  arguments: Record<string, unknown>  // Parsed and validated args
  provenance: 'native' | 'fallback'   // Source of the call
}

interface ToolResult {
  toolCallId: string    // Must match ToolCallRequest.id
  name: string
  content: string
  isError: boolean
}
```

**Source of truth:**
- Message-level `tool_calls` (JSON column on `messages`): stores `ToolCallRequest[]` — what the model intended
- `tool_calls` audit table (backed by `tool-calls-store.ts`): stores execution lifecycle — what actually happened
- Linked by `tool_call_id`, never treated interchangeably

---

## 7. Native Pathway (supportsTools: true)

```
chat.ts:runChatRound()
  └─ descriptor.supportsTools && !isDowngraded() → send tools[]
  └─ chatStream() sends tools to API
  └─ onDone(fullContent, toolCalls, fullReasoning)
       ├─ if toolCalls non-empty:
       │    ├─ validateToolArguments() per call (FC-5)
       │    ├─ partitionToolCallWindows() → parallel/sequential
       │    ├─ resolveSingleToolCall() → execute
       │    └─ recursive runChatRound()
       └─ if toolCalls empty:
            ├─ capability mismatch detection (FC-10)
            ├─ composer pass (if agent mode)
            └─ save message → done
```

**PSEUDO_TAG_GUARD bypass:** Native models skip the guard injection and content sanitization (FC-7).

---

## 8. Fallback Pathway (supportsTools: false)

```
chat.ts:runChatRound()
  └─ !descriptor.supportsTools → no tools[] sent
  └─ model returns text-only response
  └─ onDone(fullContent, null, fullReasoning)
       ├─ parseFallbackToolCalls(fullContent, tools)
       │    ├─ extractBalancedJson() → find first {} block
       │    ├─ check for {"action":"final","answer":"..."} → final answer
       │    ├─ match action to known tool name
       │    ├─ validateToolArguments() against inputSchema
       │    └─ return ToolCallRequest[] with provenance:'fallback'
       ├─ if valid calls found → dispatch (with degraded trust FC-9)
       └─ if no calls → composer pass → done
```

**Fallback instruction contract:**
```
{"action": "<tool_name>", "input": {<arguments>}}   ← tool call
{"action": "final", "answer": "..."}                 ← final answer
```

The `FALLBACK_TOOL_INSTRUCTION` constant is appended to the system prompt for fallback models.

**Fallback trust degradation (FC-9):**
- Fallback calls carry `provenance: "fallback"` and use `fb_` prefixed call IDs
- Mutating fallback calls skip "always allow" policies and always re-prompt the user
- The `dangerous` flag is set on the approval request, mirroring sandbox-bypass behavior

---

## 9. Capability Mismatch Detection (FC-10)

`capability-tracker.ts` tracks per-conversation per-model:
- When a `supportsTools: true` model returns tool-like syntax (`<bash>`, `{"action":`, etc.) but NO `tool_calls`, increment a mismatch counter
- Normal answers (no tool-like syntax) reset the counter
- After 3 consecutive mismatches, the model is temporarily downgraded to fallback mode
- `isDowngraded(conversationId, modelId)` gates `effectiveTools` to undefined
- Reset on new conversation or `resetCapabilityTracking()`

---

## 10. Role-Based Tool Access

`filterToolsForRole(descriptors, role)` in `role-tool-access.ts`:

| Role | Access |
|------|--------|
| **Planner** | Read-only tools + `update_plan` + goal management |
| **Coder** | All tools (gated by plan mode + permissions) |
| **Reviewer** | Read-only inspection + proof receipts + diff tools |

MCP tools follow the same role-based filtering when exposed to model tool lists.

**Invocation (WC-2, 2026-06-09):** The role filter is reached through `toolRegistry.getNormalizedToolsForRole(role, provider)` at `electron/services/tool-registry.ts:541`. The chat dispatch at `electron/ipc/chat.ts:467` calls it with `role: 'coder'` because single-mode and the multi-mode Coder are the only stages currently receiving tools (Planner uses `chatOnce` without tools, Reviewer uses `subAgentRunner` without tools per FC_AUDIT §4). Planner and Reviewer subsets verifiably exclude `apply_patch` and `shell_command` — see `electron/services/tool-registry.test.ts` (`WC-2 role-aware tool filtering wiring` block).

---

## 11. MCP Tool Boundary

MCP-originating tools are **in scope** for the function-calling pathway:
- Their schemas come from MCP server tool definitions
- They are included in `getOpenAITools()` output
- They pass through `normalizeToolsForProvider()` — non-normalizable MCP tools are excluded with warnings
- They are validated by `validateToolArguments()` before dispatch
- They follow the same provenance, transcript, and permission rules
- Marked `providerKind: 'mcp'` and `lazy: true`

---

## 12. Adding a New Tool

1. Define `inputSchema` with strict JSON Schema (type, properties, required, additionalProperties)
2. Register via `toolRegistry.registerNative({...}, handler)`
3. Add to appropriate `role-tool-access.ts` allowlist if restricted
4. Run `npx vitest run electron/services/tool-schema-coverage.test.ts` to verify schema
5. Add positive and negative validation tests to cover your tool's schema

---

## 13. Adding a New Provider

1. Add entry to `PROVIDERS` in `registry.ts` (id, label, baseURL, keyEnv, docsUrl)
2. Add models to `MODEL_CATALOG` with correct `supportsTools` flag
3. If provider has different schema acceptance, add per-provider logic to `schema-normalizer.ts`
4. Update `ProviderId` type in `registry.ts`
5. Add a row to `docs/function-calling-matrix.md` and smoke-test

---

## 14. Ghost-Reply Protection

Two layers of defense against pseudo-XML in model output:

1. **Prompt-level (`PSEUDO_TAG_GUARD`):** For fallback models, the system prompt instructs the model to use plain Markdown only and never emit `<bash>`, `<tool>`, etc.
2. **Persist-level (`sanitizePseudoTags`):** For fallback models, assistant messages are sanitized before save — angle-bracket tags are rewritten to fenced code blocks.

Native models (with `supportsTools: true`) skip both layers.

---

## 15. Serial Mutating Execution Rule

- Mutating tools (`mutates: true` or `risks` includes `write`/`destructive`) execute serially
- Read-only tools may batch execute in parallel via `partitionToolCallWindows()`
- A fresh workspace snapshot is conceptually taken between mutating calls (enforced by sequential dispatch)

---

## 16. Diagram

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  chat:send   │────▶│  runChatRound() │────▶│   chatStream()   │
│  (user msg)  │     │  (chat.ts)      │     │  (registry.ts)   │
└──────────────┘     └───────┬─────────┘     └────────┬─────────┘
                             │                         │
                    ┌────────▼────────┐     ┌──────────▼──────────┐
                    │  supportsTools? │     │  OpenAI API call    │
                    │  + isDowngraded?│     │  with tools[]       │
                    └────┬───────┬────┘     └──────────┬──────────┘
                         │       │                      │
                    true │       │ false          ┌─────▼─────┐
                         │       │                │ SSE stream│
              ┌──────────▼──┐ ┌──▼──────────┐    │ tool_calls│
              │ Native path │ │Fallback path│    └─────┬─────┘
              │ tool_calls[]│ │parse text   │          │
              └──────┬──────┘ │JSON extract │    ┌─────▼──────┐
                     │        └──────┬──────┘    │ onDone()   │
                     │               │           │ content +  │
              ┌──────▼───────────────▼──┐        │ toolCalls  │
              │ validateToolArguments() │◀───────┤ + reasoning│
              │ (tool-schema-validator) │        └────────────┘
              └───────────┬────────────┘
                          │
                   ┌──────▼──────┐
                   │  Dispatch   │
                   │  + Execute  │
                   │  + Persist  │
                   └─────────────┘
```
