import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcRegistered: Map<string, (...args: any[]) => any> = new Map()

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('electron app not available in test environment')
    }
  },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      ipcRegistered.set(channel, handler)
    }
  }
}))

import {
  __forceMemoryFallback as forceEventMemory,
  __resetEventLog,
  listEvents
} from '../services/event-log'
import {
  __forceMemoryFallback as forceCollectionMemory,
  __resetCollectionStore
} from '../services/rag/store'
import { registerRagHandlers } from './rag'

beforeEach(() => {
  __resetEventLog()
  forceEventMemory()
  __resetCollectionStore()
  forceCollectionMemory()
  ipcRegistered.clear()
  registerRagHandlers()
})

// ──────────────────── handler registration ────────────────────

describe('rag IPC handler registration', () => {
  it('registers the R1 collection + status surface', () => {
    expect(ipcRegistered.has('rag:status')).toBe(true)
    expect(ipcRegistered.has('rag:collection:list')).toBe(true)
    expect(ipcRegistered.has('rag:collection:create')).toBe(true)
    expect(ipcRegistered.has('rag:collection:update')).toBe(true)
    expect(ipcRegistered.has('rag:collection:delete')).toBe(true)
  })

  it('registers the R2 embedder surface (catalog / active / setActive)', () => {
    expect(ipcRegistered.has('rag:embedder:catalog')).toBe(true)
    expect(ipcRegistered.has('rag:embedder:active')).toBe(true)
    expect(ipcRegistered.has('rag:embedder:setActive')).toBe(true)
    // `embed` is intentionally NOT exposed — only main-process callers
    // touch the embed function directly. Pin that absence here.
    expect(ipcRegistered.has('rag:embedder:embed')).toBe(false)
  })

  it('registers the R5 document surface', () => {
    expect(ipcRegistered.has('rag:document:list')).toBe(true)
    expect(ipcRegistered.has('rag:document:ingest')).toBe(true)
    expect(ipcRegistered.has('rag:document:reingest')).toBe(true)
    expect(ipcRegistered.has('rag:document:delete')).toBe(true)
    expect(ipcRegistered.has('rag:document:cancel')).toBe(true)
  })

  it('registers the R7 query + R11 attachment + R12 chunk surfaces', () => {
    expect(ipcRegistered.has('rag:query:run')).toBe(true)
    expect(ipcRegistered.has('rag:attachments:list')).toBe(true)
    expect(ipcRegistered.has('rag:attachments:add')).toBe(true)
    expect(ipcRegistered.has('rag:attachments:remove')).toBe(true)
    expect(ipcRegistered.has('rag:chunk:get')).toBe(true)
  })
})

// ──────────────────── status probe ────────────────────

describe('rag:status', () => {
  it('returns a vecAvailable flag', async () => {
    const res = await ipcRegistered.get('rag:status')!()
    expect(res.success).toBe(true)
    // In the headless test env sqlite-vec is never loaded (vitest can't
    // load native modules); the flag must be a deterministic boolean.
    expect(typeof res.data.vecAvailable).toBe('boolean')
  })
})

// ──────────────────── collection CRUD via IPC ────────────────────

describe('rag:collection:* IPC roundtrip', () => {
  it('create roundtrip + emits rag.collection.created', async () => {
    const res = await ipcRegistered.get('rag:collection:create')!(undefined, {
      name: 'Smoke',
      embedderId: 'bge-small-en-v1.5',
      projectId: 'proj-A'
    })
    expect(res.success).toBe(true)
    const created = res.data
    expect(created.id).toMatch(/[0-9a-f-]{36}/)
    expect(created.name).toBe('Smoke')

    const events = listEvents({ type: 'rag.collection.created' })
    expect(events).toHaveLength(1)
    expect(events[0].entityId).toBe(created.id)
    expect(events[0].projectId).toBe('proj-A')
    expect((events[0].payload as { name: string }).name).toBe('Smoke')
  })

  it('create rejects bad input and does NOT emit an event', async () => {
    const res = await ipcRegistered.get('rag:collection:create')!(undefined, {
      name: '',
      embedderId: 'x'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/name/i)
    expect(listEvents({ type: 'rag.collection.created' })).toHaveLength(0)
  })

  it('list returns the seeded collections', async () => {
    await ipcRegistered.get('rag:collection:create')!(undefined, {
      name: 'A',
      embedderId: 'e'
    })
    await ipcRegistered.get('rag:collection:create')!(undefined, {
      name: 'B',
      embedderId: 'e'
    })
    const res = await ipcRegistered.get('rag:collection:list')!()
    expect(res.success).toBe(true)
    expect(res.data).toHaveLength(2)
  })

  it('update patches the row and emits rag.collection.updated', async () => {
    const create = await ipcRegistered.get('rag:collection:create')!(undefined, {
      name: 'Original',
      embedderId: 'e'
    })
    const id = create.data.id
    const baselineUpdated = listEvents({ type: 'rag.collection.updated' }).length
    const res = await ipcRegistered.get('rag:collection:update')!(undefined, id, {
      name: 'Renamed'
    })
    expect(res.success).toBe(true)
    expect(res.data.name).toBe('Renamed')
    const updateEvents = listEvents({ type: 'rag.collection.updated' })
    expect(updateEvents.length).toBe(baselineUpdated + 1)
  })

  it('update with missing id returns an error envelope', async () => {
    const res = await ipcRegistered.get('rag:collection:update')!(undefined, '', {
      name: 'x'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/id is required/i)
  })

  it('delete removes the row, returns true, and emits rag.collection.deleted with the prior name', async () => {
    const create = await ipcRegistered.get('rag:collection:create')!(undefined, {
      name: 'Doomed',
      embedderId: 'e'
    })
    const id = create.data.id
    const res = await ipcRegistered.get('rag:collection:delete')!(undefined, id)
    expect(res.success).toBe(true)
    expect(res.data).toBe(true)
    const deletes = listEvents({ type: 'rag.collection.deleted' })
    expect(deletes).toHaveLength(1)
    // The pre-delete name is captured in the payload — the timeline reader
    // can answer "what was the collection the user removed" without
    // restoring it from a backup.
    expect((deletes[0].payload as { name: string }).name).toBe('Doomed')
  })

  it('delete on an unknown id returns success:true data:false and emits no event', async () => {
    const res = await ipcRegistered.get('rag:collection:delete')!(
      undefined,
      'phantom'
    )
    expect(res.success).toBe(true)
    expect(res.data).toBe(false)
    expect(listEvents({ type: 'rag.collection.deleted' })).toHaveLength(0)
  })
})
