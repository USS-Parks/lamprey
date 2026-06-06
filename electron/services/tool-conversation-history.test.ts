import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the conversation-store + stage-metrics-store seams so the suite runs
// without a real SQLite connection. The tool is pure logic on top of these.
const messagesByConv = new Map<string, Array<Record<string, unknown>>>()
const metricsByMessage = new Map<string, Array<Record<string, unknown>>>()

vi.mock('./conversation-store', () => ({
  getMessages: (id: string) => messagesByConv.get(id) ?? []
}))

vi.mock('./stage-metrics-store', () => ({
  listStageMetrics: (mid: string) => metricsByMessage.get(mid) ?? []
}))

import {
  runGetConversationHistory,
  runGetConversationHistorySafe,
  validateArgs
} from './tool-conversation-history'

const C = 'conv-A'

function userTurn(id: string, content: string) {
  return {
    id,
    conversationId: C,
    role: 'user',
    content,
    timestamp: 1000,
    model: undefined,
    toolCalls: undefined,
    reasoning: undefined
  }
}

function assistantTurn(id: string, content: string, opts: Record<string, unknown> = {}) {
  return {
    id,
    conversationId: C,
    role: 'assistant',
    content,
    timestamp: 2000,
    model: 'deepseek-v4-pro',
    toolCalls: undefined,
    reasoning: undefined,
    ...opts
  }
}

beforeEach(() => {
  messagesByConv.clear()
  metricsByMessage.clear()
})

describe('validateArgs', () => {
  it('returns an empty object for null/undefined', () => {
    expect(validateArgs(undefined)).toEqual({})
    expect(validateArgs(null)).toEqual({})
  })

  it('rejects non-objects', () => {
    expect(() => validateArgs('string')).toThrow(/must be an object/)
    expect(() => validateArgs(42)).toThrow(/must be an object/)
  })

  it('rejects empty conversation_id', () => {
    expect(() => validateArgs({ conversation_id: '   ' })).toThrow(/conversation_id/)
  })

  it('clamps limit to 200 and floors fractional', () => {
    expect(validateArgs({ limit: 5000 })).toEqual({ limit: 200 })
    expect(validateArgs({ limit: 12.7 })).toEqual({ limit: 12 })
  })

  it('rejects negative turn_index', () => {
    expect(() => validateArgs({ turn_index: -1 })).toThrow(/turn_index/)
  })

  it('rejects non-boolean include flags', () => {
    expect(() => validateArgs({ include_reasoning: 'yes' })).toThrow(/include_reasoning/)
  })
})

describe('runGetConversationHistory', () => {
  it('errors when no conversation id is available', () => {
    expect(() => runGetConversationHistory({}, null)).toThrow(/no conversation_id/)
  })

  it('returns the most recent N turns in chronological order', () => {
    messagesByConv.set(C, [
      userTurn('u1', 'hi'),
      assistantTurn('a1', 'hello'),
      userTurn('u2', 'how are you'),
      assistantTurn('a2', 'good thanks'),
      userTurn('u3', 'ok')
    ])
    const result = runGetConversationHistory({ limit: 3 }, C)
    expect(result.conversation_id).toBe(C)
    expect(result.total_turns).toBe(5)
    expect(result.returned_turns).toBe(3)
    expect(result.turns.map((t) => t.content)).toEqual(['how are you', 'good thanks', 'ok'])
    expect(result.turns.map((t) => t.turn_index)).toEqual([2, 3, 4])
  })

  it('respects turn_index single-turn select', () => {
    messagesByConv.set(C, [
      userTurn('u1', 'hi'),
      assistantTurn('a1', 'hello'),
      userTurn('u2', 'q'),
      assistantTurn('a2', 'a')
    ])
    const result = runGetConversationHistory({ turn_index: 1 }, C)
    expect(result.returned_turns).toBe(1)
    expect(result.turns[0].content).toBe('hello')
    expect(result.turns[0].turn_index).toBe(1)
  })

  it('returns an empty list for an out-of-range turn_index', () => {
    messagesByConv.set(C, [userTurn('u1', 'hi'), assistantTurn('a1', 'hello')])
    const result = runGetConversationHistory({ turn_index: 99 }, C)
    expect(result.returned_turns).toBe(0)
    expect(result.turns).toEqual([])
  })

  it('omits reasoning when include_reasoning is false', () => {
    messagesByConv.set(C, [
      assistantTurn('a1', 'visible body', { reasoning: 'hidden thoughts' })
    ])
    const without = runGetConversationHistory({ include_reasoning: false }, C)
    expect(without.turns[0].reasoning).toBeUndefined()
    const withIt = runGetConversationHistory({ include_reasoning: true }, C)
    expect(withIt.turns[0].reasoning).toBe('hidden thoughts')
  })

  it('attaches stage metrics only when include_stage_metrics is true', () => {
    messagesByConv.set(C, [
      assistantTurn('a1', 'reply', {
        // reasoning omitted intentionally — metrics path still tested.
      })
    ])
    metricsByMessage.set('a1', [
      {
        id: 'm1',
        messageId: 'a1',
        stage: 'single',
        model: 'deepseek-v4-pro',
        promptTokens: null,
        completionTokens: 120,
        durationMs: 3200,
        createdAt: 2500
      }
    ])
    const off = runGetConversationHistory({}, C)
    expect(off.turns[0].stage_metrics).toBeUndefined()
    const on = runGetConversationHistory({ include_stage_metrics: true }, C)
    expect(on.turns[0].stage_metrics).toHaveLength(1)
    expect((on.turns[0].stage_metrics?.[0] as { stage: string })?.stage).toBe('single')
  })

  it('attaches tool_calls only when include_tool_calls is true', () => {
    messagesByConv.set(C, [
      assistantTurn('a1', 'reply', {
        toolCalls: [
          { id: 'call1', type: 'function', function: { name: 'shell_command', arguments: '{}' } }
        ]
      })
    ])
    const off = runGetConversationHistory({}, C)
    expect(off.turns[0].tool_calls).toBeUndefined()
    const on = runGetConversationHistory({ include_tool_calls: true }, C)
    expect(on.turns[0].tool_calls).toHaveLength(1)
  })

  it('falls back to active conversation when conversation_id is omitted', () => {
    messagesByConv.set(C, [userTurn('u1', 'hi')])
    const result = runGetConversationHistory({}, C)
    expect(result.conversation_id).toBe(C)
    expect(result.total_turns).toBe(1)
  })

  it('honors an explicit conversation_id over the active one', () => {
    messagesByConv.set('other', [userTurn('u1', 'other body')])
    messagesByConv.set(C, [userTurn('u2', 'active body')])
    const result = runGetConversationHistory({ conversation_id: 'other' }, C)
    expect(result.conversation_id).toBe('other')
    expect(result.turns[0].content).toBe('other body')
  })
})

describe('runGetConversationHistorySafe', () => {
  it('wraps successful runs in ok: true', () => {
    messagesByConv.set(C, [userTurn('u1', 'hi')])
    const out = runGetConversationHistorySafe({}, C)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.data.total_turns).toBe(1)
    }
  })

  it('catches validation errors as ok: false', () => {
    const out = runGetConversationHistorySafe({ limit: -1 }, C)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toMatch(/limit/)
    }
  })

  it('catches runtime errors (no conversation) as ok: false', () => {
    const out = runGetConversationHistorySafe({}, null)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toMatch(/no conversation_id/)
    }
  })
})
