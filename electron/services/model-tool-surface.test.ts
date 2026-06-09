import { describe, it, expect, vi } from 'vitest'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import {
  buildModelToolSurface,
  isAlreadyAvailable,
  toolEntryName,
  CORE_TOOL_NAMES,
  TOOL_SEARCH_TOOL_NAME,
  TOOL_SEARCH_TOOL
} from './model-tool-surface'

// Registry-level checks load the full native catalog via the side-effect packs.
vi.mock('electron', () => ({
  app: { getPath: () => '.tmp-hy1', isReady: () => true },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

const fn = (name: string): ChatCompletionTool => ({
  type: 'function',
  function: { name, description: `desc ${name}`, parameters: { type: 'object', properties: {} } }
})

const ALL = [
  fn('shell_command'),
  fn('apply_patch'),
  fn('browser_screenshot'),
  fn('image_generate'),
  fn('workspace_context'),
  fn('multi_agent_run')
]

describe('buildModelToolSurface (pure)', () => {
  it('keeps only core tools + appends tool_search by default', () => {
    const surface = buildModelToolSurface(ALL)
    const names = surface.map(toolEntryName)
    expect(names).toContain('shell_command')
    expect(names).toContain('apply_patch')
    expect(names).toContain('workspace_context')
    expect(names).toContain(TOOL_SEARCH_TOOL_NAME)
    // non-core excluded until unlocked
    expect(names).not.toContain('browser_screenshot')
    expect(names).not.toContain('image_generate')
    expect(names).not.toContain('multi_agent_run')
  })

  it('includes unlocked tools alongside core', () => {
    const surface = buildModelToolSurface(ALL, { unlockedNames: ['browser_screenshot', 'image_generate'] })
    const names = surface.map(toolEntryName)
    expect(names).toContain('browser_screenshot')
    expect(names).toContain('image_generate')
    expect(names).toContain('shell_command') // core still present
    expect(names).not.toContain('multi_agent_run') // not unlocked
  })

  it('tool_search is appended exactly once and last', () => {
    const surface = buildModelToolSurface(ALL)
    const names = surface.map(toolEntryName)
    expect(names.filter((n) => n === TOOL_SEARCH_TOOL_NAME)).toHaveLength(1)
    expect(names[names.length - 1]).toBe(TOOL_SEARCH_TOOL_NAME)
  })

  it('does not duplicate tool_search if the catalog already has one', () => {
    const withSearch = [...ALL, TOOL_SEARCH_TOOL]
    const surface = buildModelToolSurface(withSearch, { unlockedNames: [TOOL_SEARCH_TOOL_NAME] })
    expect(surface.map(toolEntryName).filter((n) => n === TOOL_SEARCH_TOOL_NAME)).toHaveLength(1)
  })

  it('honors a custom core set', () => {
    const surface = buildModelToolSurface(ALL, { coreNames: ['multi_agent_run'] })
    const names = surface.map(toolEntryName)
    expect(names).toContain('multi_agent_run')
    expect(names).not.toContain('shell_command')
  })

  it('lazy surface drops non-core entries (real byte savings measured in HY_BASELINE.md)', () => {
    // On real schemas the byte win is large (67.6% native-only, HY0). On this
    // toy array the invariant is structural: fewer tool entries than the full
    // catalog whenever non-core tools exist. The big tool_search description
    // means byte-size is only a win at real catalog scale, not on stubs.
    const surface = buildModelToolSurface(ALL)
    const nonCoreInAll = ALL.map(toolEntryName).filter(
      (n) => !(CORE_TOOL_NAMES as readonly string[]).includes(n)
    ).length
    expect(nonCoreInAll).toBeGreaterThan(0)
    // full = 6 entries; lazy = 3 core + tool_search = 4
    expect(surface.length).toBeLessThan(ALL.length + 1)
    expect(surface.length).toBe(ALL.length - nonCoreInAll + 1)
  })
})

describe('isAlreadyAvailable', () => {
  it('flags core tools + the meta-tool, not others', () => {
    expect(isAlreadyAvailable('shell_command')).toBe(true)
    expect(isAlreadyAvailable(TOOL_SEARCH_TOOL_NAME)).toBe(true)
    expect(isAlreadyAvailable('browser_screenshot')).toBe(false)
  })
})

describe('toolRegistry lazy surface (integration)', () => {
  it('getModelToolSurface returns core + tool_search, and every catalog tool is reachable via search', async () => {
    await import('./tool-packs') // register native catalog
    const { toolRegistry } = await import('./tool-registry')

    const surface = toolRegistry.getModelToolSurface('deepseek')
    const names = surface.map(toolEntryName)
    // core present
    for (const c of CORE_TOOL_NAMES) expect(names).toContain(c)
    // meta present
    expect(names).toContain(TOOL_SEARCH_TOOL_NAME)
    // a known non-core tool is NOT in the default surface
    expect(names).not.toContain('browser_screenshot')

    // …but IS reachable via search, and search never surfaces core/meta
    const matches = toolRegistry.resolveToolSearch('take a browser screenshot')
    const matchNames = matches.map((m) => m.name)
    expect(matchNames).toContain('browser_screenshot')
    expect(matchNames).not.toContain('shell_command')
    expect(matchNames).not.toContain(TOOL_SEARCH_TOOL_NAME)

    // unlocking makes it appear in the surface
    const unlocked = toolRegistry.getModelToolSurface('deepseek', { unlockedNames: ['browser_screenshot'] })
    expect(unlocked.map(toolEntryName)).toContain('browser_screenshot')
  })

  it('select: query resolves exact names', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const matches = toolRegistry.resolveToolSearch('select:image_generate')
    expect(matches.map((m) => m.name)).toContain('image_generate')
  })
})
