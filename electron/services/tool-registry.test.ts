import { describe, it, expect } from 'vitest'

// Regression guard for the production startup crash.
//
// `tool-registry.ts` once held the bundled tool-pack side-effect imports
// at the bottom of the file. ES-module bundlers can hoist those imports
// above `export const toolRegistry = new ToolRegistry()`, which caused
// every pack's top-level `toolRegistry.registerNative(...)` to throw
// "ReferenceError: Cannot access 'toolRegistry' before initialization"
// at app startup.
//
// The packs now live in `tool-packs.ts` (loaded explicitly from
// `electron/ipc/index.ts`). This test pins the contract: importing
// `tool-registry` in isolation must succeed and produce a usable
// singleton, and `memory_add` + `shell_command` (the only inline
// registrations left in the file) must be present.

describe('tool-registry module load', () => {
  it('imports without TDZ errors and exposes the toolRegistry singleton', async () => {
    const mod = await import('./tool-registry')
    expect(mod.toolRegistry).toBeDefined()
    expect(typeof mod.toolRegistry.registerNative).toBe('function')
    expect(typeof mod.toolRegistry.getById).toBe('function')
  })

  it('has the inline memory_add registration', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const desc = toolRegistry.getById('memory_add')
    expect(desc).toBeDefined()
    expect(desc?.providerKind).toBe('native')
  })

  it('has the inline shell_command registration', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const desc = toolRegistry.getById('shell_command')
    expect(desc).toBeDefined()
    expect(desc?.providerKind).toBe('native')
    expect(toolRegistry.hasHandler('shell_command')).toBe(true)
  })
})
