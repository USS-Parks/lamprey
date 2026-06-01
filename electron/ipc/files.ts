import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs/promises'
import { processFiles } from '../services/file-handler'

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache',
  '.vscode', '.idea', '__pycache__', '.pytest_cache', '.venv', 'venv',
  'target', '.gradle', '.turbo', 'coverage', '.nyc_output'
])

const TEXT_READ_CAP = 2_000_000 // 2 MB cap for in-app viewer
const WALK_FILE_CAP = 5000      // safety stop for huge repos

type FsEntry = {
  name: string
  type: 'file' | 'dir'
  path: string
  size?: number
}

async function listDir(absPath: string): Promise<FsEntry[]> {
  const entries = await fs.readdir(absPath, { withFileTypes: true })
  const out: FsEntry[] = []
  for (const e of entries) {
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue
    const full = path.join(absPath, e.name)
    if (e.isDirectory()) {
      out.push({ name: e.name, type: 'dir', path: full })
    } else if (e.isFile()) {
      try {
        const st = await fs.stat(full)
        out.push({ name: e.name, type: 'file', path: full, size: st.size })
      } catch {
        out.push({ name: e.name, type: 'file', path: full })
      }
    }
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return out
}

async function walkProject(rootPath: string): Promise<string[]> {
  const results: string[] = []
  const stack: string[] = [rootPath]
  while (stack.length && results.length < WALK_FILE_CAP) {
    const dir = stack.pop()!
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        stack.push(path.join(dir, e.name))
      } else if (e.isFile()) {
        if (results.length >= WALK_FILE_CAP) break
        const full = path.join(dir, e.name)
        results.push(path.relative(rootPath, full))
      }
    }
  }
  return results
}

export function registerFilesHandlers(): void {
  ipcMain.handle('files:listDir', async (_event, dirPath: string) => {
    try {
      if (typeof dirPath !== 'string' || !dirPath) {
        return { success: false, error: 'dirPath required' }
      }
      const entries = await listDir(dirPath)
      return { success: true, data: entries }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'listDir failed' }
    }
  })

  ipcMain.handle('files:readText', async (_event, filePath: string) => {
    try {
      if (typeof filePath !== 'string' || !filePath) {
        return { success: false, error: 'filePath required' }
      }
      const st = await fs.stat(filePath)
      if (st.size > TEXT_READ_CAP) {
        return {
          success: false,
          error: `File too large (${(st.size / 1_000_000).toFixed(1)} MB). Cap is ${(TEXT_READ_CAP / 1_000_000).toFixed(1)} MB.`
        }
      }
      const buf = await fs.readFile(filePath)
      // Crude binary sniff: presence of NUL byte in first 4 KB.
      const sample = buf.subarray(0, Math.min(buf.length, 4096))
      const isBinary = sample.includes(0)
      if (isBinary) {
        return { success: false, error: 'Binary file — not previewable as text.' }
      }
      return { success: true, data: { content: buf.toString('utf8'), size: st.size } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'readText failed' }
    }
  })

  ipcMain.handle('files:walkProject', async (_event, rootPath: string) => {
    try {
      if (typeof rootPath !== 'string' || !rootPath) {
        return { success: false, error: 'rootPath required' }
      }
      const files = await walkProject(rootPath)
      return { success: true, data: { files, truncated: files.length >= WALK_FILE_CAP } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'walkProject failed' }
    }
  })

  ipcMain.handle('files:process', async (_event, paths: string[]) => {
    try {
      if (!Array.isArray(paths)) return { success: false, error: 'paths must be an array' }
      const result = await processFiles(paths)
      return { success: true, data: result }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'File processing failed' }
    }
  })

  ipcMain.handle('files:getWorkdir', async () => {
    try {
      const cwd = process.cwd()
      return { success: true, data: { path: cwd, name: path.basename(cwd) } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'Could not read working directory' }
    }
  })

  ipcMain.handle('files:pickWorkdir', async () => {
    try {
      const win = BrowserWindow.getAllWindows()[0]
      const dlg = win
        ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
        : await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (dlg.canceled || dlg.filePaths.length === 0) return { success: true, data: null }
      const chosen = dlg.filePaths[0]
      return { success: true, data: { path: chosen, name: path.basename(chosen) } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'Folder picker failed' }
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

  ipcMain.handle('files:openInVSCode', async (_event, args?: { targetPath?: string }) => {
    try {
      const target = args?.targetPath || process.cwd()
      // Probe `code` first so we can surface a real error to the renderer
      // rather than firing a detached child that silently fails on ENOENT.
      // On Windows `code` is a .cmd shim → shell: true is required for both
      // probe and launch.
      const probeCmd = process.platform === 'win32' ? 'where code' : 'command -v code'
      const probe = await new Promise<boolean>((resolve) => {
        const p = spawn(probeCmd, {
          shell: true,
          windowsHide: true,
          stdio: 'ignore'
        })
        p.on('exit', (code) => resolve(code === 0))
        p.on('error', () => resolve(false))
      })
      if (!probe) {
        return {
          success: false,
          error:
            "VS Code's `code` CLI was not found on PATH. Install VS Code or add it to PATH (Command Palette → Shell Command: Install 'code' command in PATH)."
        }
      }
      const child = spawn('code', [target], {
        detached: true,
        stdio: 'ignore',
        shell: true,
        windowsHide: true
      })
      // After the probe succeeded a spawn error here is rare; log it but
      // don't promise-reject (the IPC already returned). The probe is the
      // real gate.
      child.on('error', () => {
        // Could pipe through app:warning here; for v1 the toast already
        // fires on probe-fail which is the common case.
      })
      child.unref()
      return { success: true, data: { path: target } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'Could not launch VS Code' }
    }
  })

  ipcMain.handle('files:openInExplorer', async (_event, args?: { targetPath?: string }) => {
    try {
      const target = args?.targetPath || process.cwd()
      await shell.openPath(target)
      return { success: true, data: { path: target } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'Could not open file explorer' }
    }
  })
}
