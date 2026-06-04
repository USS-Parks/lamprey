// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { SideChatPanel } from './SideChatPanel'

// BUG-4: the per-conversation subscribe effect must NOT re-run on every stream
// chunk. Before the fix it listed `streamBuf` in its deps, so each chunk tore
// down and rebuilt the subscription. We render the panel, let it subscribe
// once, then fire several chunks and assert the subscription is untouched.

interface SubCbs {
  onChunk?: (e: { conversationId: string; content: string }) => void
  onDone?: (e: { conversationId: string; message: unknown }) => void
  onError?: (e: { conversationId: string; error: string }) => void
}

const unsub = vi.fn()
const subscribe = vi.fn()
let captured: SubCbs = {}

function installApiStub() {
  subscribe.mockImplementation((_id: string, cbs: SubCbs) => {
    captured = cbs
    return unsub
  })
  ;(window as unknown as Record<string, unknown>).api = {
    conversation: {
      get: vi.fn(async () => ({ success: true, data: { id: 'side1' } })),
      getMessages: vi.fn(async () => ({ success: true, data: [] })),
      create: vi.fn(async () => ({ success: true, data: { id: 'side1' } }))
    },
    chat: { subscribe }
  }
}

beforeEach(() => {
  unsub.mockClear()
  subscribe.mockClear()
  captured = {}
  window.localStorage.setItem('lamprey.sidechat.conversationId', 'side1')
  installApiStub()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('SideChatPanel subscription lifecycle — BUG-4', () => {
  it('subscribes exactly once and does not re-subscribe as chunks arrive', async () => {
    render(<SideChatPanel />)

    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1))

    // Drive several stream chunks through the captured handler.
    act(() => {
      captured.onChunk?.({ conversationId: 'side1', content: 'Hello ' })
    })
    act(() => {
      captured.onChunk?.({ conversationId: 'side1', content: 'world' })
    })
    act(() => {
      captured.onChunk?.({ conversationId: 'side1', content: '!' })
    })

    // The subscription must not have been recreated, nor the old one torn down.
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(unsub).not.toHaveBeenCalled()
  })
})
