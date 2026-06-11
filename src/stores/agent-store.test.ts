import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStore } from './agent-store'

// UB-6 (Unburdening Phase, 2026-06-10) — the store is roster-only now. The
// mode/activeRun/recordStatus suites died with the pipeline; these lock the
// surviving surface.

const defaultRoster = {
  planner: 'deepseek-v4-pro',
  coder: 'deepseek-v4-flash',
  reviewer: 'deepseek-v4-pro',
  coworker: 'qwen3-coder-plus'
}

beforeEach(() => {
  useAgentStore.getState().hydrate(defaultRoster)
})

describe('useAgentStore (roster-only, UB-6)', () => {
  it('boots with the default roster', () => {
    expect(useAgentStore.getState().roster).toEqual(defaultRoster)
  })

  it('setRole updates one role and leaves the rest', () => {
    useAgentStore.getState().setRole('coworker', 'gemma-3-27b')
    const roster = useAgentStore.getState().roster
    expect(roster.coworker).toBe('gemma-3-27b')
    expect(roster.coder).toBe(defaultRoster.coder)
  })

  it('hydrate merges over defaults so missing roles stay populated', () => {
    useAgentStore.getState().hydrate({ coworker: 'qwen3-coder-plus' } as never)
    const roster = useAgentStore.getState().roster
    expect(roster.coworker).toBe('qwen3-coder-plus')
    expect(roster.planner).toBe(defaultRoster.planner)
  })

  it('carries no pipeline surface (UB-6 absence lock)', () => {
    const state = useAgentStore.getState() as unknown as Record<string, unknown>
    expect(state.mode).toBeUndefined()
    expect(state.activeRun).toBeUndefined()
    expect(state.recordStatus).toBeUndefined()
    expect(state.clearRun).toBeUndefined()
  })
})
