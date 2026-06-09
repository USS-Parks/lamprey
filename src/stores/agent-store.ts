import { create } from 'zustand'
import type { AgentMode, AgentRole, AgentRoster, AgentStatusEvent } from '@/lib/types'

interface AgentRunStatus {
  role: AgentRole
  model: string
  state: 'running' | 'done' | 'error'
  output?: string
  startedAt: number
}

interface AgentState {
  mode: AgentMode
  roster: AgentRoster
  activeRun: AgentRunStatus[]
  setMode: (mode: AgentMode) => void
  setRole: (role: AgentRole, modelId: string) => void
  hydrate: (mode: AgentMode, roster: AgentRoster) => void
  recordStatus: (event: AgentStatusEvent) => void
  clearRun: () => void
}

const defaultRoster: AgentRoster = {
  planner: 'deepseek-v4-pro',
  coder: 'deepseek-v4-flash',
  reviewer: 'deepseek-v4-pro',
  coworker: 'qwen3-coder-plus'
}

// L8 (Lampshade Phase, 2026-06-09) — `'auto'` is the new default for new
// installs. Existing settings rows with an explicit `'single'` or `'multi'`
// pass through unchanged via `hydrate` — only callers that pass a value
// outside the AgentMode union (e.g. missing field) fall to `'auto'`.
export const useAgentStore = create<AgentState>((set) => ({
  mode: 'auto',
  roster: defaultRoster,
  activeRun: [],

  setMode: (mode) => set({ mode }),

  setRole: (role, modelId) =>
    set((s) => ({ roster: { ...s.roster, [role]: modelId } })),

  hydrate: (mode, roster) => {
    const normalizedMode: AgentMode =
      mode === 'auto' || mode === 'single' || mode === 'multi' ? mode : 'auto'
    set({ mode: normalizedMode, roster: { ...defaultRoster, ...roster } })
  },

  recordStatus: (event) =>
    set((s) => {
      const existing = s.activeRun.find((r) => r.role === event.role)
      if (existing) {
        return {
          activeRun: s.activeRun.map((r) =>
            r.role === event.role
              ? { ...r, state: event.state, output: event.output ?? r.output }
              : r
          )
        }
      }
      return {
        activeRun: [
          ...s.activeRun,
          {
            role: event.role,
            model: event.model,
            state: event.state,
            output: event.output,
            startedAt: Date.now()
          }
        ]
      }
    }),

  clearRun: () => set({ activeRun: [] })
}))
