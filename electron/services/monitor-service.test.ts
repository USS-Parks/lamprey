import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { platform } from 'os'
import {
  destroyAllBackgroundShells,
  executeShellCommandInBackground,
  getBackgroundShell,
  shellBackgroundBus
} from './shell-tool'
import {
  __monitorServiceTest,
  destroyAllMonitors,
  destroyMonitor,
  listMonitors,
  monitorBus,
  readMonitor,
  startMonitor,
  stopMonitor
} from './monitor-service'

const WORKSPACE = process.cwd()

function isWindows(): boolean {
  return platform() === 'win32'
}

beforeEach(() => {
  __monitorServiceTest.reset()
})

afterEach(() => {
  destroyAllMonitors()
  destroyAllBackgroundShells()
})

describe('F4 — background shell', () => {
  it('returns a handle synchronously with running status', () => {
    const handle = executeShellCommandInBackground(
      { command: 'node -e "setTimeout(()=>{}, 200)"' },
      WORKSPACE
    )
    expect(handle.id).toBeTruthy()
    expect(handle.status).toBe('running')
    expect(handle.pid).not.toBeNull()
  })

  it('emits bg-line for each line of stdout', async () => {
    const received: string[] = []
    const onLine = (evt: any) => {
      if (typeof evt?.line === 'string') received.push(evt.line)
    }
    shellBackgroundBus.on('bg-line', onLine)

    const handle = executeShellCommandInBackground(
      { command: 'node -e "console.log(\'one\'); console.log(\'two\'); console.log(\'three\')"' },
      WORKSPACE
    )

    // Wait deterministically for the bg-exit event for this process so
    // the assertions don't depend on a fixed timeout.
    await new Promise<void>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => rejectExit(new Error('bg-exit timeout')), 5000)
      const onExit = (evt: any) => {
        if (evt?.processId === handle.id) {
          clearTimeout(timer)
          shellBackgroundBus.off('bg-exit', onExit)
          resolveExit()
        }
      }
      shellBackgroundBus.on('bg-exit', onExit)
    })

    shellBackgroundBus.off('bg-line', onLine)
    expect(received).toContain('one')
    expect(received).toContain('two')
    expect(received).toContain('three')
  })

  it.skipIf(isWindows())('fires bg-exit with the exit code', async () => {
    const handle = executeShellCommandInBackground(
      { command: 'node -e "process.exit(0)"' },
      WORKSPACE
    )
    const exit = await new Promise<any>((resolveOk, rejectOk) => {
      const timer = setTimeout(() => rejectOk(new Error('bg-exit timeout')), 5000)
      const onExit = (e: any) => {
        if (e?.processId === handle.id) {
          clearTimeout(timer)
          shellBackgroundBus.off('bg-exit', onExit)
          resolveOk(e)
        }
      }
      shellBackgroundBus.on('bg-exit', onExit)
    })
    expect(exit.exitCode).toBe(0)
    const refreshed = getBackgroundShell(handle.id)
    expect(refreshed?.status).toBe('exited')
  })

  it('rejects empty commands as failed', () => {
    const handle = executeShellCommandInBackground({ command: '' }, WORKSPACE)
    expect(handle.status).toBe('failed')
    expect(handle.stderr).toMatch(/command is required/i)
  })
})

describe('F4 — monitor service', () => {
  it('buffers lines from the background bus and drains by cursor', () => {
    const stream = startMonitor({ processId: 'fake-1' })
    const internal = __monitorServiceTest.getInternalMonitor(stream.id) as any
    __monitorServiceTest.ingestLine(internal, {
      processId: 'fake-1',
      stream: 'stdout',
      line: 'first',
      at: Date.now()
    })
    __monitorServiceTest.ingestLine(internal, {
      processId: 'fake-1',
      stream: 'stdout',
      line: 'second',
      at: Date.now()
    })
    const first = readMonitor(stream.id)
    expect(first.lines.map((l) => l.line)).toEqual(['first', 'second'])
    expect(first.cursor).toBe(2)

    __monitorServiceTest.ingestLine(internal, {
      processId: 'fake-1',
      stream: 'stdout',
      line: 'third',
      at: Date.now()
    })
    const next = readMonitor(stream.id, first.cursor)
    expect(next.lines.map((l) => l.line)).toEqual(['third'])
    expect(next.cursor).toBe(3)

    // Reading again with the new cursor returns nothing new.
    const empty = readMonitor(stream.id, next.cursor)
    expect(empty.lines).toEqual([])
  })

  it('auto-stops + fires monitor:matched when untilPattern matches', () => {
    const stream = startMonitor({ processId: 'fake-2', untilPattern: 'Local:.*localhost' })
    const events: any[] = []
    monitorBus.on('monitor:matched', (e) => events.push(e))

    const monitor = __monitorServiceTest.getInternalMonitor(stream.id) as any
    __monitorServiceTest.ingestLine(monitor, {
      processId: 'fake-2',
      stream: 'stdout',
      line: 'starting up...',
      at: Date.now()
    })
    __monitorServiceTest.ingestLine(monitor, {
      processId: 'fake-2',
      stream: 'stdout',
      line: '➜  Local: http://localhost:5173/',
      at: Date.now()
    })

    expect(events.length).toBe(1)
    expect(events[0].streamId).toBe(stream.id)
    expect(events[0].matchedLine).toContain('http://localhost:5173')

    // After matching, status is 'matched' and further lines are ignored.
    __monitorServiceTest.ingestLine(monitor, {
      processId: 'fake-2',
      stream: 'stdout',
      line: 'should not buffer',
      at: Date.now()
    })
    const after = readMonitor(stream.id)
    expect(after.lines.map((l) => l.line)).not.toContain('should not buffer')
    expect(after.handle.status).toBe('matched')
  })

  it('stopMonitor sets status to stopped and bus emits monitor:stopped', () => {
    const stream = startMonitor({ processId: 'fake-3' })
    const events: any[] = []
    monitorBus.on('monitor:stopped', (e) => events.push(e))
    expect(stopMonitor(stream.id)).toBe(true)
    expect(events[0].streamId).toBe(stream.id)
    const after = readMonitor(stream.id)
    expect(after.handle.status).toBe('stopped')
  })

  it('startMonitor throws on an invalid regex', () => {
    expect(() => startMonitor({ processId: 'fake-4', untilPattern: '(' })).toThrow(
      /invalid untilPattern/i
    )
  })

  it('listMonitors + destroyMonitor manage the registry', () => {
    const a = startMonitor({ processId: 'fake-a' })
    const b = startMonitor({ processId: 'fake-b' })
    expect(listMonitors().map((m) => m.id).sort()).toEqual([a.id, b.id].sort())
    destroyMonitor(a.id)
    expect(listMonitors().map((m) => m.id)).toEqual([b.id])
  })
})

