import { describe, it, expect, afterEach } from 'vitest'
import { platform } from 'os'
import {
  destroyAllDevServers,
  destroyDevServer,
  getDevServer,
  listDevServers,
  spawnDevServer,
  URL_PATTERNS,
  waitForOutput
} from './dev-server-manager'

// Pure-Node tests for the dev-server lifecycle helper. No Electron
// imports — this module is intentionally self-contained so its tests
// can run regardless of the better-sqlite3 binding state.
//
// Each test cleans up its spawned process so a flaky run doesn't leak
// node subprocesses across the suite.

const NODE_PRINT = `node -e "console.log('Local: http://localhost:54321/'); setTimeout(()=>{}, 5000)"`
const NODE_FAIL = `node -e "process.exit(2)"`
const NODE_QUICK_EXIT = `node -e "console.log('hi'); process.exit(0)"`

function isWindows(): boolean {
  return platform() === 'win32'
}

afterEach(() => {
  destroyAllDevServers()
})

describe('dev-server-manager', () => {
  it('spawnDevServer returns a handle with running status', () => {
    const handle = spawnDevServer({ command: NODE_PRINT, shell: true })
    expect(handle.id).toBeTruthy()
    expect(handle.status).toBe('running')
    expect(handle.command).toBe(NODE_PRINT)
  })

  it('waitForOutput resolves with the matched URL once the dev server prints it', async () => {
    const handle = spawnDevServer({ command: NODE_PRINT, shell: true })
    const matched = await waitForOutput(handle.id, URL_PATTERNS.vite, 5_000)
    expect(matched).toMatch(/http:\/\/localhost:54321/)
  })

  it('waitForOutput times out when the pattern never matches', async () => {
    const handle = spawnDevServer({ command: NODE_PRINT, shell: true })
    await expect(
      waitForOutput(handle.id, /pattern-that-never-shows-up/, 250)
    ).rejects.toThrow(/timeout/)
  })

  it.skipIf(isWindows())('reflects a quick-exit child as exited', async () => {
    // Windows process exit timing is flakier through `shell: true`;
    // POSIX is fine. The non-Windows path catches the regression.
    const handle = spawnDevServer({ command: NODE_QUICK_EXIT, shell: true })
    // give exit a moment to propagate
    await new Promise((r) => setTimeout(r, 400))
    const after = getDevServer(handle.id)
    expect(after?.status).toBe('exited')
    expect(after?.exitCode).toBe(0)
    expect(after?.output).toContain('hi')
  })

  it.skipIf(isWindows())('marks a failed child as failed with the exit code', async () => {
    const handle = spawnDevServer({ command: NODE_FAIL, shell: true })
    await new Promise((r) => setTimeout(r, 400))
    const after = getDevServer(handle.id)
    expect(after?.status).toBe('failed')
    expect(after?.exitCode).toBe(2)
  })

  it('listDevServers reflects spawned + destroyed sessions', () => {
    const a = spawnDevServer({ command: NODE_PRINT, shell: true })
    const b = spawnDevServer({ command: NODE_PRINT, shell: true })
    const initial = listDevServers().map((h) => h.id)
    expect(initial).toContain(a.id)
    expect(initial).toContain(b.id)
    destroyDevServer(a.id)
    const after = listDevServers().map((h) => h.id)
    expect(after).not.toContain(a.id)
    expect(after).toContain(b.id)
  })

  it('destroyAllDevServers wipes every session', () => {
    spawnDevServer({ command: NODE_PRINT, shell: true })
    spawnDevServer({ command: NODE_PRINT, shell: true })
    expect(listDevServers().length).toBeGreaterThan(0)
    destroyAllDevServers()
    expect(listDevServers()).toEqual([])
  })

  it('URL_PATTERNS.vite captures Local: http://localhost:5173/', () => {
    const out = 'VITE v5.0.0  ready in 230 ms\n  ➜  Local:   http://localhost:5173/\n'
    const m = URL_PATTERNS.vite.exec(out)
    expect(m?.[0]).toMatch(/localhost:5173/)
  })
})
