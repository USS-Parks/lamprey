import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock electron so getDb() throws and every persistence layer either uses
// its memory fallback (event-log, permission-policies-store) or no-ops with
// a caught console.error (tool-calls-store). The event-log fallback is what
// these tests exercise — that's where the new audit rows land.
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('electron app not available in test environment')
    }
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

import {
  __forceMemoryFallback as forcePolicyMemory,
  __resetPolicyStore,
  upsertPolicy
} from './permission-policies-store'
import {
  __forceMemoryFallback as forceEventMemory,
  __resetEventLog,
  listEvents,
  type EventRecord
} from './event-log'
import { permissionsService } from './permissions-store'
import { toolRegistry } from './tool-registry'

beforeEach(() => {
  __resetEventLog()
  forceEventMemory()
  __resetPolicyStore()
  forcePolicyMemory()
})

// ──────────────────── tool-call lifecycle events ────────────────────

describe('tool-call lifecycle audit events', () => {
  function startCall(args: Record<string, unknown> = { cmd: 'ls' }): string {
    const id = 'tc-' + Math.random().toString(36).slice(2, 10)
    toolRegistry.recordCallStart({
      id,
      toolId: 'shell_command',
      name: 'shell_command',
      conversationId: 'conv-A',
      args,
      startedAt: Date.now(),
      status: 'running'
    })
    return id
  }

  it('recordCallStart writes a tool.call.started event tied to the tool_call id', () => {
    const id = startCall({ cmd: 'echo hi' })
    const events = listEvents({ toolCallId: id })
    expect(events).toHaveLength(1)
    const started = events[0]
    expect(started.type).toBe('tool.call.started')
    expect(started.toolCallId).toBe(id)
    expect(started.conversationId).toBe('conv-A')
    expect(started.actorKind).toBe('model')
    expect((started.payload as { toolId: string }).toolId).toBe('shell_command')
    // shell_command descriptor is registered in tool-registry.ts, so providerKind
    // is enriched from the registry rather than left undefined.
    expect((started.payload as { providerKind: string }).providerKind).toBe('native')
  })

  it('recordCallEnd done → tool.call.completed event', () => {
    const id = startCall()
    toolRegistry.recordCallEnd(id, {
      status: 'done',
      result: 'ok',
      approvalSource: 'none',
      finishedAt: Date.now()
    })
    const types = listEvents({ toolCallId: id }).map((e) => e.type)
    expect(types).toContain('tool.call.started')
    expect(types).toContain('tool.call.completed')
  })

  it('recordCallEnd error → tool.call.failed event with severity error', () => {
    const id = startCall()
    toolRegistry.recordCallEnd(id, {
      status: 'error',
      error: 'bad thing happened',
      approvalSource: 'none',
      finishedAt: Date.now()
    })
    const failed = listEvents({ toolCallId: id, type: 'tool.call.failed' })
    expect(failed).toHaveLength(1)
    expect(failed[0].severity).toBe('error')
    expect((failed[0].payload as { errorPreview: string }).errorPreview).toContain(
      'bad thing happened'
    )
  })

  it('recordCallEnd denied with gate source → NO tool.call.denied event (gate already emitted)', () => {
    const id = startCall()
    toolRegistry.recordCallEnd(id, {
      status: 'denied',
      approvalSource: 'modal',
      finishedAt: Date.now()
    })
    const denied = listEvents({ toolCallId: id, type: 'tool.call.denied' })
    expect(denied).toHaveLength(0)
  })

  it('recordCallEnd denied with policy source → NO duplicate tool.call.denied event', () => {
    const id = startCall()
    toolRegistry.recordCallEnd(id, {
      status: 'denied',
      approvalSource: 'policy:abc123',
      finishedAt: Date.now()
    })
    const denied = listEvents({ toolCallId: id, type: 'tool.call.denied' })
    expect(denied).toHaveLength(0)
  })

  it('recordCallEnd denied with NO gate source (self-deny) → emits tool.call.denied', () => {
    const id = startCall()
    toolRegistry.recordCallEnd(id, {
      status: 'denied',
      approvalSource: 'none',
      finishedAt: Date.now()
    })
    const denied = listEvents({ toolCallId: id, type: 'tool.call.denied' })
    expect(denied).toHaveLength(1)
    expect(denied[0].severity).toBe('warning')
  })

  it('redacts credential-looking arg fields out of the started event preview', () => {
    const id = startCall({
      cmd: 'curl example.com',
      api_key: 'sk-should-not-persist',
      Authorization: 'Bearer LEAKY'
    })
    const started = listEvents({ toolCallId: id, type: 'tool.call.started' })[0]
    const preview = (started.payload as { argsPreview: string }).argsPreview
    expect(preview).not.toContain('sk-should-not-persist')
    expect(preview).not.toContain('LEAKY')
    expect(preview).toContain('[redacted]')
  })

  it('intermediate statuses (running/pending/approved) emit NO lifecycle terminal event', () => {
    const id = startCall()
    toolRegistry.recordCallEnd(id, {
      status: 'running',
      approvalSource: 'none',
      finishedAt: Date.now()
    })
    const events = listEvents({ toolCallId: id })
    // Only the started event is present — the running update doesn't terminate.
    expect(events.map((e) => e.type)).toEqual(['tool.call.started'])
  })
})

// ──────────────────── approval-decision events ────────────────────

describe('approval-decision audit events', () => {
  it('policy-match allow → tool.call.approved event from the permissions service', async () => {
    const policy = upsertPolicy({
      scope: 'global',
      subjectKind: 'tool',
      subject: 'shell_command',
      decision: 'allow'
    })
    const outcome = await permissionsService.requestApprovalDetailed({
      callId: 'tc-1',
      toolId: 'shell_command',
      name: 'shell_command',
      serverId: 'internal',
      providerKind: 'native',
      risks: ['destructive'],
      args: { cmd: 'ls' },
      conversationId: 'conv-A'
    })
    expect(outcome.decision).toBe('allow')
    expect(outcome.source).toBe(`policy:${policy.id}`)

    const approved = listEvents({ toolCallId: 'tc-1', type: 'tool.call.approved' })
    expect(approved).toHaveLength(1)
    expect(approved[0].actorKind).toBe('system')
    expect((approved[0].payload as { source: string }).source).toBe(
      `policy:${policy.id}`
    )
    expect((approved[0].payload as { policyId: string }).policyId).toBe(policy.id)
  })

  it('policy-match deny → tool.call.denied event from the permissions service', async () => {
    upsertPolicy({
      scope: 'global',
      subjectKind: 'risk',
      subject: 'destructive',
      decision: 'deny'
    })
    const outcome = await permissionsService.requestApprovalDetailed({
      callId: 'tc-2',
      toolId: 'shell_command',
      name: 'shell_command',
      serverId: 'internal',
      providerKind: 'native',
      risks: ['destructive'],
      args: { cmd: 'rm -rf /' },
      conversationId: 'conv-A'
    })
    expect(outcome.decision).toBe('deny')

    const denied = listEvents({ toolCallId: 'tc-2', type: 'tool.call.denied' })
    expect(denied).toHaveLength(1)
    expect(denied[0].severity).toBe('warning')
    expect(denied[0].actorKind).toBe('system')
  })

  it('no-window default deny is recorded as a tool.call.denied event', async () => {
    // No policy is seeded → resolver falls through to askUser. The electron
    // mock returns an empty windows array, so askUser yields the
    // 'no-window' default deny.
    const outcome = await permissionsService.requestApprovalDetailed({
      callId: 'tc-3',
      toolId: 'apply_patch',
      name: 'apply_patch',
      serverId: 'internal',
      providerKind: 'native',
      risks: ['write'],
      args: { patch: '--- a\n+++ b\n' },
      conversationId: 'conv-A'
    })
    expect(outcome.decision).toBe('deny')
    expect(outcome.source).toBe('no-window')

    const denied = listEvents({ toolCallId: 'tc-3', type: 'tool.call.denied' })
    expect(denied).toHaveLength(1)
    expect((denied[0].payload as { source: string }).source).toBe('no-window')
  })

  it('omits credential-looking arg fields from the approval event payload', async () => {
    upsertPolicy({
      scope: 'global',
      subjectKind: 'tool',
      subject: 'shell_command',
      decision: 'allow'
    })
    await permissionsService.requestApprovalDetailed({
      callId: 'tc-4',
      toolId: 'shell_command',
      name: 'shell_command',
      serverId: 'internal',
      providerKind: 'native',
      risks: ['destructive'],
      args: { cmd: 'curl', api_key: 'sk-leak-me' },
      conversationId: 'conv-A'
    })
    const approved = listEvents({ toolCallId: 'tc-4', type: 'tool.call.approved' })
    // The approval event doesn't carry args directly — only toolId/risks/source
    // metadata — so verify the payload doesn't accidentally leak the secret.
    const json = JSON.stringify(approved[0].payload)
    expect(json).not.toContain('sk-leak-me')
  })
})

// ──────────────────── end-to-end timeline shape ────────────────────

describe('approval + lifecycle compose into a coherent timeline', () => {
  it('allow path: approved → started → completed in ascending time order', async () => {
    upsertPolicy({
      scope: 'global',
      subjectKind: 'tool',
      subject: 'shell_command',
      decision: 'allow'
    })
    const callId = 'tc-e2e-allow'
    await permissionsService.requestApprovalDetailed({
      callId,
      toolId: 'shell_command',
      name: 'shell_command',
      serverId: 'internal',
      providerKind: 'native',
      risks: ['destructive'],
      args: { cmd: 'ls' },
      conversationId: 'conv-Z'
    })
    toolRegistry.recordCallStart({
      id: callId,
      toolId: 'shell_command',
      name: 'shell_command',
      conversationId: 'conv-Z',
      args: { cmd: 'ls' },
      startedAt: Date.now(),
      status: 'running'
    })
    toolRegistry.recordCallEnd(callId, {
      status: 'done',
      result: 'a.txt\nb.txt',
      approvalSource: 'policy:p',
      finishedAt: Date.now()
    })
    const events: EventRecord[] = listEvents({
      toolCallId: callId,
      order: 'asc'
    })
    expect(events.map((e) => e.type)).toEqual([
      'tool.call.approved',
      'tool.call.started',
      'tool.call.completed'
    ])
  })
})
