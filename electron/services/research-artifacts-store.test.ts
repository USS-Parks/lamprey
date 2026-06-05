import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: {
    getPath: () => testDir
  }
}))

let testDir = ''

import {
  __resetResearchArtifactStore,
  downloadResearchArtifact,
  initResearchArtifactStore,
  listResearchArtifacts,
  readResearchArtifact,
  registerArtifact
} from './research-artifacts-store'

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'lamprey-research-store-test-'))
  __resetResearchArtifactStore()
})

afterEach(() => {
  __resetResearchArtifactStore()
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore EPERM */ }
})

function writeArtifactFile(dir: string, filename: string, content: string): string {
  const fullDir = join(dir, 'artifacts', 'research')
  if (!existsSync(fullDir)) {
    require('fs').mkdirSync(fullDir, { recursive: true })
  }
  const fullPath = join(fullDir, filename)
  writeFileSync(fullPath, content, 'utf-8')
  return fullPath
}

describe('registerArtifact + listResearchArtifacts', () => {
  it('adds an entry and surfaces it via list', () => {
    const path = writeArtifactFile(testDir, 'research-fusion-energy-1780000000000.md', '# Fusion\n\n[1]')
    registerArtifact('research-fusion-energy-1780000000000.md', path, 'fusion energy', 50, 1_780_000_000_000)
    const entries = listResearchArtifacts()
    expect(entries.length).toBe(1)
    expect(entries[0].filename).toBe('research-fusion-energy-1780000000000.md')
    expect(entries[0].question).toBe('fusion energy')
  })

  it('newest first ordering', () => {
    const a = writeArtifactFile(testDir, 'research-a-1780000000000.md', 'A')
    const b = writeArtifactFile(testDir, 'research-b-1780000000001.md', 'B')
    registerArtifact('research-a-1780000000000.md', a, 'a', 1, 1_780_000_000_000)
    registerArtifact('research-b-1780000000001.md', b, 'b', 1, 1_780_000_000_001)
    expect(listResearchArtifacts()[0].filename).toBe('research-b-1780000000001.md')
  })
})

describe('initResearchArtifactStore — disk scan', () => {
  it('rebuilds the manifest from disk on init', () => {
    writeArtifactFile(testDir, 'research-from-disk-1780000000000.md', '# From disk')
    initResearchArtifactStore(join(testDir, 'artifacts', 'research'))
    const entries = listResearchArtifacts()
    expect(entries.length).toBe(1)
    expect(entries[0].question).toBe('from disk')
  })

  it('ignores files that do not match the research-*-<ts>.md pattern', () => {
    writeArtifactFile(testDir, 'research-good-1780000000000.md', 'good')
    writeArtifactFile(testDir, 'random.md', 'random')
    initResearchArtifactStore(join(testDir, 'artifacts', 'research'))
    const entries = listResearchArtifacts()
    expect(entries.length).toBe(1)
  })

  it('is idempotent on repeat init', () => {
    writeArtifactFile(testDir, 'research-x-1780000000000.md', 'x')
    initResearchArtifactStore(join(testDir, 'artifacts', 'research'))
    initResearchArtifactStore(join(testDir, 'artifacts', 'research'))
    expect(listResearchArtifacts().length).toBe(1)
  })
})

describe('readResearchArtifact', () => {
  it('returns content + entry for a registered artifact', () => {
    const path = writeArtifactFile(testDir, 'research-x-1780000000000.md', '# Report\n\nbody [1]')
    registerArtifact('research-x-1780000000000.md', path, 'x', 100, 1_780_000_000_000)
    const r = readResearchArtifact('research-x-1780000000000.md')
    expect(r?.content).toContain('# Report')
    expect(r?.entry.filename).toBe('research-x-1780000000000.md')
  })

  it('returns null and drops the manifest entry when the file is missing', () => {
    registerArtifact('research-ghost-1780000000000.md', join(testDir, 'nope.md'), 'ghost', 1, 1_780_000_000_000)
    expect(readResearchArtifact('research-ghost-1780000000000.md')).toBeNull()
    expect(listResearchArtifacts().length).toBe(0)
  })

  it('returns null for unknown filenames', () => {
    expect(readResearchArtifact('nope.md')).toBeNull()
  })
})

describe('downloadResearchArtifact', () => {
  it('writes the content to the destination path and returns true', () => {
    const path = writeArtifactFile(testDir, 'research-x-1780000000000.md', '# Report')
    registerArtifact('research-x-1780000000000.md', path, 'x', 100, 1_780_000_000_000)
    const dest = join(testDir, 'export', 'copy.md')
    const ok = downloadResearchArtifact('research-x-1780000000000.md', dest)
    expect(ok).toBe(true)
    expect(readFileSync(dest, 'utf-8')).toBe('# Report')
  })

  it('returns false for unknown filenames', () => {
    expect(downloadResearchArtifact('nope.md', join(testDir, 'x.md'))).toBe(false)
  })
})
