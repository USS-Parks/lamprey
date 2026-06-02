import { describe, it, expect } from 'vitest'
import { isAbsolute, resolve, sep } from 'path'

import { resolveWorkspaceRelative } from './path-utils'

describe('resolveWorkspaceRelative', () => {
  it('returns the workspace root verbatim for "."', () => {
    const root = resolve('/tmp/ws')
    expect(resolveWorkspaceRelative('.', root)).toBe(root)
  })

  it('resolves a bare relative segment against the workspace root', () => {
    const root = resolve('/tmp/ws')
    expect(resolveWorkspaceRelative('foo.txt', root)).toBe(resolve(root, 'foo.txt'))
  })

  it('resolves a nested relative segment against the workspace root', () => {
    const root = resolve('/tmp/ws')
    expect(resolveWorkspaceRelative('src/lib/index.ts', root)).toBe(
      resolve(root, 'src/lib/index.ts')
    )
  })

  it('returns an absolute path unchanged (modulo path.resolve normalisation)', () => {
    const abs = resolve('/already/absolute/file.png')
    expect(resolveWorkspaceRelative(abs, resolve('/tmp/ws'))).toBe(abs)
  })

  it('does not enforce any boundary — a "../escape" still resolves', () => {
    // The helper is intentionally lenient; boundary enforcement is the
    // caller's responsibility (callers that need it use
    // resolveCwdWithinWorkspace / resolvePathWithinWorkspace / etc.).
    const root = resolve('/tmp/ws')
    const out = resolveWorkspaceRelative('../escape.txt', root)
    expect(isAbsolute(out)).toBe(true)
    expect(out).not.toBe(resolve(root, 'escape.txt'))
  })

  it('handles a workspace root that itself contains the separator', () => {
    const root = resolve(`/tmp${sep}with${sep}nesting`)
    expect(resolveWorkspaceRelative('a.png', root)).toBe(resolve(root, 'a.png'))
  })

  it('handles a Windows-style drive-letter absolute on Windows', () => {
    if (process.platform !== 'win32') return
    const root = 'C:\\tmp\\ws'
    // resolve() flattens the drive prefix; the input is already absolute
    // so workspaceRoot is irrelevant.
    expect(resolveWorkspaceRelative('D:\\elsewhere\\f.png', root)).toBe(
      resolve('D:\\elsewhere\\f.png')
    )
  })
})
