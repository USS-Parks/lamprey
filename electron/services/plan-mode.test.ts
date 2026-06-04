import { describe, expect, it } from 'vitest'
import { isMutatingDescriptor, type LampreyToolDescriptor } from './tool-registry'

// Track 2 / C3 — tests for the plan-mode gate's primitives. The
// integration test (dispatcher actually blocks shell_command) lives in
// the existing chat.* test files; here we cover:
//   - registry derives `mutates` from risks correctly (write/destructive
//     → mutates: true; read/network → false)
//   - explicit mutates: false overrides risk derivation
//   - isMutatingDescriptor is the single source of truth
//   - the enter/exit plan-mode tools ship with mutates: false so they
//     can always be called even when plan mode is on
//
// `isPlanModeActive` / `setPlanModeActive` round-trip lives in
// `conversation-store.test.ts` companion; here we only need the
// descriptor-side predicate.

function descriptor(
  overrides: Partial<LampreyToolDescriptor> = {}
): LampreyToolDescriptor {
  return {
    id: 't',
    name: 't',
    title: 'T',
    description: 'd',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: { type: 'object' },
    risks: [],
    requiresApproval: false,
    enabled: true,
    tags: [],
    lazy: false,
    mutates: false,
    ...overrides
  }
}

describe('isMutatingDescriptor', () => {
  it('returns false for undefined', () => {
    expect(isMutatingDescriptor(undefined)).toBe(false)
  })

  it('returns true when the descriptor opts in', () => {
    expect(isMutatingDescriptor(descriptor({ mutates: true }))).toBe(true)
  })

  it('returns false when mutates is explicitly false even with write risk', () => {
    // Defensive: the field is the source of truth. A test descriptor
    // could be constructed with risks=['write'] yet mutates=false; the
    // predicate trusts the explicit field.
    expect(
      isMutatingDescriptor(descriptor({ risks: ['write'], mutates: false }))
    ).toBe(false)
  })
})

describe('registerNative derives `mutates` from risks', () => {
  it('write-risk native gets mutates: true', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const desc = toolRegistry.getById('memory_add')
    expect(desc?.mutates).toBe(true)
    expect(desc?.tags).toContain('mutates')
  })

  it('shell_command (write + network) → mutates: true', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const desc = toolRegistry.getById('shell_command')
    expect(desc?.mutates).toBe(true)
  })

  it('enter_plan_mode and exit_plan_mode ship with mutates: false', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const enter = toolRegistry.getById('enter_plan_mode')
    const exit = toolRegistry.getById('exit_plan_mode')
    expect(enter).toBeDefined()
    expect(exit).toBeDefined()
    expect(enter?.mutates).toBe(false)
    expect(exit?.mutates).toBe(false)
    // They must not carry the 'mutates' tag either; the renderer/model
    // shouldn't filter them out under a "mutating only" view.
    expect(enter?.tags).not.toContain('mutates')
    expect(exit?.tags).not.toContain('mutates')
  })

  it('enter_plan_mode and exit_plan_mode have empty risks', async () => {
    const { toolRegistry } = await import('./tool-registry')
    expect(toolRegistry.getById('enter_plan_mode')?.risks).toEqual([])
    expect(toolRegistry.getById('exit_plan_mode')?.risks).toEqual([])
  })
})
