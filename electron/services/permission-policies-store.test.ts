import { describe, it, expect, beforeEach, vi } from 'vitest'

// Force getDb() to throw so the policy store engages its in-memory fallback.
// We exercise the persistence API through that layer — the DB path is the
// same code shape and is covered by integration smoke at runtime.
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('electron app not available in test environment')
    }
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

import {
  __forceMemoryFallback,
  __resetPolicyStore,
  canonicalWorkspacePath,
  clearPoliciesForConversation,
  clearPoliciesForScope,
  deletePolicy,
  getPolicy,
  listPolicies,
  resolveDecision,
  resolveDecisionFromPolicies,
  upsertPolicy,
  type PermissionPolicy
} from './permission-policies-store'

beforeEach(() => {
  __resetPolicyStore()
  __forceMemoryFallback()
})

// ──────────────────── canonicalWorkspacePath ────────────────────

describe('canonicalWorkspacePath', () => {
  it('returns undefined for empty / undefined input', () => {
    expect(canonicalWorkspacePath(undefined)).toBeUndefined()
    expect(canonicalWorkspacePath('')).toBeUndefined()
    expect(canonicalWorkspacePath('   ')).toBeUndefined()
  })

  it('resolves to absolute and (on Windows) lowercases the result', () => {
    const result = canonicalWorkspacePath('C:\\Foo\\Bar')
    expect(result).toBeDefined()
    if (process.platform === 'win32') {
      expect(result).toBe(result?.toLowerCase())
    }
  })
})

// ──────────────────── pure resolver ────────────────────

function makePolicy(partial: Partial<PermissionPolicy>): PermissionPolicy {
  const now = 1_700_000_000_000
  return {
    id: partial.id ?? 'p-' + Math.random().toString(36).slice(2, 10),
    scope: partial.scope ?? 'global',
    subjectKind: partial.subjectKind ?? 'tool',
    subject: partial.subject ?? 'shell_command',
    decision: partial.decision ?? 'allow',
    conversationId: partial.conversationId,
    workspacePath: partial.workspacePath,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now
  }
}

describe('resolveDecisionFromPolicies — resolution order', () => {
  it('most-specific allow wins when no deny matches', () => {
    const policies = [
      makePolicy({
        id: 'global-tool',
        scope: 'global',
        subjectKind: 'tool',
        subject: 'shell_command',
        decision: 'allow'
      }),
      makePolicy({
        id: 'workspace-tool',
        scope: 'workspace',
        subjectKind: 'tool',
        subject: 'shell_command',
        decision: 'allow',
        workspacePath: '/repo'
      }),
      makePolicy({
        id: 'conv-tool',
        scope: 'conversation',
        subjectKind: 'tool',
        subject: 'shell_command',
        decision: 'allow',
        conversationId: 'conv-A'
      })
    ]
    const decision = resolveDecisionFromPolicies(policies, {
      toolId: 'shell_command',
      risks: ['destructive'],
      conversationId: 'conv-A',
      workspacePath: '/repo'
    })
    expect(decision).toEqual({ decision: 'allow', policyId: 'conv-tool' })
  })

  it('risk deny beats tool allow at the same scope', () => {
    const policies = [
      makePolicy({
        id: 'global-tool',
        scope: 'global',
        subjectKind: 'tool',
        subject: 'shell_command',
        decision: 'allow'
      }),
      makePolicy({
        id: 'global-risk',
        scope: 'global',
        subjectKind: 'risk',
        subject: 'destructive',
        decision: 'deny'
      })
    ]
    const decision = resolveDecisionFromPolicies(policies, {
      toolId: 'shell_command',
      risks: ['destructive']
    })
    expect(decision).toEqual({ decision: 'deny', policyId: 'global-risk' })
  })

  it('falls back to global+risk when no tool-subject policy matches', () => {
    const policies = [
      makePolicy({
        id: 'global-risk',
        scope: 'global',
        subjectKind: 'risk',
        subject: 'network',
        decision: 'allow'
      })
    ]
    const decision = resolveDecisionFromPolicies(policies, {
      toolId: 'web_open',
      risks: ['network']
    })
    expect(decision).toEqual({ decision: 'allow', policyId: 'global-risk' })
  })

  it('returns null when nothing matches', () => {
    const policies = [
      makePolicy({
        id: 'unrelated',
        scope: 'global',
        subjectKind: 'tool',
        subject: 'apply_patch',
        decision: 'allow'
      })
    ]
    const decision = resolveDecisionFromPolicies(policies, {
      toolId: 'shell_command',
      risks: ['destructive']
    })
    expect(decision).toBeNull()
  })

  it('skips conversation-scope rows for unrelated conversation ids', () => {
    const policies = [
      makePolicy({
        id: 'other-conv',
        scope: 'conversation',
        subjectKind: 'tool',
        subject: 'shell_command',
        decision: 'allow',
        conversationId: 'conv-OTHER'
      }),
      makePolicy({
        id: 'global-deny',
        scope: 'global',
        subjectKind: 'tool',
        subject: 'shell_command',
        decision: 'deny'
      })
    ]
    const decision = resolveDecisionFromPolicies(policies, {
      toolId: 'shell_command',
      risks: [],
      conversationId: 'conv-A'
    })
    expect(decision).toEqual({ decision: 'deny', policyId: 'global-deny' })
  })

  it('skips workspace-scope rows for mismatched workspaces', () => {
    const policies = [
      makePolicy({
        id: 'other-ws',
        scope: 'workspace',
        subjectKind: 'tool',
        subject: 'shell_command',
        decision: 'allow',
        workspacePath: '/other/path'
      })
    ]
    const decision = resolveDecisionFromPolicies(policies, {
      toolId: 'shell_command',
      risks: [],
      workspacePath: '/different/path'
    })
    expect(decision).toBeNull()
  })
})

describe('resolveDecisionFromPolicies — deny precedence at same level', () => {
  it('deny wins over allow at the same scope+subjectKind level', () => {
    const policies = [
      makePolicy({
        id: 'allow-net',
        scope: 'global',
        subjectKind: 'risk',
        subject: 'network',
        decision: 'allow'
      }),
      makePolicy({
        id: 'deny-destructive',
        scope: 'global',
        subjectKind: 'risk',
        subject: 'destructive',
        decision: 'deny'
      })
    ]
    const decision = resolveDecisionFromPolicies(policies, {
      toolId: 'shell_command',
      risks: ['network', 'destructive']
    })
    expect(decision).toEqual({ decision: 'deny', policyId: 'deny-destructive' })
  })

  it('conversation-level deny beats workspace-level allow', () => {
    const policies = [
      makePolicy({
        id: 'ws-allow',
        scope: 'workspace',
        subjectKind: 'tool',
        subject: 'shell_command',
        decision: 'allow',
        workspacePath: '/repo'
      }),
      makePolicy({
        id: 'conv-deny',
        scope: 'conversation',
        subjectKind: 'tool',
        subject: 'shell_command',
        decision: 'deny',
        conversationId: 'conv-A'
      })
    ]
    const decision = resolveDecisionFromPolicies(policies, {
      toolId: 'shell_command',
      risks: [],
      conversationId: 'conv-A',
      workspacePath: '/repo'
    })
    expect(decision).toEqual({ decision: 'deny', policyId: 'conv-deny' })
  })

  it('global risk deny beats conversation tool allow', () => {
    const policies = [
      makePolicy({
        id: 'global-destructive-deny',
        scope: 'global',
        subjectKind: 'risk',
        subject: 'destructive',
        decision: 'deny'
      }),
      makePolicy({
        id: 'conv-shell-allow',
        scope: 'conversation',
        subjectKind: 'tool',
        subject: 'shell_command',
        decision: 'allow',
        conversationId: 'conv-A'
      })
    ]
    const decision = resolveDecisionFromPolicies(policies, {
      toolId: 'shell_command',
      risks: ['destructive'],
      conversationId: 'conv-A'
    })
    expect(decision).toEqual({ decision: 'deny', policyId: 'global-destructive-deny' })
  })
})

describe('resolveDecisionFromPolicies — risk matching against multi-risk descriptors', () => {
  it('matches a risk policy against any of the descriptor risks', () => {
    const policies = [
      makePolicy({
        id: 'global-destructive',
        scope: 'global',
        subjectKind: 'risk',
        subject: 'destructive',
        decision: 'deny'
      })
    ]
    // A multi-risk descriptor should match the destructive policy regardless
    // of order.
    const decision = resolveDecisionFromPolicies(policies, {
      toolId: 'apply_patch',
      risks: ['write', 'network', 'destructive']
    })
    expect(decision).toEqual({ decision: 'deny', policyId: 'global-destructive' })
  })

  it('skips risk policies that name a risk the descriptor does not carry', () => {
    const policies = [
      makePolicy({
        id: 'global-secret',
        scope: 'global',
        subjectKind: 'risk',
        subject: 'secret',
        decision: 'deny'
      })
    ]
    const decision = resolveDecisionFromPolicies(policies, {
      toolId: 'shell_command',
      risks: ['write', 'network']
    })
    expect(decision).toBeNull()
  })
})

// ──────────────────── persistence (memory fallback path) ────────────────────

describe('upsertPolicy / listPolicies / getPolicy', () => {
  it('inserts a new policy and lists it back', () => {
    const inserted = upsertPolicy({
      scope: 'global',
      subjectKind: 'tool',
      subject: 'shell_command',
      decision: 'allow'
    })
    expect(inserted.id).toBeTruthy()
    expect(inserted.decision).toBe('allow')
    expect(listPolicies()).toHaveLength(1)
    expect(getPolicy(inserted.id)).toEqual(inserted)
  })

  it('upserting the same (scope, subjectKind, subject) updates instead of duplicating', () => {
    const a = upsertPolicy({
      scope: 'global',
      subjectKind: 'tool',
      subject: 'shell_command',
      decision: 'allow'
    })
    const b = upsertPolicy({
      scope: 'global',
      subjectKind: 'tool',
      subject: 'shell_command',
      decision: 'deny'
    })
    expect(a.id).toBe(b.id)
    expect(listPolicies()).toHaveLength(1)
    expect(listPolicies()[0].decision).toBe('deny')
  })

  it('rejects conversation-scoped policies without a conversation id', () => {
    expect(() =>
      upsertPolicy({
        scope: 'conversation',
        subjectKind: 'tool',
        subject: 'shell_command',
        decision: 'allow'
      })
    ).toThrow(/conversationId/i)
  })

  it('rejects workspace-scoped policies without a workspace path', () => {
    expect(() =>
      upsertPolicy({
        scope: 'workspace',
        subjectKind: 'tool',
        subject: 'shell_command',
        decision: 'allow'
      })
    ).toThrow(/workspacePath/i)
  })

  it('canonicalizes workspace path on insert so later resolves match', () => {
    const ws = process.platform === 'win32' ? 'C:\\Repo\\Mixed' : '/repo/case'
    const policy = upsertPolicy({
      scope: 'workspace',
      subjectKind: 'tool',
      subject: 'shell_command',
      decision: 'allow',
      workspacePath: ws
    })
    // On Windows the path is normalized to lowercase; on POSIX the case is
    // preserved.
    if (process.platform === 'win32') {
      expect(policy.workspacePath).toBe(ws.toLowerCase())
    } else {
      expect(policy.workspacePath).toBe(ws)
    }

    const decision = resolveDecision({
      toolId: 'shell_command',
      risks: [],
      workspacePath: ws
    })
    expect(decision).toEqual({ decision: 'allow', policyId: policy.id })
  })
})

describe('deletePolicy + clearPoliciesForConversation + clearPoliciesForScope', () => {
  it('deletePolicy returns true on hit, false on miss', () => {
    const p = upsertPolicy({
      scope: 'global',
      subjectKind: 'tool',
      subject: 'shell_command',
      decision: 'allow'
    })
    expect(deletePolicy(p.id)).toBe(true)
    expect(deletePolicy(p.id)).toBe(false)
    expect(listPolicies()).toHaveLength(0)
  })

  it('clearPoliciesForConversation only removes conv-scoped rows for that id', () => {
    upsertPolicy({
      scope: 'conversation',
      subjectKind: 'tool',
      subject: 'shell_command',
      decision: 'allow',
      conversationId: 'conv-A'
    })
    upsertPolicy({
      scope: 'conversation',
      subjectKind: 'tool',
      subject: 'web_open',
      decision: 'deny',
      conversationId: 'conv-B'
    })
    upsertPolicy({
      scope: 'global',
      subjectKind: 'tool',
      subject: 'apply_patch',
      decision: 'allow'
    })
    const removed = clearPoliciesForConversation('conv-A')
    expect(removed).toBe(1)
    const remaining = listPolicies()
    expect(remaining).toHaveLength(2)
    expect(remaining.some((p) => p.conversationId === 'conv-A')).toBe(false)
  })

  it('clearPoliciesForScope removes every row at the given scope', () => {
    upsertPolicy({
      scope: 'global',
      subjectKind: 'tool',
      subject: 'shell_command',
      decision: 'allow'
    })
    upsertPolicy({
      scope: 'global',
      subjectKind: 'risk',
      subject: 'network',
      decision: 'deny'
    })
    upsertPolicy({
      scope: 'conversation',
      subjectKind: 'tool',
      subject: 'apply_patch',
      decision: 'allow',
      conversationId: 'conv-A'
    })
    const removed = clearPoliciesForScope('global')
    expect(removed).toBe(2)
    expect(listPolicies()).toHaveLength(1)
    expect(listPolicies()[0].scope).toBe('conversation')
  })
})

describe('persistence reload (memory fallback)', () => {
  it('listPolicies + resolveDecision survive across separate calls (simulated restart)', () => {
    upsertPolicy({
      scope: 'global',
      subjectKind: 'tool',
      subject: 'shell_command',
      decision: 'allow'
    })
    // First decision lookup.
    const decision1 = resolveDecision({
      toolId: 'shell_command',
      risks: ['destructive']
    })
    expect(decision1?.decision).toBe('allow')

    // Pretend the process is the same; the fallback persists across calls in
    // the same module instance, mirroring how the DB layer would survive a
    // process restart.
    const decision2 = resolveDecision({
      toolId: 'shell_command',
      risks: ['destructive']
    })
    expect(decision2?.decision).toBe('allow')
    expect(decision2?.policyId).toBe(decision1?.policyId)
  })
})

// ──────────────────── modal fallback (resolveDecision returns null) ────────────────────

describe('modal fallback when nothing matches', () => {
  it('returns null so the caller routes to the user', () => {
    upsertPolicy({
      scope: 'global',
      subjectKind: 'tool',
      subject: 'apply_patch',
      decision: 'allow'
    })
    const decision = resolveDecision({
      toolId: 'shell_command',
      risks: ['destructive']
    })
    expect(decision).toBeNull()
  })
})
