import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Covers the askUser() BrowserWindow round-trip in permissions-store, which the
// sibling permissions-store.test.ts deliberately never reaches (it stubs
// getAllWindows() to [], so every case there resolves via a sticky policy).
//
// Here we install a fake window whose webContents.send is a spy, and drive the
// renderer's reply through permissionsService.respond(). vi.hoisted lets the
// mock factory and the test body share the same mutable window list + sent-event
// log. app.getPath throws so the policy persistence layer uses its in-memory
// fallback (forced in beforeEach).
const h = vi.hoisted(() => {
  const sent: Array<{ channel: string; payload: unknown }> = []
  const fakeWindow = {
    webContents: {
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload })
      }
    }
  }
  return { sent, fakeWindow, state: { windows: [fakeWindow] as unknown[] } }
})

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => h.state.windows },
  app: {
    getPath: () => {
      throw new Error('app not ready in test env')
    }
  }
}))

import {
  permissionsService,
  type ApprovalDecision,
  type ToolApprovalRequest
} from './permissions-store'
import {
  __forceMemoryFallback,
  __resetPolicyStore,
  listPolicies
} from './permission-policies-store'

let callSeq = 0

function makeReq(partial: Partial<ToolApprovalRequest> = {}): ToolApprovalRequest {
  return {
    callId: `call-${++callSeq}`,
    toolId: 'shell_command',
    name: 'shell_command',
    serverId: 'internal',
    providerKind: 'native',
    risks: ['write', 'network'],
    args: { command: 'git status' },
    ...partial
  }
}

beforeEach(() => {
  __resetPolicyStore()
  __forceMemoryFallback()
  h.sent.length = 0
  h.state.windows = [h.fakeWindow]
})

afterEach(() => {
  vi.useRealTimers()
})

describe('askUser — no active window', () => {
  it('denies with source "no-window" and sends nothing', async () => {
    h.state.windows = []
    const outcome = await permissionsService.requestApprovalDetailed(makeReq())
    expect(outcome).toEqual({ decision: 'deny', source: 'no-window' })
    expect(h.sent).toHaveLength(0)
  })
})

describe('askUser — modal round-trip', () => {
  it('dispatches the approval request to the renderer', async () => {
    const req = makeReq()
    const promise = permissionsService.requestApprovalDetailed(req)

    // The executor runs synchronously, so the events are already sent and the
    // resolver is registered before we reply.
    const channels = h.sent.map((e) => e.channel)
    expect(channels).toContain('tools:approvalRequired')
    expect(channels).toContain('mcp:confirmationRequired') // legacy compat
    const approval = h.sent.find((e) => e.channel === 'tools:approvalRequired')
    expect(approval?.payload).toMatchObject({ callId: req.callId, toolId: 'shell_command' })

    permissionsService.respond({ callId: req.callId, decision: 'allow', scope: 'once' })
    await promise
  })

  it('"just this once" allow resolves as modal and persists no policy', async () => {
    const req = makeReq()
    const promise = permissionsService.requestApprovalDetailed(req)
    permissionsService.respond({ callId: req.callId, decision: 'allow', scope: 'once' })
    const outcome = await promise
    expect(outcome).toEqual({ decision: 'allow', source: 'modal' })
    expect(listPolicies()).toHaveLength(0)
  })

  it('a denial is reported as modal with no persisted policy', async () => {
    const req = makeReq()
    const promise = permissionsService.requestApprovalDetailed(req)
    permissionsService.respond({ callId: req.callId, decision: 'deny', scope: 'once' })
    const outcome = await promise
    expect(outcome).toEqual({ decision: 'deny', source: 'modal' })
    expect(listPolicies()).toHaveLength(0)
  })

  it('"always" allow persists a global tool policy and reports its id as the source', async () => {
    const req = makeReq()
    const promise = permissionsService.requestApprovalDetailed(req)
    permissionsService.respond({ callId: req.callId, decision: 'allow', scope: 'always' })
    const outcome = await promise

    expect(outcome.decision).toBe('allow')
    expect(outcome.source).toMatch(/^policy:/)

    const policies = listPolicies()
    expect(policies).toHaveLength(1)
    expect(policies[0]).toMatchObject({
      scope: 'global',
      subjectKind: 'tool',
      subject: 'shell_command',
      decision: 'allow'
    })
    expect(outcome.source).toBe(`policy:${policies[0].id}`)
  })

  it('"conversation" scope without a conversationId does not persist (stays modal)', async () => {
    const req = makeReq({ conversationId: undefined })
    const promise = permissionsService.requestApprovalDetailed(req)
    permissionsService.respond({ callId: req.callId, decision: 'allow', scope: 'conversation' })
    const outcome = await promise
    expect(outcome.source).toBe('modal')
    expect(listPolicies()).toHaveLength(0)
  })

  it('"conversation" scope with an id persists a conversation-scoped policy', async () => {
    const req = makeReq({ conversationId: 'conv-77' })
    const promise = permissionsService.requestApprovalDetailed(req)
    permissionsService.respond({ callId: req.callId, decision: 'allow', scope: 'conversation' })
    const outcome = await promise
    expect(outcome.source).toMatch(/^policy:/)
    const policies = listPolicies()
    expect(policies).toHaveLength(1)
    expect(policies[0]).toMatchObject({
      scope: 'conversation',
      subject: 'shell_command',
      conversationId: 'conv-77',
      decision: 'allow'
    })
  })

  it('once an "always" answer is persisted, the next request resolves via policy without re-prompting', async () => {
    const first = makeReq()
    const p1 = permissionsService.requestApprovalDetailed(first)
    permissionsService.respond({ callId: first.callId, decision: 'allow', scope: 'always' })
    await p1

    h.sent.length = 0
    const second = makeReq()
    const outcome = await permissionsService.requestApprovalDetailed(second)
    expect(outcome.decision).toBe('allow')
    expect(outcome.source).toMatch(/^policy:/)
    // No modal this time — the persisted policy short-circuits askUser.
    expect(h.sent).toHaveLength(0)
  })
})

describe('askUser — no timeout, explicit cancellation only', () => {
  // The 30s auto-deny was removed: a pending approval must wait for the
  // user to definitively answer. Verified by advancing fake timers well
  // past the old limit and confirming the promise is still pending.
  it('never auto-denies, no matter how long the user is away', async () => {
    vi.useFakeTimers()
    const req = makeReq()
    let settled: { decision: ApprovalDecision; source: string } | 'pending' = 'pending'
    const promise = permissionsService
      .requestApprovalDetailed(req)
      .then((o) => {
        settled = o
        return o
      })
    // Advance an hour — far past the old 30s timeout.
    vi.advanceTimersByTime(60 * 60 * 1000)
    // Yield to the microtask queue so any wrongly-scheduled resolves can fire.
    await Promise.resolve()
    expect(settled).toBe('pending')
    // Confirm the request CAN still be answered after the long wait.
    permissionsService.respond({ callId: req.callId, decision: 'allow', scope: 'once' })
    const final = await promise
    expect(final).toEqual({ decision: 'allow', source: 'modal' })
    expect(settled).toEqual({ decision: 'allow', source: 'modal' })
  })

  it('a late response (well after the old 30s window) still lands cleanly', async () => {
    vi.useFakeTimers()
    const req = makeReq()
    const promise = permissionsService.requestApprovalDetailed(req)
    vi.advanceTimersByTime(5 * 60 * 1000)
    permissionsService.respond({ callId: req.callId, decision: 'deny', scope: 'once' })
    const outcome = await promise
    expect(outcome).toEqual({ decision: 'deny', source: 'modal' })
  })

  it('cancelPending resolves the pending request as a one-time deny', async () => {
    const req = makeReq()
    const promise = permissionsService.requestApprovalDetailed(req)
    permissionsService.cancelPending(req.callId)
    const outcome = await promise
    expect(outcome.decision).toBe('deny')
    expect(listPolicies()).toHaveLength(0)
  })

  it('respond for an unknown callId is a harmless no-op', () => {
    expect(() =>
      permissionsService.respond({ callId: 'nonexistent', decision: 'allow', scope: 'once' })
    ).not.toThrow()
  })
})
