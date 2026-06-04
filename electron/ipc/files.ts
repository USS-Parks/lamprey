import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs/promises'
import { processFiles, type RoutingThresholds } from '../services/file-handler'
import { readSettings } from '../services/settings-helper'
import {
  clearActiveWorkspace,
  getActiveWorkspace,
  setActiveWorkspace
} from '../services/workspace-state'

// Pull the contextRouting block out of settings.json — the Settings UI
// stores arbitrary keys, so we sanity-check each numeric field before
// handing it to the file router. Missing/invalid keys fall back to the
// router's defaults (resolveThresholds handles the merge).
function loadRoutingFromSettings(): Partial<RoutingThresholds> | null {
  try {
    const settings = readSettings() as { contextRouting?: Record<string, unknown> }
    const cr = settings.contextRouting
    if (!cr || typeof cr !== 'object') return null
    const partial: Partial<RoutingThresholds> = {}
    if (typeof cr.proseInlineMaxBytes === 'number' && cr.proseInlineMaxBytes > 0) {
      partial.proseInlineMaxBytes = cr.proseInlineMaxBytes
    }
    if (typeof cr.structuredInlineMaxBytes === 'number' && cr.structuredInlineMaxBytes > 0) {
      partial.structuredInlineMaxBytes = cr.structuredInlineMaxBytes
    }
    if (typeof cr.structuredInlineWarnMaxBytes === 'number' && cr.structuredInlineWarnMaxBytes > 0) {
      partial.structuredInlineWarnMaxBytes = cr.structuredInlineWarnMaxBytes
    }
    if (typeof cr.codeInlineMaxBytes === 'number' && cr.codeInlineMaxBytes > 0) {
      partial.codeInlineMaxBytes = cr.codeInlineMaxBytes
    }
    if (typeof cr.codeInlineWarnMaxBytes === 'number' && cr.codeInlineWarnMaxBytes > 0) {
      partial.codeInlineWarnMaxBytes = cr.codeInlineWarnMaxBytes
    }
    return partial
  } catch {
    return null
  }
}

// ----------------------------------------------------------------------------
// Pure helpers (exported for unit tests). SEC-6: every spawn that follows a
// model-reachable codepath uses `shell: false` + argv form; nothing the
// renderer sends gets concatenated into a shell command line.
// ----------------------------------------------------------------------------

export function parseProbeOutput(stdout: string): string | null {
  const first = stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0)
  return first ?? null
}

export interface VSCodeLaunchPlan {
  command: string
  args: string[]
  options: {
    detached: true
    stdio: 'ignore'
    windowsHide: true
    shell: false
  }
}

export function buildVSCodeLaunchPlan(codePath: string, target: string): VSCodeLaunchPlan {
  return {
    command: codePath,
    args: [target],
    options: {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false
    }
  }
}

// argv-form probe. `where` (Windows) and `which` (POSIX) are real binaries —
// no shell needed. The string `code` is a constant, not user input, so even
// the probe surface has no model-reachable argument injection.
async function probeCodeBinary(): Promise<string | null> {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    let out = ''
    let p: ReturnType<typeof spawn>
    try {
      p = spawn(cmd, ['code'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: false,
        windowsHide: true
      })
    } catch {
      return resolve(null)
    }
    p.stdout?.on('data', (b: Buffer) => {
      out += b.toString('utf8')
    })
    p.on('error', () => resolve(null))
    p.on('exit', (code) => {
      if (code !== 0) return resolve(null)
      resolve(parseProbeOutput(out))
    })
  })
}

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
      const result = await processFiles(paths, loadRoutingFromSettings())
      return { success: true, data: result }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'File processing failed' }
    }
  })

  ipcMain.handle('files:getWorkdir', async () => {
    try {
      // Resolve the active workspace from the persisted state, falling back
      // to process.cwd() when nothing is set. This is the source of truth
      // tool execution (workspace_context / shell_command / apply_patch)
      // reads through ToolExecutionContext.workspacePath.
      const cwd = getActiveWorkspace()
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

  ipcMain.handle('files:setWorkdir', async (_event, candidate: string) => {
    try {
      const result = setActiveWorkspace(candidate)
      return { success: true, data: { path: result.path, name: path.basename(result.path) } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'Could not set working directory' }
    }
  })

  ipcMain.handle('files:clearWorkdir', async () => {
    try {
      clearActiveWorkspace()
      const cwd = getActiveWorkspace()
      return { success: true, data: { path: cwd, name: path.basename(cwd) } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'Could not clear working directory' }
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
      const processed = await processFiles(dlg.filePaths, loadRoutingFromSettings())
      return { success: true, data: processed }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'File picker failed' }
    }
  })

  ipcMain.handle('files:openInVSCode', async (_event, args?: { targetPath?: string }) => {
    try {
      const target = args?.targetPath || process.cwd()
      const codePath = await probeCodeBinary()
      if (!codePath) {
        return {
          success: false,
          error:
            "VS Code's `code` CLI was not found on PATH. Install VS Code or add it to PATH (Command Palette → Shell Command: Install 'code' command in PATH)."
        }
      }
      // SEC-6: no `shell: true`. The target is an argv element so the OS
      // shell never sees it. On Windows the resolved `code` is typically
      // `code.cmd`; Node ≥21.7 applies safe per-arg quoting for .cmd
      // targets automatically (CVE-2024-27980 fix), so this argv form is
      // safe across the modern Node runtimes Electron 35 carries.
      const plan = buildVSCodeLaunchPlan(codePath, target)
      const child = spawn(plan.command, plan.args, plan.options)
      child.on('error', () => {
        // Spawn errors after a successful probe are rare; the IPC has
        // already returned. The probe is the real gate.
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
