import { describe, expect, it, vi } from 'vitest'
import type { Claim } from './claims'
import type { CuratedSource } from './collector'

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
  buildOppositionCandidates,
  corroborate,
  parseOppositionOutput,
  _corroboratorInternals,
  type EmbeddingProvider,
  type ClaimCluster
} from './corroborator'

function mkClaim(id: string, text: string, sourceN: number, span?: string): Claim {
  return { id, text, source_n: sourceN, span }
}

function mkSource(n: number, domain: string, url?: string): CuratedSource {
  return {
    n,
    url: url ?? `https://${domain}/p${n}`,
    canonicalUrl: url ?? `https://${domain}/p${n}`,
    title: `Source ${n}`,
    snippet: '',
    registrableDomain: domain,
    trustScore: 1,
    sourceQuery: 'q',
    sourceAngle: 'a',
    provider: 'duckduckgo'
  }
}

/**
 * Tiny deterministic "embedding" provider for tests: maps each claim to
 * a fixed-length vector keyed by a label included in the claim text.
 * Same label → identical vector → cluster together. Different labels →
 * orthogonal vectors → cluster apart.
 */
function fixedLabelEmbeddings(map: Record<string, number[]>): EmbeddingProvider {
  return {
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((t) => {
        for (const [label, vec] of Object.entries(map)) {
          if (t.includes(label)) return new Float32Array(vec)
        }
        return new Float32Array(Object.values(map)[0]?.map(() => 0) ?? [0])
      })
    }
  }
}

describe('cosine + normalize', () => {
  const { cosine, normalize } = _corroboratorInternals
  it('identical normalised vectors → cosine 1', () => {
    const v = normalize(new Float32Array([1, 1, 1]))
    expect(cosine(v, v)).toBeCloseTo(1, 5)
  })
  it('orthogonal vectors → cosine 0', () => {
    const a = normalize(new Float32Array([1, 0, 0]))
    const b = normalize(new Float32Array([0, 1, 0]))
    expect(cosine(a, b)).toBeCloseTo(0, 5)
  })
})

describe('tokenOverlap', () => {
  const { tokenOverlap } = _corroboratorInternals
  it('overlap 0 when no shared tokens', () => {
    expect(tokenOverlap('abc def', 'ghi jkl')).toBe(0)
  })
  it('overlap 1 when identical token sets', () => {
    expect(tokenOverlap('alpha beta gamma', 'gamma alpha beta')).toBeCloseTo(1, 3)
  })
})

describe('corroborate — clustering by embeddings', () => {
  it('clusters claims that share the same embedding label', async () => {
    const claims = [
      mkClaim('1-0', 'AAA fusion is hard', 1),
      mkClaim('2-0', 'AAA fusion is very hard', 2),
      mkClaim('3-0', 'BBB fusion is cheap', 3)
    ]
    const sources = [
      mkSource(1, 'reuters.com'),
      mkSource(2, 'nature.com'),
      mkSource(3, 'random-blog.com')
    ]
    const embed = fixedLabelEmbeddings({ AAA: [1, 0], BBB: [0, 1] })

    const r = await corroborate(claims, sources, embed, { clusterThreshold: 0.8 })
    // Two clusters: {AAA × 2} → accepted; {BBB × 1} → single-source.
    expect(r.accepted.length).toBe(1)
    expect(r.accepted[0].supportingDomains.sort()).toEqual(['nature.com', 'reuters.com'])
    expect(r.singleSource.length).toBe(1)
    expect(r.singleSource[0].supportingDomains).toEqual(['random-blog.com'])
    expect(r.disputed.length).toBe(0)
  })

  it('counts independence by registrable DOMAIN, not URL', async () => {
    // Three claims, two sources from the same publisher (different
    // subdomains), one from a different publisher.
    const claims = [
      mkClaim('1-0', 'AAA claim', 1),
      mkClaim('2-0', 'AAA claim alt', 2),
      mkClaim('3-0', 'AAA claim alt2', 3)
    ]
    const sources = [
      mkSource(1, 'bbc.co.uk', 'https://news.bbc.co.uk/a'),
      mkSource(2, 'bbc.co.uk', 'https://sport.bbc.co.uk/b'),
      mkSource(3, 'reuters.com', 'https://reuters.com/c')
    ]
    const embed = fixedLabelEmbeddings({ AAA: [1, 0] })
    const r = await corroborate(claims, sources, embed, { clusterThreshold: 0.8 })
    // One cluster — two domains (bbc.co.uk + reuters.com) → accepted.
    expect(r.accepted.length).toBe(1)
    expect(r.accepted[0].supportingDomains.sort()).toEqual(['bbc.co.uk', 'reuters.com'])
  })

  it('requires ≥ 2 independent domains for accepted', async () => {
    const claims = [
      mkClaim('1-0', 'AAA same claim', 1),
      mkClaim('2-0', 'AAA same claim', 2)
    ]
    const sources = [
      mkSource(1, 'example.com'),
      mkSource(2, 'example.com')
    ]
    const embed = fixedLabelEmbeddings({ AAA: [1, 0] })
    const r = await corroborate(claims, sources, embed)
    expect(r.accepted.length).toBe(0)
    expect(r.singleSource.length).toBe(1)
  })

  it('returns empty ClaimSet on empty input without throwing', async () => {
    const embed = fixedLabelEmbeddings({ AAA: [1, 0] })
    const r = await corroborate([], [], embed)
    expect(r).toEqual({ accepted: [], singleSource: [], disputed: [] })
  })

  it('falls back to all-single-source when embeddings throw', async () => {
    const failing: EmbeddingProvider = {
      embed: async () => {
        throw new Error('worker dead')
      }
    }
    const claims = [mkClaim('1-0', 'a', 1), mkClaim('2-0', 'b', 2)]
    const sources = [mkSource(1, 'x.com'), mkSource(2, 'y.com')]
    const r = await corroborate(claims, sources, failing)
    expect(r.accepted.length).toBe(0)
    expect(r.singleSource.length).toBe(2)
    expect(r.disputed.length).toBe(0)
  })

  it('falls back when embeddings count mismatches claims count', async () => {
    const bad: EmbeddingProvider = {
      embed: async () => [new Float32Array([1, 0])]
    }
    const claims = [mkClaim('1-0', 'a', 1), mkClaim('2-0', 'b', 2)]
    const sources = [mkSource(1, 'x.com'), mkSource(2, 'y.com')]
    const r = await corroborate(claims, sources, bad)
    expect(r.singleSource.length).toBe(2)
  })

  it('clustering is deterministic across runs', async () => {
    const claims = [
      mkClaim('1-0', 'AAA hello', 1),
      mkClaim('2-0', 'BBB world', 2),
      mkClaim('3-0', 'AAA goodbye', 3)
    ]
    const sources = [mkSource(1, 'a.com'), mkSource(2, 'b.com'), mkSource(3, 'c.com')]
    const embed = fixedLabelEmbeddings({ AAA: [1, 0], BBB: [0, 1] })
    const r1 = await corroborate(claims, sources, embed)
    const r2 = await corroborate(claims, sources, embed)
    expect(r1.accepted.length).toBe(r2.accepted.length)
    expect(r1.accepted.map((c) => c.id)).toEqual(r2.accepted.map((c) => c.id))
  })
})

describe('corroborate — dispute detection', () => {
  it('flags opposing clusters as disputed and removes them from accepted', async () => {
    // Two clusters: claim A and claim B share enough topical tokens to be
    // a candidate opposition pair (overlap in [0.15, 0.6]), but the
    // embedding model puts them in different clusters. The mock LLM
    // declares them contradictory.
    const claims = [
      mkClaim('1-0', 'AAA fusion has been demonstrated commercially', 1),
      mkClaim('2-0', 'AAA fusion has been demonstrated commercially', 2),
      mkClaim('3-0', 'BBB fusion is purely theoretical no commercial demonstration', 3),
      mkClaim('4-0', 'BBB fusion is purely theoretical no commercial demonstration', 4)
    ]
    const sources = [
      mkSource(1, 'a.com'),
      mkSource(2, 'b.com'),
      mkSource(3, 'c.com'),
      mkSource(4, 'd.com')
    ]
    const embed = fixedLabelEmbeddings({ AAA: [1, 0], BBB: [0, 1] })
    let llmCalls = 0
    const r = await corroborate(claims, sources, embed, {
      callLlm: async () => {
        llmCalls++
        return '{"contradicts":true,"reason":"opposite claims about commercial status"}'
      }
    })
    expect(llmCalls).toBeGreaterThan(0)
    expect(r.disputed.length).toBe(1)
    expect(r.accepted.length).toBe(0)
    expect(r.singleSource.length).toBe(0)
  })

  it('skips clusters with no topical overlap (no LLM call)', async () => {
    const claims = [
      mkClaim('1-0', 'AAA cats are mammals', 1),
      mkClaim('2-0', 'BBB the moon is dry', 2)
    ]
    const sources = [mkSource(1, 'a.com'), mkSource(2, 'b.com')]
    const embed = fixedLabelEmbeddings({ AAA: [1, 0], BBB: [0, 1] })
    let llmCalls = 0
    await corroborate(claims, sources, embed, {
      callLlm: async () => {
        llmCalls++
        return '{"contradicts":true,"reason":"x"}'
      }
    })
    expect(llmCalls).toBe(0)
  })

  it('caps the number of opposition pairs sent to the LLM', async () => {
    // Build 8 clusters with topical overlap with each other (many
    // potential pairs).
    const claims = Array.from({ length: 8 }, (_, i) =>
      mkClaim(`${i + 1}-0`, `LABEL${i} fusion energy renewable nuclear power claim`, i + 1)
    )
    const sources = claims.map((c) => mkSource(c.source_n, `d${c.source_n}.com`))
    const embed: EmbeddingProvider = {
      // Each claim gets a distinct vector so they all cluster separately.
      embed: async (texts) =>
        texts.map((_t, idx) => {
          const v = new Float32Array(8)
          v[idx] = 1
          return v
        })
    }
    let llmCalls = 0
    await corroborate(claims, sources, embed, {
      maxOppositionPairs: 3,
      callLlm: async () => {
        llmCalls++
        return '{"contradicts":false,"reason":"x"}'
      }
    })
    expect(llmCalls).toBeLessThanOrEqual(3)
  })

  it('non-contradicting LLM verdict does not mark clusters as disputed', async () => {
    const claims = [
      mkClaim('1-0', 'AAA fusion energy is hard', 1),
      mkClaim('2-0', 'AAA fusion energy is hard', 2),
      mkClaim('3-0', 'BBB fusion energy is expensive', 3)
    ]
    const sources = [mkSource(1, 'a.com'), mkSource(2, 'b.com'), mkSource(3, 'c.com')]
    const embed = fixedLabelEmbeddings({ AAA: [1, 0], BBB: [0, 1] })
    const r = await corroborate(claims, sources, embed, {
      callLlm: async () => '{"contradicts":false,"reason":"different facets"}'
    })
    expect(r.disputed.length).toBe(0)
  })
})

describe('parseOppositionOutput', () => {
  it('parses a clean JSON object', () => {
    const o = parseOppositionOutput('{"contradicts":true,"reason":"x"}')
    expect(o?.contradicts).toBe(true)
  })

  it('returns null on malformed JSON', () => {
    expect(parseOppositionOutput('not json')).toBeNull()
    expect(parseOppositionOutput('')).toBeNull()
  })

  it('defaults missing fields safely', () => {
    const o = parseOppositionOutput('{}')
    expect(o?.contradicts).toBe(false)
    expect(o?.reason).toBe('no reason given')
  })
})

describe('buildOppositionCandidates', () => {
  function mkCluster(id: string, text: string): ClaimCluster {
    return {
      id,
      representative: { id: `${id}-0`, text, source_n: 1 },
      claims: [{ id: `${id}-0`, text, source_n: 1 }],
      supportingDomains: ['x.com']
    }
  }

  it('selects pairs with moderate topical overlap (excludes very low + very high)', () => {
    const clusters = [
      mkCluster('c0', 'fusion energy has been demonstrated commercially with real returns'),
      mkCluster('c1', 'fusion energy purely theoretical not been demonstrated commercially with anything'),
      mkCluster('c2', 'the moon orbits earth at thirty thousand kilometers distance')
    ]
    const pairs = buildOppositionCandidates(clusters, 10)
    // c0 vs c1 has high overlap (same topic, different claims) → included.
    // c0/c1 vs c2 has zero overlap → excluded.
    expect(pairs.length).toBe(1)
    expect(pairs[0][0].id).toBe('c0')
    expect(pairs[0][1].id).toBe('c1')
  })

  it('returns at most cap pairs', () => {
    const clusters = Array.from({ length: 5 }, (_, i) =>
      mkCluster(`c${i}`, 'fusion energy renewable nuclear power claim variant')
    )
    const pairs = buildOppositionCandidates(clusters, 2)
    expect(pairs.length).toBeLessThanOrEqual(2)
  })
})
