import { ipcMain } from 'electron'

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', async () => {
    return { success: true, data: null }
  })

  ipcMain.handle('settings:set', async (_event, _partial) => {
    return { success: true, data: null }
  })

  ipcMain.handle('settings:saveApiKey', async (_event, _key) => {
    return { success: true, data: null }
  })

  ipcMain.handle('settings:hasApiKey', async () => {
    return { success: true, data: false }
  })

  ipcMain.handle('settings:testApiKey', async () => {
    return { success: true, data: false }
  })

  ipcMain.handle('settings:saveGoogleCredentials', async (_event, _clientId, _clientSecret) => {
    return { success: true, data: null }
  })
}
