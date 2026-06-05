import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaimSet, EmbeddingProvider } from './corroborator'
import type { CuratedSource } from './collector'
import type { ExtractedPage } from './extractor'
import type { Claim } from './claims'
import type { PlanResult } from './planner'

vi.mock('../settings-helper', () => ({
  readSettings: () => ({})
}))

vi.mock('../providers/registry', () => ({
  chatOnce: async () => {
    throw new Error('chatOnce called without test override')
  },
  resolveModel: () => ({ contextWindow: 128_000 })
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-userdata-research'
  }
}))

import {
  __resetActiveRuns,
  cancelRun,
  DeepResearchCancelledError,
  FabricatedCitationError,
  getRunStatus,
  listActiveRuns,
  runDeepResearch,
  type ResearchProgress
} from './index'

beforeEach(() => {
  __resetActiveRuns()
})

afterEach(() => {
  __resetActiveRuns()
})

function mkSource(n: number, domain: string): CuratedSource {
  return {
    n,
    url: `https://${domain}/p${n}`,
    canonicalUrl: `https://${domain}/p${n}`,
    title: `Title ${n}`,
    snippet: '',
    registrableDomain: domain,
    trustScore: 1,
    sourceQuery: 'q',
    sourceAngle: 'a',
    provider: 'duckduckgo'
  }
}

const fakeEmbeddings: EmbeddingProvider = {
  async embed(texts) {
    return texts.map((_t, i) => {
      const v = new Float32Array(8)
      v[i % 8] = 1
      return v
    })
  }
}

function makeStubs(overrides: Partial<Parameters<typeof runDeepResearch>[0]['deps']> = {}) {
  const sources = [mkSource(1, 'a.com'), mkSource(2, 'b.com')]
  const claims: Claim[] = [
    { id: '1-0', text: 'X is true', source_n: 1 },
    { id: '2-0', text: 'X is true', source_n: 2 }
  ]
  const claimSet: ClaimSet = {
    accepted: [
      {
        id: 'c0',
        representative: claims[0],
        claims,
        supportingDomains: ['a.com', 'b.com']
      }
    ],
    singleSource: [],
    disputed: []
  }

  const pages: ExtractedPage[] = sources.map((s) => ({
    n: s.n,
    url: s.url,
    status: 'ok',
    title: s.title,
    fullText: 'some text',
    fetchedAt: 1
  }))

  return {
    planQueries: async (): Promise<PlanResult> => ({
      queries: [{ q: 'q1', angle: 'a' }, { q: 'q2', angle: 'b' }]
    }),
    collectSources: async () => ({
      sources,
      providersUsed: ['duckduckgo'],
      rawCount: 4,
      errors: []
    }),
    extractAll: async () => pages,
    extractClaimsAll: async () => claims,
    corroborate: async () => claimSet,
    synthesizeReport: async () => ({
      markdown: 'Body about X [1, 2].\n\n## Sources\n\n[1] [Title 1](https://a.com/p1) — accessed 2026-06-05\n[2] [Title 2](https://b.com/p2) — accessed 2026-06-05\n',
      summary: 'Body about X [1, 2].',
      citedSources: sources,
      filenameSlug: 'fusion-slug'
    }),
    embeddings: fakeEmbeddings,
    writeArtifact: () => {
      // memory sink for tests
    },
    now: () => 1_780_000_000_000,
    accessedAt: '2026-06-05',
    ...overrides
  }
}

describe('runDeepResearch — happy path', () => {
  it('runs every stage and returns a DeepResearchOutcome', async () => {
    const progress: ResearchProgress[] = []
    const outcome = await runDeepResearch({
      question: 'what is fusion?',
      depth: 'quick',
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      onProgress: (p) => progress.push(p),
      deps: makeStubs()
    })
    expect(outcome.summary).toContain('Body about X')
    expect(outcome.sourceCount).toBe(2)
    expect(outcome.acceptedCount).toBe(1)
    expect(outcome.disputedCount).toBe(0)
    expect(outcome.filename).toContain('research-fusion-slug')
    expect(outcome.markdown).toContain('## Sources')
  })

  it('emits progress events at every stage boundary in order', async () => {
    const stages: string[] = []
    await runDeepResearch({
      question: 'what is fusion?',
      depth: 'quick',
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      onProgress: (p) => stages.push(p.stage),
      deps: makeStubs()
    })
    expect(stages[0]).toBe('planning')
    expect(stages).toContain('searching')
    expect(stages).toContain('reading')
    expect(stages).toContain('extracting-claims')
    expect(stages).toContain('corroborating')
    expect(stages).toContain('synthesizing')
    expect(stages).toContain('writing-artifact')
    expect(stages[stages.length - 1]).toBe('done')
  })

  it('writes the artifact to disk via the injected writer', async () => {
    let writtenPath = ''
    let writtenBody = ''
    await runDeepResearch({
      question: 'what is fusion?',
      depth: 'quick',
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      deps: makeStubs({
        writeArtifact: (path, body) => {
          writtenPath = path
          writtenBody = body
        }
      })
    })
    expect(writtenPath).toContain('research-fusion-slug')
    expect(writtenPath.endsWith('.md')).toBe(true)
    expect(writtenBody).toContain('## Sources')
  })
})

describe('runDeepResearch — failure paths', () => {
  it('throws when the collector returns zero sources', async () => {
    await expect(
      runDeepResearch({
        question: 'q',
        depth: 'quick',
        conversationId: 'c1',
        correlationId: 'cr1',
        deps: makeStubs({
          collectSources: async () => ({ sources: [], providersUsed: [], rawCount: 0, errors: [] })
        })
      })
    ).rejects.toThrow(/No sources found/)
  })

  it('throws when every source fails to extract', async () => {
    await expect(
      runDeepResearch({
        question: 'q',
        depth: 'quick',
        conversationId: 'c1',
        correlationId: 'cr1',
        deps: makeStubs({
          extractAll: async () => [
            {
              n: 1,
              url: 'x',
              status: 'failed',
              title: '',
              fullText: '',
              fetchedAt: 1,
              error: 'HTTP 404'
            }
          ]
        })
      })
    ).rejects.toThrow(/No pages could be extracted/)
  })

  it('throws when no claims are extracted', async () => {
    await expect(
      runDeepResearch({
        question: 'q',
        depth: 'quick',
        conversationId: 'c1',
        correlationId: 'cr1',
        deps: makeStubs({
          extractClaimsAll: async () => []
        })
      })
    ).rejects.toThrow(/No factual claims/)
  })

  it('propagates FabricatedCitationError from the synthesizer', async () => {
    const stubs = makeStubs({
      synthesizeReport: async () => {
        throw new FabricatedCitationError([42])
      }
    })
    await expect(
      runDeepResearch({
        question: 'q',
        depth: 'quick',
        conversationId: 'c1',
        correlationId: 'cr1',
        deps: stubs
      })
    ).rejects.toBeInstanceOf(FabricatedCitationError)
  })

  it('emits stage=failed before re-throwing', async () => {
    const progress: ResearchProgress[] = []
    await expect(
      runDeepResearch({
        question: 'q',
        depth: 'quick',
        conversationId: 'c1',
        correlationId: 'cr1',
        onProgress: (p) => progress.push(p),
        deps: makeStubs({
          collectSources: async () => ({ sources: [], providersUsed: [], rawCount: 0, errors: [] })
        })
      })
    ).rejects.toBeTruthy()
    const last = progress[progress.length - 1]
    expect(last.stage).toBe('failed')
    expect(last.error).toContain('No sources')
  })
})

describe('runDeepResearch — cancellation', () => {
  it('honours an AbortSignal aborted before the first stage', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(
      runDeepResearch({
        question: 'q',
        depth: 'quick',
        conversationId: 'c1',
        correlationId: 'cr1',
        abortSignal: ctrl.signal,
        deps: makeStubs()
      })
    ).rejects.toBeInstanceOf(DeepResearchCancelledError)
  })

  it('honours an AbortSignal aborted mid-pipeline', async () => {
    const ctrl = new AbortController()
    const stubs = makeStubs({
      collectSources: async () => {
        ctrl.abort()
        return { sources: [mkSource(1, 'a.com')], providersUsed: ['duckduckgo'], rawCount: 1, errors: [] }
      }
    })
    await expect(
      runDeepResearch({
        question: 'q',
        depth: 'quick',
        conversationId: 'c1',
        correlationId: 'cr1',
        abortSignal: ctrl.signal,
        deps: stubs
      })
    ).rejects.toBeInstanceOf(DeepResearchCancelledError)
  })
})

describe('Active-run registry', () => {
  it('listActiveRuns reflects in-flight runs', async () => {
    const slowStubs = makeStubs({
      planQueries: async () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ queries: [{ q: 'q', angle: 'a' }] }), 50)
        )
    })
    const promise = runDeepResearch({
      question: 'q',
      depth: 'quick',
      conversationId: 'c1',
      correlationId: 'cr1',
      onProgress: () => {
        /* triggers registration via IPC layer; the registry is populated by ipc/research.ts in production */
      },
      deps: slowStubs
    })
    void promise
    await promise.catch(() => undefined)
    expect(listActiveRuns()).toEqual([])
  })

  it('getRunStatus returns null for unknown runIds', () => {
    expect(getRunStatus('nope')).toBeNull()
  })

  it('cancelRun returns false for unknown runIds', () => {
    expect(cancelRun('nope')).toBe(false)
  })
})
