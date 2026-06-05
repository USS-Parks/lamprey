import { describe, expect, it, vi } from 'vitest'
import type { Claim } from './claims'
import type { CuratedSource } from './collector'
import type { ClaimSet, ClaimCluster, DisputeGroup } from './corroborator'

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
  FabricatedCitationError,
  _synthesizerInternals,
  extractCitationRefs,
  synthesizeReport,
  type SynthesisInput
} from './synthesizer'
import { slugify } from './slugify'

function mkSource(n: number, domain: string, title?: string): CuratedSource {
  return {
    n,
    url: `https://${domain}/page-${n}`,
    canonicalUrl: `https://${domain}/page-${n}`,
    title: title ?? `Title ${n}`,
    snippet: '',
    registrableDomain: domain,
    trustScore: 1,
    sourceQuery: 'q',
    sourceAngle: 'a',
    provider: 'duckduckgo'
  }
}

function mkClaim(id: string, text: string, sourceN: number): Claim {
  return { id, text, source_n: sourceN }
}

function mkCluster(id: string, text: string, sourceNs: number[]): ClaimCluster {
  const claims = sourceNs.map((n, i) => mkClaim(`${n}-${i}`, text, n))
  return {
    id,
    representative: claims[0],
    claims,
    supportingDomains: sourceNs.map((n) => `d${n}.com`)
  }
}

const ACCESSED_AT = '2026-06-05'

function mkInput(claimSet: ClaimSet, sources: CuratedSource[], question = 'what is fusion?'): SynthesisInput {
  return { question, claimSet, sources, accessedAt: ACCESSED_AT }
}

describe('slugify', () => {
  it('lowercases + hyphenates a question', () => {
    expect(slugify('What is the current state of fusion energy?')).toBe('what-is-the-current-state-of-fusion-energy')
  })
  it('strips diacritics', () => {
    expect(slugify('café résumé')).toBe('cafe-resume')
  })
  it('falls back to "research" on empty input', () => {
    expect(slugify('')).toBe('research')
    expect(slugify('!!!???')).toBe('research')
  })
  it('caps at 80 chars and trims trailing hyphen', () => {
    const long = 'word '.repeat(50)
    const s = slugify(long)
    expect(s.length).toBeLessThanOrEqual(80)
    expect(s.endsWith('-')).toBe(false)
  })
})

describe('extractCitationRefs', () => {
  it('extracts single refs', () => {
    expect(extractCitationRefs('hello [3] world')).toEqual([3])
  })
  it('extracts multi-ref groups', () => {
    expect(extractCitationRefs('a [1, 4, 7] b')).toEqual([1, 4, 7])
  })
  it('combines multiple groups', () => {
    expect(extractCitationRefs('p1 [1] then [2,3] and [4]')).toEqual([1, 2, 3, 4])
  })
  it('ignores refs inside code fences', () => {
    expect(extractCitationRefs('text [3]\n```\nstuff [99]\n```\nmore [4]')).toEqual([3, 4])
  })
  it('returns empty array on no refs', () => {
    expect(extractCitationRefs('plain text')).toEqual([])
  })
})

describe('synthesizeReport — happy path', () => {
  it('builds a complete report with bibliography from a corroborated claim set', async () => {
    const sources = [mkSource(1, 'reuters.com'), mkSource(2, 'nature.com'), mkSource(3, 'mit.edu')]
    const claimSet: ClaimSet = {
      accepted: [mkCluster('c0', 'Fusion is hard', [1, 2])],
      singleSource: [mkCluster('c1', 'MIT runs experiments', [3])],
      disputed: []
    }
    const input = mkInput(claimSet, sources)
    const r = await synthesizeReport(input, {
      callLlm: async () =>
        `Fusion remains an active area of research [1, 2]. According to [3], MIT operates major experimental facilities.`
    })
    expect(r.markdown).toContain('## Sources')
    expect(r.markdown).toContain('[1] [Title 1](https://reuters.com/page-1)')
    expect(r.markdown).toContain('[2] [Title 2](https://nature.com/page-2)')
    expect(r.markdown).toContain('[3] [Title 3](https://mit.edu/page-3)')
    expect(r.markdown).toContain('accessed 2026-06-05')
    expect(r.citedSources.map((s) => s.n)).toEqual([1, 2, 3])
    expect(r.summary).toContain('Fusion remains')
  })

  it('orders the bibliography by first appearance in the body', async () => {
    const sources = [mkSource(1, 'a.com'), mkSource(2, 'b.com'), mkSource(3, 'c.com')]
    const claimSet: ClaimSet = {
      accepted: [],
      singleSource: [mkCluster('c0', 'x', [3]), mkCluster('c1', 'y', [1]), mkCluster('c2', 'z', [2])],
      disputed: []
    }
    const input = mkInput(claimSet, sources)
    const r = await synthesizeReport(input, {
      callLlm: async () => 'Paragraph one [3]. Paragraph two [1]. Paragraph three [2].'
    })
    expect(r.citedSources.map((s) => s.n)).toEqual([3, 1, 2])
  })

  it('drops bibliography section the model emitted, then appends our own', async () => {
    const sources = [mkSource(1, 'a.com')]
    const claimSet: ClaimSet = {
      accepted: [],
      singleSource: [mkCluster('c0', 'x', [1])],
      disputed: []
    }
    const input = mkInput(claimSet, sources)
    const r = await synthesizeReport(input, {
      callLlm: async () =>
        `According to [1], X is true.\n\n## Sources\n- [1] WRONG URL https://wrong.com`
    })
    // Our deterministic bibliography (with the right URL) is present.
    expect(r.markdown).toContain('[1] [Title 1](https://a.com/page-1)')
    // The model's wrong bibliography did not leak through (only one ## Sources).
    expect(r.markdown.match(/## Sources/g)?.length).toBe(1)
    expect(r.markdown).not.toContain('wrong.com')
  })

  it('uses the source URL straight from the source pool, never the model output', async () => {
    const sources = [mkSource(1, 'reuters.com', 'A Reuters Article')]
    const claimSet: ClaimSet = {
      accepted: [],
      singleSource: [mkCluster('c0', 'X', [1])],
      disputed: []
    }
    const input = mkInput(claimSet, sources)
    const r = await synthesizeReport(input, {
      callLlm: async () => 'According to [1], X holds.'
    })
    expect(r.markdown).toContain('https://reuters.com/page-1')
  })

  it('passes disputed claim pairs through to the system prompt context', async () => {
    const sources = [mkSource(1, 'a.com'), mkSource(2, 'b.com')]
    const dispute: DisputeGroup = {
      a: mkCluster('cA', 'fusion works commercially', [1]),
      b: mkCluster('cB', 'fusion is purely theoretical', [2]),
      reason: 'direct opposition'
    }
    const claimSet: ClaimSet = { accepted: [], singleSource: [], disputed: [dispute] }
    let userContent = ''
    await synthesizeReport(mkInput(claimSet, sources), {
      callLlm: async (messages) => {
        userContent = String(messages[1]?.content ?? '')
        return 'Some say X [1]; others say Y [2].'
      }
    })
    expect(userContent).toContain('DISPUTED CLAIM PAIRS')
    expect(userContent).toContain('fusion works commercially')
    expect(userContent).toContain('fusion is purely theoretical')
  })
})

describe('synthesizeReport — strict citation validator', () => {
  it('throws FabricatedCitationError when the model cites an index not in the pool', async () => {
    const sources = [mkSource(1, 'a.com'), mkSource(2, 'b.com')]
    const claimSet: ClaimSet = {
      accepted: [mkCluster('c0', 'x', [1, 2])],
      singleSource: [],
      disputed: []
    }
    await expect(
      synthesizeReport(mkInput(claimSet, sources), {
        callLlm: async () => 'Claim about X [1, 99].'
      })
    ).rejects.toBeInstanceOf(FabricatedCitationError)
  })

  it('retries once when fabricated citations are detected, then succeeds', async () => {
    const sources = [mkSource(1, 'a.com'), mkSource(2, 'b.com')]
    const claimSet: ClaimSet = {
      accepted: [mkCluster('c0', 'x', [1, 2])],
      singleSource: [],
      disputed: []
    }
    let calls = 0
    const r = await synthesizeReport(mkInput(claimSet, sources), {
      callLlm: async () => {
        calls++
        if (calls === 1) return 'X holds [1, 99].'
        return 'X holds [1, 2].'
      }
    })
    expect(calls).toBe(2)
    expect(r.markdown).toContain('X holds [1, 2]')
  })

  it('FabricatedCitationError exposes the fabricated indices', async () => {
    const sources = [mkSource(1, 'a.com')]
    const claimSet: ClaimSet = {
      accepted: [],
      singleSource: [mkCluster('c0', 'x', [1])],
      disputed: []
    }
    try {
      await synthesizeReport(mkInput(claimSet, sources), {
        callLlm: async () => 'X [42, 99].'
      })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(FabricatedCitationError)
      expect((err as FabricatedCitationError).fabricatedRefs).toEqual([42, 99])
    }
  })

  it('does NOT throw when every cited index is in the source pool', async () => {
    const sources = [mkSource(1, 'a.com'), mkSource(2, 'b.com'), mkSource(3, 'c.com')]
    const claimSet: ClaimSet = {
      accepted: [mkCluster('c0', 'x', [1, 2, 3])],
      singleSource: [],
      disputed: []
    }
    const r = await synthesizeReport(mkInput(claimSet, sources), {
      callLlm: async () => 'X [1]. Y [2]. Z [3].'
    })
    expect(r.markdown).toContain('## Sources')
  })
})

describe('synthesizeReport — filename slug', () => {
  it('derives the filename slug from the question', async () => {
    const sources = [mkSource(1, 'a.com')]
    const claimSet: ClaimSet = {
      accepted: [],
      singleSource: [mkCluster('c0', 'x', [1])],
      disputed: []
    }
    const r = await synthesizeReport(
      { ...mkInput(claimSet, sources), question: 'What is the current state of fusion energy?' },
      { callLlm: async () => 'X [1].' }
    )
    expect(r.filenameSlug).toBe('what-is-the-current-state-of-fusion-energy')
  })
})

describe('synthesizeReport — system prompt is sensible', () => {
  it('system prompt mentions strict citation rules', () => {
    expect(_synthesizerInternals.SYSTEM_PROMPT).toContain('Every paragraph')
    expect(_synthesizerInternals.SYSTEM_PROMPT).toContain('SOURCE POOL')
    expect(_synthesizerInternals.SYSTEM_PROMPT).toContain('NEVER invent')
  })
})
