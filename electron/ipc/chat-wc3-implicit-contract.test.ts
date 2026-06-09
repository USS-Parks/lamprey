/**
 * WC-3 — Implicit change contract synthesis on first mutating tool call.
 *
 * Verifies that `ensureImplicitContractForFirstMutation` (exported from
 * `chat.ts`) creates an implicit contract for the (conversationId,
 * correlationId) pair when no Plan-mode contract is already active, and
 * does nothing when one is. The cache is per-correlation so the
 * synthesis fires at most once per turn.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('electron app not available in test environment')
    }
  },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => undefined }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

// `chat.ts` imports `convStore.getMessages` from conversation-store; the
// helper falls back to a generic userRequest if the call throws. We stub
// the export so it returns the conversation context we want each test.
const stubMessages = vi.hoisted(() => ({ current: [] as Array<{ role: string; content: string }> }))
vi.mock('../services/conversation-store', () => ({
  getMessages: () => stubMessages.current,
  isPlanModeActive: () => false,
  setPlanModeActive: () => undefined,
  saveMessage: () => undefined
}))

import {
  __forceChangeContractMemoryFallback,
  __resetChangeContractStore,
  createChangeContract,
  listChangeContracts
} from '../services/change-contract-store'
import { __forceMemoryFallback, __resetEventLog } from '../services/event-log'
import {
  __resetImplicitContractCacheForTesting,
  ensureImplicitContractForFirstMutation
} from './chat'

beforeEach(() => {
  __resetChangeContractStore()
  __forceChangeContractMemoryFallback()
  __resetEventLog()
  __forceMemoryFallback()
  __resetImplicitContractCacheForTesting()
  stubMessages.current = []
})

describe('WC-3 ensureImplicitContractForFirstMutation', () => {
  it('synthesizes an implicit contract when none exists for the correlation', () => {
    stubMessages.current = [
      { role: 'user', content: 'Add a footer link to the homepage.' }
    ]
    ensureImplicitContractForFirstMutation({
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      toolName: 'apply_patch',
      args: { path: 'src/Footer.tsx' }
    })
    const contracts = listChangeContracts({
      conversationId: 'conv-1',
      correlationId: 'corr-1'
    })
    expect(contracts.length).toBe(1)
    const c = contracts[0]
    expect(c.implicit).toBe(true)
    expect(c.source).toBe('implicit')
    expect(c.expectedFiles).toEqual(['src/Footer.tsx'])
    expect(c.goal).toContain('footer link')
    expect(c.requiredReceiptKinds).toEqual(['verify'])
  })

  it('does not synthesize a second contract when one is already active', () => {
    createChangeContract({
      conversationId: 'conv-2',
      correlationId: 'corr-2',
      goal: 'Plan-authored',
      source: 'plan_goal',
      implicit: false
    })
    ensureImplicitContractForFirstMutation({
      conversationId: 'conv-2',
      correlationId: 'corr-2',
      toolName: 'apply_patch',
      args: { path: 'src/foo.ts' }
    })
    const contracts = listChangeContracts({
      conversationId: 'conv-2',
      correlationId: 'corr-2'
    })
    expect(contracts.length).toBe(1)
    expect(contracts[0].implicit).toBe(false)
    expect(contracts[0].source).toBe('plan_goal')
  })

  it('only synthesizes once per (conversation, correlation) — cache hit on second call', () => {
    stubMessages.current = [
      { role: 'user', content: 'Refactor the auth module.' }
    ]
    ensureImplicitContractForFirstMutation({
      conversationId: 'conv-3',
      correlationId: 'corr-3',
      toolName: 'apply_patch',
      args: { path: 'electron/services/auth.ts' }
    })
    // Second call — same correlation. Cache must short-circuit; no new
    // contract row appears.
    ensureImplicitContractForFirstMutation({
      conversationId: 'conv-3',
      correlationId: 'corr-3',
      toolName: 'apply_patch',
      args: { path: 'electron/services/auth.ts' }
    })
    const contracts = listChangeContracts({
      conversationId: 'conv-3',
      correlationId: 'corr-3'
    })
    expect(contracts.length).toBe(1)
  })

  it('extracts firstObservedFile from common arg shapes (path, file_path, target)', () => {
    stubMessages.current = [{ role: 'user', content: 'demo' }]

    ensureImplicitContractForFirstMutation({
      conversationId: 'conv-a',
      correlationId: 'corr-a',
      toolName: 'apply_patch',
      args: { file_path: 'src/file_path.ts' }
    })
    __resetImplicitContractCacheForTesting()

    ensureImplicitContractForFirstMutation({
      conversationId: 'conv-b',
      correlationId: 'corr-b',
      toolName: 'apply_patch',
      args: { target: 'src/target.ts' }
    })

    expect(
      listChangeContracts({ conversationId: 'conv-a' })[0].expectedFiles
    ).toEqual(['src/file_path.ts'])
    expect(
      listChangeContracts({ conversationId: 'conv-b' })[0].expectedFiles
    ).toEqual(['src/target.ts'])
  })

  it('falls back to a default user request when no user message exists', () => {
    stubMessages.current = []
    ensureImplicitContractForFirstMutation({
      conversationId: 'conv-x',
      correlationId: 'corr-x',
      toolName: 'shell_command',
      args: {}
    })
    const c = listChangeContracts({ conversationId: 'conv-x' })[0]
    expect(c).toBeDefined()
    expect(c.goal).toContain('Mutating tool call')
    expect(c.goal).toContain('shell_command')
  })
})
