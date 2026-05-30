import { ipcMain } from 'electron'
import * as artifactSandbox from '../services/artifact-sandbox'

export function registerArtifactHandlers(): void {
  ipcMain.handle('artifact:render', async (_event, type: string, content: string) => {
    try {
      artifactSandbox.render(type, content)
      return { success: true, data: null }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('artifact:hide', async () => {
    artifactSandbox.hide()
    return { success: true, data: null }
  })

  ipcMain.handle('artifact:resize', async (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    try {
      artifactSandbox.setBounds(bounds)
      return { success: true, data: null }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('artifact:openInWindow', async (_event, type: string, content: string) => {
    try {
      artifactSandbox.openInWindow(type, content)
      return { success: true, data: null }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('artifact:getSource', async () => {
    return { success: true, data: artifactSandbox.getSource() }
  })

  ipcMain.handle('artifact:getType', async () => {
    return { success: true, data: artifactSandbox.getType() }
  })
}
