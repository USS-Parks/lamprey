import { describe, it, expect, beforeEach } from 'vitest'
import {
  isRigorRequest,
  setProofRigor,
  isProofRigorActive,
  resolveProofRigor,
  shouldEngageProofGate,
  markMutationAttempted,
  clearMutationAttempted,
  hasMutationAttempted,
  setRigorRequiresMutation,
  isRigorRequiresMutation,
  __resetProofRigorForTesting
} from './proof-rigor'

describe('proof-rigor (HY5 Split)', () => {
  beforeEach(() => __resetProofRigorForTesting())

  it('detects rigor verbs in a prompt', () => {
    expect(isRigorRequest('audit the IPC handlers')).toBe(true)
    expect(isRigorRequest('please verify this works')).toBe(true)
    expect(isRigorRequest('prove the fix is correct')).toBe(true)
    expect(isRigorRequest('review the diff carefully')).toBe(true)
    expect(isRigorRequest('validate the schema')).toBe(true)
  })

  it('does not flag casual asks', () => {
    expect(isRigorRequest('add a logout button')).toBe(false)
    expect(isRigorRequest('what does keychain.ts do?')).toBe(false)
    expect(isRigorRequest('rename the function')).toBe(false)
  })

  it('per-conversation active flag toggles', () => {
    expect(isProofRigorActive('c1')).toBe(false)
    setProofRigor('c1', true)
    expect(isProofRigorActive('c1')).toBe(true)
    setProofRigor('c1', false)
    expect(isProofRigorActive('c1')).toBe(false)
  })

  // SP-1 (Sweet Spot Phase, 2026-06-10) — rigor-on-signal behavior now
  // requires an EXPLICIT proofGate='rigor'. Unset resolves to off (era
  // default): the Opus 4.5-era product had no proof gate.
  it("resolveProofRigor: mode 'rigor' + multi dispatch engages", () => {
    expect(
      resolveProofRigor({ proofGateMode: 'rigor', dispatchKind: 'multi', content: 'add a button' })
    ).toBe(true)
  })

  it("resolveProofRigor: mode 'rigor' + single + rigor verb engages", () => {
    expect(
      resolveProofRigor({ proofGateMode: 'rigor', dispatchKind: 'single', content: 'verify the build' })
    ).toBe(true)
  })

  it("resolveProofRigor: mode 'rigor' + single + casual does NOT engage", () => {
    expect(
      resolveProofRigor({ proofGateMode: 'rigor', dispatchKind: 'single', content: 'add a button' })
    ).toBe(false)
  })

  it('resolveProofRigor: proofGate=always forces on; off forces off', () => {
    expect(resolveProofRigor({ proofGateMode: 'always', dispatchKind: 'single', content: 'x' })).toBe(true)
    expect(resolveProofRigor({ proofGateMode: 'off', dispatchKind: 'multi', content: 'audit it' })).toBe(false)
  })

  it('SP-1: unset proofGate resolves to OFF — even on multi dispatch or rigor verbs', () => {
    expect(resolveProofRigor({ dispatchKind: 'multi', content: 'add a button' })).toBe(false)
    expect(resolveProofRigor({ dispatchKind: 'single', content: 'verify the build' })).toBe(false)
    expect(resolveProofRigor({ dispatchKind: 'multi', content: 'audit everything' })).toBe(false)
  })

  it('SP-1: unknown proofGate values resolve to OFF (fail-quiet, not fail-rigor)', () => {
    expect(resolveProofRigor({ proofGateMode: 'bogus', dispatchKind: 'multi', content: 'audit it' })).toBe(false)
  })
})

// CR-5 (Cogency Restore Phase, 2026-06-09) — gate the proof machinery on
// rigor AND mutation_attempted so multi-dispatch turns that don't actually
// mutate don't trip the "Untrusted completion" pill (F4 from the playbook).
describe('CR-5 shouldEngageProofGate — rigor && mutation_attempted', () => {
  beforeEach(() => __resetProofRigorForTesting())

  it('multi-dispatch + zero mutations → does NOT engage (F4 fix)', () => {
    setProofRigor('c1', true) // simulate multi-dispatch turn
    expect(hasMutationAttempted('c1')).toBe(false)
    expect(shouldEngageProofGate('c1')).toBe(false)
  })

  it('multi-dispatch + one mutation → engages', () => {
    setProofRigor('c1', true)
    markMutationAttempted('c1')
    expect(shouldEngageProofGate('c1')).toBe(true)
  })

  it('single-dispatch + zero mutations → does NOT engage', () => {
    setProofRigor('c1', false) // single-dispatch, no rigor verb
    markMutationAttempted('c1') // even with a mutation, no rigor signal
    expect(shouldEngageProofGate('c1')).toBe(false)
  })

  it('single + rigor verb + mutation → engages', () => {
    setProofRigor('c1', true) // user said "audit", rigor flag set
    markMutationAttempted('c1')
    expect(shouldEngageProofGate('c1')).toBe(true)
  })

  it('plan-mode turn (no mutation attempted) → does NOT engage', () => {
    // Plan-mode blocks mutating descriptors before they reach the
    // markMutationAttempted call, so the flag never flips. Result: clean
    // turn, no proof gate, no "Untrusted completion" pill.
    setProofRigor('c1', true) // even on multi-dispatch plan-mode turn
    expect(shouldEngageProofGate('c1')).toBe(false)
  })

  it('escape hatch: rigorRequiresMutation=false restores pre-CR-5 behavior', () => {
    setRigorRequiresMutation(false)
    setProofRigor('c1', true)
    expect(hasMutationAttempted('c1')).toBe(false)
    expect(shouldEngageProofGate('c1')).toBe(true)
    expect(isRigorRequiresMutation()).toBe(false)
  })

  it('reset clears mutation flag', () => {
    setProofRigor('c1', true)
    markMutationAttempted('c1')
    __resetProofRigorForTesting()
    expect(hasMutationAttempted('c1')).toBe(false)
    expect(isProofRigorActive('c1')).toBe(false)
    expect(isRigorRequiresMutation()).toBe(true) // default restored
  })

  it('hasMutationAttempted is per-conversation', () => {
    markMutationAttempted('c1')
    expect(hasMutationAttempted('c1')).toBe(true)
    expect(hasMutationAttempted('c2')).toBe(false)
  })

  // SP-3 (Sweet Spot Phase, 2026-06-10) — D4 regression lock. The flag is
  // per-TURN: chat.ts clears it at turn start, so a mutation on turn 1 can't
  // arm the gate for a rigor-keyword turn 2 that never mutates.
  it('SP-3: clearMutationAttempted resets the flag for the next turn (D4)', () => {
    // Turn 1 — "fix the bug": mutating turn, rigor off → gate stays closed.
    clearMutationAttempted('c1')
    setProofRigor('c1', false)
    markMutationAttempted('c1')
    expect(shouldEngageProofGate('c1')).toBe(false)

    // Turn 2 — "audit the module": rigor on, NO mutation this turn. Before
    // SP-3 the stale turn-1 flag made this engage; now it must not.
    clearMutationAttempted('c1')
    setProofRigor('c1', true)
    expect(hasMutationAttempted('c1')).toBe(false)
    expect(shouldEngageProofGate('c1')).toBe(false)

    // Turn 3 — rigor on AND a fresh mutation → engages as designed.
    clearMutationAttempted('c1')
    setProofRigor('c1', true)
    markMutationAttempted('c1')
    expect(shouldEngageProofGate('c1')).toBe(true)
  })

  it('SP-3: clearing one conversation leaves others untouched', () => {
    markMutationAttempted('c1')
    markMutationAttempted('c2')
    clearMutationAttempted('c1')
    expect(hasMutationAttempted('c1')).toBe(false)
    expect(hasMutationAttempted('c2')).toBe(true)
  })
})
