import { ipcMain } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

const models = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3',
    contextWindow: 65536,
    supportsTools: true,
    supportsVision: false
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek R1',
    contextWindow: 65536,
    supportsTools: false,
    supportsVision: false
  }
]

const getSettingsPath = () => join(app.getPath('userData'), 'settings.json')

function readSettings(): Record<string, unknown> {
  const settingsPath = getSettingsPath()
  if (!existsSync(settingsPath)) return {}
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf-8'))
  } catch {
    return {}
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

export function registerModelHandlers(): void {
  ipcMain.handle('model:list', async () => {
    return { success: true, data: models }
  })

  ipcMain.handle('model:getActive', async () => {
    const settings = readSettings()
    return { success: true, data: (settings.defaultModel as string) || 'deepseek-chat' }
  })

  ipcMain.handle('model:setActive', async (_event, id) => {
    try {
      const settings = readSettings()
      settings.defaultModel = id
      writeSettings(settings)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
