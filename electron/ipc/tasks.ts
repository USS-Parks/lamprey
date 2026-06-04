import { ipcMain, BrowserWindow } from 'electron'
import * as store from '../services/agent-run-store'
import {
  getLiveHandle,
  type AgentRunNotifyEvent
} from '../services/subagent-runner'

// Track 1 / A2: tasks:* IPC + agent:run:notify broadcast wiring.
//
// `tasks:list/get/output/stop/update` read or mutate the agent_runs table.
// The notify broadcaster forwards every run start/finish from
// subagent-runner.notify into the renderer via webContents.send so the
// renderer can build a live tree without polling.
//
// Production callers of forkAgent should pass `agentRunStore: realAgentRunStore`
// and `notify: broadcastAgentRunEvent` in their deps so that runs land in the
// DB and surface in the UI. The chat dispatcher (Track 2 wires this) is the
// canonical caller.

export function broadcastAgentRunEvent(event: AgentRunNotifyEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('agent:run:notify', event)
  }
}

export function registerTasksHandlers(): void {
  ipcMain.handle('tasks:list', async (_e, filter?: store.AgentRunListFilter) => {
    try {
      return { success: true, data: store.listRuns(filter ?? {}) }
    } catch (err: unknown) {
      return { success: false, error: messageFor(err, 'list failed') }
    }
  })

  ipcMain.handle('tasks:get', async (_e, id: string) => {
    try {
      if (typeof id !== 'string' || !id) return { success: false, error: 'id required' }
      const row = store.getRun(id)
      if (!row) return { success: false, error: 'not found' }
      return { success: true, data: row }
    } catch (err: unknown) {
      return { success: false, error: messageFor(err, 'get failed') }
    }
  })

  ipcMain.handle('tasks:output', async (_e, id: string) => {
    try {
      if (typeof id !== 'string' || !id) return { success: false, error: 'id required' }
      const data = store.getRunOutput(id)
      if (!data) return { success: false, error: 'not found' }
      return { success: true, data }
    } catch (err: unknown) {
      return { success: false, error: messageFor(err, 'output failed') }
    }
  })

  ipcMain.handle('tasks:stop', async (_e, id: string) => {
    try {
      if (typeof id !== 'string' || !id) return { success: false, error: 'id required' }
      const handle = getLiveHandle(id)
      if (handle) {
        handle.abort('user-stop')
        // The forkAgent catch path will write 'aborted' to the DB + fire the
        // notify event; we return success to the caller now.
        return { success: true, data: { stopped: true, wasLive: true } }
      }
      // Not live — maybe finished, or never tracked. If the row exists and
      // is still marked running (which would be a stale row), correct it.
      const row = store.getRun(id)
      if (!row) return { success: false, error: 'not found' }
      if (row.status === 'running') {
        store.finishRun({
          id,
          status: 'aborted',
          finishedAt: Date.now(),
          error: 'aborted by user (handle was not live)'
        })
        broadcastAgentRunEvent({
          runId: row.id,
          agentType: row.agentType,
          label: row.label,
          parentConvId: row.parentConvId,
          parentRunId: row.parentRunId,
          status: 'aborted',
          startedAt: row.startedAt,
          finishedAt: Date.now(),
          error: 'aborted by user (handle was not live)',
          background: row.background
        })
        return { success: true, data: { stopped: true, wasLive: false } }
      }
      return { success: true, data: { stopped: false, wasLive: false, status: row.status } }
    } catch (err: unknown) {
      return { success: false, error: messageFor(err, 'stop failed') }
    }
  })

  ipcMain.handle('tasks:update', async (_e, id: string, patch: store.AgentRunUpdate) => {
    try {
      if (typeof id !== 'string' || !id) return { success: false, error: 'id required' }
      if (!patch || typeof patch !== 'object') {
        return { success: false, error: 'patch must be an object' }
      }
      store.updateRun(id, patch)
      const updated = store.getRun(id)
      if (!updated) return { success: false, error: 'not found' }
      return { success: true, data: updated }
    } catch (err: unknown) {
      return { success: false, error: messageFor(err, 'update failed') }
    }
  })
}

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback
  if (typeof err === 'string') return err || fallback
  return fallback
}
