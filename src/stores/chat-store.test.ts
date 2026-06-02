// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChatStore } from './chat-store'
import type { Message, ProcessedFile, ToolCallEvent, ToolCallResultEvent } from '@/lib/types'

beforeEach(() => {
  // finishStream trails a loadConversations() → window.api.conversation.list().
  ;(window as unknown as { api: unknown }).api = {
    conversation: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) }
  }
  useChatStore.setState({
    messages: [],
    isStreaming: true,
    streamingContent: '',
    streamStartedAt: Date.now(),
    runPhase: 'acting',
    toolCalls: [],
    pendingAttachments: []
  })
})

const toolEvent = (over: Partial<ToolCallEvent> = {}): ToolCallEvent =>
  ({
    callId: 'c1',
    serverId: 'internal',
    toolName: 'shell_command',
    args: {},
    startedAt: Date.now(),
    ...over
  }) as ToolCallEvent

const file = (name: string, error?: string): ProcessedFile =>
  ({ name, kind: 'text', content: 'x', error }) as ProcessedFile

describe('chat-store — streaming state', () => {
  it('appendStreamChunk accumulates content', () => {
    useChatStore.getState().appendStreamChunk('Hel')
    useChatStore.getState().appendStreamChunk('lo')
    expect(useChatStore.getState().streamingContent).toBe('Hello')
  })

  it('finishStream appends the message and resets streaming state', () => {
    const msg = { id: 'm1', role: 'assistant', content: 'done' } as Message
    useChatStore.getState().appendStreamChunk('partial')
    useChatStore.getState().finishStream(msg)
    const s = useChatStore.getState()
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0]).toBe(msg)
    expect(s.isStreaming).toBe(false)
    expect(s.streamingContent).toBe('')
    expect(s.runPhase).toBeNull()
  })

  it('streamError clears streaming state without appending a message', () => {
    useChatStore.getState().streamError('boom')
    const s = useChatStore.getState()
    expect(s.isStreaming).toBe(false)
    expect(s.streamingContent).toBe('')
    expect(s.runPhase).toBeNull()
    expect(s.messages).toHaveLength(0)
  })

  it('setRunPhase sets and clears the phase', () => {
    useChatStore.getState().setRunPhase('verifying')
    expect(useChatStore.getState().runPhase).toBe('verifying')
    useChatStore.getState().setRunPhase(null)
    expect(useChatStore.getState().runPhase).toBeNull()
  })
})

describe('chat-store — tool calls', () => {
  it('addToolCall records a running call', () => {
    useChatStore.getState().addToolCall(toolEvent({ callId: 'c1' }))
    const tc = useChatStore.getState().toolCalls
    expect(tc).toHaveLength(1)
    expect(tc[0]).toMatchObject({ callId: 'c1', status: 'running' })
  })

  it('updateToolCall respects the backend terminal status (denied stays denied)', () => {
    useChatStore.getState().addToolCall(toolEvent({ callId: 'c1' }))
    useChatStore
      .getState()
      .updateToolCall({ callId: 'c1', status: 'denied', result: 'no', duration: 5 } as ToolCallResultEvent)
    expect(useChatStore.getState().toolCalls[0]).toMatchObject({ status: 'denied', result: 'no', duration: 5 })
  })

  it('updateToolCall defaults to success when status is omitted', () => {
    useChatStore.getState().addToolCall(toolEvent({ callId: 'c1' }))
    useChatStore.getState().updateToolCall({ callId: 'c1', result: 'ok' } as ToolCallResultEvent)
    expect(useChatStore.getState().toolCalls[0].status).toBe('success')
  })

  it('clearToolCalls empties the list', () => {
    useChatStore.getState().addToolCall(toolEvent())
    useChatStore.getState().clearToolCalls()
    expect(useChatStore.getState().toolCalls).toEqual([])
  })
})

describe('chat-store — attachments', () => {
  it('addAttachments appends and removeAttachment drops by index', () => {
    useChatStore.getState().addAttachments([file('a.txt'), file('b.txt')])
    expect(useChatStore.getState().pendingAttachments.map((f) => f.name)).toEqual(['a.txt', 'b.txt'])
    useChatStore.getState().removeAttachment(0)
    expect(useChatStore.getState().pendingAttachments.map((f) => f.name)).toEqual(['b.txt'])
  })

  it('addAttachments ignores an empty list', () => {
    useChatStore.getState().addAttachments([])
    expect(useChatStore.getState().pendingAttachments).toHaveLength(0)
  })

  it('clearAttachments empties pending attachments', () => {
    useChatStore.getState().addAttachments([file('a.txt')])
    useChatStore.getState().clearAttachments()
    expect(useChatStore.getState().pendingAttachments).toEqual([])
  })
})
