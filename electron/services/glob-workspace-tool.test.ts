import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildGlobArgs,
  executeGlob,
  formatGlobResult,
  sortPathsByMtime
} from './glob-workspace-tool'

let rgPath: string | undefined
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ;({ rgPath } = require('@vscode/ripgrep') as { rgPath: string })
  if (rgPath && !existsSync(rgPath)) rgPath = undefined
} catch {
  rgPath = undefined
}

describe('buildGlobArgs', () => {
  it('rejects empty pattern', () => {
    expect(buildGlobArgs({ pattern: '' })).toBe('pattern is required')
  })
  it('rejects whitespace-only pattern', () => {
    expect(buildGlobArgs({ pattern: '   ' })).toBe('pattern is required')
  })
  it('always passes --files + --no-messages', () => {
    const r = buildGlobArgs({ pattern: '**/*.ts' })
    if (typeof r === 'string') throw new Error(r)
    expect(r.argv).toContain('--files')
    expect(r.argv).toContain('--no-messages')
  })
  it('does NOT pass --glob to rg (it would override .gitignore)', () => {
    // The user's pattern is post-filtered with picomatch instead. Asserting
    // this absence pins the design: any future change that re-adds --glob
    // here would silently surface node_modules paths.
    const r = buildGlobArgs({ pattern: '**/*.tsx' })
    if (typeof r === 'string') throw new Error(r)
    expect(r.argv).not.toContain('--glob')
  })
  it('hidden + no_ignore flags', () => {
    const r = buildGlobArgs({
      pattern: '*',
      include_hidden: true,
      no_ignore: true
    })
    if (typeof r === 'string') throw new Error(r)
    expect(r.argv).toContain('--hidden')
    expect(r.argv).toContain('--no-ignore')
  })
})

describe('sortPathsByMtime', () => {
  let workspace: string
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'glob-sort-test-'))
  })
  afterEach(() => {
    try {
      rmSync(workspace, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  })

  it('most recently modified first', () => {
    const a = join(workspace, 'a.txt')
    const b = join(workspace, 'b.txt')
    const c = join(workspace, 'c.txt')
    writeFileSync(a, 'a')
    writeFileSync(b, 'b')
    writeFileSync(c, 'c')
    // Force explicit, distinct mtimes (epoch seconds). c is newest, a is oldest.
    utimesSync(a, new Date('2020-01-01'), new Date('2020-01-01'))
    utimesSync(b, new Date('2024-01-01'), new Date('2024-01-01'))
    utimesSync(c, new Date('2025-01-01'), new Date('2025-01-01'))
    const sorted = sortPathsByMtime([a, b, c])
    expect(sorted).toEqual([c, b, a])
  })

  it('missing files keep order at the back (mtime=0)', () => {
    const a = join(workspace, 'a.txt')
    writeFileSync(a, 'a')
    utimesSync(a, new Date('2020-01-01'), new Date('2020-01-01'))
    const ghost = join(workspace, 'ghost.txt') // never created
    const sorted = sortPathsByMtime([ghost, a])
    expect(sorted[0]).toBe(a) // real file comes first
    expect(sorted[1]).toBe(ghost)
  })
})

describe('formatGlobResult', () => {
  it('paths one per line', () => {
    expect(
      formatGlobResult({
        paths: ['a.ts', 'b.ts'],
        truncated: false,
        totalMatched: 2
      })
    ).toBe('a.ts\nb.ts')
  })
  it('empty → "(no matches)"', () => {
    expect(
      formatGlobResult({ paths: [], truncated: false, totalMatched: 0 })
    ).toBe('(no matches)')
  })
  it('truncation marker includes totals', () => {
    const out = formatGlobResult({
      paths: ['a.ts'],
      truncated: true,
      totalMatched: 5000
    })
    expect(out).toContain('5000 total')
    expect(out).toContain('mtime')
  })
})

const itRg = rgPath ? it : it.skip

describe('executeGlob (real rg)', () => {
  let workspace: string
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'glob-test-'))
  })
  afterEach(() => {
    try {
      rmSync(workspace, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  })

  itRg('matches by extension', async () => {
    writeFileSync(join(workspace, 'a.ts'), '')
    writeFileSync(join(workspace, 'b.ts'), '')
    writeFileSync(join(workspace, 'c.py'), '')
    const r = await executeGlob({ pattern: '*.ts' }, workspace, rgPath)
    expect(r.paths.length).toBe(2)
    expect(r.paths.every((p) => p.endsWith('.ts'))).toBe(true)
  })

  itRg('recursive ** descent', async () => {
    mkdirSync(join(workspace, 'src/nested'), { recursive: true })
    writeFileSync(join(workspace, 'src/a.ts'), '')
    writeFileSync(join(workspace, 'src/nested/b.ts'), '')
    const r = await executeGlob({ pattern: '**/*.ts' }, workspace, rgPath)
    expect(r.paths.length).toBe(2)
  })

  itRg('brace expansion', async () => {
    writeFileSync(join(workspace, 'a.ts'), '')
    writeFileSync(join(workspace, 'b.tsx'), '')
    writeFileSync(join(workspace, 'c.js'), '')
    const r = await executeGlob({ pattern: '*.{ts,tsx}' }, workspace, rgPath)
    expect(r.paths.length).toBe(2)
    expect(r.paths.every((p) => p.endsWith('.ts') || p.endsWith('.tsx'))).toBe(true)
  })

  itRg('mtime sort: newest first', async () => {
    const a = join(workspace, 'a.ts')
    const b = join(workspace, 'b.ts')
    writeFileSync(a, '')
    writeFileSync(b, '')
    utimesSync(a, new Date('2020-01-01'), new Date('2020-01-01'))
    utimesSync(b, new Date('2025-01-01'), new Date('2025-01-01'))
    const r = await executeGlob({ pattern: '*.ts' }, workspace, rgPath)
    expect(r.paths[0]).toBe(b)
    expect(r.paths[1]).toBe(a)
  })

  itRg('zero matches → empty paths, not error', async () => {
    const r = await executeGlob({ pattern: '*.nope' }, workspace, rgPath)
    expect(r.paths).toEqual([])
    expect(r.totalMatched).toBe(0)
  })

  itRg('respects .gitignore by default', async () => {
    writeFileSync(join(workspace, '.gitignore'), 'ignored.ts\n')
    writeFileSync(join(workspace, 'kept.ts'), '')
    writeFileSync(join(workspace, 'ignored.ts'), '')
    // rg's --files reads gitignore even outside a git repo via --hidden flag
    // semantics. With no_ignore=false, ignored.ts should NOT appear.
    const r = await executeGlob({ pattern: '*.ts' }, workspace, rgPath)
    expect(r.paths.some((p) => p.endsWith('kept.ts'))).toBe(true)
    expect(r.paths.some((p) => p.endsWith('ignored.ts'))).toBe(false)
  })

  itRg('no_ignore=true bypasses .gitignore', async () => {
    writeFileSync(join(workspace, '.gitignore'), 'ignored.ts\n')
    writeFileSync(join(workspace, 'ignored.ts'), '')
    const r = await executeGlob(
      { pattern: '*.ts', no_ignore: true },
      workspace,
      rgPath
    )
    expect(r.paths.some((p) => p.endsWith('ignored.ts'))).toBe(true)
  })

  itRg('subdirectory path scopes search', async () => {
    mkdirSync(join(workspace, 'in'))
    writeFileSync(join(workspace, 'in/a.ts'), '')
    writeFileSync(join(workspace, 'out.ts'), '')
    const r = await executeGlob(
      { pattern: '*.ts', path: 'in' },
      workspace,
      rgPath
    )
    expect(r.paths.length).toBe(1)
    expect(r.paths[0]).toContain('a.ts')
  })

  itRg('search path escape rejected', async () => {
    await expect(
      executeGlob({ pattern: '*', path: '../escape' }, workspace, rgPath)
    ).rejects.toThrow(/outside the workspace root/)
  })
})
