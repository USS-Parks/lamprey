import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('electron app not available in test environment')
    }
  }
}))
import {
  DEFAULT_STATUSLINE_CONFIG,
  loadStatusLineConfig,
  saveStatusLineConfig
} from './statusline-config'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lamprey-statusline-'))
})

describe('loadStatusLineConfig', () => {
  it('returns DEFAULTS when no file exists', () => {
    const cfg = loadStatusLineConfig(join(dir, 'statusline.md'))
    expect(cfg.source).toBe('default')
    expect(cfg.slots).toEqual(DEFAULT_STATUSLINE_CONFIG.slots)
  })

  it('parses user frontmatter and keeps known slots in order', () => {
    const path = join(dir, 'statusline.md')
    writeFileSync(
      path,
      `---
slots:
  - tokens
  - model
  - wakeups
  - bogus
formats:
  model: '{name} ({tier})'
  tokens: '{kilo}K'
---

# notes
`,
      'utf8'
    )
    const cfg = loadStatusLineConfig(path)
    expect(cfg.source).toBe('user')
    expect(cfg.slots).toEqual(['tokens', 'model', 'wakeups'])
    expect(cfg.formats.model).toBe('{name} ({tier})')
    expect(cfg.formats.tokens).toBe('{kilo}K')
    expect(cfg.formats.workflow).toBe(DEFAULT_STATUSLINE_CONFIG.formats.workflow)
  })

  it('drops duplicate slot ids and unknown slot ids silently', () => {
    const path = join(dir, 'statusline.md')
    writeFileSync(
      path,
      `---
slots: [model, model, rag, evil]
---
`,
      'utf8'
    )
    const cfg = loadStatusLineConfig(path)
    expect(cfg.slots).toEqual(['model', 'rag'])
  })

  it('falls back to the default-visible set when slots is empty', () => {
    const path = join(dir, 'statusline.md')
    writeFileSync(path, `---\nslots: []\n---\n`, 'utf8')
    const cfg = loadStatusLineConfig(path)
    // Empty user override behaves the same as no-file: default-visible set,
    // not every registered slot. Fluidity J8 added `context` + `branch` and
    // dropped `tokens` + `rag` from the default render order.
    expect(cfg.slots).toEqual(DEFAULT_STATUSLINE_CONFIG.slots)
    expect(cfg.slots).toContain('context')
    expect(cfg.slots).toContain('branch')
    expect(cfg.slots).not.toContain('tokens')
    expect(cfg.slots).not.toContain('rag')
  })
})

describe('saveStatusLineConfig', () => {
  it('writes a frontmatter file and roundtrips', () => {
    const path = join(dir, 'statusline.md')
    const saved = saveStatusLineConfig(
      { slots: ['model', 'tokens'], formats: { model: '{id}' } },
      path
    )
    expect(saved.slots).toEqual(['model', 'tokens'])
    expect(saved.formats.model).toBe('{id}')

    const reloaded = loadStatusLineConfig(path)
    expect(reloaded.source).toBe('user')
    expect(reloaded.slots).toEqual(['model', 'tokens'])
    expect(reloaded.formats.model).toBe('{id}')
  })

  it('cleans unknown slot ids on write', () => {
    const path = join(dir, 'statusline.md')
    const saved = saveStatusLineConfig(
      { slots: ['model', 'evil' as any, 'rag'], formats: {} },
      path
    )
    expect(saved.slots).toEqual(['model', 'rag'])
  })
})

// Cleanup happens implicitly when the test process exits; mkdtempSync entries
// live under the OS temp dir.
function _silence(): void {
  rmSync('non-existent', { recursive: true, force: true })
}
void _silence
