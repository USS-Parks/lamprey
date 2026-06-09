/**
 * FC-4 — Canonical internal transcript model.
 *
 * Defines the internal types for tool call requests and tool results, and
 * per-provider serializers that convert them into provider-specific API
 * message shapes. Per the FC-0 audit, all four providers use the same
 * OpenAI-compatible format, so the serializers are structurally identical.
 * The per-provider functions exist as a type-safety seam for future provider
 * divergence.
 *
 * ## Source of truth
 *
 *   Message-level `tool_calls` (JSON column on `messages`) stores
 *   `ToolCallRequest[]` — this is the canonical record of what the model
 *   intended to invoke. The `tool_calls` audit table (backed by
 *   `tool-calls-store.ts`) stores the execution lifecycle: started, running,
 *   done/error. They are linked by `tool_call_id` and are NEVER treated
 *   interchangeably. The message-level record answers "what did the model
 *   want?"; the audit table answers "what actually happened?"
 */

import type { ProviderId } from './providers/registry'

// ── Internal canonical types ──────────────────────────────────────────

export interface ToolCallRequest {
  /** OpenAI-format tool call id (e.g. "call_abc123"). */
  id: string
  /** Tool name matching a descriptor in the registry. */
  name: string
  /** Parsed and validated arguments. */
  arguments: Record<string, unknown>
  /** Provenance: "native" = API-returned tool_calls; "fallback" = text-parsed. */
  provenance: 'native' | 'fallback'
}

export interface ToolResult {
  /** Must match the ToolCallRequest.id this result answers. */
  toolCallId: string
  /** Tool name (for display). */
  name: string
  /** The result body, as a string. */
  content: string
  /** True when the tool call produced an error. */
  isError: boolean
}

// ── Provider-specific message shapes ──────────────────────────────────

/**
 * An assistant message containing one or more tool call requests.
 * Serialized per-provider.
 */
export interface ProviderAssistantToolCallsMessage {
  role: 'assistant'
  content: string | null
  tool_calls: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
}

/**
 * A tool-role message carrying the result of one tool call.
 * Serialized per-provider.
 */
export interface ProviderToolResultMessage {
  role: 'tool'
  tool_call_id: string
  content: string
}

// ── Serializers ───────────────────────────────────────────────────────

/**
 * Serialize one or more tool call requests into a provider-specific
 * assistant message with tool_calls.
 */
export function serializeAssistantToolCalls(
  requests: ToolCallRequest[],
  _provider: ProviderId
): ProviderAssistantToolCallsMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: requests.map((r) => ({
      id: r.id,
      type: 'function' as const,
      function: {
        name: r.name,
        arguments: JSON.stringify(r.arguments)
      }
    }))
  }
}

/**
 * Serialize a single tool result into a provider-specific tool message.
 */
export function serializeToolResult(
  result: ToolResult,
  _provider: ProviderId
): ProviderToolResultMessage {
  return {
    role: 'tool',
    tool_call_id: result.toolCallId,
    content: result.isError ? `Error: ${result.content}` : result.content
  }
}

/**
 * Serialize a batch of tool results, one message per result.
 */
export function serializeToolResults(
  results: ToolResult[],
  provider: ProviderId
): ProviderToolResultMessage[] {
  return results.map((r) => serializeToolResult(r, provider))
}
