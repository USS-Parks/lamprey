import type { LampreyToolDescriptor, ToolRisk } from './tool-registry'

// Run-phase model for a chat request. The renderer mirrors the current
// phase as a compact pill so the user can see what Lamprey is doing
// without parsing the stream.
//
// The chat loop emits a subset of these values today: 'understanding',
// 'gathering_context', 'acting', 'done', 'error'. 'planning',
// 'verifying', and 'summarizing' are valid states the type allows but no
// caller emits them yet — caller code that sets these will route through
// the same store path.

export type AgentRunPhase =
  | 'understanding'
  | 'gathering_context'
  | 'planning'
  | 'acting'
  | 'verifying'
  | 'summarizing'
  | 'done'
  | 'error'

// Tool ids that classify as verification rather than acting — typecheck,
// test, lint runs and the like. These surface as "Checking result" instead
// of "Editing" in the run-phase UI.
const VERIFICATION_TOOLS = new Set<string>(['verify_workspace', 'frontend_qa'])

// Risks that indicate the model is modifying state, not gathering context.
const ACTING_RISKS = new Set<ToolRisk>(['write', 'destructive', 'secret'])

export function inferPhaseFromDescriptor(
  descriptor: Pick<LampreyToolDescriptor, 'id' | 'risks'>
): AgentRunPhase {
  if (VERIFICATION_TOOLS.has(descriptor.id)) return 'verifying'
  for (const r of descriptor.risks) {
    if (ACTING_RISKS.has(r)) return 'acting'
  }
  // Pure 'read' or 'network' (or empty risks) → context-gathering. Web search,
  // file reads, view_image, web_find, browser_screenshot, etc.
  return 'gathering_context'
}
