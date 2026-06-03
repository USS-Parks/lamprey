import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Real tmp userData so settings.ts reads/writes a real settings.json. The
// event-log + projects-store layers are forced into their memory fallbacks
// so we don't open a real SQLite db.
const userDataDir = mkdtempSync(join(tmpdir(), 'lamprey-p4-misc-'))

const ipcRegistered: Map<string, (...args: any[]) => any> = new Map()

vi.mock('electron', () => ({
  app: {
    getPath: (which: string) => {
      if (which === 'userData') return userDataDir
      throw new Error(`unexpected getPath("${which}") in test`)
    }
  },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      ipcRegistered.set(channel, handler)
    }
  }
}))

// projects-store relies on getDb. Stub the four mutating fns so we can
// directly observe whether the wrapping emit call fires; we don't need real
// SQLite here because the producers are the unit under test.
vi.mock('./database', () => ({
  getDb: () => ({
    prepare: () => ({
      run: () => ({ changes: 0 }),
      get: () => undefined,
      all: () => []
    })
  })
}))

// keychain + deepseek + providers are imported by settings.ts but the test
// only exercises settings:set. Stub the ones that would otherwise reach a
// real keychain file or network.
vi.mock('./keychain', () => ({
  setKey: vi.fn(),
  deleteKey: vi.fn(),
  isEncryptionAvailable: () => true,
  grantPlaintextConsent: vi.fn(),
  hasPlaintextConsent: () => true
}))
vi.mock('./deepseek', () => ({
  deepseekClient: { resetClient: vi.fn() }
}))

import {
  __forceMemoryFallback,
  __resetEventLog,
  listEvents
} from './event-log'

beforeEach(() => {
  __resetEventLog()
  __forceMemoryFallback()
  ipcRegistered.clear()
  const settingsPath = join(userDataDir, 'settings.json')
  if (existsSync(settingsPath)) rmSync(settingsPath)
})

// ──────────────────── settings.updated ────────────────────

describe('settings:set emits settings.updated with changed key NAMES only', () => {
  it('first set writes settings.json + emits a settings.updated event for the changed keys', async () => {
    const { registerSettingsHandlers } = await import('../ipc/settings')
    registerSettingsHandlers()
    const handler = ipcRegistered.get('settings:set')!
    const before = listEvents({ type: 'settings.updated' }).length
    await handler(undefined, { theme: 'light', fontSize: 16 })
    const after = listEvents({ type: 'settings.updated' })
    expect(after.length).toBe(before + 1)
    const payload = after[after.length - 1].payload as {
      changedKeys: string[]
      sensitiveChanged: string[]
      partialKeys: string[]
    }
    expect(payload.changedKeys).toEqual(expect.arrayContaining(['theme', 'fontSize']))
    expect(payload.sensitiveChanged).toEqual([])
    expect(payload.partialKeys).toEqual(['theme', 'fontSize'])
    // settings.json itself wrote the values, but the event payload must NOT.
    const written = JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf-8'))
    expect(written.theme).toBe('light')
    expect(written.fontSize).toBe(16)
    const json = JSON.stringify(after[after.length - 1].payload)
    expect(json).not.toContain('light')
    expect(json).not.toContain('"16"')
  })

  it('setting a value identical to the existing one emits NO event', async () => {
    const { registerSettingsHandlers } = await import('../ipc/settings')
    registerSettingsHandlers()
    const handler = ipcRegistered.get('settings:set')!
    await handler(undefined, { theme: 'light' })
    const baseline = listEvents({ type: 'settings.updated' }).length
    await handler(undefined, { theme: 'light' })
    expect(listEvents({ type: 'settings.updated' }).length).toBe(baseline)
  })

  it('flags sensitiveChanged when the apiKey settings field moves', async () => {
    const { registerSettingsHandlers } = await import('../ipc/settings')
    registerSettingsHandlers()
    const handler = ipcRegistered.get('settings:set')!
    await handler(undefined, { apiKey: 'sk-newvalue' })
    const events = listEvents({ type: 'settings.updated' })
    const payload = events[events.length - 1].payload as {
      changedKeys: string[]
      sensitiveChanged: string[]
    }
    expect(payload.sensitiveChanged).toContain('apiKey')
    // The value still doesn't appear in the event payload.
    expect(JSON.stringify(payload)).not.toContain('sk-newvalue')
  })
})

// ──────────────────── project.* ────────────────────

describe('projects-store emits project.* events for discrete actions', () => {
  it('createProject emits project.created tagged with projectId', async () => {
    const { createProject } = await import('./projects-store')
    const p = createProject({ name: 'Spike', path: '/tmp/spike' })
    const events = listEvents({ type: 'project.created', projectId: p.id })
    expect(events).toHaveLength(1)
    expect(events[0].projectId).toBe(p.id)
    expect((events[0].payload as { name: string }).name).toBe('Spike')
  })

  it('setProjectArchived emits project.archived with the new flag', async () => {
    const { setProjectArchived } = await import('./projects-store')
    setProjectArchived('proj-X', true)
    setProjectArchived('proj-X', false)
    const events = listEvents({ type: 'project.archived', projectId: 'proj-X', order: 'asc' })
    expect(events.map((e) => (e.payload as { archived: boolean }).archived)).toEqual([
      true,
      false
    ])
  })

  it('setProjectPinned emits project.pinned', async () => {
    const { setProjectPinned } = await import('./projects-store')
    setProjectPinned('proj-Y', true)
    const events = listEvents({ type: 'project.pinned', projectId: 'proj-Y' })
    expect(events).toHaveLength(1)
    expect((events[0].payload as { pinned: boolean }).pinned).toBe(true)
  })

  it('deleteProject emits project.deleted', async () => {
    const { deleteProject } = await import('./projects-store')
    deleteProject('proj-Z')
    const events = listEvents({ type: 'project.deleted', projectId: 'proj-Z' })
    expect(events).toHaveLength(1)
    expect(events[0].projectId).toBe('proj-Z')
  })

  it('renameProject is intentionally silent (noisy bookkeeping, not a spine event)', async () => {
    const { renameProject } = await import('./projects-store')
    renameProject('proj-Q', 'new name')
    const events = listEvents({ projectId: 'proj-Q' })
    expect(events).toHaveLength(0)
  })
})
