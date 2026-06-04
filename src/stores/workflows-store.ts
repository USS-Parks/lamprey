import { create } from 'zustand'

// Track 1 / B3: workflow live progress store. Subscribes to
// `workflow:progress` (from electron/ipc/workflows.ts) and assembles a
// per-run tree: workflow → phase → agent. Each agent chip carries its
// own status / duration / token estimate so the panel can render the
// tree from state alone without per-event DOM mutation.

export type WorkflowStatus = 'running' | 'done' | 'errored' | 'aborted'
export type AgentChipStatus = 'running' | 'done' | 'error' | 'aborted'

export type AgentTier = 'cheap' | 'pro' | 'unknown'

export interface AgentChip {
  /** Synthetic id stable across start/finish for the same agent. */
  id: string
  agentType: string
  label: string
  phase?: string
  status: AgentChipStatus
  startedAt: number
  finishedAt?: number
  durationMs?: number
  tokensUsedEstimate?: number
  cached?: boolean
  error?: string
  /** B5: model tier the agent ran on. Populated on agent:finish. */
  tier?: AgentTier
}

export interface PhaseGroup {
  title: string
  agents: AgentChip[]
  // For agents fired before any phase() call, the title is the empty string.
}

export interface NarratorLine {
  id: string
  text: string
  phase?: string
  at: number
}

export interface WorkflowRunState {
  runId: string
  name: string
  status: WorkflowStatus
  startedAt: number
  finishedAt?: number
  phases: PhaseGroup[]
  log: NarratorLine[]
  error?: string
  finalResult?: unknown
}

interface WorkflowsStoreState {
  /** Most-recent-first list of runs (live + finished). */
  runs: WorkflowRunState[]
  /** Apply a single workflow:progress event. */
  applyProgress: (event: WorkflowProgressEvent) => void
  /** Stop a run via window.api.workflows.stop. */
  stopRun: (runId: string) => Promise<void>
  /** Clear all state (used by tests). */
  reset: () => void
}

// Mirror of WorkflowProgressEvent from electron/services/workflow-runner.ts.
// Kept local so the renderer doesn't import main-process types.
export interface WorkflowProgressEvent {
  runId: string
  kind:
    | 'started'
    | 'phase'
    | 'log'
    | 'agent:start'
    | 'agent:finish'
    | 'finished'
    | 'errored'
    | 'tokens'
  label?: string
  phase?: string
  agentRunId?: string
  agentType?: string
  message?: string
  status?: 'done' | 'error' | 'aborted'
  durationMs?: number
  tokensUsedEstimate?: number
  tier?: AgentTier
  finalResult?: unknown
  error?: string
  budgetByTier?: Record<AgentTier, number>
}

function findOrCreateRun(runs: WorkflowRunState[], runId: string): WorkflowRunState[] {
  const idx = runs.findIndex((r) => r.runId === runId)
  if (idx >= 0) return runs
  const fresh: WorkflowRunState = {
    runId,
    name: runId.slice(0, 8),
    status: 'running',
    startedAt: 0,
    phases: [],
    log: []
  }
  return [fresh, ...runs]
}

function withRun(
  runs: WorkflowRunState[],
  runId: string,
  mut: (r: WorkflowRunState) => WorkflowRunState
): WorkflowRunState[] {
  return runs.map((r) => (r.runId === runId ? mut(r) : r))
}

function findOrCreatePhase(phases: PhaseGroup[], title: string): { phases: PhaseGroup[]; index: number } {
  const idx = phases.findIndex((p) => p.title === title)
  if (idx >= 0) return { phases, index: idx }
  return { phases: [...phases, { title, agents: [] }], index: phases.length }
}

// Synthetic agent id — agent:start/agent:finish are matched by agentRunId
// when present (forkAgent runId), else by (agentType + label + startedAt).
function chipIdFor(event: WorkflowProgressEvent, fallbackSeq: number): string {
  if (event.agentRunId) return event.agentRunId
  return `synthetic:${event.agentType ?? '?'}:${event.label ?? ''}:${fallbackSeq}`
}

let syntheticCounter = 0

export const useWorkflowsStore = create<WorkflowsStoreState>((set, get) => ({
  runs: [],

  applyProgress: (event: WorkflowProgressEvent) => {
    if (!event || typeof event.runId !== 'string') return
    set((state) => {
      const runs = findOrCreateRun(state.runs, event.runId)
      switch (event.kind) {
        case 'started':
          return {
            runs: withRun(runs, event.runId, (r) => ({
              ...r,
              name: event.label ?? r.name,
              status: 'running',
              startedAt: Date.now(),
              phases: [],
              log: []
            }))
          }
        case 'phase': {
          const title = event.phase ?? ''
          if (!title) return { runs }
          return {
            runs: withRun(runs, event.runId, (r) => {
              const next = findOrCreatePhase(r.phases, title)
              return { ...r, phases: next.phases }
            })
          }
        }
        case 'log': {
          if (!event.message) return { runs }
          return {
            runs: withRun(runs, event.runId, (r) => ({
              ...r,
              log: [
                ...r.log,
                {
                  id: `log:${r.log.length}:${syntheticCounter++}`,
                  text: event.message!,
                  phase: event.phase,
                  at: Date.now()
                }
              ]
            }))
          }
        }
        case 'agent:start': {
          const id = chipIdFor(event, syntheticCounter++)
          return {
            runs: withRun(runs, event.runId, (r) => {
              const title = event.phase ?? ''
              const next = findOrCreatePhase(r.phases, title)
              const phases = [...next.phases]
              phases[next.index] = {
                ...phases[next.index],
                agents: [
                  ...phases[next.index].agents,
                  {
                    id,
                    agentType: event.agentType ?? 'general',
                    label: event.label ?? event.agentType ?? 'general',
                    phase: title || undefined,
                    status: 'running',
                    startedAt: Date.now()
                  }
                ]
              }
              return { ...r, phases }
            })
          }
        }
        case 'agent:finish': {
          const id = chipIdFor(event, syntheticCounter++)
          return {
            runs: withRun(runs, event.runId, (r) => {
              const title = event.phase ?? ''
              const phaseIdx = r.phases.findIndex((p) => p.title === title)
              if (phaseIdx < 0) return r
              const phases = [...r.phases]
              const phase = { ...phases[phaseIdx] }
              const agents = [...phase.agents]
              // Match by agentRunId when present; else update the most recent
              // synthetic chip for this label that's still 'running'.
              let updateIdx = agents.findIndex((a) => a.id === id)
              if (updateIdx < 0) {
                updateIdx = agents
                  .map((a, i): [AgentChip, number] => [a, i])
                  .reverse()
                  .find(
                    ([a]) =>
                      a.status === 'running' &&
                      a.label === (event.label ?? a.label) &&
                      a.agentType === (event.agentType ?? a.agentType)
                  )?.[1] ?? -1
              }
              if (updateIdx < 0) return r
              const status: AgentChipStatus =
                event.status === 'done' ? 'done' : event.status === 'error' ? 'error' : 'aborted'
              agents[updateIdx] = {
                ...agents[updateIdx],
                status,
                finishedAt: Date.now(),
                durationMs: event.durationMs,
                tokensUsedEstimate: event.tokensUsedEstimate,
                cached: event.message === 'cached',
                tier: event.tier,
                error: event.error
              }
              phase.agents = agents
              phases[phaseIdx] = phase
              return { ...r, phases }
            })
          }
        }
        case 'finished':
          return {
            runs: withRun(runs, event.runId, (r) => ({
              ...r,
              status: 'done',
              finishedAt: Date.now(),
              finalResult: event.finalResult
            }))
          }
        case 'errored':
          return {
            runs: withRun(runs, event.runId, (r) => ({
              ...r,
              status: 'errored',
              finishedAt: Date.now(),
              error: event.error
            }))
          }
        case 'tokens':
          // B5: per-tier token accumulation is held inside the runner's
          // budget tracker; the store doesn't need to mirror it. The event
          // exists so the panel can render live cost chips if desired.
          return { runs }
        default:
          return { runs }
      }
    })
  },

  stopRun: async (runId: string) => {
    if (typeof window === 'undefined' || !window.api?.workflows) return
    await window.api.workflows.stop(runId)
    // Optimistically flip to aborted; the actual workflow:progress 'errored'
    // event will firm it up.
    set((state) => ({
      runs: withRun(state.runs, runId, (r) =>
        r.status === 'running' ? { ...r, status: 'aborted' as WorkflowStatus } : r
      )
    }))
  },

  reset: () => {
    set({ runs: [] })
    syntheticCounter = 0
  }
}))
