import { describe, it, expect } from 'vitest'
import { applyProfile } from './index'

describe('applyProfile (S3 abstraction)', () => {
  const baseInput = {
    spawnCmd: 'echo',
    spawnArgs: ['hi'],
    cwd: '/tmp/wk',
    opts: { workspaceRoot: '/tmp/wk' }
  }

  it('returns a SandboxOutput shape on every platform', () => {
    for (const platform of ['darwin', 'linux', 'win32', 'freebsd'] as NodeJS.Platform[]) {
      const r = applyProfile({ ...baseInput, platform })
      expect(typeof r.cmd).toBe('string')
      expect(Array.isArray(r.args)).toBe(true)
      expect(['darwin-sbx', 'linux-bwrap', 'none', 'bypassed']).toContain(r.sandboxTier)
    }
  })

  it("passes through with tier 'none' on platforms with no impl yet", () => {
    // Until S4/S5/S6 populate the platform modules, every dispatch
    // path returns null and we fall back to pass-through.
    const r = applyProfile({ ...baseInput, platform: 'darwin' })
    expect(r.cmd).toBe('echo')
    expect(r.args).toEqual(['hi'])
    expect(r.sandboxTier).toBe('none')
    expect(r.note).toMatch(/darwin profile unavailable/)
  })

  it("annotates 'none' on win32", () => {
    const r = applyProfile({ ...baseInput, platform: 'win32' })
    expect(r.sandboxTier).toBe('none')
    expect(r.note).toMatch(/windows host/)
  })

  it("annotates 'none' on linux when bwrap is missing", () => {
    const r = applyProfile({ ...baseInput, platform: 'linux' })
    expect(r.sandboxTier).toBe('none')
    expect(r.note).toMatch(/bwrap/)
  })

  it("annotates 'none' on unknown platforms", () => {
    const r = applyProfile({ ...baseInput, platform: 'freebsd' as NodeJS.Platform })
    expect(r.sandboxTier).toBe('none')
    expect(r.note).toMatch(/freebsd/)
  })

  it('passes the network policy through opts (does not mutate input)', () => {
    const input = {
      ...baseInput,
      platform: 'linux' as NodeJS.Platform,
      opts: { workspaceRoot: '/tmp/wk', networkPolicy: 'deny' as const }
    }
    const before = JSON.stringify(input)
    applyProfile(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})
