import { describe, expect, it } from 'vitest'
import {
  eventSubtitle,
  eventTypeLabel,
  formatEventTime,
  groupEventsByCorrelation,
  severityStyle
} from './event-presentation'
import type { EventRecord, EventType } from './types'

// Pure tests for the renderer-side presentation helpers. node-env safe — the
// helpers don't touch the DOM. Asserting them in isolation here means the
// React component can stay just layout + state.

function makeEvent(partial: Partial<EventRecord>): EventRecord {
  return {
    id: partial.id ?? 'e-' + Math.random().toString(36).slice(2, 10),
    type: partial.type ?? 'tool.call.started',
    createdAt: partial.createdAt ?? 1_700_000_000_000,
    severity: partial.severity ?? 'info',
    actorKind: partial.actorKind ?? 'system',
    payload: partial.payload ?? {},
    redaction: partial.redaction ?? 'metadata',
    conversationId: partial.conversationId,
    projectId: partial.projectId,
    workspacePath: partial.workspacePath,
    automationId: partial.automationId,
    toolCallId: partial.toolCallId,
    correlationId: partial.correlationId,
    parentEventId: partial.parentEventId,
    actorId: partial.actorId,
    entityKind: partial.entityKind,
    entityId: partial.entityId
  }
}

describe('eventTypeLabel', () => {
  it('returns human-readable strings for every catalogued type', () => {
    const types: EventType[] = [
      'tool.call.started',
      'tool.call.completed',
      'tool.call.failed',
      'tool.call.approved',
      'tool.call.denied',
      'agent.stage.completed',
      'model.request.failed',
      'chat.cancelled',
      'workspace.changed',
      'worktree.created',
      'worktree.removed',
      'automation.completed',
      'automation.failed',
      'settings.updated',
      'project.created',
      'project.archived'
    ]
    for (const t of types) {
      const label = eventTypeLabel(t)
      expect(label.length).toBeGreaterThan(0)
      expect(label).not.toContain('.') // they're prose, not type ids
    }
  })
})

describe('eventSubtitle', () => {
  it('uses the tool name for tool.call events', () => {
    const e = makeEvent({
      type: 'tool.call.started',
      payload: { name: 'shell_command', toolId: 'shell_command' }
    })
    expect(eventSubtitle(e)).toBe('shell_command')
  })

  it('joins provider + model for model.request events; appends purpose when non-main', () => {
    const main = makeEvent({
      type: 'model.request.completed',
      payload: { provider: 'deepseek', model: 'deepseek-v4-pro', purpose: 'main' }
    })
    expect(eventSubtitle(main)).toBe('deepseek · deepseek-v4-pro')
    const composer = makeEvent({
      type: 'model.request.completed',
      payload: { provider: 'deepseek', model: 'deepseek-v4-pro', purpose: 'composer' }
    })
    expect(eventSubtitle(composer)).toBe('deepseek · deepseek-v4-pro (composer)')
  })

  it('shows role + model for agent stages', () => {
    const e = makeEvent({
      type: 'agent.stage.completed',
      payload: { role: 'planner', model: 'deepseek-v4-pro' }
    })
    expect(eventSubtitle(e)).toBe('planner · deepseek-v4-pro')
  })

  it('shows action + path for workspace.changed', () => {
    const set = makeEvent({
      type: 'workspace.changed',
      payload: { action: 'set', to: '/repo' }
    })
    expect(eventSubtitle(set)).toBe('/repo')
    const clear = makeEvent({
      type: 'workspace.changed',
      payload: { action: 'clear', from: '/old' }
    })
    expect(eventSubtitle(clear)).toBe('cleared (was /old)')
  })

  it('marks failed worktree events with a "(failed)" suffix', () => {
    const ok = makeEvent({
      type: 'worktree.created',
      payload: { ok: true, path: '/wt/a', branch: 'feature/x' }
    })
    expect(eventSubtitle(ok)).toBe('feature/x → /wt/a')
    const fail = makeEvent({
      type: 'worktree.created',
      payload: { ok: false, path: '/wt/a', branch: 'feature/x' }
    })
    expect(eventSubtitle(fail)).toBe('feature/x → /wt/a (failed)')
  })

  it('lists changedKeys for settings.updated', () => {
    const e = makeEvent({
      type: 'settings.updated',
      payload: { changedKeys: ['theme', 'fontSize'] }
    })
    expect(eventSubtitle(e)).toBe('theme, fontSize')
  })

  it('truncates a very long subtitle with an ellipsis', () => {
    const e = makeEvent({
      type: 'automation.completed',
      payload: { label: 'a'.repeat(500), model: 'deepseek-v4-pro' }
    })
    const out = eventSubtitle(e, 50)!
    expect(out.length).toBe(50)
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns null for categories that have no useful subtitle', () => {
    expect(eventSubtitle(makeEvent({ type: 'chat.cancelled' }))).toBeNull()
    expect(eventSubtitle(makeEvent({ type: 'chat.error' }))).toBeNull()
  })
})

describe('severityStyle', () => {
  it('returns distinct classes per severity', () => {
    const i = severityStyle('info')
    const w = severityStyle('warning')
    const e = severityStyle('error')
    expect(new Set([i.dotClass, w.dotClass, e.dotClass]).size).toBe(3)
    expect(i.label).toBe('Info')
    expect(w.label).toBe('Warning')
    expect(e.label).toBe('Error')
  })
})

describe('formatEventTime', () => {
  it('returns HH:MM:SS for a real timestamp', () => {
    // 2026-06-02 14:05:09 UTC — pin via a known epoch ms.
    const ms = Date.UTC(2026, 5, 2, 14, 5, 9)
    const out = formatEventTime(ms, 'en-US')
    // The formatter uses local time of the test runner, so we can't pin the
    // exact string. But the shape must be HH:MM:SS.
    expect(out).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('returns "—" for invalid input', () => {
    expect(formatEventTime(NaN)).toBe('—')
    expect(formatEventTime(Infinity)).toBe('—')
    expect(formatEventTime('hi' as unknown as number)).toBe('—')
  })
})

describe('groupEventsByCorrelation', () => {
  it('puts every event with the same correlationId into one group', () => {
    const events = [
      makeEvent({ correlationId: 'A', createdAt: 100, type: 'tool.call.started' }),
      makeEvent({ correlationId: 'B', createdAt: 200, type: 'tool.call.started' }),
      makeEvent({
        correlationId: 'A',
        createdAt: 150,
        type: 'tool.call.completed'
      })
    ]
    const groups = groupEventsByCorrelation(events, 'asc')
    expect(groups).toHaveLength(2)
    const a = groups.find((g) => g.correlationId === 'A')!
    expect(a.events).toHaveLength(2)
    expect(a.startedAt).toBe(100)
    expect(a.endedAt).toBe(150)
  })

  it('orders groups by startedAt (asc or desc as requested)', () => {
    const events = [
      makeEvent({ correlationId: 'late', createdAt: 500 }),
      makeEvent({ correlationId: 'early', createdAt: 100 })
    ]
    const asc = groupEventsByCorrelation(events, 'asc')
    expect(asc.map((g) => g.correlationId)).toEqual(['early', 'late'])
    const desc = groupEventsByCorrelation(events, 'desc')
    expect(desc.map((g) => g.correlationId)).toEqual(['late', 'early'])
  })

  it('keeps events without a correlationId as their own one-element groups', () => {
    const events = [
      makeEvent({ correlationId: undefined, createdAt: 100 }),
      makeEvent({ correlationId: undefined, createdAt: 200 })
    ]
    const groups = groupEventsByCorrelation(events)
    expect(groups).toHaveLength(2)
    for (const g of groups) {
      expect(g.correlationId).toBeNull()
      expect(g.events).toHaveLength(1)
    }
  })
})
