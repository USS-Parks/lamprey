import { ipcMain, dialog, BrowserWindow } from 'electron'
import { processFiles } from '../services/file-handler'

export function registerFilesHandlers(): void {
  ipcMain.handle('files:process', async (_event, paths: string[]) => {
    try {
      if (!Array.isArray(paths)) return { success: false, error: 'paths must be an array' }
      const result = await processFiles(paths)
      return { success: true, data: result }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'File processing failed' }
    }
  })

  ipcMain.handle('files:openPicker', async () => {
    try {
      const win = BrowserWindow.getAllWindows()[0]
      const dlg = win
        ? await dialog.showOpenDialog(win, {
            properties: ['openFile', 'multiSelections'],
            filters: [
              {
                name: 'Supported',
                extensions: [
                  'txt',
                  'md',
                  'mdx',
                  'py',
                  'js',
                  'ts',
                  'tsx',
                  'jsx',
                  'html',
                  'css',
                  'json',
                  'csv',
                  'tsv',
                  'yaml',
                  'yml',
                  'pdf',
                  'png',
                  'jpg',
                  'jpeg',
                  'gif',
                  'webp'
                ]
              },
              { name: 'All files', extensions: ['*'] }
            ]
          })
        : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
      if (dlg.canceled) return { success: true, data: [] }
      const processed = await processFiles(dlg.filePaths)
      return { success: true, data: processed }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'File picker failed' }
    }
  })
}
