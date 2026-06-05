import { describe, expect, it, vi } from 'vitest'

vi.mock('../settings-helper', () => ({
  readSettings: () => ({})
}))

vi.mock('../providers/registry', () => ({
  chatOnce: async () => {
    throw new Error('chatOnce called without test override')
  },
  resolveModel: () => ({ contextWindow: 128_000 })
}))

import {
  dedupePlannedQueries,
  parsePlannerOutput,
  planQueries,
  type PlannedQuery
} from './planner'

describe('parsePlannerOutput', () => {
  it('parses a clean JSON object', () => {
    const out = parsePlannerOutput(
      '{"queries":[{"q":"fusion energy 2026","angle":"baseline"},{"q":"ITER timeline","angle":"projects"}]}'
    )
    expect(out?.queries.length).toBe(2)
    expect(out?.queries[0].q).toBe('fusion energy 2026')
  })

  it('extracts JSON from prose-wrapped output', () => {
    const out = parsePlannerOutput(
      'Sure, here are the queries:\n```json\n{"queries":[{"q":"hello world","angle":"x"}]}\n```'
    )
    expect(out?.queries[0].q).toBe('hello world')
  })

  it('returns null on empty input', () => {
    expect(parsePlannerOutput('')).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    expect(parsePlannerOutput('not json')).toBeNull()
    expect(parsePlannerOutput('{"queries":}')).toBeNull()
  })

  it('returns null when queries array is missing', () => {
    expect(parsePlannerOutput('{"foo":1}')).toBeNull()
  })

  it('returns null when queries array is empty after filtering', () => {
    expect(parsePlannerOutput('{"queries":[{"q":""}]}')).toBeNull()
  })

  it('defaults missing angle to "unspecified"', () => {
    const out = parsePlannerOutput('{"queries":[{"q":"x"}]}')
    expect(out?.queries[0].angle).toBe('unspecified')
  })

  it('drops malformed entries but keeps valid ones', () => {
    const out = parsePlannerOutput(
      '{"queries":[{"q":"good"},{"missing":"q field"},{"q":"   "},{"q":"also good","angle":"x"}]}'
    )
    expect(out?.queries.length).toBe(2)
    expect(out?.queries.map((x) => x.q)).toEqual(['good', 'also good'])
  })
})

describe('dedupePlannedQueries', () => {
  it('keeps unique queries', () => {
    const input: PlannedQuery[] = [
      { q: 'fusion energy baseline', angle: 'baseline' },
      { q: 'iter project timeline', angle: 'projects' },
      { q: 'tokamak vs stellarator', angle: 'tech' }
    ]
    expect(dedupePlannedQueries(input).length).toBe(3)
  })

  it('drops near-duplicates by Jaccard overlap', () => {
    const input: PlannedQuery[] = [
      { q: 'fusion energy state of the art', angle: 'baseline' },
      { q: 'state of the art fusion energy', angle: 'baseline-2' },
      { q: 'fusion startups funding', angle: 'business' }
    ]
    const out = dedupePlannedQueries(input)
    expect(out.length).toBe(2)
    // First occurrence preserved.
    expect(out[0].angle).toBe('baseline')
    expect(out[1].q).toBe('fusion startups funding')
  })

  it('threshold is configurable', () => {
    const input: PlannedQuery[] = [
      { q: 'one two three four', angle: 'a' },
      { q: 'one two three five', angle: 'b' }
    ]
    // Jaccard = 3/5 = 0.6
    expect(dedupePlannedQueries(input, 0.5).length).toBe(1)
    expect(dedupePlannedQueries(input, 0.7).length).toBe(2)
  })

  it('handles empty input', () => {
    expect(dedupePlannedQueries([])).toEqual([])
  })
})

describe('planQueries', () => {
  it('returns the target number of queries for the depth tier', async () => {
    const llmOutput = JSON.stringify({
      queries: [
        { q: 'q1', angle: 'a' },
        { q: 'q2', angle: 'b' },
        { q: 'q3', angle: 'c' },
        { q: 'q4', angle: 'd' },
        { q: 'q5', angle: 'e' }
      ]
    })
    const r = await planQueries('what is X?', 'standard', undefined, {
      callLlm: async () => llmOutput
    })
    expect(r.queries.length).toBe(5)
  })

  it('quick depth → 3 queries even if the model returns more', async () => {
    const llmOutput = JSON.stringify({
      queries: Array.from({ length: 8 }, (_, i) => ({ q: `q${i}`, angle: 'a' + i }))
    })
    const r = await planQueries('what is X?', 'quick', undefined, {
      callLlm: async () => llmOutput
    })
    expect(r.queries.length).toBe(3)
  })

  it('exhaustive depth → up to 8 queries', async () => {
    const distinctQueries = [
      { q: 'fusion energy baseline overview', angle: 'baseline' },
      { q: 'iter timeline projected milestones', angle: 'projects' },
      { q: 'tokamak vs stellarator design', angle: 'tech' },
      { q: 'private fusion startup funding 2026', angle: 'business' },
      { q: 'criticism nuclear power adoption', angle: 'critique' },
      { q: 'tritium fuel supply constraints', angle: 'materials' },
      { q: 'commonwealth fusion sparc plasma', angle: 'company' },
      { q: 'magnetic confinement breakthrough records', angle: 'records' }
    ]
    const r = await planQueries('what is X?', 'exhaustive', undefined, {
      callLlm: async () => JSON.stringify({ queries: distinctQueries })
    })
    expect(r.queries.length).toBe(8)
  })

  it('retries once when the first LLM output is malformed', async () => {
    let callCount = 0
    const r = await planQueries('what is X?', 'quick', undefined, {
      callLlm: async () => {
        callCount++
        if (callCount === 1) return 'not json at all'
        return '{"queries":[{"q":"q1","angle":"a"},{"q":"q2","angle":"b"},{"q":"q3","angle":"c"}]}'
      }
    })
    expect(callCount).toBe(2)
    expect(r.queries.length).toBe(3)
  })

  it('throws when both attempts produce malformed output', async () => {
    await expect(
      planQueries('what is X?', 'quick', undefined, {
        callLlm: async () => 'still not json'
      })
    ).rejects.toThrow(/failed to produce valid JSON/)
  })

  it('dedupes near-identical queries in the LLM output', async () => {
    const llmOutput = JSON.stringify({
      queries: [
        { q: 'fusion energy state of the art', angle: 'a' },
        { q: 'state of the art fusion energy', angle: 'a-dup' },
        { q: 'fusion startup funding 2026', angle: 'business' }
      ]
    })
    const r = await planQueries('what is fusion?', 'quick', undefined, {
      callLlm: async () => llmOutput
    })
    // 3 input → 2 after dedup; quick caps at 3 so the cap doesn't bite.
    expect(r.queries.length).toBe(2)
  })

  it('angles are not all the same', async () => {
    const llmOutput = JSON.stringify({
      queries: [
        { q: 'baseline overview', angle: 'baseline' },
        { q: 'recent news', angle: 'news' },
        { q: 'opposing view', angle: 'critique' }
      ]
    })
    const r = await planQueries('what is X?', 'quick', undefined, {
      callLlm: async () => llmOutput
    })
    const angles = new Set(r.queries.map((q) => q.angle))
    expect(angles.size).toBe(3)
  })
})
