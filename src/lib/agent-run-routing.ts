// Fluidity J7: routing decision for multi-agent run rendering.
//
// In-turn runs (the pipeline lives under the active turn — the multi_agent_run
// tool call or the agent-store.activeRun for `mode='multi'`) render as a
// nested chevron group inside the transcript. Background runs spawned via
// `tasks:spawn` with `runInBackground:true` keep the legacy banner UI so
// they remain visible across conversation switches.

export type AgentRunSurface = 'inline' | 'banner'

export interface AgentRunRoutingInput {
  runInBackground: boolean
}

export function routeAgentRun(input: AgentRunRoutingInput): AgentRunSurface {
  return input.runInBackground ? 'banner' : 'inline'
}
