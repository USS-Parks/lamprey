// Snip Phase K10: renderer-facing IPC for the SnipSettings dashboard
// (K11) and the K12 Discover panel.
//
// Eight channels:
//   snip:stats           → SnipStats     (totals + sparkline + top-5)
//   snip:recent          → recent rows
//   snip:listFilters     → filter library with source + path
//   snip:setEnabled      → flip the master switch (and update the cache)
//   snip:setVerbose      → flip the verbose flag
//   snip:reloadFilters   → force a YAML re-scan
//   snip:discover        → top-K unfiltered commands (rtk discover)
//   snip:clearHistory    → wipe both tracking tables
//   snip:openFilterDir   → open the user filter dir in the OS file explorer
//
// Every handler returns the harness's standard IpcResponse shape
// (`{success:true,data} | {success:false,error}`).

import { ipcMain, shell } from 'electron'
import { readSettings, patchSettings } from '../services/settings-helper'
import {
  getStats,
  getRecent,
  getUnfilteredCommands,
  clearAll,
  listAllFilters,
  reloadAllFilters,
  getUserFilterDir,
  type FilterListEntry
} from '../services/snip'

const ONE_DAY_MS = 86_400_000

export function registerSnipHandlers(): void {
  ipcMain.handle('snip:stats', async () => {
    try {
      const settings = readSettings()
      const enabled = settings.snipEnabled !== false
      return { success: true, data: getStats(enabled, Date.now()) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'snip:stats failed' }
    }
  })

  ipcMain.handle('snip:recent', async (_event, payload?: { limit?: number }) => {
    try {
      const limit = Math.max(1, Math.min(500, Math.floor(payload?.limit ?? 20)))
      return { success: true, data: getRecent(limit) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'snip:recent failed' }
    }
  })

  ipcMain.handle(
    'snip:listFilters',
    async (): Promise<{ success: true; data: FilterListEntry[] } | { success: false; error: string }> => {
      try {
        return { success: true, data: listAllFilters() }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'snip:listFilters failed' }
      }
    }
  )

  ipcMain.handle('snip:setEnabled', async (_event, payload?: { enabled?: boolean }) => {
    try {
      const enabled = payload?.enabled === true
      patchSettings({ snipEnabled: enabled })
      return { success: true, data: { enabled } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'snip:setEnabled failed' }
    }
  })

  ipcMain.handle('snip:setVerbose', async (_event, payload?: { verbose?: boolean }) => {
    try {
      const verbose = payload?.verbose === true
      patchSettings({ snipVerbose: verbose })
      return { success: true, data: { verbose } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'snip:setVerbose failed' }
    }
  })

  ipcMain.handle('snip:reloadFilters', async () => {
    try {
      return { success: true, data: reloadAllFilters() }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'snip:reloadFilters failed' }
    }
  })

  ipcMain.handle('snip:discover', async (_event, payload?: { sinceDays?: number; limit?: number }) => {
    try {
      const sinceDays = Math.max(1, Math.min(365, Math.floor(payload?.sinceDays ?? 7)))
      const limit = Math.max(1, Math.min(100, Math.floor(payload?.limit ?? 20)))
      const sinceMs = Date.now() - sinceDays * ONE_DAY_MS
      const suggestions = getUnfilteredCommands(sinceMs, limit).map((r) => ({
        commandPattern: r.commandPattern,
        runs: r.runs,
        estimatedTokens: r.estimatedTokens,
        sampleCommand: r.sampleCommand,
        suggestedCategory: categoryFor(r.commandPattern)
      }))
      return { success: true, data: { suggestions, sinceMs, scannedCommandHeads: suggestions.length } }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'snip:discover failed' }
    }
  })

  ipcMain.handle('snip:clearHistory', async () => {
    try {
      clearAll()
      return { success: true, data: null }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'snip:clearHistory failed' }
    }
  })

  ipcMain.handle('snip:openFilterDir', async () => {
    try {
      const dir = getUserFilterDir()
      await shell.openPath(dir)
      return { success: true, data: dir }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'snip:openFilterDir failed' }
    }
  })
}

/**
 * Heuristic mapping from command head to one of the shipped categories.
 * Powers the K12 Discover panel's "Write a filter for this — suggested
 * folder" hint. A miss falls back to "other".
 */
function categoryFor(head: string): string {
  switch (head) {
    case 'git':
    case 'jj':
    case 'yadm':
    case 'gt':
      return 'git'
    case 'tsc':
    case 'vitest':
    case 'jest':
    case 'eslint':
    case 'prettier':
    case 'biome':
    case 'oxlint':
    case 'next':
    case 'playwright':
    case 'nx':
    case 'turbo':
    case 'npm':
    case 'npx':
    case 'yarn':
    case 'pnpm':
    case 'prisma':
      return 'js'
    case 'go':
    case 'golangci-lint':
      return 'go'
    case 'cargo':
    case 'rustc':
      return 'rust'
    case 'pytest':
    case 'ruff':
    case 'mypy':
    case 'basedpyright':
    case 'ty':
    case 'pip':
    case 'poetry':
    case 'uv':
      return 'python'
    case 'rspec':
    case 'rubocop':
    case 'rake':
    case 'bundle':
    case 'rails':
      return 'ruby'
    case 'dotnet':
      return 'dotnet'
    case 'docker':
    case 'docker-compose':
    case 'kubectl':
      return 'docker'
    case 'terraform':
    case 'tofu':
    case 'helm':
    case 'ansible-playbook':
    case 'gcloud':
    case 'aws':
      return 'cloud'
    case 'make':
    case 'gcc':
    case 'g++':
    case 'gradle':
    case 'gradlew':
    case 'mvn':
    case 'swift':
    case 'xcodebuild':
    case 'just':
    case 'task':
    case 'pio':
    case 'trunk':
    case 'mise':
      return 'build'
    case 'ls':
    case 'find':
    case 'grep':
    case 'rg':
    case 'diff':
    case 'wc':
    case 'tree':
      return 'files'
    case 'shellcheck':
    case 'hadolint':
    case 'markdownlint':
    case 'yamllint':
    case 'pre-commit':
      return 'linting'
    case 'brew':
    case 'composer':
      return 'pkg'
    case 'curl':
    case 'wget':
    case 'psql':
    case 'jq':
    case 'ping':
    case 'ssh':
    case 'rsync':
    case 'df':
    case 'du':
    case 'ps':
    case 'systemctl':
    case 'iptables':
    case 'stat':
    case 'fail2ban-client':
      return 'system'
    case 'gh':
    case 'jira':
    case 'ollama':
    case 'sops':
    case 'skopeo':
      return 'other'
    default:
      return 'other'
  }
}
