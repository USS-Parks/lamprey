import { ipcMain } from 'electron'

export function registerArtifactHandlers(): void {
  ipcMain.handle('artifact:render', async (_event, _type, _content) => {
    return { success: true, data: null }
  })

  ipcMain.handle('artifact:hide', async () => {
    return { success: true, data: null }
  })

  ipcMain.handle('artifact:resize', async (_event, _bounds) => {
    return { success: true, data: null }
  })

  ipcMain.handle('artifact:openInWindow', async (_event, _type, _content) => {
    return { success: true, data: null }
  })
}
