import { ipcMain } from 'electron'

export function registerModelHandlers(): void {
  ipcMain.handle('model:list', async () => {
    return { success: true, data: null }
  })

  ipcMain.handle('model:getActive', async () => {
    return { success: true, data: null }
  })

  ipcMain.handle('model:setActive', async (_event, _id) => {
    return { success: true, data: null }
  })
}
