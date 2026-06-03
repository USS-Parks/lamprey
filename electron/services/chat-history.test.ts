import { describe, expect, it } from 'vitest'
import { buildApiMessagesFromStoredMessages, type StoredChatMessage } from './chat-history'

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
