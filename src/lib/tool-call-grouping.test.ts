import { describe, it, expect } from 'vitest'
import type { ToolCallState } from '@/stores/chat-store'
import {
  GROUP_THRESHOLD,
  groupConsecutiveToolCalls,
  groupTotalDurationMs,
  isGroupable
} from './tool-call-grouping'

function tc(overrides: Partial<ToolCallState> = {}): ToolCallState {
  return {
    callId: overrides.callId ?? Math.random().toString(36),
    serverId: 'internal',
    toolName: 'shell_command',
    args: {},
    status: 'success',
    title: 'Shell command',
    risks: ['write', 'network'],
    providerKind: 'native',
    duration: 200,
    ...overrides
  }
}

describe('isGroupable', () => {
  it('accepts a terminal-success shell read', () => {
    expect(isGroupable(tc())).toBe(true)
  })
  it('rejects in-flight calls', () => {
    expect(isGroupable(tc({ status: 'pending' }))).toBe(false)
    expect(isGroupable(tc({ status: 'running' }))).toBe(false)
  })
  it('rejects errored / denied calls', () => {
    expect(isGroupable(tc({ status: 'error' }))).toBe(false)
    expect(isGroupable(tc({ status: 'denied' }))).toBe(false)
  })
  it('rejects destructive calls', () => {
    expect(isGroupable(tc({ risks: ['destructive', 'write'] }))).toBe(false)
  })
  it('rejects transcript-hidden UX-shim tools', () => {
    expect(
      isGroupable(tc({ toolName: 'request_permissions', transcriptHidden: true }))
    ).toBe(false)
  })
  it('rejects multi_agent_run (has its own renderer)', () => {
    expect(isGroupable(tc({ toolName: 'multi_agent_run' }))).toBe(false)
  })
})

describe('groupConsecutiveToolCalls', () => {
  it('returns an empty list for empty input', () => {
    expect(groupConsecutiveToolCalls([])).toEqual([])
  })

  it('emits singles for runs shorter than the threshold', () => {
    const calls = [tc(), tc()] // length 2, threshold 3
    const out = groupConsecutiveToolCalls(calls)
    expect(out).toHaveLength(2)
    expect(out.every((g) => g.kind === 'single')).toBe(true)
  })

  it('folds a run of 3+ same-tool calls into one group', () => {
    const calls = [tc(), tc(), tc(), tc(), tc(), tc()]
    const out = groupConsecutiveToolCalls(calls)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('group')
    if (out[0].kind === 'group') {
      expect(out[0].items).toHaveLength(6)
      expect(out[0].toolName).toBe('shell_command')
      expect(out[0].title).toBe('Shell command')
    }
  })

  it('respects the threshold constant', () => {
    expect(GROUP_THRESHOLD).toBe(3)
  })

  it('starts a new group on (toolName, serverId) change', () => {
    const calls = [
      tc({ toolName: 'shell_command' }),
      tc({ toolName: 'shell_command' }),
      tc({ toolName: 'shell_command' }),
      tc({ toolName: 'workspace_context', risks: ['read'] }),
      tc({ toolName: 'workspace_context', risks: ['read'] }),
      tc({ toolName: 'workspace_context', risks: ['read'] }),
      tc({ toolName: 'workspace_context', risks: ['read'] })
    ]
    const out = groupConsecutiveToolCalls(calls)
    expect(out).toHaveLength(2)
    expect(out[0].kind).toBe('group')
    expect(out[1].kind).toBe('group')
    if (out[0].kind === 'group') expect(out[0].items).toHaveLength(3)
    if (out[1].kind === 'group') expect(out[1].items).toHaveLength(4)
  })

  it('breaks a run when an in-flight call appears in the middle', () => {
    const calls = [
      tc(),
      tc(),
      tc({ status: 'running' }), // breaks the run
      tc(),
      tc(),
      tc()
    ]
    const out = groupConsecutiveToolCalls(calls)
    // Two singles (first two below threshold), one running single, one
    // group of three.
    expect(out).toHaveLength(4)
    expect(out[0].kind).toBe('single')
    expect(out[1].kind).toBe('single')
    expect(out[2].kind).toBe('single')
    expect(out[3].kind).toBe('group')
    if (out[3].kind === 'group') expect(out[3].items).toHaveLength(3)
  })

  it('keeps multi_agent_run as a single regardless of neighbours', () => {
    const calls = [
      tc({ toolName: 'shell_command' }),
      tc({ toolName: 'shell_command' }),
      tc({ toolName: 'shell_command' }),
      tc({ toolName: 'multi_agent_run' }),
      tc({ toolName: 'shell_command' }),
      tc({ toolName: 'shell_command' }),
      tc({ toolName: 'shell_command' })
    ]
    const out = groupConsecutiveToolCalls(calls)
    expect(out).toHaveLength(3)
    expect(out[0].kind).toBe('group')
    expect(out[1].kind).toBe('single')
    expect(out[2].kind).toBe('group')
    if (out[1].kind === 'single') {
      expect(out[1].toolCall.toolName).toBe('multi_agent_run')
    }
  })

  it('keeps errored calls as individual singles', () => {
    const calls = [
      tc(),
      tc({ status: 'error' }), // ungroupable, stays individual
      tc(),
      tc(),
      tc()
    ]
    const out = groupConsecutiveToolCalls(calls)
    // single, single (errored), then a group of 3
    expect(out).toHaveLength(3)
    expect(out[0].kind).toBe('single')
    expect(out[1].kind).toBe('single')
    expect(out[2].kind).toBe('group')
  })

  it('passes transcript-hidden cards straight through as singles (MessageList filters them later)', () => {
    const calls = [
      tc({ toolName: 'ask_user_question', transcriptHidden: true }),
      tc({ toolName: 'ask_user_question', transcriptHidden: true }),
      tc({ toolName: 'ask_user_question', transcriptHidden: true })
    ]
    const out = groupConsecutiveToolCalls(calls)
    // Even three in a row — all are ungroupable, so they remain singles.
    // The renderer's `.filter(!transcriptHidden)` then drops them.
    expect(out).toHaveLength(3)
    expect(out.every((g) => g.kind === 'single')).toBe(true)
  })
})

describe('groupTotalDurationMs', () => {
  it('sums durations across items', () => {
    expect(
      groupTotalDurationMs([
        tc({ duration: 100 }),
        tc({ duration: 250 }),
        tc({ duration: 70 })
      ])
    ).toBe(420)
  })
  it('treats missing durations as 0', () => {
    expect(
      groupTotalDurationMs([tc({ duration: 100 }), tc({ duration: undefined })])
    ).toBe(100)
  })
})
