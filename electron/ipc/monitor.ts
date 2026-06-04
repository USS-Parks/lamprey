import { BrowserWindow, ipcMain } from 'electron'
import {
  destroyMonitor,
  listMonitors,
  monitorBus,
  readMonitor,
  startMonitor,
  stopMonitor
} from '../services/monitor-service'
import {
  destroyBackgroundShell,
  executeShellCommandInBackground,
  getBackgroundShell,
  killBackgroundShell,
  listBackgroundShells,
  shellBackgroundBus,
  type ShellBackgroundExitEvent,
  type ShellBackgroundLineEvent
} from '../services/shell-tool'
import { getActiveWorkspace } from '../services/workspace-state'

// F4 — IPC bindings for the monitor + background-shell primitives.
//
// The renderer receives a per-monitor stream of `monitor:line` events
// (one per buffered line) plus `monitor:matched` / `monitor:exit`
// terminal events. The background-shell bus surfaces `shell:bg:line`
// and `shell:bg:exit` so the activity dashboard (Integration H1) can
// show live process state without polling.

let busesWired = false
function ensureBusesWired(): void {
  if (busesWired) return
  busesWired = true

  const broadcast = (channel: string, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed()) win.webContents.send(channel, payload)
      } catch {
        // window closing
      }
    }
  }

  shellBackgroundBus.on('bg-line', (evt: ShellBackgroundLineEvent) => {
    broadcast('shell:bg:line', evt)
  })
  shellBackgroundBus.on('bg-exit', (evt: ShellBackgroundExitEvent) => {
    broadcast('shell:bg:exit', evt)
  })
  monitorBus.on('monitor:line', (evt) => broadcast('monitor:line', evt))
  monitorBus.on('monitor:matched', (evt) => broadcast('monitor:matched', evt))
  monitorBus.on('monitor:exit', (evt) => broadcast('monitor:exit', evt))
  monitorBus.on('monitor:stopped', (evt) => broadcast('monitor:stopped', evt))
}

export function registerMonitorHandlers(): void {
  ensureBusesWired()

  ipcMain.handle(
    'shell:bg:spawn',
    async (
      _e,
      args: { command: string; cwd?: string; env?: Record<string, string>; emitLines?: boolean }
    ) => {
      try {
        const workspace = getActiveWorkspace()
        return { success: true, data: executeShellCommandInBackground(args, workspace) }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'spawn failed' }
      }
    }
  )

  ipcMain.handle('shell:bg:list', async () => {
    try {
      return { success: true, data: listBackgroundShells() }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'list failed' }
    }
  })

  ipcMain.handle('shell:bg:get', async (_e, processId: string) => {
    try {
      const handle = getBackgroundShell(processId)
      if (!handle) return { success: false, error: 'unknown processId' }
      return { success: true, data: handle }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'get failed' }
    }
  })

  ipcMain.handle('shell:bg:kill', async (_e, processId: string) => {
    try {
      const ok = killBackgroundShell(processId)
      return { success: true, data: { killed: ok } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'kill failed' }
    }
  })

  ipcMain.handle('shell:bg:destroy', async (_e, processId: string) => {
    try {
      destroyBackgroundShell(processId)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'destroy failed' }
    }
  })

  ipcMain.handle('monitor:start', async (_e, opts: { processId: string; untilPattern?: string }) => {
    try {
      return { success: true, data: startMonitor(opts) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'monitor:start failed' }
    }
  })

  ipcMain.handle('monitor:read', async (_e, streamId: string, since?: number) => {
    try {
      return { success: true, data: readMonitor(streamId, since) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'monitor:read failed' }
    }
  })

  ipcMain.handle('monitor:stop', async (_e, streamId: string) => {
    try {
      stopMonitor(streamId)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'monitor:stop failed' }
    }
  })

  ipcMain.handle('monitor:destroy', async (_e, streamId: string) => {
    try {
      destroyMonitor(streamId)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'monitor:destroy failed' }
    }
  })

  ipcMain.handle('monitor:list', async () => {
    try {
      return { success: true, data: listMonitors() }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'monitor:list failed' }
    }
  })
}
