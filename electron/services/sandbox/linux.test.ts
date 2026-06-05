import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'

import { applyLinuxProfile, buildBwrapArgs } from './linux'
import type { SandboxInput } from './index'

// All host paths exist — keeps argv stable across hosts where /lib64 is
// optional (Alpine, NixOS).
const existsAll = (_p: string) => true
const existsNone = (_p: string) => false
const TMPDIR = '/tmp'

function baseInput(overrides: Partial<SandboxInput> = {}): SandboxInput {
  return {
    spawnCmd: 'echo',
    spawnArgs: ['hi'],
    cwd: '/work/repo',
    opts: { workspaceRoot: '/work/repo' },
    platform: 'linux',
    ...overrides
  }
}

/** Locate consecutive `--flag a b` triples inside argv. */
function hasBindTriple(args: string[], flag: string, src: string, dst: string): boolean {
  for (let i = 0; i < args.length - 2; i++) {
    if (args[i] === flag && args[i + 1] === src && args[i + 2] === dst) return true
  }
  return false
}

describe('applyLinuxProfile / buildBwrapArgs (S5)', () => {
  it('returns null when bwrap is not on PATH', () => {
    const r = applyLinuxProfile(baseInput(), () => null, existsAll, TMPDIR)
    expect(r).toBeNull()
  })

  it('wraps the original cmd + args in a bwrap invocation', () => {
    const r = applyLinuxProfile(baseInput(), () => '/usr/bin/bwrap', existsAll, TMPDIR)
    expect(r).not.toBeNull()
    expect(r!.cmd).toBe('bwrap')
    expect(r!.sandboxTier).toBe('linux-bwrap')
  })

  it('argv contains --bind <workspace> <workspace>', () => {
    const { args } = buildBwrapArgs(baseInput(), existsAll, TMPDIR)
    expect(hasBindTriple(args, '--bind', '/work/repo', '/work/repo')).toBe(true)
  })

  it('argv contains --bind <tmpdir> <tmpdir>', () => {
    const { args } = buildBwrapArgs(baseInput(), existsAll, TMPDIR)
    expect(hasBindTriple(args, '--bind', TMPDIR, TMPDIR)).toBe(true)
  })

  it('argv contains --proc /proc and --dev /dev', () => {
    const { args } = buildBwrapArgs(baseInput(), existsAll, TMPDIR)
    const procIdx = args.indexOf('--proc')
    const devIdx = args.indexOf('--dev')
    expect(procIdx).toBeGreaterThanOrEqual(0)
    expect(args[procIdx + 1]).toBe('/proc')
    expect(devIdx).toBeGreaterThanOrEqual(0)
    expect(args[devIdx + 1]).toBe('/dev')
  })

  it('argv contains --chdir <cwd>', () => {
    const { args } = buildBwrapArgs(baseInput({ cwd: '/work/repo/sub' }), existsAll, TMPDIR)
    const idx = args.indexOf('--chdir')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(args[idx + 1]).toBe('/work/repo/sub')
  })

  it("adds --unshare-net when networkPolicy === 'deny'", () => {
    const { args, note } = buildBwrapArgs(
      baseInput({ opts: { workspaceRoot: '/work/repo', networkPolicy: 'deny' } }),
      existsAll,
      TMPDIR
    )
    expect(args).toContain('--unshare-net')
    expect(note).toBeUndefined()
  })

  it("does NOT add --unshare-net when networkPolicy === 'open'", () => {
    const { args } = buildBwrapArgs(
      baseInput({ opts: { workspaceRoot: '/work/repo', networkPolicy: 'open' } }),
      existsAll,
      TMPDIR
    )
    expect(args).not.toContain('--unshare-net')
  })

  it('does NOT add --unshare-net for allowDomains AND sets a note about the limitation', () => {
    const r = applyLinuxProfile(
      baseInput({
        opts: { workspaceRoot: '/work/repo', networkPolicy: { allowDomains: ['foo.com'] } }
      }),
      () => '/usr/bin/bwrap',
      existsAll,
      TMPDIR
    )
    expect(r).not.toBeNull()
    expect(r!.args).not.toContain('--unshare-net')
    expect(r!.note).toBeDefined()
    expect(r!.note).toMatch(/allowDomains/i)
    expect(r!.note).toMatch(/no domain filtering|not enforced/i)
  })

  it('emits one --bind P P pair per fsWritePaths entry', () => {
    const { args } = buildBwrapArgs(
      baseInput({
        opts: {
          workspaceRoot: '/work/repo',
          fsWritePaths: ['/cache/a', '/cache/b']
        }
      }),
      existsAll,
      TMPDIR
    )
    expect(hasBindTriple(args, '--bind', '/cache/a', '/cache/a')).toBe(true)
    expect(hasBindTriple(args, '--bind', '/cache/b', '/cache/b')).toBe(true)
  })

  it('places the original cmd + args last, immediately after --', () => {
    const { args } = buildBwrapArgs(
      baseInput({ spawnCmd: 'echo', spawnArgs: ['hello', 'world'] }),
      existsAll,
      TMPDIR
    )
    const sep = args.indexOf('--')
    expect(sep).toBeGreaterThanOrEqual(0)
    expect(args.slice(sep)).toEqual(['--', 'echo', 'hello', 'world'])
    // Nothing trailing after the original args.
    expect(args[args.length - 1]).toBe('world')
  })

  it("returned SandboxOutput carries sandboxTier 'linux-bwrap'", () => {
    const r = applyLinuxProfile(baseInput(), () => '/usr/bin/bwrap', existsAll, TMPDIR)
    expect(r!.sandboxTier).toBe('linux-bwrap')
  })

  it('argv starts with bwrap-style flags (first arg is a flag, not the original cmd)', () => {
    const { args } = buildBwrapArgs(baseInput(), existsAll, TMPDIR)
    expect(args[0]).toMatch(/^--/)
    expect(args[0]).toBe('--ro-bind')
  })

  it('skips /lib and /lib64 binds when those paths do not exist on the host', () => {
    const { args } = buildBwrapArgs(baseInput(), existsNone, TMPDIR)
    expect(hasBindTriple(args, '--ro-bind', '/lib', '/lib')).toBe(false)
    expect(hasBindTriple(args, '--ro-bind', '/lib64', '/lib64')).toBe(false)
    // /usr, /bin, /etc are always bound regardless of pathExists.
    expect(hasBindTriple(args, '--ro-bind', '/usr', '/usr')).toBe(true)
    expect(hasBindTriple(args, '--ro-bind', '/bin', '/bin')).toBe(true)
    expect(hasBindTriple(args, '--ro-bind', '/etc', '/etc')).toBe(true)
  })

  it('includes /lib and /lib64 ro-binds when those paths exist on the host', () => {
    const { args } = buildBwrapArgs(baseInput(), existsAll, TMPDIR)
    expect(hasBindTriple(args, '--ro-bind', '/lib', '/lib')).toBe(true)
    expect(hasBindTriple(args, '--ro-bind', '/lib64', '/lib64')).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────
// Integration: only runs on a real Linux host with bwrap installed.
// On Windows / macOS / CI without bwrap these are skipped.
// user-verification-needed: confirm on a real Linux host with bwrap installed
// ────────────────────────────────────────────────────────────────────────
const RUN_LINUX_INTEGRATION = process.platform === 'linux'

describe.skipIf(!RUN_LINUX_INTEGRATION)('applyLinuxProfile integration (linux only)', () => {
  it('produced argv actually spawns and runs the wrapped command', () => {
    const r = applyLinuxProfile(
      baseInput({ spawnCmd: '/bin/echo', spawnArgs: ['lamprey-bwrap-ok'] })
    )
    if (!r) {
      // bwrap not installed on this Linux host — skip rather than fail.
      return
    }
    const result = spawnSync(r.cmd, r.args, { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('lamprey-bwrap-ok')
  })
})
