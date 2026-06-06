import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { StoredToolCall } from './conversation-store'
import { readSettings } from './settings-helper'

export interface StoredChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: StoredToolCall[]
  /** Reasoning Audit Phase R8 — chain-of-thought the model produced
   *  on the turn that wrote this row. When the `includePastReasoningInContext`
   *  setting is enabled (default), `buildApiMessagesFromStoredMessages`
   *  prepends this as `<think>…</think>` inside the assistant content so
   *  the model on the NEXT turn can see its own prior thinking. Closes
   *  the "no session history tool exists" gap the debug-session audit
   *  surfaced. NULL on legacy rows (single-agent without thinking, or
   *  any row written pre-R5) — those go through unchanged. */
  reasoning?: string
}

/** Reasoning Audit Phase R8 — read the `includePastReasoningInContext`
 *  setting from `userData/settings.json`. Defaults to `true` per the
 *  user's audit-priority direction (2026-06-06). Returns false ONLY when
 *  the user has explicitly disabled it via Settings → Reasoning Audit
 *  panel. The setting trades API token cost (each rehydrated `<think>`
 *  block inflates context) for audit transparency. */
function shouldIncludePastReasoning(): boolean {
  try {
    const raw = readSettings()
    const v = (raw as { includePastReasoningInContext?: unknown })
      .includePastReasoningInContext
    if (v === false) return false
    return true
  } catch {
    return true
  }
}

function toApiToolCalls(toolCalls: StoredToolCall[] | undefined): StoredToolCall[] {
  if (!Array.isArray(toolCalls)) return []
  return toolCalls.filter(
    (tc) =>
      tc?.type === 'function' &&
      typeof tc.id === 'string' &&
      tc.id.trim().length > 0 &&
      typeof tc.function?.name === 'string' &&
      typeof tc.function?.arguments === 'string'
  )
}

/**
 * Convert persisted rows into the strict OpenAI chat message sequence.
 *
 * Providers require an assistant message with tool_calls to be followed by
 * one tool message for every tool_call_id before any other role appears. Old
 * or interrupted conversations can miss one side of that pair, so we buffer a
 * tool-call block until it is complete; incomplete blocks are dropped instead
 * of poisoning the next request.
 */
/** Reasoning Audit Phase R8 — when the setting is on, prepend the row's
 *  reasoning as a leading `<think>…</think>` block inside the assistant
 *  content (provided the content doesn't already start with `<think>`,
 *  which would double-tag inline-emitter rows). The model on the next
 *  turn sees the prior chain-of-thought as if it had emitted it itself.
 *
 *  When the setting is off, or the row has no reasoning, or the content
 *  already opens with `<think>`, the content is passed through unchanged. */
function reasoningRehydratedContent(
  content: string,
  reasoning: string | undefined,
  enabled: boolean
): string {
  if (!enabled) return content
  if (!reasoning || reasoning.length === 0) return content
  if (/^\s*<think>/i.test(content)) return content
  return `<think>${reasoning}</think>\n\n${content}`
}

export function buildApiMessagesFromStoredMessages(
  systemPrompt: string,
  storedMessages: StoredChatMessage[]
): ChatCompletionMessageParam[] {
  const apiMessages: ChatCompletionMessageParam[] = [
    { role: 'system' as const, content: systemPrompt }
  ]
  const includePastReasoning = shouldIncludePastReasoning()

  let pendingAssistant:
    | (ChatCompletionMessageParam & { tool_calls: Array<{ id: string }> })
    | null = null
  let pendingToolIds = new Set<string>()
  let pendingTools: ChatCompletionMessageParam[] = []

  const flushPending = () => {
    if (!pendingAssistant) return
    if (pendingToolIds.size === 0) {
      apiMessages.push(pendingAssistant as ChatCompletionMessageParam, ...pendingTools)
    }
    pendingAssistant = null
    pendingToolIds = new Set()
    pendingTools = []
  }

  for (const m of storedMessages) {
    if (m.role === 'system') continue

    if (pendingAssistant) {
      if (m.role === 'tool' && m.toolCallId && pendingToolIds.has(m.toolCallId)) {
        pendingTools.push({
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.toolCallId
        })
        pendingToolIds.delete(m.toolCallId)
        continue
      }
      flushPending()
    }

    if (m.role === 'tool') {
      continue
    }

    if (m.role === 'assistant') {
      const toolCalls = toApiToolCalls(m.toolCalls)
      const rehydratedContent = reasoningRehydratedContent(
        m.content,
        m.reasoning,
        includePastReasoning
      )
      if (toolCalls.length > 0) {
        pendingAssistant = {
          role: 'assistant' as const,
          content: rehydratedContent || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments }
          }))
        } as ChatCompletionMessageParam & { tool_calls: Array<{ id: string }> }
        pendingToolIds = new Set(toolCalls.map((tc) => tc.id))
      } else {
        apiMessages.push({ role: 'assistant' as const, content: rehydratedContent })
      }
      continue
    }

    apiMessages.push({ role: 'user' as const, content: m.content })
  }

  flushPending()
  return apiMessages
}
