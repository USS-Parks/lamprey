import { describe, it, expect, beforeEach, vi } from 'vitest'

// Force getDb() to throw so the event log engages its in-memory fallback.
// We exercise the public API through that layer — the DB path is the same
// code shape and is covered by runtime smoke.
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('electron app not available in test environment')
    }
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

import {
  EVENT_TYPES,
  PAYLOAD_BYTE_CAP,
  __forceMemoryFallback,
  __resetEventLog,
  getEvent,
  listEvents,
  listTimeline,
  recordEvent,
  recordError,
  recordInfo,
  recordWarning,
  redactPayload,
  serializePayload
} from './event-log'

beforeEach(() => {
  __resetEventLog()
  __forceMemoryFallback()
})

// ──────────────────── redactPayload ────────────────────

describe('redactPayload', () => {
  it('passes plain metadata through unchanged', () => {
    const input = { provider: 'deepseek', model: 'v4-pro', durationMs: 142 }
    const { value, redacted } = redactPayload(input)
    expect(redacted).toBe(false)
    expect(value).toEqual(input)
  })

  it('redacts values under credential-looking keys', () => {
    const { value, redacted } = redactPayload({
      api_key: 'sk-abc123',
      apiKey: 'sk-def456',
      Authorization: 'Bearer xyz',
      cookie: 'sid=...',
      provider: 'deepseek'
    })
    expect(redacted).toBe(true)
    expect(value).toEqual({
      api_key: '[redacted]',
      apiKey: '[redacted]',
      Authorization: '[redacted]',
      cookie: '[redacted]',
      provider: 'deepseek'
    })
  })

  it('recurses into nested objects and arrays', () => {
    const { value, redacted } = redactPayload({
      headers: { authorization: 'Bearer x', 'x-trace-id': 'abc' },
      items: [
        { secret: 's1', name: 'item-1' },
        { token: 't', count: 2 }
      ]
    })
    expect(redacted).toBe(true)
    expect(value).toEqual({
      headers: { authorization: '[redacted]', 'x-trace-id': 'abc' },
      items: [
        { secret: '[redacted]', name: 'item-1' },
        { token: '[redacted]', count: 2 }
      ]
    })
  })

  it('handles self-referential payloads without exploding', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic.self = cyclic
    const { value, redacted } = redactPayload(cyclic)
    expect(redacted).toBe(true)
    expect((value as { name: string }).name).toBe('loop')
    expect((value as { self: string }).self).toBe('[cycle]')
  })
})

// ──────────────────── serializePayload ────────────────────

describe('serializePayload', () => {
  it('returns metadata redaction for clean payloads', () => {
    const result = serializePayload({ a: 1 })
    expect(result.redaction).toBe('metadata')
    expect(JSON.parse(result.json)).toEqual({ a: 1 })
  })

  it('flips to redacted when sensitive keys are stripped', () => {
    const result = serializePayload({ secret: 'x', provider: 'y' })
    expect(result.redaction).toBe('redacted')
    expect(JSON.parse(result.json)).toEqual({
      secret: '[redacted]',
      provider: 'y'
    })
  })

  it('preserves a caller-declared "preview" label when nothing else is sensitive', () => {
    const result = serializePayload({ preview: 'first 100 chars…' }, 'preview')
    expect(result.redaction).toBe('preview')
  })

  it('caps payloads larger than PAYLOAD_BYTE_CAP into a truncation envelope', () => {
    const big = { blob: 'x'.repeat(PAYLOAD_BYTE_CAP + 1024) }
    const result = serializePayload(big)
    expect(result.redaction).toBe('redacted')
    const parsed = JSON.parse(result.json)
    expect(parsed.truncated).toBe(true)
    expect(parsed.originalBytes).toBeGreaterThan(PAYLOAD_BYTE_CAP)
    expect(parsed.cap).toBe(PAYLOAD_BYTE_CAP)
  })
})

// ──────────────────── recordEvent / getEvent ────────────────────

describe('recordEvent + getEvent', () => {
  it('records and retrieves an event with generated id + timestamp', () => {
    const record = recordEvent({
      type: 'workspace.changed',
      actorKind: 'user',
      payload: { from: '/old', to: '/new' }
    })
    expect(record.id).toMatch(/[0-9a-f-]{36}/)
    expect(record.createdAt).toBeGreaterThan(0)
    expect(record.severity).toBe('info')
    expect(record.redaction).toBe('metadata')

    const fetched = getEvent(record.id)
    expect(fetched).not.toBeNull()
    expect(fetched?.type).toBe('workspace.changed')
    expect(fetched?.payload).toEqual({ from: '/old', to: '/new' })
  })

  it('rejects unknown event types', () => {
    expect(() =>
      // @ts-expect-error: deliberately invalid for the runtime guard
      recordEvent({ type: 'not.a.real.event', actorKind: 'user' })
    ).toThrow(/unknown event type/i)
  })

  it('stores credential-looking payload fields as [redacted]', () => {
    const record = recordEvent({
      type: 'model.request.started',
      actorKind: 'system',
      payload: {
        provider: 'deepseek',
        model: 'v4-pro',
        api_key: 'sk-should-not-persist',
        headers: { authorization: 'Bearer leak' }
      }
    })
    const fetched = getEvent(record.id)
    expect(fetched?.redaction).toBe('redacted')
    expect((fetched?.payload as { api_key: string }).api_key).toBe('[redacted]')
    expect(
      ((fetched?.payload as { headers: { authorization: string } }).headers)
        .authorization
    ).toBe('[redacted]')
    // Non-sensitive metadata survives so the timeline is still useful.
    expect((fetched?.payload as { provider: string }).provider).toBe('deepseek')
  })

  it('truncates oversized payloads into an envelope rather than refusing to write', () => {
    const big = 'x'.repeat(PAYLOAD_BYTE_CAP + 4096)
    const record = recordEvent({
      type: 'chat.error',
      actorKind: 'system',
      payload: { trace: big }
    })
    const fetched = getEvent(record.id)
    expect(fetched?.redaction).toBe('redacted')
    expect(fetched?.payload.truncated).toBe(true)
    expect(fetched?.payload.cap).toBe(PAYLOAD_BYTE_CAP)
  })

  it('exposes severity helpers that set the right level', () => {
    const a = recordInfo({ type: 'chat.cancelled', actorKind: 'user' })
    const b = recordWarning({ type: 'chat.error', actorKind: 'system' })
    const c = recordError({ type: 'chat.error', actorKind: 'system' })
    expect(a.severity).toBe('info')
    expect(b.severity).toBe('warning')
    expect(c.severity).toBe('error')
  })
})

// ──────────────────── listEvents filters ────────────────────

describe('listEvents', () => {
  function seed(): void {
    recordEvent({
      type: 'tool.call.started',
      actorKind: 'model',
      conversationId: 'conv-A',
      correlationId: 'run-1',
      toolCallId: 'tc-1',
      payload: { name: 'shell_command' }
    })
    recordEvent({
      type: 'tool.call.completed',
      actorKind: 'tool',
      conversationId: 'conv-A',
      correlationId: 'run-1',
      toolCallId: 'tc-1',
      payload: { durationMs: 12 }
    })
    recordEvent({
      type: 'model.request.completed',
      actorKind: 'model',
      conversationId: 'conv-B',
      correlationId: 'run-2',
      payload: { provider: 'google', model: 'gemma' }
    })
    recordEvent({
      type: 'automation.completed',
      actorKind: 'system',
      automationId: 'auto-1',
      payload: { ok: true }
    })
  }

  it('returns recent first by default and respects the limit', () => {
    seed()
    const rows = listEvents({ limit: 2 })
    expect(rows).toHaveLength(2)
    expect(rows[0].createdAt).toBeGreaterThanOrEqual(rows[1].createdAt)
  })

  it('filters by single event type', () => {
    seed()
    const rows = listEvents({ type: 'tool.call.started' })
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('tool.call.started')
  })

  it('filters by type array (any-match)', () => {
    seed()
    const rows = listEvents({
      type: ['tool.call.started', 'tool.call.completed']
    })
    expect(rows.map((r) => r.type).sort()).toEqual([
      'tool.call.completed',
      'tool.call.started'
    ])
  })

  it('filters by conversation id', () => {
    seed()
    const rows = listEvents({ conversationId: 'conv-A' })
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r.conversationId).toBe('conv-A')
  })

  it('groups all rows from one chat run when filtered by correlation id', () => {
    seed()
    const rows = listEvents({ correlationId: 'run-1', order: 'asc' })
    expect(rows.map((r) => r.type)).toEqual([
      'tool.call.started',
      'tool.call.completed'
    ])
  })

  it('filters by automation id', () => {
    seed()
    const rows = listEvents({ automationId: 'auto-1' })
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('automation.completed')
  })

  it('clamps absurd limits down to MAX_LIST_LIMIT', () => {
    seed()
    const rows = listEvents({ limit: 1_000_000 })
    // We only seeded 4 rows; the clamp is silent so we just expect to get our
    // seed back rather than 1M placeholders.
    expect(rows.length).toBeLessThanOrEqual(4)
  })
})

// ──────────────────── listTimeline ────────────────────

describe('listTimeline', () => {
  it('returns ascending-time events for the named scope', () => {
    recordEvent({
      type: 'agent.stage.started',
      actorKind: 'agent',
      conversationId: 'conv-X',
      correlationId: 'run-Z',
      payload: { stage: 'planner' }
    })
    recordEvent({
      type: 'agent.stage.completed',
      actorKind: 'agent',
      conversationId: 'conv-X',
      correlationId: 'run-Z',
      payload: { stage: 'planner', durationMs: 42 }
    })
    const tl = listTimeline({ conversationId: 'conv-X' })
    expect(tl.map((e) => e.type)).toEqual([
      'agent.stage.started',
      'agent.stage.completed'
    ])
  })

  it('refuses to run without any scope', () => {
    expect(() => listTimeline({})).toThrow(/at least one/i)
  })
})

// ──────────────────── type catalogue ────────────────────

describe('EVENT_TYPES catalogue', () => {
  it('covers each category the spine plan calls out', () => {
    // Spine plan v1 categories. If a row gets renamed, this test fails loud
    // and the matching producer wiring (Prompts 2–4) can update in lockstep.
    const required = [
      'tool.call.started',
      'tool.call.completed',
      'tool.call.failed',
      'tool.call.approved',
      'tool.call.denied',
      'agent.stage.started',
      'agent.stage.completed',
      'agent.stage.failed',
      'model.request.started',
      'model.request.completed',
      'model.request.failed',
      'chat.cancelled',
      'chat.error',
      'workspace.changed',
      'worktree.created',
      'worktree.removed',
      'automation.started',
      'automation.completed',
      'automation.failed',
      'security.decision',
      'permission.policy.created',
      'permission.policy.updated',
      'permission.policy.deleted',
      'settings.updated'
    ]
    for (const t of required) expect(EVENT_TYPES).toContain(t)
  })
})
