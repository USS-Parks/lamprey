import { ipcMain, BrowserWindow } from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import * as path from 'path'
import { runGit } from '../services/git-runner'

// Single active watcher across the app: cwd-change closes the prior watcher
// before installing the new one, so changing workdirs mid-session can't pile
// up FSWatchers. Broadcasts `review:changed` (debounced 200 ms) to all
// windows on .git/HEAD or .git/index mutation.
let activeWatcher: { cwd: string; watcher: FSWatcher } | null = null
let broadcastDebounce: ReturnType<typeof setTimeout> | null = null

function broadcast(cwd: string): void {
  if (broadcastDebounce) clearTimeout(broadcastDebounce)
  broadcastDebounce = setTimeout(() => {
    broadcastDebounce = null
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed()) win.webContents.send('review:changed', { cwd })
      } catch {
        // window closed mid-broadcast
      }
    }
  }, 200)
}

function ensureWatcher(cwd: string): void {
  if (activeWatcher && activeWatcher.cwd === cwd) return
  if (activeWatcher) {
    void activeWatcher.watcher.close().catch(() => {
      // ignore — best effort teardown
    })
    activeWatcher = null
  }
  const gitDir = path.join(cwd, '.git')
  const watcher = chokidar.watch(
    [path.join(gitDir, 'HEAD'), path.join(gitDir, 'index')],
    { ignoreInitial: true, depth: 0 }
  )
  watcher.on('all', () => broadcast(cwd))
  watcher.on('error', () => {
    // Swallow — non-git directories or permission issues just stop watching.
  })
  activeWatcher = { cwd, watcher }
}

export async function shutdownReviewWatcher(): Promise<void> {
  if (broadcastDebounce) clearTimeout(broadcastDebounce)
  broadcastDebounce = null
  if (activeWatcher) {
    try {
      await activeWatcher.watcher.close()
    } catch {
      // best effort
    }
    activeWatcher = null
  }
}

interface FileStatus {
  path: string
  indexStatus: string // ' ', M, A, D, R, C, U, ?
  workStatus: string
  staged: boolean
  unstaged: boolean
}

function parsePorcelain(stdout: string): FileStatus[] {
  const lines = stdout.split('\n')
  const out: FileStatus[] = []
  for (const raw of lines) {
    if (!raw) continue
    // Format: XY <space> path  (rename: XY <space> path -> path)
    if (raw.length < 3) continue
    const x = raw[0]
    const y = raw[1]
    const rest = raw.slice(3)
    let path = rest
    if (x === 'R' || y === 'R') {
      const arrow = rest.indexOf(' -> ')
      if (arrow >= 0) path = rest.slice(arrow + 4)
    }
    if (x === '?' && y === '?') {
      out.push({ path, indexStatus: '?', workStatus: '?', staged: false, unstaged: true })
      continue
    }
    out.push({
      path,
      indexStatus: x === ' ' ? ' ' : x,
      workStatus: y === ' ' ? ' ' : y,
      staged: x !== ' ' && x !== '?',
      unstaged: y !== ' '
    })
  }
  return out
}

export function registerReviewHandlers(): void {
  ipcMain.handle('review:status', async (_e, args: { cwd?: string }) => {
    try {
      const cwd = args?.cwd || process.cwd()
      ensureWatcher(cwd)
      const res = await runGit(['status', '--porcelain=v1'], cwd)
      if (res.code !== 0) {
        return { success: false, error: res.stderr.trim() || 'git status failed' }
      }
      // Also fetch branch info — best effort.
      const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
      const ahead = await runGit(['rev-list', '--count', '@{u}..HEAD'], cwd).catch(() => ({
        stdout: '0',
        code: 0,
        stderr: ''
      } as any))
      const behind = await runGit(['rev-list', '--count', 'HEAD..@{u}'], cwd).catch(() => ({
        stdout: '0',
        code: 0,
        stderr: ''
      } as any))
      return {
        success: true,
        data: {
          files: parsePorcelain(res.stdout),
          branch: branch.stdout.trim() || null,
          ahead: parseInt(ahead.stdout.trim() || '0', 10) || 0,
          behind: parseInt(behind.stdout.trim() || '0', 10) || 0,
          cwd
        }
      }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'status failed' }
    }
  })

  ipcMain.handle(
    'review:diff',
    async (_e, args: { cwd?: string; path?: string; staged?: boolean }) => {
      try {
        const cwd = args?.cwd || process.cwd()
        const gitArgs = ['diff', '--no-color']
        if (args?.staged) gitArgs.push('--cached')
        if (args?.path) gitArgs.push('--', args.path)
        const res = await runGit(gitArgs, cwd)
        if (res.code !== 0 && res.stderr) {
          return { success: false, error: res.stderr.trim() }
        }
        // For untracked files, fall back to showing the file content as additions.
        if (!res.stdout && args?.path && !args?.staged) {
          const trackedCheck = await runGit(['ls-files', '--error-unmatch', args.path], cwd)
          if (trackedCheck.code !== 0) {
            const content = await runGit(['ls-files', '-o', '--exclude-standard'], cwd) // noop, just to keep types
            void content
            // Read file directly
            const fs = await import('fs/promises')
            const path = await import('path')
            try {
              const text = await fs.readFile(path.join(cwd, args.path), 'utf8')
              const synthetic =
                `diff --git a/${args.path} b/${args.path}\n` +
                `new file\n--- /dev/null\n+++ b/${args.path}\n` +
                text
                  .split('\n')
                  .map((l) => `+${l}`)
                  .join('\n')
              return { success: true, data: { diff: synthetic, untracked: true } }
            } catch {
              return { success: true, data: { diff: '', untracked: true } }
            }
          }
        }
        return { success: true, data: { diff: res.stdout, untracked: false } }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'diff failed' }
      }
    }
  )

  ipcMain.handle('review:stage', async (_e, args: { cwd?: string; path: string }) => {
    try {
      const cwd = args?.cwd || process.cwd()
      const res = await runGit(['add', '--', args.path], cwd)
      if (res.code !== 0) return { success: false, error: res.stderr.trim() }
      return { success: true, data: true }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'stage failed' }
    }
  })

  ipcMain.handle('review:unstage', async (_e, args: { cwd?: string; path: string }) => {
    try {
      const cwd = args?.cwd || process.cwd()
      const res = await runGit(['restore', '--staged', '--', args.path], cwd)
      if (res.code !== 0) return { success: false, error: res.stderr.trim() }
      return { success: true, data: true }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'unstage failed' }
    }
  })

  ipcMain.handle('review:discard', async (_e, args: { cwd?: string; path: string }) => {
    try {
      const cwd = args?.cwd || process.cwd()
      const res = await runGit(['checkout', '--', args.path], cwd)
      if (res.code !== 0) return { success: false, error: res.stderr.trim() }
      return { success: true, data: true }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'discard failed' }
    }
  })

  ipcMain.handle('review:branches', async (_e, args?: { cwd?: string }) => {
    try {
      const cwd = args?.cwd || process.cwd()
      // %(HEAD) = '*' for current branch, ' ' otherwise. %(upstream:short) is
      // blank for branches with no upstream, which is fine.
      const fmt = '%(HEAD) %(refname:short)\t%(upstream:short)'
      const res = await runGit(
        ['for-each-ref', '--sort=-committerdate', `--format=${fmt}`, 'refs/heads'],
        cwd
      )
      if (res.code !== 0) return { success: false, error: res.stderr.trim() || 'branch list failed' }
      const lines = res.stdout.split('\n').filter((l) => l.trim().length > 0)
      const branches = lines.map((line) => {
        const headMarker = line[0] === '*'
        const rest = line.slice(2) // skip head marker + space
        const tabIdx = rest.indexOf('\t')
        const name = tabIdx >= 0 ? rest.slice(0, tabIdx) : rest
        const upstream = tabIdx >= 0 ? rest.slice(tabIdx + 1).trim() : ''
        return {
          name: name.trim(),
          current: headMarker,
          upstream: upstream || undefined
        }
      })
      return { success: true, data: { branches } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'branches failed' }
    }
  })

  ipcMain.handle('review:checkout', async (_e, args: { cwd?: string; name: string }) => {
    try {
      const cwd = args?.cwd || process.cwd()
      if (!args?.name) return { success: false, error: 'name required' }
      const res = await runGit(['checkout', args.name], cwd)
      if (res.code !== 0) return { success: false, error: res.stderr.trim() || 'checkout failed' }
      return { success: true, data: { name: args.name } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'checkout failed' }
    }
  })

  ipcMain.handle('review:createBranch', async (_e, args: { cwd?: string; name: string }) => {
    try {
      const cwd = args?.cwd || process.cwd()
      if (!args?.name) return { success: false, error: 'name required' }
      const res = await runGit(['checkout', '-b', args.name], cwd)
      if (res.code !== 0)
        return { success: false, error: res.stderr.trim() || 'create branch failed' }
      return { success: true, data: { name: args.name } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'create branch failed' }
    }
  })

  ipcMain.handle('review:summary', async (_e, args?: { cwd?: string }) => {
    try {
      const cwd = args?.cwd || process.cwd()
      // --shortstat for tracked changes (working tree); --cached for staged.
      // Untracked files don't count toward +/- numbers in git's view; treat
      // their existence as "has changes" via the porcelain status used by
      // the Review tool, not here.
      const [unstaged, staged] = await Promise.all([
        runGit(['diff', '--shortstat', '--no-color'], cwd),
        runGit(['diff', '--cached', '--shortstat', '--no-color'], cwd)
      ])
      // shortstat format: " 3 files changed, 12 insertions(+), 5 deletions(-)"
      const parse = (txt: string) => {
        const addM = txt.match(/(\d+) insertions?\(\+\)/)
        const delM = txt.match(/(\d+) deletions?\(-\)/)
        return {
          additions: addM ? parseInt(addM[1], 10) : 0,
          deletions: delM ? parseInt(delM[1], 10) : 0
        }
      }
      const u = parse(unstaged.stdout)
      const s = parse(staged.stdout)
      return {
        success: true,
        data: { additions: u.additions + s.additions, deletions: u.deletions + s.deletions }
      }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'summary failed' }
    }
  })

  ipcMain.handle(
    'review:commit',
    async (_e, args: { cwd?: string; message: string; stageAll?: boolean }) => {
      try {
        const cwd = args?.cwd || process.cwd()
        if (!args?.message) return { success: false, error: 'message required' }
        if (args.stageAll) {
          const st = await runGit(['add', '-A'], cwd)
          if (st.code !== 0) return { success: false, error: st.stderr.trim() || 'stage failed' }
        }
        const res = await runGit(['commit', '-m', args.message], cwd)
        if (res.code !== 0) return { success: false, error: res.stderr.trim() || 'commit failed' }
        return { success: true, data: { stdout: res.stdout.trim() } }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'commit failed' }
      }
    }
  )

  ipcMain.handle('review:push', async (_e, args?: { cwd?: string }) => {
    try {
      const cwd = args?.cwd || process.cwd()
      // Try plain push first; fall back to setting upstream if the branch has none.
      const first = await runGit(['push'], cwd)
      if (first.code === 0) return { success: true, data: { stdout: first.stdout.trim() } }
      const noUpstream =
        first.stderr.includes('has no upstream branch') ||
        first.stderr.includes('set-upstream')
      if (!noUpstream) return { success: false, error: first.stderr.trim() || 'push failed' }
      const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
      const name = branch.stdout.trim()
      if (!name) return { success: false, error: first.stderr.trim() || 'push failed' }
      const second = await runGit(['push', '--set-upstream', 'origin', name], cwd)
      if (second.code !== 0)
        return { success: false, error: second.stderr.trim() || 'push failed' }
      return { success: true, data: { stdout: second.stdout.trim() } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'push failed' }
    }
  })
}
