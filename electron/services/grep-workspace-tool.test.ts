import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildRgArgs,
  executeGrep,
  formatGrepResult,
  parseRgJsonStream,
  type GrepResult
} from './grep-workspace-tool'

// rgPath is resolved lazily inside executeGrep. For the spawn-based
// integration tests at the bottom we import it directly so we can skip
// gracefully on platforms missing the optional dep (CI Linux ARM
// without a matching binary, for instance).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let rgPath: string | undefined
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ;({ rgPath } = require('@vscode/ripgrep') as { rgPath: string })
  if (rgPath && !existsSync(rgPath)) rgPath = undefined
} catch {
  rgPath = undefined
}

describe('buildRgArgs', () => {
  it('rejects empty pattern', () => {
    expect(buildRgArgs({ pattern: '' })).toBe('pattern is required')
  })
  it('rejects missing pattern', () => {
    // @ts-expect-error intentional missing pattern
    expect(buildRgArgs({})).toBe('pattern is required')
  })
  it('always injects --json', () => {
    const r = buildRgArgs({ pattern: 'foo' })
    expect(typeof r).not.toBe('string')
    if (typeof r === 'string') return
    expect(r.argv).toContain('--json')
  })
  it('case insensitivity → --ignore-case', () => {
    const r = buildRgArgs({ pattern: 'x', case_insensitive: true })
    if (typeof r === 'string') throw new Error(r)
    expect(r.argv).toContain('--ignore-case')
  })
  it('type filter is sanitized', () => {
    expect(buildRgArgs({ pattern: 'x', type: 'rm -rf' })).toContain('invalid')
  })
  it('valid type → --type passed', () => {
    const r = buildRgArgs({ pattern: 'x', type: 'ts' })
    if (typeof r === 'string') throw new Error(r)
    const idx = r.argv.indexOf('--type')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(r.argv[idx + 1]).toBe('ts')
  })
  it('glob passes through', () => {
    const r = buildRgArgs({ pattern: 'x', glob: '*.tsx' })
    if (typeof r === 'string') throw new Error(r)
    const idx = r.argv.indexOf('--glob')
    expect(r.argv[idx + 1]).toBe('*.tsx')
  })
  it('symmetric context overrides before/after', () => {
    const r = buildRgArgs({
      pattern: 'x',
      context: 3,
      context_before: 5,
      context_after: 5
    })
    if (typeof r === 'string') throw new Error(r)
    expect(r.argv).toContain('--context')
    expect(r.argv).not.toContain('--before-context')
    expect(r.argv).not.toContain('--after-context')
  })
  it('multiline implies dotall', () => {
    const r = buildRgArgs({ pattern: 'x', multiline: true })
    if (typeof r === 'string') throw new Error(r)
    expect(r.argv).toContain('--multiline')
    expect(r.argv).toContain('--multiline-dotall')
  })
  it('pattern goes through -e to allow leading dash', () => {
    const r = buildRgArgs({ pattern: '-x' })
    if (typeof r === 'string') throw new Error(r)
    expect(r.argv[r.argv.length - 2]).toBe('-e')
    expect(r.argv[r.argv.length - 1]).toBe('-x')
  })
  it('mode defaults to files_with_matches', () => {
    const r = buildRgArgs({ pattern: 'x' })
    if (typeof r === 'string') throw new Error(r)
    expect(r.mode).toBe('files_with_matches')
  })
  it('hidden + no_ignore flags', () => {
    const r = buildRgArgs({ pattern: 'x', include_hidden: true, no_ignore: true })
    if (typeof r === 'string') throw new Error(r)
    expect(r.argv).toContain('--hidden')
    expect(r.argv).toContain('--no-ignore')
  })
})

describe('parseRgJsonStream', () => {
  // Synthetic rg --json output, constructed from the documented schema
  // (https://docs.rs/ripgrep/latest/grep_printer/struct.JSON.html).
  const sample = [
    JSON.stringify({
      type: 'begin',
      data: { path: { text: 'src/foo.ts' } }
    }),
    JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'src/foo.ts' },
        line_number: 5,
        lines: { text: 'function foo()\n' }
      }
    }),
    JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'src/foo.ts' },
        line_number: 9,
        lines: { text: '  foo()\n' }
      }
    }),
    JSON.stringify({
      type: 'end',
      data: { path: { text: 'src/foo.ts' } }
    }),
    JSON.stringify({
      type: 'begin',
      data: { path: { text: 'src/bar.ts' } }
    }),
    JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'src/bar.ts' },
        line_number: 1,
        lines: { text: 'import { foo }\n' }
      }
    }),
    JSON.stringify({
      type: 'end',
      data: { path: { text: 'src/bar.ts' } }
    })
  ].join('\n')

  it('content mode → match per line', () => {
    const r = parseRgJsonStream(sample, 'content', 250)
    expect(r.totalMatches).toBe(3)
    expect(r.matches.length).toBe(3)
    expect(r.matches[0]).toEqual({
      file: 'src/foo.ts',
      line: 5,
      text: 'function foo()'
    })
  })
  it('files_with_matches → deduped paths', () => {
    const r = parseRgJsonStream(sample, 'files_with_matches', 250)
    expect(r.matches.length).toBe(2)
    expect(r.matches.map((m) => m.file)).toEqual(['src/foo.ts', 'src/bar.ts'])
  })
  it('count mode → per-file totals', () => {
    const r = parseRgJsonStream(sample, 'count', 250)
    expect(r.matches.length).toBe(2)
    expect(r.matches).toEqual([
      { file: 'src/foo.ts', matchCount: 2 },
      { file: 'src/bar.ts', matchCount: 1 }
    ])
  })
  it('honors head_limit and reports truncated', () => {
    const r = parseRgJsonStream(sample, 'content', 1)
    expect(r.matches.length).toBe(1)
    expect(r.truncated).toBe(true)
    // totalMatches still reflects ALL the matches rg saw, not just kept
    expect(r.totalMatches).toBe(3)
  })
  it('handles malformed lines without crashing', () => {
    const mangled = sample + '\nnot json at all\n'
    const r = parseRgJsonStream(mangled, 'content', 250)
    expect(r.totalMatches).toBe(3)
  })
})

describe('formatGrepResult', () => {
  it('files_with_matches → one path per line', () => {
    const r: GrepResult = {
      mode: 'files_with_matches',
      matches: [{ file: 'a.ts' }, { file: 'b.ts' }],
      totalMatches: 2,
      truncated: false
    }
    expect(formatGrepResult(r)).toBe('a.ts\nb.ts')
  })
  it('content → grep -n shape', () => {
    const r: GrepResult = {
      mode: 'content',
      matches: [{ file: 'x.ts', line: 7, text: 'foo' }],
      totalMatches: 1,
      truncated: false
    }
    expect(formatGrepResult(r)).toBe('x.ts:7:foo')
  })
  it('count → path:count', () => {
    const r: GrepResult = {
      mode: 'count',
      matches: [{ file: 'x.ts', matchCount: 4 }],
      totalMatches: 4,
      truncated: false
    }
    expect(formatGrepResult(r)).toBe('x.ts:4')
  })
  it('empty → "(no matches)"', () => {
    const r: GrepResult = {
      mode: 'content',
      matches: [],
      totalMatches: 0,
      truncated: false
    }
    expect(formatGrepResult(r)).toBe('(no matches)')
  })
  it('truncation marker appended', () => {
    const r: GrepResult = {
      mode: 'content',
      matches: [{ file: 'x.ts', line: 1, text: 'a' }],
      totalMatches: 100,
      truncated: true
    }
    expect(formatGrepResult(r)).toContain('truncated')
    expect(formatGrepResult(r)).toContain('100 total')
  })
})

// Integration: actually spawn the bundled rg against a tiny tempdir.
// Skipped if the platform-specific binary failed to install.
const itRg = rgPath ? it : it.skip

describe('executeGrep (real rg)', () => {
  let workspace: string
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'grep-test-'))
  })
  afterEach(() => {
    try {
      rmSync(workspace, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  })

  itRg('finds matches in a small workspace', async () => {
    writeFileSync(join(workspace, 'a.ts'), 'const foo = 1\nconst bar = foo + 2\n')
    writeFileSync(join(workspace, 'b.ts'), 'const baz = 3\n')
    const r = await executeGrep({ pattern: 'foo', output_mode: 'content' }, workspace, rgPath)
    expect(r.totalMatches).toBeGreaterThanOrEqual(2)
    expect(r.matches.some((m) => m.file?.endsWith('a.ts'))).toBe(true)
  })

  itRg('zero matches → empty result, not error', async () => {
    writeFileSync(join(workspace, 'a.ts'), 'nothing\n')
    const r = await executeGrep({ pattern: 'missing-symbol-xyz' }, workspace, rgPath)
    expect(r.totalMatches).toBe(0)
    expect(r.matches.length).toBe(0)
  })

  itRg('glob narrows scope', async () => {
    writeFileSync(join(workspace, 'a.ts'), 'foo\n')
    writeFileSync(join(workspace, 'b.py'), 'foo\n')
    const r = await executeGrep(
      { pattern: 'foo', glob: '*.py', output_mode: 'files_with_matches' },
      workspace,
      rgPath
    )
    expect(r.matches.length).toBe(1)
    expect(r.matches[0].file.endsWith('b.py')).toBe(true)
  })

  itRg('count mode returns per-file totals', async () => {
    writeFileSync(join(workspace, 'a.ts'), 'foo\nfoo\nfoo\n')
    writeFileSync(join(workspace, 'b.ts'), 'foo\n')
    const r = await executeGrep(
      { pattern: 'foo', output_mode: 'count' },
      workspace,
      rgPath
    )
    expect(r.matches.length).toBe(2)
    const total = r.matches.reduce((a, m) => a + (m.matchCount ?? 0), 0)
    expect(total).toBe(4)
  })

  itRg('subdir path scopes search', async () => {
    mkdirSync(join(workspace, 'sub'))
    writeFileSync(join(workspace, 'sub/in.ts'), 'foo\n')
    writeFileSync(join(workspace, 'out.ts'), 'foo\n')
    const r = await executeGrep(
      { pattern: 'foo', path: 'sub', output_mode: 'files_with_matches' },
      workspace,
      rgPath
    )
    expect(r.matches.length).toBe(1)
    expect(r.matches[0].file).toContain('in.ts')
  })

  itRg('search path escape rejected', async () => {
    await expect(
      executeGrep({ pattern: 'x', path: '../escape' }, workspace, rgPath)
    ).rejects.toThrow(/outside the workspace root/)
  })
})
