import { ipcMain } from 'electron'

export function registerMemoryHandlers(): void {
  ipcMain.handle('memory:list', async () => {
    return { success: true, data: null }
  })

  ipcMain.handle('memory:add', async (_event, _content) => {
    return { success: true, data: null }
  })

  ipcMain.handle('memory:update', async (_event, _id, _content) => {
    return { success: true, data: null }
  })

  ipcMain.handle('memory:delete', async (_event, _id) => {
    return { success: true, data: null }
  })

  ipcMain.handle('memory:clear', async () => {
    return { success: true, data: null }
  })

  ipcMain.handle('memory:export', async () => {
    return { success: true, data: null }
  })

  ipcMain.handle('memory:import', async (_event, _entries) => {
    return { success: true, data: null }
  })
}
