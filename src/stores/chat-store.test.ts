// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from './chat-store'
import type { Message, ToolCallEvent, ToolCallResultEvent } from '@/lib/types'

// finishStream calls loadConversations() fire-and-forget, which reads
// window.api.conversation.list. Stub it so no unhandled rejection escapes.
const list = vi.fn()
function installApiStub() {
  ;(window as unknown as Record<string, unknown>).api = {
    conversation: { list }
  }
}

const initial = useChatStore.getInitialState()

function userMsg(id: string, content: string): Message {
  return { id, role: 'user', content, timestamp: Date.now(), conversationId: 'conv1' }
}
function assistantMsg(id: string, content: string): Message {
  return { id, role: 'assistant', content, timestamp: Date.now(), conversationId: 'conv1' }
}
function toolEvent(callId: string, toolName: string): ToolCallEvent {
  return {
    callId,
    conversationId: 'conv1',
    serverId: 's1',
    toolName,
    args: {},
    startedAt: Date.now()
  }
}

beforeEach(() => {
  list.mockReset().mockResolvedValue({ success: false, error: 'noop' })
  installApiStub()
  useChatStore.setState(initial, true)
})

describe('useChatStore streaming transitions', () => {
  it('appendStreamChunk concatenates onto streamingContent', () => {
    useChatStore.getState().appendStreamChunk('Hello ')
    useChatStore.getState().appendStreamChunk('world')
    expect(useChatStore.getState().streamingContent).toBe('Hello world')
  })

  it('finishStream appends the message and clears streaming state', () => {
    useChatStore.setState({ isStreaming: true, streamingContent: 'partial', streamStartedAt: 1 })
    const msg = assistantMsg('m1', 'done')
    useChatStore.getState().finishStream(msg)
    const s = useChatStore.getState()
    expect(s.messages.at(-1)).toEqual(msg)
    expect(s.isStreaming).toBe(false)
    expect(s.streamingContent).toBe('')
    expect(s.streamStartedAt).toBeNull()
    expect(s.runPhase).toBeNull()
  })

  it('streamError clears streaming state without appending a message', () => {
    useChatStore.setState({ isStreaming: true, streamingContent: 'x', streamStartedAt: 2 })
    useChatStore.getState().streamError('network down')
    const s = useChatStore.getState()
    expect(s.isStreaming).toBe(false)
    expect(s.streamingContent).toBe('')
    expect(s.messages).toHaveLength(0)
  })
})

describe('useChatStore tool-call lifecycle', () => {
  it('addToolCall starts a running card; updateToolCall resolves it', () => {
    const ev = toolEvent('c1', 'shell_command')
    ev.args = { cmd: 'ls' }
    useChatStore.getState().addToolCall(ev)
    expect(useChatStore.getState().toolCalls).toHaveLength(1)
    expect(useChatStore.getState().toolCalls[0].status).toBe('running')

    const res: ToolCallResultEvent = {
      callId: 'c1',
      conversationId: 'conv1',
      status: 'success',
      result: 'file.txt',
      duration: 42
    }
    useChatStore.getState().updateToolCall(res)
    const tc = useChatStore.getState().toolCalls[0]
    expect(tc.status).toBe('success')
    expect(tc.result).toBe('file.txt')
    expect(tc.duration).toBe(42)
  })

  it('updateToolCall respects a terminal error status (not hard-coded success)', () => {
    useChatStore.getState().addToolCall(toolEvent('c2', 'apply_patch'))
    useChatStore.getState().updateToolCall({
      callId: 'c2',
      conversationId: 'conv1',
      status: 'error',
      result: 'denied',
      duration: 0
    })
    expect(useChatStore.getState().toolCalls[0].status).toBe('error')
  })

  it('clearToolCalls empties the list', () => {
    useChatStore.getState().addToolCall(toolEvent('c3', 't'))
    useChatStore.getState().clearToolCalls()
    expect(useChatStore.getState().toolCalls).toHaveLength(0)
  })
})

describe('useChatStore.getRecentUserPrompts', () => {
  it('returns user prompts newest-first, skipping assistant turns', () => {
    useChatStore.setState({
      messages: [
        userMsg('1', 'first'),
        assistantMsg('2', 'reply'),
        userMsg('3', 'second')
      ]
    })
    expect(useChatStore.getState().getRecentUserPrompts()).toEqual(['second', 'first'])
  })
})
