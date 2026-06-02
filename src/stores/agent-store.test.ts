import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStore } from './agent-store'
import type { AgentStatusEvent } from '@/lib/types'

const DEFAULT_ROSTER = {
  planner: 'deepseek-v4-pro',
  coder: 'deepseek-v4-flash',
  reviewer: 'deepseek-v4-pro',
  coworker: 'qwen3-coder-plus'
}

beforeEach(() => {
  useAgentStore.setState({ mode: 'single', roster: { ...DEFAULT_ROSTER }, activeRun: [] })
})

describe('agent-store', () => {
  it('setMode switches the mode', () => {
    useAgentStore.getState().setMode('multi')
    expect(useAgentStore.getState().mode).toBe('multi')
  })

  it('setRole updates a single roster entry without touching the others', () => {
    useAgentStore.getState().setRole('coder', 'qwen3-coder-plus')
    const roster = useAgentStore.getState().roster
    expect(roster.coder).toBe('qwen3-coder-plus')
    expect(roster.planner).toBe(DEFAULT_ROSTER.planner)
  })

  it('hydrate merges a partial roster onto the defaults', () => {
    useAgentStore.getState().hydrate('multi', { reviewer: 'custom-model' } as never)
    const s = useAgentStore.getState()
    expect(s.mode).toBe('multi')
    expect(s.roster.reviewer).toBe('custom-model')
    expect(s.roster.planner).toBe(DEFAULT_ROSTER.planner) // default preserved
  })

  describe('recordStatus', () => {
    const ev = (over: Partial<AgentStatusEvent>): AgentStatusEvent =>
      ({ role: 'planner', model: 'm', state: 'running', ...over }) as AgentStatusEvent

    it('appends a new role on first event', () => {
      useAgentStore.getState().recordStatus(ev({ role: 'planner', state: 'running' }))
      const run = useAgentStore.getState().activeRun
      expect(run).toHaveLength(1)
      expect(run[0]).toMatchObject({ role: 'planner', state: 'running' })
      expect(run[0].startedAt).toBeGreaterThan(0)
    })

    it('updates state + output for an existing role instead of duplicating', () => {
      const store = useAgentStore.getState()
      store.recordStatus(ev({ role: 'planner', state: 'running' }))
      store.recordStatus(ev({ role: 'planner', state: 'done', output: 'the plan' }))
      const run = useAgentStore.getState().activeRun
      expect(run).toHaveLength(1)
      expect(run[0]).toMatchObject({ role: 'planner', state: 'done', output: 'the plan' })
    })

    it('preserves prior output when a later event omits it', () => {
      const store = useAgentStore.getState()
      store.recordStatus(ev({ role: 'coder', state: 'done', output: 'kept' }))
      store.recordStatus(ev({ role: 'coder', state: 'error' }))
      expect(useAgentStore.getState().activeRun[0]).toMatchObject({ state: 'error', output: 'kept' })
    })

    it('tracks distinct roles separately', () => {
      const store = useAgentStore.getState()
      store.recordStatus(ev({ role: 'planner' }))
      store.recordStatus(ev({ role: 'coder' }))
      expect(useAgentStore.getState().activeRun.map((r) => r.role)).toEqual(['planner', 'coder'])
    })
  })

  it('clearRun empties the active run', () => {
    useAgentStore.getState().recordStatus({ role: 'planner', model: 'm', state: 'running' } as AgentStatusEvent)
    useAgentStore.getState().clearRun()
    expect(useAgentStore.getState().activeRun).toEqual([])
  })
})
