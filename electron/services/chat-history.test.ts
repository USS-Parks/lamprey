import { describe, expect, it, vi, beforeEach } from 'vitest'
import { buildApiMessagesFromStoredMessages, type StoredChatMessage } from './chat-history'
import { readSettings } from './settings-helper'

vi.mock('./settings-helper', () => ({
  readSettings: vi.fn(() => ({}))
}))

const toolCall = (id: string, name = 'shell_command') => ({
  id,
  type: 'function' as const,
  function: { name, arguments: '{"command":"echo hi"}' }
})

describe('buildApiMessagesFromStoredMessages', () => {
  it('keeps all tool replies for a multi-tool assistant turn', () => {
    const messages: StoredChatMessage[] = [
      { role: 'user', content: 'check things' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [toolCall('call-a'), toolCall('call-b')]
      },
      { role: 'tool', content: 'A done', toolCallId: 'call-a' },
      { role: 'tool', content: 'B done', toolCallId: 'call-b' },
      { role: 'assistant', content: 'All set.' }
    ]

    const api = buildApiMessagesFromStoredMessages('system', messages)

    expect(api.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'tool',
      'assistant'
    ])
    expect(api[2]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'call-a' }, { id: 'call-b' }]
    })
    expect(api[3]).toMatchObject({ role: 'tool', tool_call_id: 'call-a' })
    expect(api[4]).toMatchObject({ role: 'tool', tool_call_id: 'call-b' })
  })

  it('drops orphan tool replies', () => {
    const api = buildApiMessagesFromStoredMessages('system', [
      { role: 'tool', content: 'orphan', toolCallId: 'call-a' },
      { role: 'user', content: 'hello' }
    ])

    expect(api.map((m) => m.role)).toEqual(['system', 'user'])
  })

  it('drops incomplete assistant tool-call blocks', () => {
    const api = buildApiMessagesFromStoredMessages('system', [
      {
        role: 'assistant',
        content: '',
        toolCalls: [toolCall('call-a'), toolCall('call-b')]
      },
      { role: 'tool', content: 'A done', toolCallId: 'call-a' },
      { role: 'user', content: 'next turn' }
    ])

    expect(api.map((m) => m.role)).toEqual(['system', 'user'])
    expect(api[1]).toMatchObject({ role: 'user', content: 'next turn' })
  })
})

// Reasoning Audit Phase R8 — rehydrate past reasoning into the API
// message stack (gated by includePastReasoningInContext, default true).
describe('buildApiMessagesFromStoredMessages — reasoning rehydration (R8)', () => {
  const mockReadSettings = readSettings as unknown as ReturnType<typeof vi.fn>
  beforeEach(() => {
    mockReadSettings.mockReset()
  })

  it('prepends <think>…</think> when setting is on (default) and row has reasoning', () => {
    mockReadSettings.mockReturnValue({}) // default = ON
    const api = buildApiMessagesFromStoredMessages('system', [
      { role: 'user', content: 'help me' },
      {
        role: 'assistant',
        content: 'sure, do this',
        reasoning: 'I thought it through'
      },
      { role: 'user', content: 'follow-up' }
    ])
    expect(api[2]).toMatchObject({
      role: 'assistant',
      content: '<think>I thought it through</think>\n\nsure, do this'
    })
  })

  it('does NOT prepend when setting is explicitly false', () => {
    mockReadSettings.mockReturnValue({ includePastReasoningInContext: false })
    const api = buildApiMessagesFromStoredMessages('system', [
      { role: 'user', content: 'help me' },
      {
        role: 'assistant',
        content: 'sure, do this',
        reasoning: 'I thought it through'
      }
    ])
    expect(api[2]).toMatchObject({ role: 'assistant', content: 'sure, do this' })
  })

  it('passes through unchanged when row has no reasoning', () => {
    mockReadSettings.mockReturnValue({}) // default = ON
    const api = buildApiMessagesFromStoredMessages('system', [
      { role: 'user', content: 'help' },
      { role: 'assistant', content: 'plain reply' }
    ])
    expect(api[2]).toMatchObject({ role: 'assistant', content: 'plain reply' })
  })

  it('does NOT double-tag when content already opens with <think>', () => {
    mockReadSettings.mockReturnValue({})
    const api = buildApiMessagesFromStoredMessages('system', [
      { role: 'user', content: 'help' },
      {
        role: 'assistant',
        content: '<think>existing inline</think>body',
        reasoning: 'native reasoning'
      }
    ])
    expect(api[2]).toMatchObject({
      role: 'assistant',
      content: '<think>existing inline</think>body'
    })
  })

  it('also prepends on assistant rows that carry tool_calls', () => {
    mockReadSettings.mockReturnValue({})
    const api = buildApiMessagesFromStoredMessages('system', [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: 'calling tool',
        reasoning: 'why I think shell is right',
        toolCalls: [toolCall('call-a')]
      },
      { role: 'tool', content: 'done', toolCallId: 'call-a' }
    ])
    const assistant = api[2] as { role: string; content: string | null }
    expect(assistant.role).toBe('assistant')
    expect(assistant.content).toBe(
      '<think>why I think shell is right</think>\n\ncalling tool'
    )
  })
})
