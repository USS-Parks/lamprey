import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { StoredToolCall } from './conversation-store'

export interface StoredChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: StoredToolCall[]
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
export function buildApiMessagesFromStoredMessages(
  systemPrompt: string,
  storedMessages: StoredChatMessage[]
): ChatCompletionMessageParam[] {
  const apiMessages: ChatCompletionMessageParam[] = [
    { role: 'system' as const, content: systemPrompt }
  ]

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
      if (toolCalls.length > 0) {
        pendingAssistant = {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments }
          }))
        } as ChatCompletionMessageParam & { tool_calls: Array<{ id: string }> }
        pendingToolIds = new Set(toolCalls.map((tc) => tc.id))
      } else {
        apiMessages.push({ role: 'assistant' as const, content: m.content })
      }
      continue
    }

    apiMessages.push({ role: 'user' as const, content: m.content })
  }

  flushPending()
  return apiMessages
}
