import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'

import { isWithin, validateExistingImagePath } from './image-tools'

describe('isWithin', () => {
  it('accepts the parent itself', () => {
    const root = mkdtempSync(join(tmpdir(), 'lamprey-iw-'))
    try {
      expect(isWithin(root, root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts a normal file inside the parent', () => {
    const root = mkdtempSync(join(tmpdir(), 'lamprey-iw-'))
    try {
      const inside = join(root, 'a.png')
      writeFileSync(inside, '')
      expect(isWithin(inside, root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts a nested file inside the parent', () => {
    const root = mkdtempSync(join(tmpdir(), 'lamprey-iw-'))
    try {
      const inside = join(root, 'sub', 'b.png')
      expect(isWithin(inside, root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a path that escapes via ..', () => {
    const root = mkdtempSync(join(tmpdir(), 'lamprey-iw-'))
    try {
      const outside = join(root, '..', 'evil.png')
      expect(isWithin(outside, root)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a sibling-directory path', () => {
    const parent = mkdtempSync(join(tmpdir(), 'lamprey-iw-parent-'))
    const sibling = mkdtempSync(join(tmpdir(), 'lamprey-iw-sibling-'))
    try {
      const siblingFile = join(sibling, 'x.png')
      expect(isWithin(siblingFile, parent)).toBe(false)
    } finally {
      rmSync(parent, { recursive: true, force: true })
      rmSync(sibling, { recursive: true, force: true })
    }
  })

  it('rejects a different-drive path on Windows', () => {
    if (process.platform !== 'win32') return
    // path.relative across drive letters returns the absolute target. The
    // previous implementation regex'd resolve(rel) which mis-classified
    // every same-drive relative segment as cross-drive — this case is the
    // one we explicitly want to keep rejecting.
    expect(isWithin('D:\\foo\\bar.png', 'C:\\foo')).toBe(false)
  })

  it('keeps accepting paths with backslashes on Windows', () => {
    if (process.platform !== 'win32') return
    // Regression guard: the previous resolve(rel).match(/^[A-Za-z]:/) check
    // returned true for every Windows file because resolve normalises bare
    // relatives to drive-absolute paths. isWithin should accept these.
    const child = `C:${sep}tmp${sep}ws${sep}a.png`
    const parent = `C:${sep}tmp${sep}ws`
    expect(isWithin(child, parent)).toBe(true)
  })
})

describe('validateExistingImagePath', () => {
  it('resolves a relative path against workspaceRoot, not process.cwd()', () => {
    // The bug: validateExistingImagePath used resolve(p) for relative
    // inputs, which resolves against process.cwd() (Lamprey's launch
    // folder) instead of the user-picked workspace. A relative
    // image_path like "assets/foo.png" would 404 even though the file is
    // there from the user's perspective.
    const workspace = mkdtempSync(join(tmpdir(), 'lamprey-vex-ws-'))
    try {
      const assetsDir = join(workspace, 'assets')
      mkdirSync(assetsDir)
      const img = join(assetsDir, 'foo.png')
      writeFileSync(img, '')
      const result = validateExistingImagePath('assets/foo.png', 'image_path', workspace)
      expect(result).toBe(img)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('still accepts an absolute path inside the workspace', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'lamprey-vex-ws-'))
    try {
      const img = join(workspace, 'a.png')
      writeFileSync(img, '')
      const result = validateExistingImagePath(img, 'image_path', workspace)
      expect(result).toBe(img)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('reports a not-found error against the workspace-relative path', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'lamprey-vex-ws-'))
    try {
      const result = validateExistingImagePath('assets/missing.png', 'image_path', workspace)
      expect(typeof result).toBe('object')
      if (typeof result === 'object') {
        // The error message should reference the workspace-resolved path so
        // the model can see exactly where the lookup went.
        expect(result.error).toContain(join(workspace, 'assets', 'missing.png'))
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('rejects empty / whitespace inputs', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'lamprey-vex-ws-'))
    try {
      expect(validateExistingImagePath('', 'image_path', workspace)).toEqual({
        error: 'image_path is required'
      })
      expect(validateExistingImagePath('   ', 'image_path', workspace)).toEqual({
        error: 'image_path is required'
      })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('rejects ".." segments before any filesystem lookup', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'lamprey-vex-ws-'))
    try {
      const result = validateExistingImagePath('../etc/passwd.png', 'image_path', workspace)
      expect(result).toEqual({ error: 'image_path must not contain ".." segments' })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('rejects an unsupported extension', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'lamprey-vex-ws-'))
    try {
      const img = join(workspace, 'a.txt')
      writeFileSync(img, '')
      const result = validateExistingImagePath('a.txt', 'image_path', workspace)
      expect(typeof result).toBe('object')
      if (typeof result === 'object') {
        expect(result.error).toMatch(/extension/i)
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
