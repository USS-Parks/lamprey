import { create } from 'zustand'
import type { AgentRole, AgentRoster } from '@/lib/types'

// UB-6 (Unburdening Phase, 2026-06-10) — slimmed with the pipeline excision.
// The store used to carry `mode` (single/multi/auto), `activeRun` (the live
// planner→coder→reviewer stage list), and the `agent:status` reducer; all of
// that died with the multi-agent dispatch. What remains is the roster — the
// per-role model assignments the Co-worker side chat (and the model-callable
// multi_agent_run tool) still consume.

interface AgentState {
  roster: AgentRoster
  setRole: (role: AgentRole, modelId: string) => void
  hydrate: (roster: AgentRoster) => void
}

const defaultRoster: AgentRoster = {
  planner: 'deepseek-v4-pro',
  coder: 'deepseek-v4-flash',
  reviewer: 'deepseek-v4-pro',
  coworker: 'qwen3-coder-plus'
}

export const useAgentStore = create<AgentState>((set) => ({
  roster: defaultRoster,

  setRole: (role, modelId) =>
    set((s) => ({ roster: { ...s.roster, [role]: modelId } })),

  hydrate: (roster) => {
    set({ roster: { ...defaultRoster, ...roster } })
  }
}))
