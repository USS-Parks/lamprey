import type { DepthTier } from './intent'

// Public entry point for the deep-research pipeline.
//
// D3 ships a stub that throws a typed `NotImplementedError`. The real
// implementation lands in D10 (orchestrator) and D11 (artifact emission).
// Until then, `chat.ts` catches the typed error and falls back to normal
// chat dispatch, logging the miss so we can see if a user has manually
// flipped `deepResearch.autoTrigger` before the pipeline is ready.

export class DeepResearchNotImplementedError extends Error {
  constructor() {
    super('Deep research pipeline is not yet wired (D10 outstanding).')
    this.name = 'DeepResearchNotImplementedError'
  }
}

export interface RunDeepResearchOpts {
  question: string
  depth: DepthTier
  conversationId: string
  correlationId: string
  abortSignal?: AbortSignal
  onProgress?: (event: Record<string, unknown>) => void
}

export interface DeepResearchOutcome {
  artifactPath: string
  filename: string
  /** Brief executive summary (1-3 sentences) shown inline in chat. */
  summary: string
  /** Number of sources cited in the final report. */
  sourceCount: number
  acceptedCount: number
  singleSourceCount: number
  disputedCount: number
}

export async function runDeepResearch(_opts: RunDeepResearchOpts): Promise<DeepResearchOutcome> {
  throw new DeepResearchNotImplementedError()
}

export function isDeepResearchNotImplemented(err: unknown): boolean {
  return err instanceof DeepResearchNotImplementedError
}
