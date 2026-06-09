import { describe, it, expect, beforeEach } from 'vitest'
import {
  isRigorRequest,
  setProofRigor,
  isProofRigorActive,
  resolveProofRigor,
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
