import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  STDOUT_CAP,
  executeShellCommand,
  formatShellResultForModel,
  resolveCwdWithinWorkspace
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
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000)
    expect(MAX_TIMEOUT_MS).toBe(600_000)
    expect(STDOUT_CAP).toBe(30_000)
  })
})

describe('formatShellResultForModel', () => {
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
