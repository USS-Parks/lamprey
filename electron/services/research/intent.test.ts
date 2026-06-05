import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>
}))

vi.mock('../settings-helper', () => ({
  readSettings: () => state.settings
}))

// chatOnce is called by classifyResearchIntent — provide a default impl
// that fails loudly if not overridden in the test.
vi.mock('../providers/registry', () => ({
  chatOnce: async () => {
    throw new Error('chatOnce called without test override')
  },
  resolveModel: () => ({ contextWindow: 128_000 })
}))

import {
  _clearIntentCache,
  classifyResearchIntent,
  parseClassifierOutput,
  parseResearchPrefix,
  prefilterResearch,
  routeChatTurn,
  shouldEscalateToResearch
} from './intent'

beforeEach(() => {
  state.settings = {}
  _clearIntentCache()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseResearchPrefix', () => {
  it('strips /research prefix and returns verb=force', () => {
    expect(parseResearchPrefix('/research what is fusion?')).toEqual({
      verb: 'force',
      body: 'what is fusion?'
    })
  })

  it('strips --no-research prefix and returns verb=suppress', () => {
    expect(parseResearchPrefix('--no-research compare REST vs GraphQL')).toEqual({
      verb: 'suppress',
      body: 'compare REST vs GraphQL'
    })
  })

  it('is case-insensitive on the prefix verb', () => {
    expect(parseResearchPrefix('/RESEARCH what is X?').verb).toBe('force')
    expect(parseResearchPrefix('--NO-RESEARCH what?').verb).toBe('suppress')
  })

  it('only matches when the prefix is at the start', () => {
    expect(parseResearchPrefix('please /research X').verb).toBe('none')
  })

  it('returns verb=none with trimmed body when no prefix present', () => {
    expect(parseResearchPrefix('   hello world  ')).toEqual({ verb: 'none', body: 'hello world' })
  })

  it('handles bare /research with no body', () => {
    expect(parseResearchPrefix('/research')).toEqual({ verb: 'force', body: '' })
  })
})

describe('prefilterResearch — REJECT cases (code edits)', () => {
  const codeEditPrompts = [
    'fix the bug in chat.ts',
    'write a function to parse JSON',
    'implement the cascade module',
    'refactor this to use a Map',
    'add a new column to the conversations table',
    'remove the unused import',
    'rename the variable to userId',
    'debug the failing test',
    'test the new adapter',
    'review my pull request'
  ]
  for (const prompt of codeEditPrompts) {
    it(`rejects "${prompt}"`, () => {
      expect(prefilterResearch({ content: prompt }).decision).toBe('skip')
    })
  }

  it('rejects prompts containing a path-like token', () => {
    expect(prefilterResearch({ content: 'I see something weird in src/foo.ts:42' }).decision).toBe('skip')
  })

  it('rejects prompts containing a code fence', () => {
    expect(prefilterResearch({ content: 'why does this ```const x = 1``` not work?' }).decision).toBe('skip')
  })

  it('rejects short prompts that are not questions', () => {
    expect(prefilterResearch({ content: 'hello' }).decision).toBe('skip')
    expect(prefilterResearch({ content: 'tell me' }).decision).toBe('skip')
  })

  it('rejects prompts when plan mode is active', () => {
    expect(prefilterResearch({ content: 'compare REST vs GraphQL', planMode: true }).decision).toBe('skip')
  })

  it('rejects empty input', () => {
    expect(prefilterResearch({ content: '' }).decision).toBe('skip')
    expect(prefilterResearch({ content: '   ' }).decision).toBe('skip')
  })
})

describe('prefilterResearch — ALLOW cases (research-loud)', () => {
  const researchPrompts = [
    'tell me about the current state of fusion energy commercialization in 2026',
    'what is the latest research on quantum error correction?',
    'compare REST vs GraphQL for high-throughput APIs',
    'what are the pros and cons of using SQLite for analytics workloads',
    'history of the printing press',
    'who is the current CEO of OpenAI and what is their background?'
  ]
  for (const prompt of researchPrompts) {
    it(`allows "${prompt.slice(0, 50)}..."`, () => {
      const r = prefilterResearch({ content: prompt })
      expect(r.decision).toBe('allow')
      if (r.decision === 'allow') {
        expect(['quick', 'standard', 'exhaustive']).toContain(r.depth)
      }
    })
  }
})

describe('prefilterResearch — UNDECIDED cases', () => {
  it('defers ambiguous longer questions to the LLM', () => {
    const r = prefilterResearch({
      content: 'Could you walk me through the considerations around picking a vector database for a small product?'
    })
    expect(r.decision).toBe('undecided')
  })
})

describe('parseClassifierOutput', () => {
  it('parses a clean JSON object', () => {
    const out = parseClassifierOutput(
      '{"shouldResearch":true,"depth":"standard","confidence":0.8,"reason":"factual question"}'
    )
    expect(out).toEqual({
      shouldResearch: true,
      depth: 'standard',
      confidence: 0.8,
      reason: 'factual question'
    })
  })

  it('extracts JSON from surrounding prose', () => {
    const out = parseClassifierOutput(
      'Sure, here is my decision:\n{"shouldResearch":false,"depth":"quick","confidence":0.9,"reason":"code edit"}\nLet me know!'
    )
    expect(out?.shouldResearch).toBe(false)
  })

  it('returns null on empty input', () => {
    expect(parseClassifierOutput('')).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    expect(parseClassifierOutput('{this is not json}')).toBeNull()
  })

  it('clamps confidence into [0,1]', () => {
    const out = parseClassifierOutput(
      '{"shouldResearch":true,"depth":"standard","confidence":42,"reason":"x"}'
    )
    expect(out?.confidence).toBe(1)
    const out2 = parseClassifierOutput(
      '{"shouldResearch":true,"depth":"standard","confidence":-5,"reason":"x"}'
    )
    expect(out2?.confidence).toBe(0)
  })

  it('falls back to standard depth on unknown depth value', () => {
    const out = parseClassifierOutput(
      '{"shouldResearch":true,"depth":"extreme","confidence":0.5,"reason":"x"}'
    )
    expect(out?.depth).toBe('standard')
  })

  it('returns safe defaults for missing fields', () => {
    const out = parseClassifierOutput('{"reason":"hmm"}')
    expect(out?.shouldResearch).toBe(false)
    expect(out?.depth).toBe('standard')
    expect(out?.confidence).toBe(0)
    expect(out?.reason).toBe('hmm')
  })
})

describe('classifyResearchIntent', () => {
  it('returns null when the LLM call throws', async () => {
    const out = await classifyResearchIntent('what is X?', undefined, {
      callLlm: async () => {
        throw new Error('network')
      }
    })
    expect(out).toBeNull()
  })

  it('returns null when the LLM returns garbage', async () => {
    const out = await classifyResearchIntent('what is X?', undefined, {
      callLlm: async () => 'I am not sure what you mean'
    })
    expect(out).toBeNull()
  })
})

describe('shouldEscalateToResearch — composition', () => {
  it('--no-research prefix forces shouldResearch=false', async () => {
    const r = await shouldEscalateToResearch('--no-research what is fusion?')
    expect(r.shouldResearch).toBe(false)
    expect(r.source).toBe('prefix')
  })

  it('/research prefix forces shouldResearch=true', async () => {
    const r = await shouldEscalateToResearch('/research what is fusion?')
    expect(r.shouldResearch).toBe(true)
    expect(r.source).toBe('prefix')
    expect(r.body).toBe('what is fusion?')
  })

  it('prefilter skip → no LLM call', async () => {
    let llmCalls = 0
    const r = await shouldEscalateToResearch('fix the bug in chat.ts', {
      deps: {
        callLlm: async () => {
          llmCalls++
          return '{}'
        }
      }
    })
    expect(r.shouldResearch).toBe(false)
    expect(r.source).toBe('prefilter')
    expect(llmCalls).toBe(0)
  })

  it('prefilter allow → no LLM call', async () => {
    let llmCalls = 0
    const r = await shouldEscalateToResearch('tell me about the latest research on fusion energy', {
      deps: {
        callLlm: async () => {
          llmCalls++
          return '{}'
        }
      }
    })
    expect(r.shouldResearch).toBe(true)
    expect(r.source).toBe('prefilter')
    expect(llmCalls).toBe(0)
  })

  it('prefilter undecided → calls LLM and returns its decision', async () => {
    const r = await shouldEscalateToResearch(
      'Could you walk me through the considerations around picking a vector database for a small product?',
      {
        deps: {
          callLlm: async () =>
            '{"shouldResearch":true,"depth":"standard","confidence":0.7,"reason":"ambiguous tooling question"}'
        }
      }
    )
    expect(r.source).toBe('llm')
    expect(r.shouldResearch).toBe(true)
    expect(r.depth).toBe('standard')
  })

  it('caches LLM decisions across re-runs with the same prompt body', async () => {
    let llmCalls = 0
    const body =
      'Could you walk me through the considerations around picking a vector database for a small product?'
    const callLlm = async () => {
      llmCalls++
      return '{"shouldResearch":true,"depth":"standard","confidence":0.7,"reason":"x"}'
    }
    await shouldEscalateToResearch(body, { deps: { callLlm } })
    await shouldEscalateToResearch(body, { deps: { callLlm } })
    expect(llmCalls).toBe(1)
  })
})

describe('routeChatTurn — chat.ts integration shape', () => {
  it('routes /research as research regardless of autoTrigger', async () => {
    const r = await routeChatTurn('/research what is fusion?', { autoTrigger: false })
    expect(r.kind).toBe('research')
    if (r.kind === 'research') {
      expect(r.body).toBe('what is fusion?')
      expect(r.confidence).toBe(1)
    }
  })

  it('routes --no-research as normal with stripped body', async () => {
    const r = await routeChatTurn('--no-research compare A vs B', { autoTrigger: true })
    expect(r.kind).toBe('normal')
    if (r.kind === 'normal') expect(r.content).toBe('compare A vs B')
  })

  it('when autoTrigger=false, returns normal even for research-loud prompts (no LLM call)', async () => {
    let llmCalls = 0
    const r = await routeChatTurn('tell me about fusion energy commercialization', {
      autoTrigger: false,
      deps: {
        callLlm: async () => {
          llmCalls++
          return ''
        }
      }
    })
    expect(r.kind).toBe('normal')
    expect(llmCalls).toBe(0)
  })

  it('when autoTrigger=true and prefilter allows, routes research without LLM', async () => {
    let llmCalls = 0
    const r = await routeChatTurn('tell me about fusion energy commercialization', {
      autoTrigger: true,
      deps: {
        callLlm: async () => {
          llmCalls++
          return ''
        }
      }
    })
    expect(r.kind).toBe('research')
    expect(llmCalls).toBe(0)
  })

  it('when autoTrigger=true, prefilter undecided, and LLM says yes with confidence ≥ threshold → research', async () => {
    const r = await routeChatTurn(
      'Could you walk me through the considerations around picking a vector database for a small product?',
      {
        autoTrigger: true,
        deps: {
          callLlm: async () =>
            '{"shouldResearch":true,"depth":"standard","confidence":0.75,"reason":"x"}'
        }
      }
    )
    expect(r.kind).toBe('research')
  })

  it('when LLM confidence is below threshold, falls back to normal', async () => {
    const r = await routeChatTurn(
      'Could you walk me through the considerations around picking a vector database for a small product?',
      {
        autoTrigger: true,
        confidenceThreshold: 0.8,
        deps: {
          callLlm: async () =>
            '{"shouldResearch":true,"depth":"standard","confidence":0.5,"reason":"x"}'
        }
      }
    )
    expect(r.kind).toBe('normal')
  })

  it('when planMode is active, never escalates even for research-loud prompts', async () => {
    const r = await routeChatTurn('tell me about fusion energy', {
      autoTrigger: true,
      planMode: true
    })
    expect(r.kind).toBe('normal')
  })

  it('when LLM call fails, falls back to normal cleanly', async () => {
    const r = await routeChatTurn(
      'Could you walk me through the considerations around picking a vector database for a small product?',
      {
        autoTrigger: true,
        deps: {
          callLlm: async () => {
            throw new Error('network')
          }
        }
      }
    )
    expect(r.kind).toBe('normal')
  })
})
