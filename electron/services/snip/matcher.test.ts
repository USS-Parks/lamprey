import { describe, expect, it } from 'vitest'
import { parseCommand, selectFilter } from './matcher'
import type { Filter } from './types'

const mkFilter = (overrides: Partial<Filter> & { name: string; match: Filter['match'] }): Filter => ({
  description: 'test',
  pipeline: [],
  ...overrides
})

describe('snip matcher — parseCommand', () => {
  it('parses head + subcommand + flags', () => {
    expect(parseCommand('git status -sb')).toEqual({
      head: 'git',
      sub: 'status',
      flags: ['-sb'],
      isChain: false
    })
  })

  it('handles missing subcommand', () => {
    expect(parseCommand('ls')).toEqual({
      head: 'ls',
      flags: [],
      isChain: false
    })
  })

  it('treats flag-shaped second token as flags, not sub', () => {
    expect(parseCommand('ls -la')).toEqual({
      head: 'ls',
      flags: ['-la'],
      isChain: false
    })
  })

  it('detects && as a chain operator', () => {
    expect(parseCommand('cd foo && git log').isChain).toBe(true)
  })

  it('detects || as a chain operator', () => {
    expect(parseCommand('make test || echo failed').isChain).toBe(true)
  })

  it('detects semicolon as a chain operator', () => {
    expect(parseCommand('cd foo; git log').isChain).toBe(true)
  })

  it('detects pipe as a chain operator', () => {
    expect(parseCommand('git log | head').isChain).toBe(true)
  })

  it('does not flag chain when operators are inside single quotes', () => {
    expect(parseCommand("echo 'a && b'").isChain).toBe(false)
  })

  it('does not flag chain when operators are inside double quotes', () => {
    expect(parseCommand('echo "a || b"').isChain).toBe(false)
  })

  it('does not flag chain when operator is backslash-escaped outside quotes', () => {
    expect(parseCommand('echo a \\&\\& b').isChain).toBe(false)
  })

  it('strips leading env-var assignments', () => {
    expect(parseCommand('NODE_ENV=production npm test --silent')).toEqual({
      head: 'npm',
      sub: 'test',
      flags: ['--silent'],
      isChain: false
    })
  })

  it('preserves double-quoted argument as single token', () => {
    const p = parseCommand('git commit -m "fix: thing with spaces"')
    expect(p.head).toBe('git')
    expect(p.sub).toBe('commit')
    expect(p.flags).toEqual(['-m', 'fix: thing with spaces'])
  })

  it('preserves single-quoted argument literally — variables stay un-expanded', () => {
    // grep has no subcommand pattern, so the parser sees the quoted
    // string as the second non-flag token → it lands in `sub`.
    const p = parseCommand("grep 'pattern with $vars' file")
    expect(p.head).toBe('grep')
    expect(p.sub).toBe('pattern with $vars')
    expect(p.flags).toEqual(['file'])
  })

  it('handles empty input', () => {
    expect(parseCommand('')).toEqual({ head: '', flags: [], isChain: false })
  })

  it('handles whitespace-only input', () => {
    expect(parseCommand('   ')).toEqual({ head: '', flags: [], isChain: false })
  })
})

describe('snip matcher — selectFilter', () => {
  const gitLog = mkFilter({
    name: 'git-log',
    match: { command: 'git', subcommand: 'log', excludeFlags: ['--oneline', '--pretty', '--format', '-n'] }
  })
  const gitStatus = mkFilter({
    name: 'git-status',
    match: { command: 'git', subcommand: 'status' }
  })
  const tscViaNpx = mkFilter({
    name: 'npx-tsc',
    match: { command: 'tsc', viaNpx: true }
  })
  const vitestViaNpx = mkFilter({
    name: 'vitest-run',
    match: { command: 'vitest', subcommand: 'run', viaNpx: true }
  })
  const allFilters: Filter[] = [gitLog, gitStatus, tscViaNpx, vitestViaNpx]

  it('returns null on empty parse', () => {
    expect(selectFilter(parseCommand(''), allFilters)).toBe(null)
  })

  it('returns null on a chained command', () => {
    expect(selectFilter(parseCommand('cd foo && git log'), allFilters)).toBe(null)
  })

  it('selects by head + subcommand', () => {
    expect(selectFilter(parseCommand('git log'), allFilters)).toBe(gitLog)
    expect(selectFilter(parseCommand('git status'), allFilters)).toBe(gitStatus)
  })

  it('does not select when subcommand differs', () => {
    expect(selectFilter(parseCommand('git diff'), allFilters)).toBe(null)
  })

  it('excludeFlags short-circuits the match', () => {
    expect(selectFilter(parseCommand('git log --oneline'), allFilters)).toBe(null)
    expect(selectFilter(parseCommand('git log --pretty=oneline'), allFilters)).toBe(null)
    expect(selectFilter(parseCommand('git log -n 5'), allFilters)).toBe(null)
  })

  it('viaNpx accepts both direct and npx-wrapped', () => {
    expect(selectFilter(parseCommand('tsc --noEmit'), allFilters)).toBe(tscViaNpx)
    expect(selectFilter(parseCommand('npx tsc --noEmit'), allFilters)).toBe(tscViaNpx)
  })

  it('viaNpx with subcommand requires the wrapped sub too', () => {
    expect(selectFilter(parseCommand('npx vitest run'), allFilters)).toBe(vitestViaNpx)
    // npx vitest (no `run`) → no match because match.subcommand requires it
    expect(selectFilter(parseCommand('npx vitest'), allFilters)).toBe(null)
  })

  it('viaNpx accepts pnpm dlx + yarn dlx forms', () => {
    expect(selectFilter(parseCommand('pnpm dlx tsc --noEmit'), allFilters)).toBe(tscViaNpx)
    expect(selectFilter(parseCommand('yarn dlx tsc'), allFilters)).toBe(tscViaNpx)
  })

  it('viaNpx + excludeFlags work together', () => {
    // No exclude flags on tsc, so just sanity-check vitest with a stub.
    const vitestNoCov = mkFilter({
      name: 'vitest-run-nocov',
      match: {
        command: 'vitest',
        subcommand: 'run',
        viaNpx: true,
        excludeFlags: ['--coverage']
      }
    })
    expect(selectFilter(parseCommand('npx vitest run --coverage'), [vitestNoCov])).toBe(null)
    expect(selectFilter(parseCommand('npx vitest run --watch'), [vitestNoCov])).toBe(vitestNoCov)
  })

  it('returns the first matching filter when multiple could match', () => {
    const wide = mkFilter({ name: 'git-any', match: { command: 'git' } })
    // wide comes first → wins even though gitStatus also matches.
    expect(selectFilter(parseCommand('git status'), [wide, gitStatus])).toBe(wide)
  })
})
