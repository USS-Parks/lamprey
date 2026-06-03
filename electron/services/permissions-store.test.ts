import { describe, it, expect, beforeEach, vi } from 'vitest'

// The store imports `electron`'s BrowserWindow at module-load time. We never
// reach askUser() in these tests (every case is covered by a sticky policy),
// but the import itself would crash without a stub. The policy persistence
// layer is exercised through its in-memory fallback because app.getPath is
// unreachable here — see __resetPolicyStore + __forceMemoryFallback below.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => { throw new Error('app not ready in test env') } }
}))

import {
  GATING_RISKS,
  descriptorNeedsApproval,
  permissionsService,
  shouldGateOnRisks,
  type ToolApprovalRequest
} from './permissions-store'
import {
  __forceMemoryFallback,
  __resetPolicyStore
} from './permission-policies-store'
import type { ToolRisk } from './tool-registry'

beforeEach(() => {
  // Wipe the in-memory fallback so each test starts clean and force the
  // fallback path explicitly (rather than relying on the first getDb() to
  // throw and flip the switch).
  __resetPolicyStore()
  __forceMemoryFallback()
})

function makeReq(
  partial: Partial<ToolApprovalRequest> = {}
): ToolApprovalRequest {
  return {
    callId: 'call-1',
    toolId: 'shell_command',
    name: 'shell_command',
    serverId: 'internal',
    providerKind: 'native',
    risks: ['write', 'network'],
    args: {},
    ...partial
  }
}

describe('GATING_RISKS', () => {
  it('includes network, destructive, and secret', () => {
    expect(GATING_RISKS.has('network')).toBe(true)
    expect(GATING_RISKS.has('destructive')).toBe(true)
    expect(GATING_RISKS.has('secret')).toBe(true)
  })

  it('excludes read and write', () => {
    expect(GATING_RISKS.has('read')).toBe(false)
    expect(GATING_RISKS.has('write')).toBe(false)
  })
})

describe('shouldGateOnRisks', () => {
  it('returns true when any gating risk is present', () => {
    expect(shouldGateOnRisks(['network', 'read'])).toBe(true)
    expect(shouldGateOnRisks(['destructive'])).toBe(true)
  })

  it('returns false for read/write-only risk sets', () => {
    expect(shouldGateOnRisks(['read'])).toBe(false)
    expect(shouldGateOnRisks(['write'])).toBe(false)
    expect(shouldGateOnRisks(['read', 'write'])).toBe(false)
  })

  it('returns false for an empty risk list', () => {
    expect(shouldGateOnRisks([])).toBe(false)
  })
})

describe('descriptorNeedsApproval — dispatch-time gate', () => {
  const desc = (over: {
    requiresApproval?: boolean
    risks?: ToolRisk[]
    selfApproves?: boolean
  } = {}) => ({ requiresApproval: false, risks: [] as ToolRisk[], ...over })

  it('returns false for a missing descriptor', () => {
    expect(descriptorNeedsApproval(undefined)).toBe(false)
  })

  it('gates when requiresApproval is true', () => {
    expect(descriptorNeedsApproval(desc({ requiresApproval: true }))).toBe(true)
  })

  it('gates on a network / destructive / secret risk even when requiresApproval is false', () => {
    expect(descriptorNeedsApproval(desc({ risks: ['network'] }))).toBe(true)
    expect(descriptorNeedsApproval(desc({ risks: ['destructive'] }))).toBe(true)
    expect(descriptorNeedsApproval(desc({ risks: ['secret'] }))).toBe(true)
  })

  it('does NOT gate read/write-only tools', () => {
    expect(descriptorNeedsApproval(desc({ risks: ['read'] }))).toBe(false)
    expect(descriptorNeedsApproval(desc({ risks: ['write'] }))).toBe(false)
    expect(descriptorNeedsApproval(desc({ risks: ['read', 'write'] }))).toBe(false)
  })

  it('never gates a self-approving tool, even with a gating risk or requiresApproval', () => {
    // This is the request_permissions case: its handler is the approval call,
    // so the dispatcher must not double-prompt — and a global "deny secret"
    // must not be able to lock it out.
    expect(descriptorNeedsApproval(desc({ risks: ['secret'], selfApproves: true }))).toBe(false)
    expect(
      descriptorNeedsApproval(desc({ requiresApproval: true, selfApproves: true }))
    ).toBe(false)
  })
})

describe('permissionsService — sticky per-tool policies', () => {
  it('allows a tool when a global allow policy is in place', async () => {
    permissionsService.setGlobalPolicy('shell_command', 'allow')
    const decision = await permissionsService.requestApproval(makeReq())
    expect(decision).toBe('allow')
  })

  it('denies a tool when a global deny policy is in place', async () => {
    permissionsService.setGlobalPolicy('shell_command', 'deny')
    const decision = await permissionsService.requestApproval(makeReq())
    expect(decision).toBe('deny')
  })

  it('listGlobalPolicies surfaces the policies that were set', () => {
    permissionsService.setGlobalPolicy('shell_command', 'allow')
    permissionsService.setGlobalPolicy('web_search', 'deny')
    const list = permissionsService.listGlobalPolicies()
    expect(list).toEqual(
      expect.arrayContaining([
        { toolId: 'shell_command', decision: 'allow' },
        { toolId: 'web_search', decision: 'deny' }
      ])
    )
  })

  it('clearGlobalPolicy with null removes the entry', () => {
    permissionsService.setGlobalPolicy('shell_command', 'allow')
    permissionsService.setGlobalPolicy('shell_command', null)
    expect(
      permissionsService.listGlobalPolicies().find((p) => p.toolId === 'shell_command')
    ).toBeUndefined()
  })
})

describe('permissionsService — per-risk policies', () => {
  it('allows when every gating risk on the request is covered by an allow policy', async () => {
    permissionsService.setRiskPolicy('network', 'always', 'allow')
    permissionsService.setRiskPolicy('destructive', 'always', 'allow')
    const decision = await permissionsService.requestApproval(
      makeReq({ risks: ['network', 'destructive'] })
    )
    expect(decision).toBe('allow')
  })

  it('denies as soon as one gating risk is covered by a deny policy', async () => {
    permissionsService.setRiskPolicy('network', 'always', 'allow')
    permissionsService.setRiskPolicy('destructive', 'always', 'deny')
    const decision = await permissionsService.requestApproval(
      makeReq({ risks: ['network', 'destructive'] })
    )
    expect(decision).toBe('deny')
  })

  it('global risk deny beats conversation allow', () => {
    permissionsService.setRiskPolicy('network', 'always', 'deny')
    permissionsService.setRiskPolicy('network', 'conversation', 'allow', 'conv-A')
    expect(permissionsService.getRiskPolicy('network', 'conv-A')).toEqual({
      scope: 'always',
      decision: 'deny'
    })
    expect(permissionsService.getRiskPolicy('network', 'conv-B')).toEqual({
      scope: 'always',
      decision: 'deny'
    })
  })

  it('clearing a conversation-scoped risk policy falls back to global', () => {
    permissionsService.setRiskPolicy('network', 'always', 'allow')
    permissionsService.setRiskPolicy('network', 'conversation', 'deny', 'conv-A')
    permissionsService.setRiskPolicy('network', 'conversation', null, 'conv-A')
    expect(permissionsService.getRiskPolicy('network', 'conv-A')).toEqual({
      scope: 'always',
      decision: 'allow'
    })
  })
})
