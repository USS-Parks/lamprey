import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Tests for the prototype-pollution + non-object defence added to
// settings:set. Mocks electron so the handler can run headlessly and
// captures the registered handler so we can call it directly.

const userDataDir = mkdtempSync(join(tmpdir(), 'lamprey-settings-sanit-'))
const ipcRegistered: Map<string, (...args: any[]) => any> = new Map()

vi.mock('electron', () => ({
  app: {
    getPath: (which: string) => {
      if (which === 'userData') return userDataDir
      throw new Error(`unexpected getPath("${which}")`)
    }
  },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      ipcRegistered.set(channel, handler)
    }
  }
}))

vi.mock('../services/database', () => ({
  getDb: () => ({
    prepare: () => ({
      run: () => ({ changes: 0 }),
      get: () => undefined,
      all: () => []
    })
  })
}))

vi.mock('../services/keychain', () => ({
  setKey: vi.fn(),
  deleteKey: vi.fn(),
  isEncryptionAvailable: () => true,
  grantPlaintextConsent: vi.fn(),
  hasPlaintextConsent: () => true
}))
vi.mock('../services/deepseek', () => ({
  deepseekClient: { resetClient: vi.fn() }
}))

import {
  __forceMemoryFallback,
  __resetEventLog
} from '../services/event-log'

beforeEach(() => {
  __resetEventLog()
  __forceMemoryFallback()
  ipcRegistered.clear()
  const settingsPath = join(userDataDir, 'settings.json')
  if (existsSync(settingsPath)) rmSync(settingsPath)
})

describe('settings:set sanitizer', () => {
  it('non-object input is treated as an empty partial (no-op merge)', async () => {
    const { registerSettingsHandlers } = await import('./settings')
    registerSettingsHandlers()
    const handler = ipcRegistered.get('settings:set')!
    // Pass a string instead of an object.
    const res = await handler(undefined, 'not an object')
    expect(res.success).toBe(true)
    // settings.json should now contain only the defaults (no string leaked in).
    const written = JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf-8'))
    expect(typeof written).toBe('object')
    expect(written).not.toEqual('not an object')
  })

  it('null input is treated as empty', async () => {
    const { registerSettingsHandlers } = await import('./settings')
    registerSettingsHandlers()
    const handler = ipcRegistered.get('settings:set')!
    const res = await handler(undefined, null)
    expect(res.success).toBe(true)
  })

  it('rejects __proto__ pollution attempts (key is dropped from the merge)', async () => {
    const { registerSettingsHandlers } = await import('./settings')
    registerSettingsHandlers()
    const handler = ipcRegistered.get('settings:set')!
    // Use a function-call shape that won't trigger native __proto__ semantics
    // but tests our defence against the literal key name.
    const malicious = JSON.parse(
      '{"__proto__": {"polluted": true}, "theme": "dark"}'
    )
    await handler(undefined, malicious)
    // The settings file must NOT contain __proto__ as an own property.
    const written = JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf-8'))
    expect(Object.prototype.hasOwnProperty.call(written, '__proto__')).toBe(false)
    // Object.prototype must not have been polluted.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    // Legitimate key DID land.
    expect(written.theme).toBe('dark')
  })

  it('rejects `constructor` and `prototype` keys', async () => {
    const { registerSettingsHandlers } = await import('./settings')
    registerSettingsHandlers()
    const handler = ipcRegistered.get('settings:set')!
    await handler(undefined, {
      constructor: 'evil',
      prototype: 'evil',
      theme: 'light'
    })
    const written = JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf-8'))
    expect(written.constructor).not.toBe('evil')
    expect(written.prototype).not.toBe('evil')
    expect(written.theme).toBe('light')
  })

  it('array input is treated as empty (not spread as numeric-keyed object)', async () => {
    const { registerSettingsHandlers } = await import('./settings')
    registerSettingsHandlers()
    const handler = ipcRegistered.get('settings:set')!
    await handler(undefined, ['a', 'b', 'c'])
    const written = JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf-8'))
    expect(written[0]).toBeUndefined()
    expect(written[1]).toBeUndefined()
  })

  it('strips NESTED __proto__ inside a deep object', async () => {
    const { registerSettingsHandlers } = await import('./settings')
    registerSettingsHandlers()
    const handler = ipcRegistered.get('settings:set')!
    // JSON.parse preserves __proto__ as an own property — the recursion
    // contract is that we strip it at every depth.
    const malicious = JSON.parse(
      '{"modelConfig": {"deepseek-v4-pro": {"__proto__": {"polluted": "yes"}}}}'
    )
    await handler(undefined, malicious)
    const written = JSON.parse(
      readFileSync(join(userDataDir, 'settings.json'), 'utf-8')
    )
    expect(
      Object.prototype.hasOwnProperty.call(
        written.modelConfig['deepseek-v4-pro'],
        '__proto__'
      )
    ).toBe(false)
    // The legitimate nesting structure is preserved.
    expect(written.modelConfig['deepseek-v4-pro']).toBeDefined()
  })

  it('strips __proto__ inside an array element', async () => {
    const { registerSettingsHandlers } = await import('./settings')
    registerSettingsHandlers()
    const handler = ipcRegistered.get('settings:set')!
    const malicious = JSON.parse(
      '{"customModels": [{"__proto__": {"bad": true}, "id": "x"}]}'
    )
    await handler(undefined, malicious)
    const written = JSON.parse(
      readFileSync(join(userDataDir, 'settings.json'), 'utf-8')
    )
    const first = written.customModels?.[0]
    expect(first).toBeDefined()
    expect(Object.prototype.hasOwnProperty.call(first, '__proto__')).toBe(false)
    expect(first.id).toBe('x')
  })

  it('caps recursion depth so a hostile deep object cannot OOM', async () => {
    const { registerSettingsHandlers } = await import('./settings')
    registerSettingsHandlers()
    const handler = ipcRegistered.get('settings:set')!
    // Build a 50-deep nested object — well past the depth cap (16).
    let deep: Record<string, unknown> = { leaf: 'value' }
    for (let i = 0; i < 50; i++) deep = { nested: deep }
    const res = await handler(undefined, { wrapper: deep })
    expect(res.success).toBe(true)
  })
})
