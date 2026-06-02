import { describe, it, expect, beforeEach, vi } from 'vitest'

// The store imports `electron`'s BrowserWindow. We never reach askUser() in
// these tests (every case is covered by a sticky policy), but the import
// itself runs at module-load time and would crash without a stub.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}))

import {
  GATING_RISKS,
  permissionsService,
  shouldGateOnRisks,
  type ToolApprovalRequest
} from './permissions-store'

beforeEach(() => {
  // Reset every policy bucket so tests don't bleed into one another. The
  // public API is the only way to mutate state, so iterate over the known
  // tool ids / risks we touch and clear them.
  permissionsService.setGlobalPolicy('shell_command', null)
  permissionsService.setGlobalPolicy('web_search', null)
  permissionsService.clearConversationPolicies('conv-A')
  permissionsService.clearConversationPolicies('conv-B')
  permissionsService.setRiskPolicy('network', 'always', null)
  permissionsService.setRiskPolicy('destructive', 'always', null)
  permissionsService.setRiskPolicy('secret', 'always', null)
  permissionsService.setRiskPolicy('network', 'conversation', null, 'conv-A')
  permissionsService.setRiskPolicy('network', 'conversation', null, 'conv-B')
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
    risks: ['destructive', 'write', 'network'],
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

  it('conversation-scoped risk policy beats global', () => {
    permissionsService.setRiskPolicy('network', 'always', 'deny')
    permissionsService.setRiskPolicy('network', 'conversation', 'allow', 'conv-A')
    expect(permissionsService.getRiskPolicy('network', 'conv-A')).toEqual({
      scope: 'conversation',
      decision: 'allow'
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
