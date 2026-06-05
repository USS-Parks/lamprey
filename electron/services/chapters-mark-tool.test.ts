import { describe, expect, it, vi } from 'vitest'

// Snip Phase K9 wired the snip layer into tool-registry; the chain
// imports filter-loader which pulls in electron + @electron-toolkit.
vi.mock('electron', () => ({
  app: { getPath: () => '.tmp-chapters-mark-test' },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

// Track 2 / E1 — verifies the `mark_chapter` tool descriptor is
// registered and matches the contract documented in the plan §5: a
// non-mutating native tool with `title: string (required)` and
// `summary: string (optional)` in its input schema. The DB-side
// chapters-store CRUD is exercised at integration time inside Electron
// (the better-sqlite3 + Electron app-path dependency makes a unit test
// here mostly mechanical mocking).

describe('mark_chapter tool descriptor', () => {
  it('is registered with mutates: false', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const d = toolRegistry.getById('mark_chapter')
    expect(d).toBeDefined()
    expect(d?.mutates).toBe(false)
    expect(d?.providerKind).toBe('native')
    expect(d?.risks).toEqual([])
  })

  it('schema requires title and accepts optional summary', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const d = toolRegistry.getById('mark_chapter')
    const schema = d?.inputSchema as Record<string, unknown>
    expect(schema?.type).toBe('object')
    const props = schema?.properties as Record<string, unknown>
    expect(props?.title).toBeDefined()
    expect(props?.summary).toBeDefined()
    expect(schema?.required).toEqual(['title'])
  })

  it('schema rejects extra fields via additionalProperties: false', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const d = toolRegistry.getById('mark_chapter')
    const schema = d?.inputSchema as Record<string, unknown>
    expect(schema?.additionalProperties).toBe(false)
  })

  it('appears in tools:search keyword scoring', async () => {
    const { toolRegistry } = await import('./tool-registry')
    const matches = toolRegistry.search('chapter')
    expect(matches.some((m) => m.name === 'mark_chapter')).toBe(true)
  })

  it('event-log includes chat.chapter.marked', async () => {
    const { EVENT_TYPES } = await import('./event-log')
    expect(EVENT_TYPES).toContain('chat.chapter.marked')
  })
})
