import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// mcp-manager imports electron + keychain at module load. Stub both so the
// singleton constructs under the node test runner.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/lamprey-test' },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('./keychain', () => ({
  getKey: () => undefined,
  setKey: vi.fn(),
  deleteKey: vi.fn()
}))

import { mcpManager } from './mcp-manager'

// MAX_RESTARTS is a module-private constant (= 3). Mirror it here.
const MAX_RESTARTS = 3

// scheduleStdioRestart is private; reach it (and the methods it calls) through
// a structural cast rather than `any`.
interface RestartSeam {
  scheduleStdioRestart: (state: unknown) => void
  cleanupServer: (state: unknown) => Promise<void>
  connectServer: (id: string) => Promise<void>
}
const mgr = mcpManager as unknown as RestartSeam

function connectedStdioState(): {
  config: { id: string; name: string; transport: string; command: string; auth: string; enabled: boolean }
  status: 'connected'
  client: null
  transport: null
  tools: never[]
  restartCount: number
  restarting: boolean
} {
  return {
    config: { id: 's1', name: 'S1', transport: 'stdio', command: 'x', auth: 'none', enabled: true },
    status: 'connected' as const,
    client: null,
    transport: null,
    tools: [],
    restartCount: 0,
    restarting: false
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

// Shadow the methods directly on the singleton (own properties win over the
// prototype) — more robust than spyOn against inherited-method lookups.
const cleanupSpy = vi.fn(async () => {})
const connectSpy = vi.fn(async () => {})
const origCleanup = mgr.cleanupServer
const origConnect = mgr.connectServer

beforeEach(() => {
  cleanupSpy.mockClear()
  connectSpy.mockClear()
  mgr.cleanupServer = cleanupSpy
  mgr.connectServer = connectSpy
})
afterEach(() => {
  mgr.cleanupServer = origCleanup
  mgr.connectServer = origConnect
})

describe('scheduleStdioRestart — BUG-2 (single reconnect on crash)', () => {
  it('coalesces back-to-back onerror + onclose into exactly one reconnect', async () => {
    const state = connectedStdioState()
    // Simulate both crash events scheduling a restart for the same crash.
    mgr.scheduleStdioRestart(state)
    mgr.scheduleStdioRestart(state)
    await flush()
    expect(cleanupSpy).toHaveBeenCalledTimes(1)
    expect(connectSpy).toHaveBeenCalledTimes(1)
    expect(state.restartCount).toBe(1)
  })

  it('a single crash event still triggers exactly one reconnect', async () => {
    const state = connectedStdioState()
    mgr.scheduleStdioRestart(state)
    await flush()
    expect(connectSpy).toHaveBeenCalledTimes(1)
    expect(state.restarting).toBe(false)
  })

  it('clears the restarting flag so a later independent crash can restart again', async () => {
    const state = connectedStdioState()
    mgr.scheduleStdioRestart(state)
    await flush()
    expect(state.restarting).toBe(false)
    mgr.scheduleStdioRestart(state)
    await flush()
    expect(connectSpy).toHaveBeenCalledTimes(2)
    expect(state.restartCount).toBe(2)
  })

  it('stops restarting once MAX_RESTARTS is reached', async () => {
    const state = connectedStdioState()
    state.restartCount = MAX_RESTARTS
    mgr.scheduleStdioRestart(state)
    await flush()
    expect(connectSpy).not.toHaveBeenCalled()
  })
})
