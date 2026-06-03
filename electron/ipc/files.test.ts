import { describe, it, expect, vi } from 'vitest'
import * as path from 'path'

// files.ts imports electron + file-handler (which pulls pdf-parse etc.) at the
// module top. Stub those so we can import the pure confineToWorkspace helper.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: {},
  BrowserWindow: { getAllWindows: () => [] },
  shell: {}
}))
vi.mock('../services/file-handler', () => ({ processFiles: vi.fn() }))
vi.mock('../services/workspace-state', () => ({
  getActiveWorkspace: () => ROOT,
  setActiveWorkspace: vi.fn(),
  clearActiveWorkspace: vi.fn()
}))

const ROOT = path.resolve(path.sep === '\\' ? 'C:\\work\\space' : '/work/space')

import { confineToWorkspace } from './files'

describe('confineToWorkspace (SEC-1 filesystem confinement)', () => {
  it('allows the workspace root itself', () => {
    expect(confineToWorkspace(ROOT)).toBe(ROOT)
  })

  it('allows descendant directories and files', () => {
    const sub = path.join(ROOT, 'src', 'index.ts')
    expect(confineToWorkspace(sub)).toBe(sub)
  })

  it('rejects an absolute path outside the workspace', () => {
    const outside = path.sep === '\\' ? 'C:\\Windows\\System32\\drivers' : '/etc/passwd'
    expect(confineToWorkspace(outside)).toBeNull()
  })

  it('rejects ../ traversal that escapes the root (e.g. ~/.ssh)', () => {
    expect(confineToWorkspace(path.join(ROOT, '..', '..', '.ssh', 'id_rsa'))).toBeNull()
    // raw unresolved string form
    expect(confineToWorkspace(ROOT + `${path.sep}..${path.sep}..${path.sep}secret`)).toBeNull()
  })

  it('rejects empty / whitespace candidates', () => {
    expect(confineToWorkspace('')).toBeNull()
    expect(confineToWorkspace('   ')).toBeNull()
  })

  it('rejects a sibling directory that shares a name prefix with the root', () => {
    // `/work/space-evil` must NOT be treated as inside `/work/space`.
    expect(confineToWorkspace(ROOT + '-evil')).toBeNull()
  })
})
