import { beforeEach, describe, expect, it, vi } from 'vitest'

// IPC handler tests for the Prompt 5 read-only event surface. Uses the same
// `vi.mock('electron')` pattern as Prompts 1–4; forces the event-log into its
// memory fallback so tests don't open a real SQLite db.

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
  __forceMemoryFallback,
  __resetEventLog,
  recordEvent
} from '../services/event-log'
import {
  coerceListFilter,
  coerceTimelineFilter,
  registerEventsHandlers
} from './events'

beforeEach(() => {
  __resetEventLog()
  __forceMemoryFallback()
  ipcRegistered.clear()
  registerEventsHandlers()
})

// ──────────────────── coerceListFilter ────────────────────

describe('coerceListFilter', () => {
  it('returns an empty filter for non-object inputs', () => {
    expect(coerceListFilter(undefined)).toEqual({})
    expect(coerceListFilter(null)).toEqual({})
    expect(coerceListFilter(42)).toEqual({})
    expect(coerceListFilter('hello')).toEqual({})
  })

  it('passes through valid string scope fields', () => {
    const filter = coerceListFilter({
      conversationId: 'conv-1',
      projectId: 'proj-1',
      workspacePath: '/repo',
      correlationId: 'corr-1',
      toolCallId: 'tc-1',
      automationId: 'auto-1'
    })
    expect(filter.conversationId).toBe('conv-1')
    expect(filter.projectId).toBe('proj-1')
    expect(filter.workspacePath).toBe('/repo')
    expect(filter.correlationId).toBe('corr-1')
    expect(filter.toolCallId).toBe('tc-1')
    expect(filter.automationId).toBe('auto-1')
  })

  it('drops ill-typed fields silently instead of failing', () => {
    const filter = coerceListFilter({
      conversationId: 42,
      projectId: { id: 'x' },
      workspacePath: '',
      type: 'not.a.real.event'
    })
    expect(filter.conversationId).toBeUndefined()
    expect(filter.projectId).toBeUndefined()
    expect(filter.workspacePath).toBeUndefined()
    expect(filter.type).toBeUndefined()
  })

  it('accepts a known event-type string and a known severity', () => {
    const filter = coerceListFilter({
      type: 'tool.call.started',
      severity: 'error'
    })
    expect(filter.type).toBe('tool.call.started')
    expect(filter.severity).toBe('error')
  })

  it('filters an array of types down to the valid subset', () => {
    const filter = coerceListFilter({
      type: ['tool.call.started', 'not-a-type', 'agent.stage.completed']
    })
    expect(filter.type).toEqual(['tool.call.started', 'agent.stage.completed'])
  })

  it('drops a type array that contains nothing valid', () => {
    const filter = coerceListFilter({ type: ['not-a-type', 42, null] })
    expect(filter.type).toBeUndefined()
  })

  it('clamps a huge limit to MAX_LIST_LIMIT, rejects non-positive', () => {
    const big = coerceListFilter({ limit: 1_000_000 })
    expect(big.limit).toBeLessThanOrEqual(1000)
    expect(coerceListFilter({ limit: -5 }).limit).toBeUndefined()
    expect(coerceListFilter({ limit: 0 }).limit).toBeUndefined()
    expect(coerceListFilter({ limit: 1.7 }).limit).toBe(1)
  })

  it('accepts asc and desc orders, rejects garbage', () => {
    expect(coerceListFilter({ order: 'asc' }).order).toBe('asc')
    expect(coerceListFilter({ order: 'desc' }).order).toBe('desc')
    expect(coerceListFilter({ order: 'random' }).order).toBeUndefined()
  })
})

// ──────────────────── coerceTimelineFilter ────────────────────

describe('coerceTimelineFilter', () => {
  it('rejects an empty filter (no scope fields)', () => {
    const result = coerceTimelineFilter({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('exactly one')
  })

  it('rejects a filter with only an unrelated field', () => {
    const result = coerceTimelineFilter({ limit: 100 })
    expect(result.ok).toBe(false)
  })

  it('accepts a single scope', () => {
    const result = coerceTimelineFilter({ correlationId: 'corr-1' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.filter.correlationId).toBe('corr-1')
  })

  it('clamps limit on the timeline filter too', () => {
    const result = coerceTimelineFilter({
      conversationId: 'c',
      limit: 999_999
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.filter.limit).toBeLessThanOrEqual(1000)
  })
})

// ──────────────────── handler end-to-end ────────────────────

describe('events IPC handlers (end-to-end)', () => {
  it('events:list returns recorded events filtered by scope', async () => {
    const cid = 'corr-list-1'
    recordEvent({
      type: 'tool.call.started',
      actorKind: 'model',
      conversationId: 'conv-A',
      correlationId: cid,
      payload: { toolId: 'shell_command' }
    })
    recordEvent({
      type: 'tool.call.completed',
      actorKind: 'tool',
      conversationId: 'conv-A',
      correlationId: cid,
      payload: { durationMs: 12 }
    })
    const handler = ipcRegistered.get('events:list')!
    const res = await handler(undefined, { conversationId: 'conv-A' })
    expect(res.success).toBe(true)
    expect(Array.isArray(res.data)).toBe(true)
    expect(res.data.length).toBe(2)
    // Both events come back; the relative order of two events stamped in the
    // same millisecond is not guaranteed by Date.now() resolution, so we
    // assert membership rather than a specific [0] position.
    const types = res.data.map((e: { type: string }) => e.type).sort()
    expect(types).toEqual(['tool.call.completed', 'tool.call.started'])
  })

  it('events:get returns a single event by id, or a "not found" error', async () => {
    const rec = recordEvent({
      type: 'workspace.changed',
      actorKind: 'user',
      payload: { action: 'set', to: '/tmp' }
    })
    const handler = ipcRegistered.get('events:get')!
    const hit = await handler(undefined, rec.id)
    expect(hit.success).toBe(true)
    expect(hit.data.id).toBe(rec.id)
    const miss = await handler(undefined, 'does-not-exist')
    expect(miss.success).toBe(false)
    expect(miss.error).toContain('not found')
  })

  it('events:get rejects an empty/non-string id', async () => {
    const handler = ipcRegistered.get('events:get')!
    const a = await handler(undefined, '')
    expect(a.success).toBe(false)
    const b = await handler(undefined, undefined)
    expect(b.success).toBe(false)
    const c = await handler(undefined, 42)
    expect(c.success).toBe(false)
  })

  it('events:timeline returns ascending events for a single scope', async () => {
    recordEvent({
      type: 'agent.stage.started',
      actorKind: 'agent',
      conversationId: 'conv-T',
      correlationId: 'corr-T',
      payload: { role: 'planner' }
    })
    recordEvent({
      type: 'agent.stage.completed',
      actorKind: 'agent',
      conversationId: 'conv-T',
      correlationId: 'corr-T',
      payload: { role: 'planner' }
    })
    const handler = ipcRegistered.get('events:timeline')!
    const res = await handler(undefined, { correlationId: 'corr-T' })
    expect(res.success).toBe(true)
    expect(res.data.map((e: { type: string }) => e.type)).toEqual([
      'agent.stage.started',
      'agent.stage.completed'
    ])
  })

  it('events:timeline rejects a no-scope filter with the validation error message', async () => {
    const handler = ipcRegistered.get('events:timeline')!
    const res = await handler(undefined, { limit: 100 })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/exactly one/i)
  })

  it('renderer cannot write events — there is no events:record handler', () => {
    expect(ipcRegistered.has('events:record')).toBe(false)
    expect(ipcRegistered.has('events:write')).toBe(false)
    expect(ipcRegistered.has('events:insert')).toBe(false)
  })
})
