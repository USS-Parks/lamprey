import { describe, it, expect, beforeEach } from 'vitest'
import {
  isRigorRequest,
  setProofRigor,
  isProofRigorActive,
  resolveProofRigor,
  shouldEngageProofGate,
  markMutationAttempted,
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

  it('resolveProofRigor: multi dispatch always engages', () => {
    expect(resolveProofRigor({ dispatchKind: 'multi', content: 'add a button' })).toBe(true)
  })

  it('resolveProofRigor: single + rigor verb engages', () => {
    expect(resolveProofRigor({ dispatchKind: 'single', content: 'verify the build' })).toBe(true)
  })

  it('resolveProofRigor: single + casual does NOT engage (default)', () => {
    expect(resolveProofRigor({ dispatchKind: 'single', content: 'add a button' })).toBe(false)
  })

  it('resolveProofRigor: proofGate=always forces on; off forces off', () => {
    expect(resolveProofRigor({ proofGateMode: 'always', dispatchKind: 'single', content: 'x' })).toBe(true)
    expect(resolveProofRigor({ proofGateMode: 'off', dispatchKind: 'multi', content: 'audit it' })).toBe(false)
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
})
