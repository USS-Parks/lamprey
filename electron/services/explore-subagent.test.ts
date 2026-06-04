import { describe, expect, it } from 'vitest'
import {
  buildExploreSystemPrompt,
  buildSubagentTools
} from './explore-subagent'

// Side-effect imports so the registry knows about the read-only tools
// when buildSubagentTools filters.
import './read-file-tool-pack'
import './grep-workspace-tool-pack'
import './glob-workspace-tool-pack'
import './workspace-context-tool-pack'
// The shell tool is intentionally NOT imported here — we want to assert
// that even if it WERE registered, buildSubagentTools filters it out.
// Importing it would actually be the better test of the filter, but
// shell tool registration in tool-registry.ts already runs at module-load
// time for any vitest run that imports tool-registry, so it's effectively
// always registered when this test runs.

describe('buildExploreSystemPrompt', () => {
  it('includes "subagent" identity', () => {
    expect(buildExploreSystemPrompt('both')).toContain('Explore subagent')
  })
  it('docs scope mentions documents only', () => {
    const p = buildExploreSystemPrompt('docs')
    expect(p).toContain('attached documents only')
    expect(p).not.toContain('workspace code only')
  })
  it('code scope mentions workspace code only', () => {
    const p = buildExploreSystemPrompt('code')
    expect(p).toContain('workspace code only')
    expect(p).not.toContain('attached documents only')
  })
  it('both scope mentions both', () => {
    const p = buildExploreSystemPrompt('both')
    expect(p).toContain('both attached documents and workspace code')
  })
  it('always forbids edits + shell', () => {
    for (const scope of ['docs', 'code', 'both'] as const) {
      const p = buildExploreSystemPrompt(scope)
      expect(p).toMatch(/No edits, no shell commands, no apply_patch/)
    }
  })
  it('lists the four allowed tools', () => {
    const p = buildExploreSystemPrompt('both')
    expect(p).toContain('glob_workspace')
    expect(p).toContain('grep_workspace')
    expect(p).toContain('read_file')
    expect(p).toContain('workspace_context')
  })
})

describe('buildSubagentTools', () => {
  it('only exposes the read-only subagent set', () => {
    const tools = buildSubagentTools()
    const names = tools
      .filter((t) => t.type === 'function')
      .map((t) => (t as { function: { name: string } }).function.name)
      .sort()
    // The set should be a SUBSET of {read_file, grep_workspace,
    // glob_workspace, workspace_context}. Order may vary by registration.
    const allowed = new Set([
      'read_file',
      'grep_workspace',
      'glob_workspace',
      'workspace_context'
    ])
    for (const n of names) {
      expect(allowed.has(n)).toBe(true)
    }
    // And ALL four allowed tools should be present (they're all registered
    // via the side-effect imports above + tool-registry itself).
    expect(names.length).toBe(4)
  })
  it('explicitly does NOT expose dangerous tools', () => {
    const tools = buildSubagentTools()
    const names = new Set(
      tools
        .filter((t) => t.type === 'function')
        .map((t) => (t as { function: { name: string } }).function.name)
    )
    expect(names.has('shell_command')).toBe(false)
    expect(names.has('apply_patch')).toBe(false)
    expect(names.has('memory_add')).toBe(false)
    expect(names.has('verify_workspace')).toBe(false)
    expect(names.has('explore')).toBe(false) // no nested explore
  })
  it('each tool descriptor has a valid OpenAI shape', () => {
    const tools = buildSubagentTools()
    for (const t of tools) {
      expect(t.type).toBe('function')
      if (t.type !== 'function') continue
      expect(typeof t.function.name).toBe('string')
      expect(typeof t.function.description).toBe('string')
      expect(t.function.parameters).toBeDefined()
    }
  })
})
