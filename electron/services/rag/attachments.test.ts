import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('electron app not available in test environment')
    }
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

import {
  __forceMemoryFallback,
  __resetCollectionStore,
  addAttachment,
  listAttachments,
  removeAttachment
} from './store'

beforeEach(() => {
  __resetCollectionStore()
  __forceMemoryFallback()
})

describe('addAttachment validation', () => {
  it('rejects missing conversationId', () => {
    expect(() =>
      addAttachment({ conversationId: '', collectionId: 'c1' })
    ).toThrow(/conversationId is required/i)
  })

  it('rejects missing both collectionId and documentId', () => {
    expect(() => addAttachment({ conversationId: 'conv-A' })).toThrow(
      /collectionId or documentId/i
    )
  })

  it('rejects passing BOTH collectionId and documentId', () => {
    expect(() =>
      addAttachment({
        conversationId: 'conv-A',
        collectionId: 'c1',
        documentId: 'd1'
      })
    ).toThrow(/exactly one/i)
  })
})

describe('add / list / remove roundtrip', () => {
  it('add a collection attachment, list it back', () => {
    addAttachment({ conversationId: 'conv-A', collectionId: 'col-1' })
    const list = listAttachments('conv-A')
    expect(list).toHaveLength(1)
    expect(list[0].collectionId).toBe('col-1')
    expect(list[0].documentId).toBeUndefined()
  })

  it('add a document attachment alongside a collection attachment', () => {
    addAttachment({ conversationId: 'conv-A', collectionId: 'col-1' })
    addAttachment({ conversationId: 'conv-A', documentId: 'doc-X' })
    const list = listAttachments('conv-A')
    expect(list).toHaveLength(2)
  })

  it('list scopes results to the requested conversation', () => {
    addAttachment({ conversationId: 'conv-A', collectionId: 'col-1' })
    addAttachment({ conversationId: 'conv-B', collectionId: 'col-2' })
    expect(listAttachments('conv-A')).toHaveLength(1)
    expect(listAttachments('conv-A')[0].collectionId).toBe('col-1')
    expect(listAttachments('conv-B')).toHaveLength(1)
  })

  it('add of the same attachment twice → still one row, updated attached_at', async () => {
    addAttachment({ conversationId: 'conv-A', collectionId: 'col-1' })
    const firstAt = listAttachments('conv-A')[0].attachedAt
    await new Promise((r) => setTimeout(r, 2))
    addAttachment({ conversationId: 'conv-A', collectionId: 'col-1' })
    const list = listAttachments('conv-A')
    expect(list).toHaveLength(1)
    expect(list[0].attachedAt).toBeGreaterThanOrEqual(firstAt)
  })

  it('remove returns true on hit, false on miss', () => {
    addAttachment({ conversationId: 'conv-A', collectionId: 'col-1' })
    expect(
      removeAttachment({ conversationId: 'conv-A', collectionId: 'col-1' })
    ).toBe(true)
    expect(listAttachments('conv-A')).toEqual([])
    expect(
      removeAttachment({ conversationId: 'conv-A', collectionId: 'col-1' })
    ).toBe(false)
  })
})
