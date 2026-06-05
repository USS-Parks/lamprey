import { create } from 'zustand'

// Renderer-side tracker for in-flight deep-research runs. The
// `research:progress` event stream from main updates the snapshot per
// conversation; the `DeepResearchBanner` reads from this store to render
// the stage label + counts + cancel button.
//
// Each conversation tracks the LATEST run only; if a second run starts
// in the same conversation it replaces the previous snapshot. The
// terminal stages (`done` / `failed` / `cancelled`) flip `terminalAt`
// so the banner can fade-and-unmount itself after a short delay.

export type ResearchStage =
  | 'planning'
  | 'searching'
  | 'reading'
  | 'extracting-claims'
  | 'corroborating'
  | 'synthesizing'
  | 'writing-artifact'
  | 'done'
  | 'cancelled'
  | 'failed'

export interface ResearchProgressSnapshot {
  runId: string
  conversationId: string
  stage: ResearchStage
  sourcesFound: number
  sourcesFetched: number
  claimsExtracted: number
  claimsAccepted: number
  claimsDisputed: number
  elapsedMs: number
  error?: string
}

interface ResearchRunRecord {
  snapshot: ResearchProgressSnapshot
  /** Wall-clock ms at which the run reached a terminal stage. null while active. */
  terminalAt: number | null
}

interface ResearchRunsState {
  byConversation: Record<string, ResearchRunRecord>
  ingest: (snapshot: ResearchProgressSnapshot) => void
  clearForConversation: (conversationId: string) => void
  /** Test-only reset. */
  __reset: () => void
}

const TERMINAL_STAGES: ResearchStage[] = ['done', 'cancelled', 'failed']

export const useResearchRunsStore = create<ResearchRunsState>((set) => ({
  byConversation: {},
  ingest: (snapshot) =>
    set((state) => {
      const terminalAt = TERMINAL_STAGES.includes(snapshot.stage) ? Date.now() : null
      return {
        byConversation: {
          ...state.byConversation,
          [snapshot.conversationId]: { snapshot, terminalAt }
        }
      }
    }),
  clearForConversation: (conversationId) =>
    set((state) => {
      if (!state.byConversation[conversationId]) return state
      const next = { ...state.byConversation }
      delete next[conversationId]
      return { byConversation: next }
    }),
  __reset: () => set({ byConversation: {} })
}))
