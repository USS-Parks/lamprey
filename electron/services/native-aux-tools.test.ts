import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  executeShellList,
  executeShellMonitor,
  executeShellOutput,
  executeShellStop
} from './native-aux-tools'
import {
  destroyAllBackgroundShells,
  executeShellCommandInBackground,
  shellBackgroundBus,
  type ShellBackgroundExitEvent
} from './shell-tool'
import { __monitorServiceTest } from './monitor-service'

// S8 — model-facing aux tools that drive monitor-service + the
// background-shell registry. The executors are thin formatters; tests
// drive them through a real background shell so we exercise the cross
// from shell-tool → monitor-service → native-aux-tools.

const IS_WIN = process.platform === 'win32'
// A short cross-platform command that prints two lines and exits cleanly.
const TWO_LINE_CMD = IS_WIN
  ? 'Write-Output line1; Write-Output line2'
  : 'echo line1; echo line2'
// A longer command for the shell_stop test — needs to be alive long
// enough that we can kill it before it exits.
const SLEEP_CMD = IS_WIN
  ? 'Start-Sleep -Seconds 30; Write-Output done'
  : 'sleep 30; echo done'

function waitForBgExit(processId: string, timeoutMs = 8000): Promise<ShellBackgroundExitEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      shellBackgroundBus.off('bg-exit', onExit)
      reject(new Error(`waitForBgExit: timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const onExit = (evt: ShellBackgroundExitEvent): void => {
      if (evt.processId !== processId) return
      clearTimeout(timer)
      shellBackgroundBus.off('bg-exit', onExit)
      resolve(evt)
    }
    shellBackgroundBus.on('bg-exit', onExit)
  })
}

beforeEach(() => {
  __monitorServiceTest.reset()
})

afterEach(() => {
  destroyAllBackgroundShells()
  __monitorServiceTest.reset()
})

describe('executeShellList', () => {
  it('lists at least the spawned background shell', async () => {
    const handle = executeShellCommandInBackground({ command: TWO_LINE_CMD }, process.cwd())
    expect(handle.status).toBe('running')

    const listed = executeShellList()
    expect(listed).toContain(handle.id)
    expect(listed).toContain('shells')

    await waitForBgExit(handle.id)
  })

  it('returns the empty-state message when nothing is running', () => {
    const out = executeShellList()
    expect(out).toMatch(/shell_list: no background shells or monitors active/)
  })
})

describe('executeShellMonitor', () => {
  it('returns a handle with status "active" for a running shell', async () => {
    const handle = executeShellCommandInBackground({ command: SLEEP_CMD }, process.cwd())
    expect(handle.status).toBe('running')

    const out = executeShellMonitor({ processId: handle.id })
    expect(out).toContain('Status: active')
    expect(out).toContain(`Process: ${handle.id}`)
    expect(out).toContain('Until: (none)')
  })

  it('returns a structured error for an unknown processId', () => {
    const out = executeShellMonitor({ processId: 'not-a-real-id' })
    expect(out).toMatch(/no background shell with processId "not-a-real-id"/)
  })

  it('rejects a missing processId', () => {
    const out = executeShellMonitor({})
    expect(out).toMatch(/"processId" is required/)
  })

  it('rejects a non-string untilPattern', () => {
    const handle = executeShellCommandInBackground({ command: SLEEP_CMD }, process.cwd())
    // @ts-expect-error — verifying the runtime guard
    const out = executeShellMonitor({ processId: handle.id, untilPattern: 42 })
    expect(out).toMatch(/"untilPattern" must be a string/)
  })
})

describe('executeShellOutput', () => {
  it('returns the captured stdout of a background shell after it exits', async () => {
    const handle = executeShellCommandInBackground({ command: TWO_LINE_CMD }, process.cwd())
    await waitForBgExit(handle.id)

    const out = executeShellOutput({ processId: handle.id })
    expect(out).toContain(`Process: ${handle.id}`)
    expect(out).toContain('--- stdout ---')
    expect(out).toContain('line1')
    expect(out).toContain('line2')
    expect(out).toContain('--- stderr ---')
  })

  it('returns a friendly error when the processId is unknown', () => {
    const out = executeShellOutput({ processId: 'not-a-real-id' })
    expect(out).toMatch(/no background shell with processId "not-a-real-id"/)
  })

  it('uses a monitor cursor when `since` is supplied and a monitor exists', async () => {
    const handle = executeShellCommandInBackground({ command: TWO_LINE_CMD }, process.cwd())
    // Attach monitor before waiting so the bus delivers lines to it.
    const monitorOut = executeShellMonitor({ processId: handle.id })
    expect(monitorOut).toContain('Status: active')
    await waitForBgExit(handle.id)
    // Give the bus a microtask to flush — exit ingestion is synchronous,
    // but tail-flush of line buffers happens on the exit handler.
    await new Promise((r) => setImmediate(r))

    const out = executeShellOutput({ processId: handle.id, since: 0 })
    expect(out).toContain('--- new lines (since=0) ---')
    expect(out).toMatch(/line1|line2/)
  })
})

describe('executeShellStop', () => {
  it('returns { stopped: true } when SIGTERM is delivered to a running shell', async () => {
    const handle = executeShellCommandInBackground({ command: SLEEP_CMD }, process.cwd())
    expect(handle.status).toBe('running')

    const exitPromise = waitForBgExit(handle.id)
    const out = executeShellStop({ processId: handle.id })
    const parsed = JSON.parse(out)
    expect(parsed.stopped).toBe(true)
    expect(parsed.processId).toBe(handle.id)
    expect(parsed.signal).toBe('SIGTERM')

    await exitPromise
  })

  it('returns a structured error JSON for an unknown processId', () => {
    const out = executeShellStop({ processId: 'not-a-real-id' })
    const parsed = JSON.parse(out)
    expect(parsed.stopped).toBe(false)
    expect(parsed.error).toMatch(/no background shell/)
  })

  it('honours an explicit SIGKILL signal', async () => {
    const handle = executeShellCommandInBackground({ command: SLEEP_CMD }, process.cwd())
    const exitPromise = waitForBgExit(handle.id)
    const out = executeShellStop({ processId: handle.id, signal: 'SIGKILL' })
    const parsed = JSON.parse(out)
    expect(parsed.signal).toBe('SIGKILL')
    expect(parsed.stopped).toBe(true)
    await exitPromise
  })

  it('refuses to stop a shell that already exited', async () => {
    const handle = executeShellCommandInBackground({ command: TWO_LINE_CMD }, process.cwd())
    await waitForBgExit(handle.id)
    const out = executeShellStop({ processId: handle.id })
    const parsed = JSON.parse(out)
    expect(parsed.stopped).toBe(false)
    expect(parsed.error).toMatch(/already (exited|failed)/)
  })

  it('rejects a missing processId', () => {
    const out = executeShellStop({})
    const parsed = JSON.parse(out)
    expect(parsed.stopped).toBe(false)
    expect(parsed.error).toMatch(/"processId" is required/)
  })
})
