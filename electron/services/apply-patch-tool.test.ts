import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  executeApplyPatch,
  parsePatch,
  resolvePathWithinWorkspace
} from './apply-patch-tool'

// Each test gets a private temp workspace so add/update/delete operations
// can't bleed across tests. Workspaces are removed in afterEach.
let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'apply-patch-test-'))
})

afterEach(() => {
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
})

function patch(...lines: string[]): string {
  return ['*** Begin Patch', ...lines, '*** End Patch'].join('\n')
}

// ────────────────────────────── parser ─────────────────────────────────

describe('parsePatch', () => {
  it('rejects empty input', () => {
    expect(() => parsePatch('')).toThrow(/non-empty string/)
  })

  it('rejects missing Begin header', () => {
    expect(() => parsePatch('hello world')).toThrow(/expected "\*\*\* Begin Patch"/)
  })

  it('rejects missing End footer', () => {
    expect(() => parsePatch('*** Begin Patch\n*** Add File: a\n+x\n')).toThrow(
      /\*\*\* End Patch/
    )
  })

  it('parses an Add directive', () => {
    const ops = parsePatch(patch('*** Add File: hi.txt', '+a', '+b'))
    expect(ops).toEqual([{ kind: 'add', path: 'hi.txt', lines: ['a', 'b'] }])
  })

  it('rejects unknown top-level directive', () => {
    expect(() => parsePatch(patch('*** Rename File: foo bar'))).toThrow(
      /unrecognized directive|unknown directive/i
    )
  })

  it('rejects Add body lines without "+" prefix', () => {
    expect(() => parsePatch(patch('*** Add File: a.txt', 'no plus'))).toThrow(
      /every content line must start with "\+"/
    )
  })

  it('parses an Update with a hunk', () => {
    const ops = parsePatch(
      patch('*** Update File: f.txt', '@@ ctx', ' keep1', '-old', '+new')
    )
    expect(ops).toHaveLength(1)
    const op = ops[0]
    expect(op.kind).toBe('update')
    if (op.kind === 'update') {
      expect(op.path).toBe('f.txt')
      expect(op.hunks).toHaveLength(1)
      expect(op.hunks[0].body).toEqual([
        { tag: 'keep', text: 'keep1' },
        { tag: 'remove', text: 'old' },
        { tag: 'add', text: 'new' }
      ])
    }
  })

  it('parses a Delete directive', () => {
    const ops = parsePatch(patch('*** Delete File: gone.txt'))
    expect(ops).toEqual([{ kind: 'delete', path: 'gone.txt' }])
  })

  it('rejects Add directive with empty path', () => {
    expect(() => parsePatch(patch('*** Add File: '))).toThrow(/missing path/i)
  })
})

// ───────────────────────────── path guard ──────────────────────────────

describe('resolvePathWithinWorkspace', () => {
  it('accepts a relative path under the root', () => {
    const r = resolvePathWithinWorkspace(workspace, 'sub/file.txt')
    expect(r).not.toBeNull()
    expect(r!.startsWith(workspace)).toBe(true)
  })

  it('rejects empty path', () => {
    expect(resolvePathWithinWorkspace(workspace, '')).toBeNull()
  })

  it('rejects ".." traversal', () => {
    expect(resolvePathWithinWorkspace(workspace, '../escape.txt')).toBeNull()
    expect(resolvePathWithinWorkspace(workspace, 'sub/../../escape.txt')).toBeNull()
  })

  it('rejects an absolute path outside the root', () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\boot.ini' : '/etc/passwd'
    expect(resolvePathWithinWorkspace(workspace, outside)).toBeNull()
  })

  it('rejects the root itself', () => {
    expect(resolvePathWithinWorkspace(workspace, '.')).toBeNull()
  })
})

// ────────────────────────────── execute ────────────────────────────────

describe('executeApplyPatch', () => {
  it('adds a new file', async () => {
    const p = patch('*** Add File: greeting.txt', '+hello', '+world')
    const { result } = await executeApplyPatch({ patch: p }, workspace)
    expect(result).toMatch(/Applied 1 change/)
    expect(readFileSync(join(workspace, 'greeting.txt'), 'utf8')).toBe('hello\nworld\n')
  })

  it('adds a file in a nested directory', async () => {
    const p = patch('*** Add File: deep/nested/file.txt', '+ok')
    const { result } = await executeApplyPatch({ patch: p }, workspace)
    expect(result).toMatch(/Applied 1 change/)
    expect(readFileSync(join(workspace, 'deep/nested/file.txt'), 'utf8')).toBe('ok\n')
  })

  it('refuses to add over an existing file', async () => {
    writeFileSync(join(workspace, 'x.txt'), 'old', 'utf8')
    const p = patch('*** Add File: x.txt', '+new')
    const { result } = await executeApplyPatch({ patch: p }, workspace)
    expect(result).toMatch(/Error:.*already exists/i)
    expect(readFileSync(join(workspace, 'x.txt'), 'utf8')).toBe('old')
  })

  it('updates a file via hunk match', async () => {
    writeFileSync(join(workspace, 'f.txt'), 'hello\nworld\n', 'utf8')
    const p = patch(
      '*** Update File: f.txt',
      '@@ first line',
      '-hello',
      '+greetings',
      ' world'
    )
    const { result } = await executeApplyPatch({ patch: p }, workspace)
    expect(result).toMatch(/Applied 1 change/)
    expect(readFileSync(join(workspace, 'f.txt'), 'utf8')).toBe('greetings\nworld\n')
  })

  it('rejects update when hunk does not match', async () => {
    writeFileSync(join(workspace, 'f.txt'), 'alpha\nbeta\n', 'utf8')
    const p = patch('*** Update File: f.txt', '-not-present', '+x')
    const { result } = await executeApplyPatch({ patch: p }, workspace)
    expect(result).toMatch(/Error:.*patch did not apply at hunk/i)
    // File unchanged.
    expect(readFileSync(join(workspace, 'f.txt'), 'utf8')).toBe('alpha\nbeta\n')
  })

  it('refuses to update a missing file', async () => {
    const p = patch('*** Update File: nope.txt', '-a', '+b')
    const { result } = await executeApplyPatch({ patch: p }, workspace)
    expect(result).toMatch(/Error:.*does not exist|not found/i)
  })

  it('deletes a file', async () => {
    writeFileSync(join(workspace, 'doomed.txt'), 'bye', 'utf8')
    const p = patch('*** Delete File: doomed.txt')
    const { result } = await executeApplyPatch({ patch: p }, workspace)
    expect(result).toMatch(/Applied 1 change/)
    expect(existsSync(join(workspace, 'doomed.txt'))).toBe(false)
  })

  it('refuses to delete a missing file', async () => {
    const p = patch('*** Delete File: missing.txt')
    const { result } = await executeApplyPatch({ patch: p }, workspace)
    expect(result).toMatch(/Error:.*does not exist|not found/i)
  })

  it('rejects a path-traversal Add', async () => {
    const p = patch('*** Add File: ../escape.txt', '+x')
    const { result } = await executeApplyPatch({ patch: p }, workspace)
    expect(result).toMatch(/Error:.*escapes the workspace|invalid/i)
  })

  it('rejects an absolute-path Add outside the workspace', async () => {
    const outside =
      process.platform === 'win32' ? 'C:\\Windows\\hacked.txt' : '/tmp/hacked.txt'
    const p = patch(`*** Add File: ${outside}`, '+x')
    const { result } = await executeApplyPatch({ patch: p }, workspace)
    expect(result).toMatch(/Error:.*escapes the workspace|invalid/i)
  })

  it('rejects a malformed envelope before any disk writes', async () => {
    const p = '*** Begin Patch\n*** Add File: real.txt\n+a\n*** End Patch\nstray-trailing'
    const { result } = await executeApplyPatch({ patch: p }, workspace)
    expect(result).toMatch(/Error:/)
    // Nothing should have been created.
    expect(existsSync(join(workspace, 'real.txt'))).toBe(false)
  })

  it('pre-validates all ops so an invalid op aborts the batch before writes', async () => {
    // Op 1: valid add. Op 2: invalid traversal. Expectation: neither applies.
    const p = patch(
      '*** Add File: ok.txt',
      '+content',
      '*** Add File: ../bad.txt',
      '+evil'
    )
    const { result } = await executeApplyPatch({ patch: p }, workspace)
    expect(result).toMatch(/Error:/)
    expect(existsSync(join(workspace, 'ok.txt'))).toBe(false)
  })

  it('preserves trailing-newline policy when updating', async () => {
    // File without trailing newline → updated file keeps no trailing newline.
    writeFileSync(join(workspace, 'noeol.txt'), 'one\ntwo', 'utf8')
    const p = patch('*** Update File: noeol.txt', '-one', '+ONE', ' two')
    const { result } = await executeApplyPatch({ patch: p }, workspace)
    expect(result).toMatch(/Applied 1 change/)
    expect(readFileSync(join(workspace, 'noeol.txt'), 'utf8')).toBe('ONE\ntwo')
  })
})
