import { ipcMain, BrowserWindow } from 'electron'
import {
  AskUserRuntime,
  setAskUserRuntime,
  getAskUserRuntime,
  type AskUserAnswer,
  type AskUserAwaitingEvent,
  type AskUserQuestion
} from '../services/ask-user-runtime'

// H6 — IPC bridge for the ask-user runtime.
//
//   IPC layout
//     'ask-user:awaiting'   (main → renderer)  AskUserAwaitingEvent
//     'ask-user:respond'    (renderer → main)  { requestId, answer }
//     'ask-user:list'       (renderer → main)  → in-flight questions
//     'ask-user:cancelAll'  (renderer → main)  → number cancelled
//
// The runtime is instantiated here so subagent / workflow / native-tool code
// can import it via `getAskUserRuntime()` (singleton) without taking a direct
// dependency on `electron`.

function broadcast(event: AskUserAwaitingEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('ask-user:awaiting', event)
  }
}

export function registerAskUserHandlers(): void {
  const runtime = new AskUserRuntime({ emit: broadcast })
  setAskUserRuntime(runtime)

  ipcMain.handle('ask-user:respond', async (_e, payload: { requestId: string; answer: AskUserAnswer }) => {
    try {
      if (!payload || typeof payload.requestId !== 'string') {
        return { success: false, error: 'requestId required' }
      }
      if (!payload.answer || typeof payload.answer !== 'object') {
        return { success: false, error: 'answer required' }
      }
      const matched = runtime.respond(payload.requestId, payload.answer)
      return { success: true, data: { matched } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'respond failed' }
    }
  })

  ipcMain.handle('ask-user:list', async () => {
    try {
      return { success: true, data: runtime.list() }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'list failed' }
    }
  })

  ipcMain.handle('ask-user:cancelAll', async () => {
    try {
      return { success: true, data: { cancelled: runtime.cancelAll() } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'cancelAll failed' }
    }
  })
}

/**
 * Helper for handlers / sandbox builders that already validated the input
 * shape. Throws if the runtime hasn't been initialised (forgot to call
 * `registerAskUserHandlers` at boot).
 */
export async function askUserViaRuntime(question: AskUserQuestion): Promise<AskUserAnswer> {
  const runtime = getAskUserRuntime()
  if (!runtime) {
    throw new Error('ask-user runtime not initialised (registerAskUserHandlers was not called)')
  }
  return runtime.ask(question)
}
