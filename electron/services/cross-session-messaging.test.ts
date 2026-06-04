import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: {
    getPath: () => {
      throw new Error('electron app not available in tests')
    }
  }
}))

vi.mock('./conversation-store', () => ({
  getConversation: (id: string) =>
    id === 'target'
      ? {
          id,
          title: 'Target',
          model: 'deepseek-chat',
          createdAt: 1,
          updatedAt: 2,
          messageCount: 0
        }
      : null,
  listConversations: () => [
    {
      id: 'target',
      title: 'Target',
      model: 'deepseek-chat',
      updatedAt: 2,
      archived: false
    }
  ]
}))

import {
  __forceAsyncEventMemoryFallback,
  __resetAsyncEventBridge,
  listPendingAsyncEvents
} from './async-event-bridge'
import { listActiveSessions, sendSessionMessage } from './cross-session-messaging'

beforeEach(() => {
  __resetAsyncEventBridge()
  __forceAsyncEventMemoryFallback()
})

describe('G4 cross-session messaging', () => {
  it('lists active sessions from unarchived conversations', () => {
    expect(listActiveSessions()).toEqual([
      {
        id: 'target',
        title: 'Target',
        model: 'deepseek-chat',
        updatedAt: 2
      }
    ])
  })

  it('enqueues incoming messages through the async-event bridge', () => {
    const sent = sendSessionMessage({
      targetSessionId: 'target',
      fromSessionId: 'source',
      body: 'The workflow finished.'
    })

    expect(sent.targetSessionId).toBe('target')
    expect(sent.fromSessionId).toBe('source')
    const pending = listPendingAsyncEvents('target')
    expect(pending).toHaveLength(1)
    expect(pending[0].kind).toBe('sessions:incoming-message')
    expect(pending[0].payload.body).toBe('The workflow finished.')
  })
})
