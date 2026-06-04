import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs/promises'
import { processFiles } from '../services/file-handler'
import {
  clearActiveWorkspace,
  getActiveWorkspace,
  setActiveWorkspace
} from '../services/workspace-state'

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

/**
 * SEC-1: confine a renderer-supplied path to the file-browser root (the active
 * workspace). Returns the resolved absolute path when `candidate` is the root
 * itself or a descendant of it; returns null for `..` traversals, absolute
 * paths that escape the root, and other-drive paths. The browser legitimately
 * recurses descendants of the user-picked workdir, so the root and its
 * children are allowed — but nothing above or beside it. Exported pure for
 * unit tests.
 */
export function confineWithinRoot(root: string, candidate: string): string | null {
  if (typeof candidate !== 'string' || candidate.trim() === '') return null
  // Reject explicit `..` segments outright, even though path.relative would
  // catch most escapes — an explicit traversal attempt is worth refusing loud.
  const segments = candidate.replace(/\\/g, '/').split('/')
  if (segments.some((s) => s === '..')) return null

  const absRoot = path.resolve(root)
  const target = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(absRoot, candidate)
  const rel = path.relative(absRoot, target)
  // rel === '' means `target` IS the root (allowed — listDir/walkProject start
  // there). A leading '..' or an absolute rel means it escaped the root.
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return target
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
      const abs = confineWithinRoot(getActiveWorkspace(), dirPath)
      if (!abs) {
        return { success: false, error: 'Path is outside the working folder.' }
      }
      const entries = await listDir(abs)
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
      const abs = confineWithinRoot(getActiveWorkspace(), filePath)
      if (!abs) {
        return { success: false, error: 'Path is outside the working folder.' }
      }
      const st = await fs.stat(abs)
      if (st.size > TEXT_READ_CAP) {
        return {
          success: false,
          error: `File too large (${(st.size / 1_000_000).toFixed(1)} MB). Cap is ${(TEXT_READ_CAP / 1_000_000).toFixed(1)} MB.`
        }
      }
      const buf = await fs.readFile(abs)
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
      const abs = confineWithinRoot(getActiveWorkspace(), rootPath)
      if (!abs) {
        return { success: false, error: 'Path is outside the working folder.' }
      }
      const files = await walkProject(abs)
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
      const processed = await processFiles(dlg.filePaths)
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
