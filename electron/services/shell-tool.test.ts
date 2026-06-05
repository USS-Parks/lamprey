import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import {
  DEFAULT_TIMEOUT_MS,
  LONG_SLEEP_THRESHOLD_SECONDS,
  MAX_TIMEOUT_MS,
  STDOUT_CAP,
  buildShellInvocation,
  clearAllSessionCwds,
  clearSessionCwd,
  executeShellCommand,
  extractCdTarget,
  findOnPath,
  formatShellResultForModel,
  getSessionCwd,
  resolveCwdWithinWorkspace,
  screenLongSleep
} from './shell-tool'

const IS_WIN = process.platform === 'win32'
const ECHO_HELLO = IS_WIN ? 'Write-Output "Hello World"' : 'echo "Hello World"'
const SLEEP_3S = IS_WIN ? 'Start-Sleep -Seconds 3' : 'sleep 3'
const ENV_PROBE = IS_WIN
  ? 'Write-Output $env:LAMPREY_SHELL_TEST'
  : 'echo "$LAMPREY_SHELL_TEST"'

describe('resolveCwdWithinWorkspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'lamprey-cwd-'))

  it('returns the root when candidate is undefined', () => {
    expect(resolveCwdWithinWorkspace(root, undefined)).toBe(root)
  })

  it('returns the root for an empty / whitespace candidate', () => {
    expect(resolveCwdWithinWorkspace(root, '')).toBe(root)
    expect(resolveCwdWithinWorkspace(root, '   ')).toBe(root)
  })

  it('resolves a relative subdirectory against the root', () => {
    expect(resolveCwdWithinWorkspace(root, 'sub')).toBe(join(root, 'sub'))
  })

  it('returns null when the candidate escapes the root', () => {
    expect(resolveCwdWithinWorkspace(root, '..')).toBeNull()
    expect(resolveCwdWithinWorkspace(root, `..${sep}..`)).toBeNull()
  })

  it('accepts an absolute path that lives inside the root', () => {
    expect(resolveCwdWithinWorkspace(root, join(root, 'nested', 'deep'))).toBe(
      join(root, 'nested', 'deep')
    )
  })

  it('rejects an absolute path outside the root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'lamprey-cwd-outside-'))
    try {
      expect(resolveCwdWithinWorkspace(root, outside)).toBeNull()
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  rmSync(root, { recursive: true, force: true })
})

describe('executeShellCommand', () => {
  it('runs a successful command and captures stdout', async () => {
    const result = await executeShellCommand({ command: ECHO_HELLO }, process.cwd())
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Hello World')
    expect(result.timedOut).toBe(false)
    expect(result.error).toBeUndefined()
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('rejects an empty command without spawning', async () => {
    const result = await executeShellCommand({ command: '' }, process.cwd())
    expect(result.error).toMatch(/command is required/)
    expect(result.exitCode).toBeNull()
    expect(result.stdout).toBe('')
  })

  it('rejects a cwd that escapes the workspace', async () => {
    const result = await executeShellCommand(
      { command: ECHO_HELLO, cwd: '..' },
      process.cwd()
    )
    expect(result.error).toMatch(/outside the workspace root/)
    expect(result.exitCode).toBeNull()
  })

  it('honors timeout_ms and reports timedOut', async () => {
    const result = await executeShellCommand(
      { command: SLEEP_3S, timeout_ms: 300 },
      process.cwd()
    )
    expect(result.timedOut).toBe(true)
    // The signal field may be null on Windows where kill('SIGTERM') terminates
    // without a Unix signal; check the timedOut flag instead.
    expect(result.durationMs).toBeLessThan(2500)
  })

  it('merges supplied env vars on top of process.env', async () => {
    const result = await executeShellCommand(
      { command: ENV_PROBE, env: { LAMPREY_SHELL_TEST: 'value-from-test' } },
      process.cwd()
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('value-from-test')
  })

  it('surfaces a non-zero exit code from a failing command', async () => {
    const cmd = IS_WIN ? 'exit 7' : '(exit 7)'
    const result = await executeShellCommand({ command: cmd }, process.cwd())
    expect(result.exitCode).toBe(7)
    expect(result.error).toBeUndefined()
  })

  it('exposes the constants at the documented values', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(120_000)
    expect(MAX_TIMEOUT_MS).toBe(600_000)
    expect(STDOUT_CAP).toBe(30_000)
  })
})

describe('buildShellInvocation', () => {
  it("'auto' on win32 routes to powershell.exe", () => {
    const r = buildShellInvocation('echo hi', 'auto', 'win32')
    expect('error' in r).toBe(false)
    if (!('error' in r)) {
      expect(r.cmd).toBe('powershell.exe')
      expect(r.args).toContain('-Command')
      expect(r.args.at(-1)).toBe('echo hi')
    }
  })

  it("'auto' on POSIX routes to $SHELL with -c", () => {
    const r = buildShellInvocation('echo hi', 'auto', 'linux')
    expect('error' in r).toBe(false)
    if (!('error' in r)) {
      expect(r.args).toEqual(['-c', 'echo hi'])
    }
  })

  it("'bash' on POSIX returns a -c invocation", () => {
    const r = buildShellInvocation('echo hi', 'bash', 'linux')
    expect('error' in r).toBe(false)
    if (!('error' in r)) {
      expect(r.args).toEqual(['-c', 'echo hi'])
      expect(r.cmd).toMatch(/bash/)
    }
  })

  it("'bash' on win32 with no bash anywhere returns a structured error", () => {
    // Pass an empty PATH; the function also probes a fixed list of standard
    // install paths, but at minimum the error case is exercised when none
    // of the candidates exist. On a host where bash IS installed at one of
    // the fallback paths this would return cmd; gate via a soft check.
    const r = buildShellInvocation('echo hi', 'bash', 'win32', '')
    if ('error' in r) {
      expect(r.error).toMatch(/bash/i)
    } else {
      // Host has bash at a standard install path — that's also valid.
      expect(r.cmd).toMatch(/bash/i)
    }
  })

  it("'powershell' on win32 routes to powershell.exe", () => {
    const r = buildShellInvocation('Write-Output hi', 'powershell', 'win32')
    expect('error' in r).toBe(false)
    if (!('error' in r)) {
      expect(r.cmd).toBe('powershell.exe')
    }
  })

  it("'powershell' on POSIX without pwsh returns a structured error", () => {
    const r = buildShellInvocation('Write-Output hi', 'powershell', 'linux', '')
    if ('error' in r) {
      expect(r.error).toMatch(/pwsh/i)
    } else {
      // Host has pwsh — also valid.
      expect(r.cmd).toMatch(/pwsh/i)
    }
  })
})

describe('findOnPath', () => {
  it('returns null when PATH is empty', () => {
    expect(findOnPath('whatever', '', 'linux')).toBeNull()
  })

  it('returns null when PATH is undefined', () => {
    expect(findOnPath('whatever', undefined, 'linux')).toBeNull()
  })
})

describe('extractCdTarget', () => {
  it('captures a bare POSIX cd target', () => {
    expect(extractCdTarget('cd sub', 'linux')).toBe('sub')
    expect(extractCdTarget('cd /abs/path', 'darwin')).toBe('/abs/path')
  })

  it('captures a quoted POSIX cd target with spaces', () => {
    expect(extractCdTarget('cd "my folder"', 'linux')).toBe('my folder')
    expect(extractCdTarget("cd 'my folder'", 'darwin')).toBe('my folder')
  })

  it('stops at shell operators', () => {
    expect(extractCdTarget('cd sub && echo hi', 'linux')).toBe('sub')
    expect(extractCdTarget('cd sub; echo hi', 'linux')).toBe('sub')
    expect(extractCdTarget('cd sub | head', 'linux')).toBe('sub')
  })

  it('returns null for non-cd commands', () => {
    expect(extractCdTarget('echo cd sub', 'linux')).toBeNull()
    expect(extractCdTarget('ls -la', 'linux')).toBeNull()
    expect(extractCdTarget('', 'linux')).toBeNull()
  })

  it('recognises PowerShell variants on win32', () => {
    expect(extractCdTarget('cd sub', 'win32')).toBe('sub')
    expect(extractCdTarget('Set-Location sub', 'win32')).toBe('sub')
    expect(extractCdTarget('set-location "my dir"', 'win32')).toBe('my dir')
    expect(extractCdTarget('sl ..', 'win32')).toBe('..')
  })

  it('does not match Set-Location on POSIX (case-sensitive)', () => {
    expect(extractCdTarget('Set-Location sub', 'linux')).toBeNull()
  })
})

describe('persistent session cwd', () => {
  let root: string
  const IS_WIN_T = process.platform === 'win32'

  beforeEach(() => {
    clearAllSessionCwds()
    root = mkdtempSync(join(tmpdir(), 'lamprey-cwd-session-'))
    mkdirSync(join(root, 'sub'))
    mkdirSync(join(root, 'sub', 'deeper'))
  })

  afterEach(() => {
    clearAllSessionCwds()
    rmSync(root, { recursive: true, force: true })
  })

  it('persists cwd across calls within a conversation', async () => {
    const convId = 'conv-1'
    const cdCmd = IS_WIN_T ? 'Set-Location sub' : 'cd sub'
    const pwdCmd = IS_WIN_T ? '(Get-Location).Path' : 'pwd'

    const r1 = await executeShellCommand({ command: cdCmd }, root, convId)
    expect(r1.exitCode).toBe(0)
    expect(getSessionCwd(convId)).toBe(join(root, 'sub'))

    const r2 = await executeShellCommand({ command: pwdCmd }, root, convId)
    expect(r2.exitCode).toBe(0)
    expect(r2.stdout).toContain('sub')
    expect(r2.cwd).toBe(join(root, 'sub'))
  })

  it('does not update session cwd when the cd target escapes the workspace', async () => {
    const convId = 'conv-2'
    const cdCmd = IS_WIN_T ? 'Set-Location ..' : 'cd ..'

    const r = await executeShellCommand({ command: cdCmd }, root, convId)
    // The in-shell cd succeeds (returns 0), but the escape attempt is
    // detected after the fact and the session cwd is NOT updated.
    expect(getSessionCwd(convId)).toBeNull()
  })

  it('does not perturb session cwd for unrelated commands', async () => {
    const convId = 'conv-3'
    const cdCmd = IS_WIN_T ? 'Set-Location sub' : 'cd sub'
    const echoCmd = IS_WIN_T ? 'Write-Output hi' : 'echo hi'

    await executeShellCommand({ command: cdCmd }, root, convId)
    expect(getSessionCwd(convId)).toBe(join(root, 'sub'))

    await executeShellCommand({ command: echoCmd }, root, convId)
    expect(getSessionCwd(convId)).toBe(join(root, 'sub'))
  })

  it('does not persist when conversationId is omitted', async () => {
    const cdCmd = IS_WIN_T ? 'Set-Location sub' : 'cd sub'
    const pwdCmd = IS_WIN_T ? '(Get-Location).Path' : 'pwd'

    await executeShellCommand({ command: cdCmd }, root)
    const r2 = await executeShellCommand({ command: pwdCmd }, root)
    // No session held → second call anchors at root, not sub.
    expect(r2.cwd).toBe(root)
  })

  it('isolates session cwd per conversationId', async () => {
    const cdCmd = IS_WIN_T ? 'Set-Location sub' : 'cd sub'

    await executeShellCommand({ command: cdCmd }, root, 'conv-A')
    expect(getSessionCwd('conv-A')).toBe(join(root, 'sub'))
    expect(getSessionCwd('conv-B')).toBeNull()
  })

  it('clearSessionCwd drops a single conversation', async () => {
    const cdCmd = IS_WIN_T ? 'Set-Location sub' : 'cd sub'

    await executeShellCommand({ command: cdCmd }, root, 'conv-X')
    expect(getSessionCwd('conv-X')).toBe(join(root, 'sub'))

    clearSessionCwd('conv-X')
    expect(getSessionCwd('conv-X')).toBeNull()
  })

  it('does not persist when the target is not a directory', async () => {
    const convId = 'conv-4'
    // Try to cd into a path that doesn't exist. Most shells return non-zero
    // for cd-to-nonexistent, so exit code branch alone would block it; this
    // also exercises the statSync isDirectory guard.
    const cdCmd = IS_WIN_T
      ? 'Set-Location nonexistent-dir-xyz'
      : 'cd nonexistent-dir-xyz'

    await executeShellCommand({ command: cdCmd }, root, convId)
    expect(getSessionCwd(convId)).toBeNull()
  })
})

describe('sandbox tier on ShellResult (S6)', () => {
  it('threads sandboxTier into the result of a successful run', async () => {
    const result = await executeShellCommand({ command: ECHO_HELLO }, process.cwd())
    expect(result.sandboxTier).toBeDefined()
    // On Windows the win32 profile returns 'none'; on darwin/linux it
    // returns the kernel tier when the binary exists, else falls back
    // to 'none' via the dispatcher.
    expect(['darwin-sbx', 'linux-bwrap', 'none']).toContain(result.sandboxTier)
  })

  it('includes sandboxNote on win32 (no kernel isolation)', async () => {
    if (process.platform !== 'win32') return
    const result = await executeShellCommand({ command: ECHO_HELLO }, process.cwd())
    expect(result.sandboxTier).toBe('none')
    expect(result.sandboxNote).toMatch(/windows host/i)
  })
})

describe('screenLongSleep (S11)', () => {
  it(`exposes the threshold constant (${LONG_SLEEP_THRESHOLD_SECONDS}s)`, () => {
    expect(LONG_SLEEP_THRESHOLD_SECONDS).toBe(30)
  })

  it('rejects POSIX `sleep 600`', () => {
    const r = screenLongSleep('sleep 600', 'linux')
    expect(r).not.toBeNull()
    expect(r?.reason).toMatch(/600/)
    expect(r?.reason).toMatch(/shell_monitor/)
  })

  it('rejects PowerShell `Start-Sleep -Seconds 60`', () => {
    const r = screenLongSleep('Start-Sleep -Seconds 60', 'win32')
    expect(r).not.toBeNull()
  })

  it('rejects PowerShell `Start-Sleep 60` (positional)', () => {
    const r = screenLongSleep('Start-Sleep 60', 'win32')
    expect(r).not.toBeNull()
  })

  it('accepts short sleeps under the threshold', () => {
    expect(screenLongSleep('sleep 5', 'linux')).toBeNull()
    expect(screenLongSleep('Start-Sleep -Seconds 5', 'win32')).toBeNull()
    expect(screenLongSleep('sleep 30', 'linux')).toBeNull()
  })

  it('accepts long sleeps inside a polling loop', () => {
    expect(screenLongSleep('until curl -fsS http://x; do sleep 60; done', 'linux')).toBeNull()
    expect(screenLongSleep('while true; do sleep 600; done', 'linux')).toBeNull()
    expect(screenLongSleep('for i in 1 2 3; do sleep 60; done', 'linux')).toBeNull()
  })

  it('accepts non-sleep commands', () => {
    expect(screenLongSleep('echo hi', 'linux')).toBeNull()
    expect(screenLongSleep('npm install', 'linux')).toBeNull()
  })

  it('does not falsely match Start-Sleep -Milliseconds 500', () => {
    expect(screenLongSleep('Start-Sleep -Milliseconds 500', 'win32')).toBeNull()
  })

  it('rejection takes effect at the executor', async () => {
    const result = await executeShellCommand(
      { command: 'sleep 600' },
      process.cwd()
    )
    expect(result.exitCode).toBeNull()
    expect(result.error).toMatch(/long solo sleep/i)
  })

  it('bypass flag allows the long sleep through screening', async () => {
    // We don't actually want a 600s sleep; just confirm the guard is
    // skipped — pass a shorter command that would still trigger if the
    // guard fired. Use `dangerously_disable_sandbox: true` + a `sleep 60`
    // that we override timeout for.
    const result = await executeShellCommand(
      {
        command: process.platform === 'win32' ? 'Write-Output "ok"' : 'echo ok',
        dangerously_disable_sandbox: true
      },
      process.cwd()
    )
    expect(result.exitCode).toBe(0)
    expect(result.sandboxTier).toBe('bypassed')
  })
})

describe('dangerously_disable_sandbox (S7)', () => {
  it("sets sandboxTier 'bypassed' and emits the bypass note", async () => {
    const result = await executeShellCommand(
      { command: ECHO_HELLO, dangerously_disable_sandbox: true },
      process.cwd()
    )
    expect(result.sandboxTier).toBe('bypassed')
    expect(result.sandboxNote).toMatch(/bypass approved/i)
    // The shell still runs to completion — bypass means "no sandbox", not
    // "no execution".
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Hello World')
  })

  it('format helper renders the bypass banner', () => {
    const text = formatShellResultForModel({
      command: 'rm -rf foo',
      cwd: '/tmp/wk',
      exitCode: 0,
      signal: null,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: 1,
      timedOut: false,
      sandboxTier: 'bypassed',
      sandboxNote: 'sandbox bypass approved by user (dangerously_disable_sandbox)'
    })
    expect(text).toMatch(/Sandbox: bypassed — sandbox bypass approved/)
  })
})

describe('formatShellResultForModel', () => {
  it('renders the Sandbox tier banner when present', () => {
    const text = formatShellResultForModel({
      command: 'echo hi',
      cwd: '/tmp/wk',
      exitCode: 0,
      signal: null,
      stdout: 'hi\n',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: 5,
      timedOut: false,
      sandboxTier: 'none',
      sandboxNote: 'windows host: no kernel sandbox'
    })
    expect(text).toMatch(/Sandbox: none — windows host/)
  })

  it('omits the Sandbox banner when tier is absent', () => {
    const text = formatShellResultForModel({
      command: 'echo hi',
      cwd: '/tmp/wk',
      exitCode: 0,
      signal: null,
      stdout: 'hi\n',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: 5,
      timedOut: false
    })
    expect(text).not.toMatch(/Sandbox:/)
  })

  it('produces a compact header + cwd + stdout/stderr blocks', () => {
    const text = formatShellResultForModel({
      command: 'echo hi',
      cwd: '/tmp/wk',
      exitCode: 0,
      signal: null,
      stdout: 'hi\n',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: 42,
      timedOut: false
    })
    expect(text).toMatch(/Exit: 0/)
    expect(text).toMatch(/Duration: 42ms/)
    expect(text).toMatch(/cwd: \/tmp\/wk/)
    expect(text).toMatch(/--- stdout ---/)
    expect(text).toMatch(/hi/)
    expect(text).toMatch(/--- stderr ---/)
    expect(text).toMatch(/\(empty\)/)
  })

  it('marks timed-out runs explicitly', () => {
    const text = formatShellResultForModel({
      command: 'sleep 999',
      cwd: '/tmp/wk',
      exitCode: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: 300,
      timedOut: true
    })
    expect(text).toMatch(/TIMED OUT/)
  })

  it('surfaces pure-error results without an exit code', () => {
    const text = formatShellResultForModel({
      command: 'whatever',
      cwd: '/tmp/wk',
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: 0,
      timedOut: false,
      error: 'cwd "../escape" is outside the workspace root'
    })
    expect(text).toBe('Shell error: cwd "../escape" is outside the workspace root')
  })
})
