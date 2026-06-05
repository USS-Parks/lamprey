import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useResearchRunsStore, type ResearchProgressSnapshot } from './research-runs-store'

function mkSnap(overrides: Partial<ResearchProgressSnapshot> = {}): ResearchProgressSnapshot {
  return {
    runId: 'run-1',
    conversationId: 'conv-1',
    stage: 'planning',
    sourcesFound: 0,
    sourcesFetched: 0,
    claimsExtracted: 0,
    claimsAccepted: 0,
    claimsDisputed: 0,
    elapsedMs: 0,
    ...overrides
  }
}

beforeEach(() => {
  useResearchRunsStore.getState().__reset()
})

afterEach(() => {
  useResearchRunsStore.getState().__reset()
})

describe('useResearchRunsStore', () => {
  it('ingest stores the snapshot under the conversation id', () => {
    useResearchRunsStore.getState().ingest(mkSnap({ stage: 'searching', sourcesFound: 12 }))
    const rec = useResearchRunsStore.getState().byConversation['conv-1']
    expect(rec.snapshot.stage).toBe('searching')
    expect(rec.snapshot.sourcesFound).toBe(12)
    expect(rec.terminalAt).toBeNull()
  })

  it('flags terminalAt on done / cancelled / failed stages', () => {
    useResearchRunsStore.getState().ingest(mkSnap({ stage: 'done' }))
    expect(useResearchRunsStore.getState().byConversation['conv-1'].terminalAt).toBeGreaterThan(0)
  })

  it('latest snapshot for a conversation replaces the previous', () => {
    useResearchRunsStore.getState().ingest(mkSnap({ stage: 'searching', sourcesFound: 5 }))
    useResearchRunsStore.getState().ingest(mkSnap({ stage: 'reading', sourcesFetched: 3, sourcesFound: 5 }))
    expect(useResearchRunsStore.getState().byConversation['conv-1'].snapshot.stage).toBe('reading')
  })

  it('clearForConversation removes only that conversation', () => {
    useResearchRunsStore.getState().ingest(mkSnap({ conversationId: 'a' }))
    useResearchRunsStore.getState().ingest(mkSnap({ conversationId: 'b' }))
    useResearchRunsStore.getState().clearForConversation('a')
    expect(useResearchRunsStore.getState().byConversation['a']).toBeUndefined()
    expect(useResearchRunsStore.getState().byConversation['b']).toBeDefined()
  })
})
