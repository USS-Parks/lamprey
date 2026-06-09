import { describe, expect, it } from 'vitest'
import { computeProofBannerState } from './proof-banner-state'

describe('WC-5 computeProofBannerState', () => {
  it("returns null when proofStatus is 'trusted' (no banner on trusted turns)", () => {
    expect(computeProofBannerState('trusted', false)).toBeNull()
    expect(computeProofBannerState('trusted', true)).toBeNull()
  })

  it("returns 'waived' when proofStatus is 'waived' regardless of legacy notice", () => {
    expect(computeProofBannerState('waived', false)).toBe('waived')
    expect(computeProofBannerState('waived', true)).toBe('waived')
  })

  it("returns 'untrusted' when proofStatus is 'untrusted'", () => {
    expect(computeProofBannerState('untrusted', false)).toBe('untrusted')
    expect(computeProofBannerState('untrusted', true)).toBe('untrusted')
  })

  it("returns 'blocked' when proofStatus is 'blocked'", () => {
    expect(computeProofBannerState('blocked', false)).toBe('blocked')
  })

  it("falls back to 'untrusted' when proofStatus is undefined but legacy notice exists", () => {
    expect(computeProofBannerState(undefined, true)).toBe('untrusted')
  })

  it('returns null when proofStatus is undefined and no legacy notice', () => {
    expect(computeProofBannerState(undefined, false)).toBeNull()
  })

  it("structured proofStatus wins over legacy notice (trusted+notice → null)", () => {
    // If a trusted row somehow also has the legacy inline notice text,
    // the persisted column is the source of truth.
    expect(computeProofBannerState('trusted', true)).toBeNull()
  })
})
