import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import {
  applyDarwinProfile,
  buildDarwinProfile,
  __setSandboxExecLocatorForTest
} from './darwin'
import type { SandboxInput } from './index'

// ─── Pure profile-string builder — runs on every platform ───────────────

describe('buildDarwinProfile (pure)', () => {
  it('emits the SBPL header `(version 1)`', () => {
    const profile = buildDarwinProfile('/tmp/wk')
    expect(profile).toContain('(version 1)')
  })

  it('starts with `(deny default)` (deny-by-default policy)', () => {
    const profile = buildDarwinProfile('/tmp/wk')
    expect(profile).toContain('(deny default)')
  })

  it('allows file-write* on the workspace root via (subpath "...")', () => {
    const profile = buildDarwinProfile('/tmp/wk')
    expect(profile).toContain('(allow file-write* (subpath "/tmp/wk"))')
  })

  it('allows file-write* on the tmpdir', () => {
    const tmp = '/private/var/folders/tmpX'
    const profile = buildDarwinProfile('/tmp/wk', [], 'open', tmp)
    expect(profile).toContain(`(allow file-write* (subpath "${tmp}"))`)
  })

  it("emits `(allow network*)` when networkPolicy is 'open'", () => {
    const profile = buildDarwinProfile('/tmp/wk', [], 'open')
    expect(profile).toContain('(allow network*)')
  })

  it("omits `(allow network*)` when networkPolicy is 'deny'", () => {
    const profile = buildDarwinProfile('/tmp/wk', [], 'deny')
    expect(profile).not.toContain('(allow network*)')
  })

  it('emits a documentation comment for { allowDomains: [...] }', () => {
    const profile = buildDarwinProfile('/tmp/wk', [], { allowDomains: ['foo.com', 'bar.org'] })
    expect(profile).toContain(';; allow-domains: foo.com, bar.org')
    // and still allows the network behaviourally
    expect(profile).toContain('(allow network*)')
  })

  it('includes extra fsWritePaths entries as their own (subpath ...) rules', () => {
    const profile = buildDarwinProfile('/tmp/wk', ['/var/cache/build', '/opt/data'])
    expect(profile).toContain('(allow file-write* (subpath "/var/cache/build"))')
    expect(profile).toContain('(allow file-write* (subpath "/opt/data"))')
  })

  it('deduplicates writable paths (workspaceRoot + tmpdir + extras)', () => {
    // Pass the workspace twice in fsWritePaths — it should still appear
    // exactly once in the profile string.
    const tmp = '/tmpdir-X'
    const profile = buildDarwinProfile('/tmp/wk', ['/tmp/wk', '/tmp/wk', tmp], 'open', tmp)
    const occurrences = profile.split('(allow file-write* (subpath "/tmp/wk"))').length - 1
    expect(occurrences).toBe(1)
    const tmpOccurrences =
      profile.split(`(allow file-write* (subpath "${tmp}"))`).length - 1
    expect(tmpOccurrences).toBe(1)
  })

  it('always allows process*, file-read*, ipc*, mach-lookup, and signal self', () => {
    const profile = buildDarwinProfile('/tmp/wk')
    expect(profile).toContain('(allow process*)')
    expect(profile).toContain('(allow file-read*)')
    expect(profile).toContain('(allow ipc*)')
    expect(profile).toContain('(allow mach-lookup)')
    expect(profile).toContain('(allow signal (target self))')
  })

  it('escapes embedded quotes / backslashes inside subpath strings', () => {
    const weird = String.raw`/tmp/with "quote" and \back`
    const profile = buildDarwinProfile(weird)
    expect(profile).toContain(
      String.raw`(allow file-write* (subpath "/tmp/with \"quote\" and \\back"))`
    )
  })
})

// ─── applyDarwinProfile dispatcher — uses the locator seam ──────────────

describe('applyDarwinProfile (dispatcher)', () => {
  afterEach(() => {
    __setSandboxExecLocatorForTest(null)
  })

  const baseInput: SandboxInput = {
    spawnCmd: 'echo',
    spawnArgs: ['hello'],
    cwd: '/tmp/wk',
    opts: { workspaceRoot: '/tmp/wk' }
  }

  it('returns the wrapped invocation when sandbox-exec is on PATH', () => {
    __setSandboxExecLocatorForTest(() => '/usr/bin/sandbox-exec')
    const result = applyDarwinProfile(baseInput)
    expect(result).not.toBeNull()
    expect(result!.cmd).toBe('sandbox-exec')
    expect(result!.sandboxTier).toBe('darwin-sbx')
    // argv layout: -p <profile> -- <original cmd> <original args...>
    expect(result!.args[0]).toBe('-p')
    expect(typeof result!.args[1]).toBe('string')
    expect(result!.args[1]).toContain('(version 1)')
    expect(result!.args[2]).toBe('--')
    expect(result!.args[3]).toBe('echo')
    expect(result!.args[4]).toBe('hello')
  })

  it('returns null when sandbox-exec is missing from PATH', () => {
    __setSandboxExecLocatorForTest(() => null)
    const result = applyDarwinProfile(baseInput)
    expect(result).toBeNull()
  })

  it('threads networkPolicy through to the embedded profile string', () => {
    __setSandboxExecLocatorForTest(() => '/usr/bin/sandbox-exec')
    const denied = applyDarwinProfile({
      ...baseInput,
      opts: { ...baseInput.opts, networkPolicy: 'deny' }
    })
    expect(denied!.args[1]).not.toContain('(allow network*)')

    const open = applyDarwinProfile({
      ...baseInput,
      opts: { ...baseInput.opts, networkPolicy: 'open' }
    })
    expect(open!.args[1]).toContain('(allow network*)')
  })

  it('threads fsWritePaths through to the embedded profile string', () => {
    __setSandboxExecLocatorForTest(() => '/usr/bin/sandbox-exec')
    const result = applyDarwinProfile({
      ...baseInput,
      opts: { ...baseInput.opts, fsWritePaths: ['/data/extra'] }
    })
    expect(result!.args[1]).toContain('(allow file-write* (subpath "/data/extra"))')
  })

  it('passes through extra spawn args untouched after the `--` separator', () => {
    __setSandboxExecLocatorForTest(() => '/usr/bin/sandbox-exec')
    const result = applyDarwinProfile({
      ...baseInput,
      spawnCmd: '/bin/sh',
      spawnArgs: ['-c', 'echo hi && date']
    })
    expect(result!.args.slice(2)).toEqual(['--', '/bin/sh', '-c', 'echo hi && date'])
  })
})

// ─── Integration — only on a real darwin host ───────────────────────────

describe('applyDarwinProfile (integration, darwin only)', () => {
  it.skipIf(process.platform !== 'darwin')(
    'spawns through real sandbox-exec and prints stdout',
    () => {
      __setSandboxExecLocatorForTest(null) // use real findOnPath
      const result = applyDarwinProfile({
        spawnCmd: '/bin/echo',
        spawnArgs: ['hello'],
        cwd: tmpdir(),
        opts: { workspaceRoot: tmpdir(), networkPolicy: 'deny' }
      })
      expect(result).not.toBeNull()
      const out = execFileSync(result!.cmd, result!.args, { encoding: 'utf8' })
      expect(out.trim()).toBe('hello')
    }
  )
})
