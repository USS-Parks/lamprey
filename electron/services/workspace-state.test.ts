import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Hoisted so it's reachable from the vi.mock factory, which is itself
// hoisted above the import below.
const userDataDir = mkdtempSync(join(tmpdir(), 'lamprey-ws-state-'))

vi.mock('electron', () => ({
  app: {
    getPath: (which: string) => {
      if (which === 'userData') return userDataDir
      throw new Error(`unexpected getPath("${which}") in test`)
    }
  }
}))

import {
  __resetWorkspaceStateCache,
  clearActiveWorkspace,
  getActiveWorkspace,
  setActiveWorkspace
} from './workspace-state'

const statePath = join(userDataDir, 'active-workspace.txt')

beforeEach(() => {
  __resetWorkspaceStateCache()
  if (existsSync(statePath)) rmSync(statePath)
})

describe('setActiveWorkspace validation', () => {
  it('rejects an empty / whitespace path', () => {
    expect(() => setActiveWorkspace('')).toThrow(/non-empty/i)
    expect(() => setActiveWorkspace('   ')).toThrow(/non-empty/i)
  })

  it('rejects a non-existent path', () => {
    const phantom = join(userDataDir, 'no-such-dir')
    expect(() => setActiveWorkspace(phantom)).toThrow(/does not exist/i)
  })

  it('rejects a path that points at a file rather than a directory', () => {
    // The folder picker only emits directories, but the IPC handler is
    // also reachable from the model side; without a stat-isDirectory
    // check the persisted root could become a file and every
    // workspace-relative tool would fail in confusing ways.
    const file = join(userDataDir, 'not-a-dir.txt')
    writeFileSync(file, 'x')
    expect(() => setActiveWorkspace(file)).toThrow(/not a directory/i)
  })

  it('persists a valid directory path and returns the absolute form', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamprey-ws-ok-'))
    try {
      const result = setActiveWorkspace(dir)
      expect(result.path).toBe(dir)
      expect(existsSync(statePath)).toBe(true)
      expect(readFileSync(statePath, 'utf8')).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('getActiveWorkspace fallback', () => {
  it('returns process.cwd() when nothing is persisted', () => {
    expect(getActiveWorkspace()).toBe(process.cwd())
  })

  it('returns the persisted directory after a set+reset', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamprey-ws-readback-'))
    try {
      setActiveWorkspace(dir)
      __resetWorkspaceStateCache()
      expect(getActiveWorkspace()).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to process.cwd() when the persisted path is no longer a directory', () => {
    // Simulate the persisted-but-deleted-then-replaced-by-file scenario.
    const stale = join(userDataDir, 'gone.txt')
    writeFileSync(stale, 'not a dir')
    writeFileSync(statePath, stale, 'utf8')
    __resetWorkspaceStateCache()
    expect(getActiveWorkspace()).toBe(process.cwd())
  })

  it('falls back to process.cwd() when the persisted path no longer exists', () => {
    writeFileSync(statePath, join(userDataDir, 'never-existed'), 'utf8')
    __resetWorkspaceStateCache()
    expect(getActiveWorkspace()).toBe(process.cwd())
  })
})

describe('clearActiveWorkspace', () => {
  it('drops the persisted path so the next get returns the fallback', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamprey-ws-clear-'))
    try {
      setActiveWorkspace(dir)
      __resetWorkspaceStateCache()
      expect(getActiveWorkspace()).toBe(dir)
      clearActiveWorkspace()
      expect(getActiveWorkspace()).toBe(process.cwd())
      expect(existsSync(statePath)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
