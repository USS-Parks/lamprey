import { describe, it, expect } from 'vitest'
import {
  serializeAssistantToolCalls,
  serializeToolResult,
  serializeToolResults,
  type ToolCallRequest,
  type ToolResult
} from './transcript-model'

const nativeRequest: ToolCallRequest = {
  id: 'call_abc123',
  name: 'shell_command',
  arguments: { command: 'ls -la' },
  provenance: 'native'
}

const fallbackRequest: ToolCallRequest = {
  id: 'fb_def456',
  name: 'apply_patch',
  arguments: { patch: '*** Begin Patch\n...\n*** End Patch' },
  provenance: 'fallback'
}

const successResult: ToolResult = {
  toolCallId: 'call_abc123',
  name: 'shell_command',
  content: 'file1.txt  file2.txt',
  isError: false
}

const errorResult: ToolResult = {
  toolCallId: 'call_abc123',
  name: 'shell_command',
  content: 'command not found',
  isError: true
}

describe('transcript model serializers', () => {
  // ── serializeAssistantToolCalls ─────────────────────────────────────

  it('serializes a single native tool call', () => {
    const msg = serializeAssistantToolCalls([nativeRequest], 'deepseek')
    expect(msg.role).toBe('assistant')
    expect(msg.content).toBeNull()
    expect(msg.tool_calls).toHaveLength(1)
    expect(msg.tool_calls[0].id).toBe('call_abc123')
    expect(msg.tool_calls[0].type).toBe('function')
    expect(msg.tool_calls[0].function.name).toBe('shell_command')
    expect(JSON.parse(msg.tool_calls[0].function.arguments)).toEqual({ command: 'ls -la' })
  })

  it('serializes multiple tool calls', () => {
    const msg = serializeAssistantToolCalls([nativeRequest, fallbackRequest], 'deepseek')
    expect(msg.tool_calls).toHaveLength(2)
    expect(msg.tool_calls[0].function.name).toBe('shell_command')
    expect(msg.tool_calls[1].function.name).toBe('apply_patch')
  })

  it('produces identical output for all providers', () => {
    const deepseek = serializeAssistantToolCalls([nativeRequest], 'deepseek')
    const google = serializeAssistantToolCalls([nativeRequest], 'google')
    const dashscope = serializeAssistantToolCalls([nativeRequest], 'dashscope')
    const openrouter = serializeAssistantToolCalls([nativeRequest], 'openrouter')
    expect(google).toEqual(deepseek)
    expect(dashscope).toEqual(deepseek)
    expect(openrouter).toEqual(deepseek)
  })

  it('preserves provenance in the serialized request (not the message)', () => {
    // Provenance is on ToolCallRequest but NOT serialized into the API
    // message. It's used internally for trust degradation (FC-9).
    const msg = serializeAssistantToolCalls([fallbackRequest], 'deepseek')
    const serialized = msg.tool_calls[0]
    expect(JSON.parse(serialized.function.arguments)).toEqual({ patch: '*** Begin Patch\n...\n*** End Patch' })
    // Provenance is NOT in the serialized message
  })

  // ── serializeToolResult ─────────────────────────────────────────────

  it('serializes a success result', () => {
    const msg = serializeToolResult(successResult, 'deepseek')
    expect(msg.role).toBe('tool')
    expect(msg.tool_call_id).toBe('call_abc123')
    expect(msg.content).toBe('file1.txt  file2.txt')
  })

  it('prepends Error: prefix for error results', () => {
    const msg = serializeToolResult(errorResult, 'deepseek')
    expect(msg.content).toBe('Error: command not found')
  })

  it('produces identical tool result format for all providers', () => {
    const deepseek = serializeToolResult(successResult, 'deepseek')
    const google = serializeToolResult(successResult, 'google')
    expect(google).toEqual(deepseek)
  })

  // ── serializeToolResults ────────────────────────────────────────────

  it('serializes multiple results into separate messages', () => {
    const results = serializeToolResults(
      [successResult, { ...successResult, toolCallId: 'call_2' }],
      'deepseek'
    )
    expect(results).toHaveLength(2)
    expect(results[0].tool_call_id).toBe('call_abc123')
    expect(results[1].tool_call_id).toBe('call_2')
  })
})
