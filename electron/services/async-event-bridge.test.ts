import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: {
    getPath: () => {
      throw new Error('electron app not available in tests')
    }
  }
}))

import {
  __forceAsyncEventMemoryFallback,
  __resetAsyncEventBridge,
  buildTaskNotificationsBlock,
  drainAsyncEventsForPrompt,
  enqueueAgentRunNotification,
  enqueueAsyncEvent,
  listPendingAsyncEvents
} from './async-event-bridge'

beforeEach(() => {
  __resetAsyncEventBridge()
  __forceAsyncEventMemoryFallback()
})

describe('async event bridge', () => {
  it('queues and drains pending events once per conversation', () => {
    enqueueAsyncEvent({
      conversationId: 'conv-a',
      kind: 'tasks:spawn-completed',
      payload: { title: 'Child task ready', body: 'Open conv-b' },
      createdAt: 100
    })
    enqueueAsyncEvent({
      conversationId: 'conv-b',
      kind: 'sessions:incoming-message',
      payload: { title: 'Other' },
      createdAt: 200
    })

    expect(listPendingAsyncEvents('conv-a')).toHaveLength(1)
    const drained = drainAsyncEventsForPrompt('conv-a', 20, 300)
    expect(drained).toHaveLength(1)
    expect(drained[0].deliveredAt).toBe(300)
    expect(listPendingAsyncEvents('conv-a')).toEqual([])
    expect(listPendingAsyncEvents('conv-b')).toHaveLength(1)
  })

  it('renders a task-notifications block for model context', () => {
    const row = enqueueAsyncEvent({
      conversationId: 'conv-a',
      kind: 'agent:run:notify',
      payload: { label: 'Explore docs', resultText: 'Found the missing API in src/a.ts' },
      createdAt: 100
    })
    const block = buildTaskNotificationsBlock([row])
    expect(block).toContain('<task-notifications>')
    expect(block).toContain('[agent:run:notify] Explore docs')
    expect(block).toContain('Found the missing API')
    expect(block).toContain('</task-notifications>')
  })

  it('turns terminal agent notifications into queued async events', () => {
    const skipped = enqueueAgentRunNotification({
      runId: 'r0',
      agentType: 'Explore',
      label: 'still running',
      parentConvId: 'conv-a',
      status: 'running',
      startedAt: 100,
      background: true
    })
    expect(skipped).toBeNull()

    const row = enqueueAgentRunNotification({
      runId: 'r1',
      agentType: 'Explore',
      label: 'done agent',
      parentConvId: 'conv-a',
      status: 'done',
      startedAt: 100,
      finishedAt: 200,
      resultText: 'done',
      background: true
    })
    expect(row?.kind).toBe('agent:run:notify')
    expect(listPendingAsyncEvents('conv-a')).toHaveLength(1)
  })
})
