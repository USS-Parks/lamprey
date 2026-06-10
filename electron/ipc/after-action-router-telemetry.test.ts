// SP-8 (Sweet Spot Phase, 2026-06-10) — D6 regression lock. CR-3 documented
// the router-telemetry ring buffer as "surfaced via IPC for the /debug view";
// the 2026-06-10 audit found NO handler existed. This suite locks the
// `after-action:routerTelemetry` channel to the buffer for real.

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
  recordRouterDecision,
  clearRouterTelemetry
} from '../services/router-telemetry'
import { registerAfterActionHandlers } from './after-action'

beforeEach(() => {
  clearRouterTelemetry()
  ipcRegistered.clear()
  registerAfterActionHandlers()
})

describe('after-action:routerTelemetry IPC (SP-8 / D6)', () => {
  it('the channel is registered', () => {
    expect(ipcRegistered.has('after-action:routerTelemetry')).toBe(true)
  })

  it('returns the buffered decisions, oldest → newest', async () => {
    recordRouterDecision({
      promptText: 'fix the typo in README',
      route: 'single',
      matchedRule: 'default_single',
      reason: 'short, single-deliverable ask',
      conversationId: 'c1'
    })
    recordRouterDecision({
      promptText: 'refactor the chat store across every consumer',
      route: 'multi',
      matchedRule: 'multi_file_phrase',
      reason: 'multi-file phrase',
      conversationId: 'c1'
    })
    const handler = ipcRegistered.get('after-action:routerTelemetry')!
    const result = await handler({}, undefined)
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(2)
    expect(result.data[0].matchedRule).toBe('default_single')
    expect(result.data[1].route).toBe('multi')
  })

  it('filters by conversationId when one is supplied', async () => {
    recordRouterDecision({
      promptText: 'a',
      route: 'single',
      matchedRule: 'default_single',
      reason: 'r',
      conversationId: 'c1'
    })
    recordRouterDecision({
      promptText: 'b',
      route: 'single',
      matchedRule: 'default_single',
      reason: 'r',
      conversationId: 'c2'
    })
    const handler = ipcRegistered.get('after-action:routerTelemetry')!
    const result = await handler({}, 'c2')
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].conversationId).toBe('c2')
  })

  it('returns an empty array when nothing has been recorded', async () => {
    const handler = ipcRegistered.get('after-action:routerTelemetry')!
    const result = await handler({}, undefined)
    expect(result.success).toBe(true)
    expect(result.data).toEqual([])
  })
})
