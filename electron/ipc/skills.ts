import { ipcMain } from 'electron'

export function registerSkillsHandlers(): void {
  ipcMain.handle('skills:list', async () => {
    return { success: true, data: null }
  })

  ipcMain.handle('skills:create', async (_event, _skill) => {
    return { success: true, data: null }
  })

  ipcMain.handle('skills:update', async (_event, _id, _skill) => {
    return { success: true, data: null }
  })

  ipcMain.handle('skills:delete', async (_event, _id) => {
    return { success: true, data: null }
  })
}
