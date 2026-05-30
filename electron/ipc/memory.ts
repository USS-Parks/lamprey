import { ipcMain } from 'electron'
import * as memStore from '../services/memory-store'

export function registerMemoryHandlers(): void {
  ipcMain.handle('memory:list', async () => {
    try {
      return { success: true, data: memStore.listMemories() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('memory:add', async (_event, content) => {
    try {
      return { success: true, data: memStore.addMemory(content) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('memory:update', async (_event, id, content) => {
    try {
      const entry = memStore.updateMemory(id, content)
      if (!entry) return { success: false, error: 'Memory entry not found' }
      return { success: true, data: entry }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('memory:delete', async (_event, id) => {
    try {
      memStore.deleteMemory(id)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('memory:clear', async () => {
    try {
      memStore.clearAllMemories()
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('memory:export', async () => {
    try {
      return { success: true, data: memStore.exportMemories() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('memory:import', async (_event, entries) => {
    try {
      const parsed = typeof entries === 'string' ? JSON.parse(entries) : entries
      memStore.importMemories(parsed)
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
