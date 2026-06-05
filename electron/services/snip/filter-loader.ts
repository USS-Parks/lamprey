// YAML filter loader. Two filter directories:
//   • built-in:   <resources>/snip-filters/   (dev: project root, prod: process.resourcesPath)
//   • user:       <userData>/snip/filters/
// On first launch the built-in tree is COPIED into userData/snip/filters/built-in/
// so the user can see exactly what's running and inspect / fork by editing the
// copy. User filters at the userData root override built-ins by name.
//
// Mirrors skill-loader.ts in shape: chokidar watch on the userData dir,
// initial scan + per-file upsert / remove, BrowserWindow broadcast on change.
//
// All errors flow through `FilterLoadError[]` to the K11 dashboard's
// "Filter health" panel — never thrown to the caller (Invariant 15).

import { app, BrowserWindow } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync
} from 'fs'
import { basename, dirname, join, relative, resolve } from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import { is } from '@electron-toolkit/utils'
import yaml from 'js-yaml'
import type { Filter } from './types'
import { validateFilter, type FilterLoadError } from './filter-schema'

interface LoadedFilterEntry {
  filter: Filter
  source: 'built-in' | 'user'
  path: string
}

/** Path → entry, key is the absolute file path. */
const filtersByPath = new Map<string, LoadedFilterEntry>()
/** Errors keyed by path (so a re-load on the same file replaces). */
const errorsByPath = new Map<string, FilterLoadError>()

let watcher: FSWatcher | null = null
let userDir: string | null = null
let builtInDir: string | null = null
let changeSubscribers: Array<() => void> = []

function resolveBuiltInDir(): string {
  if (is.dev) return join(__dirname, '../../resources/snip-filters')
  return join(process.resourcesPath, 'snip-filters')
}

function resolveUserDir(): string {
  return join(app.getPath('userData'), 'snip', 'filters')
}

function copyMissingTree(src: string, dest: string): void {
  if (!existsSync(src)) return
  const s = statSync(src)
  if (s.isDirectory()) {
    if (!existsSync(dest)) mkdirSync(dest, { recursive: true })
    for (const child of readdirSync(src)) {
      copyMissingTree(join(src, child), join(dest, child))
    }
    return
  }
  if (!s.isFile() || existsSync(dest)) return
  try {
    copyFileSync(src, dest)
  } catch (err) {
    console.error('[snip-loader] failed to copy bundled filter', src, err)
  }
}

function ensureUserDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const bundled = resolveBuiltInDir()
  if (!existsSync(bundled)) return
  // Built-ins live under <userData>/snip/filters/built-in/ so user
  // filters at the root override them by name without touching the
  // built-in copies.
  copyMissingTree(bundled, join(dir, 'built-in'))
}

function isYamlFile(p: string): boolean {
  const lower = basename(p).toLowerCase()
  return (lower.endsWith('.yaml') || lower.endsWith('.yml')) && !lower.endsWith('.draft.yaml')
}

function classifyPath(p: string): 'built-in' | 'user' {
  if (!userDir) return 'user'
  const rel = relative(userDir, p)
  return rel.startsWith('built-in') ? 'built-in' : 'user'
}

function discoverFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry)
      try {
        const s = statSync(full)
        if (s.isDirectory()) walk(full)
        else if (s.isFile() && isYamlFile(full)) out.push(full)
      } catch {
        /* skip unreadable */
      }
    }
  }
  walk(dir)
  return out
}

function loadOne(path: string): void {
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = yaml.load(raw)
    const result = validateFilter(parsed)
    if (!result.ok || !result.filter) {
      errorsByPath.set(path, { path, message: result.error ?? 'invalid filter' })
      filtersByPath.delete(path)
      return
    }
    errorsByPath.delete(path)
    filtersByPath.set(path, {
      filter: result.filter,
      source: classifyPath(path),
      path
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    errorsByPath.set(path, { path, message: `YAML parse failed: ${message}` })
    filtersByPath.delete(path)
  }
}

function unloadOne(path: string): void {
  filtersByPath.delete(path)
  errorsByPath.delete(path)
}

function broadcast(): void {
  for (const cb of changeSubscribers) {
    try {
      cb()
    } catch (err) {
      console.error('[snip-loader] subscriber threw', err)
    }
  }
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('snip:filters-changed')
    } catch {
      /* window may already be closing */
    }
  }
}

/**
 * Initial scan + chokidar watch. Idempotent — second call is a no-op.
 */
export function initializeFilterLoader(): void {
  if (userDir) return
  userDir = resolveUserDir()
  builtInDir = resolveBuiltInDir()
  ensureUserDir(userDir)

  try {
    for (const path of discoverFiles(userDir)) {
      loadOne(path)
    }
  } catch (err) {
    console.error('[snip-loader] initial scan failed', err)
  }

  watcher = chokidar.watch(userDir, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
  })
  const onAddOrChange = (p: string): void => {
    if (!isYamlFile(p)) return
    loadOne(p)
    broadcast()
  }
  const onUnlink = (p: string): void => {
    if (!isYamlFile(p)) return
    unloadOne(p)
    broadcast()
  }
  watcher.on('add', onAddOrChange)
  watcher.on('change', onAddOrChange)
  watcher.on('unlink', onUnlink)
  watcher.on('error', (err) => console.error('[snip-loader] watcher error:', err))

  console.log(
    `[snip-loader] watching ${userDir} (${filtersByPath.size} loaded, ${errorsByPath.size} errors)`
  )
}

export function shutdownFilterLoader(): void {
  if (watcher) {
    watcher.close().catch(() => {})
    watcher = null
  }
  filtersByPath.clear()
  errorsByPath.clear()
  userDir = null
  builtInDir = null
  changeSubscribers = []
}

/**
 * Manual full reload — used by the K10 `snip:reloadFilters` IPC.
 */
export function reloadAllFilters(): { loaded: number; errors: FilterLoadError[] } {
  if (!userDir) initializeFilterLoader()
  if (!userDir) return { loaded: 0, errors: [] }
  filtersByPath.clear()
  errorsByPath.clear()
  for (const path of discoverFiles(userDir)) {
    loadOne(path)
  }
  broadcast()
  return {
    loaded: filtersByPath.size,
    errors: Array.from(errorsByPath.values())
  }
}

/**
 * Active filter set, with user filters winning over built-ins of the
 * same `name`. Order: user filters first (so K2's `selectFilter`
 * first-match-wins picks the override), then built-ins.
 */
export function listActiveFilters(): Filter[] {
  const userByName = new Map<string, Filter>()
  const builtIns: Filter[] = []
  for (const entry of filtersByPath.values()) {
    if (entry.source === 'user') {
      userByName.set(entry.filter.name, entry.filter)
    } else {
      builtIns.push(entry.filter)
    }
  }
  const overriddenNames = new Set(userByName.keys())
  const out = [
    ...userByName.values(),
    ...builtIns.filter((f) => !overriddenNames.has(f.name))
  ]
  return out
}

/**
 * Full list for the dashboard, with source + path metadata. Sorted
 * by name. Overridden built-ins are flagged.
 */
export interface FilterListEntry {
  name: string
  description: string
  source: 'built-in' | 'user'
  path: string
  overriddenByUser: boolean
}

export function listAllFilters(): FilterListEntry[] {
  const userNames = new Set<string>()
  for (const entry of filtersByPath.values()) {
    if (entry.source === 'user') userNames.add(entry.filter.name)
  }
  const rows: FilterListEntry[] = []
  for (const entry of filtersByPath.values()) {
    rows.push({
      name: entry.filter.name,
      description: entry.filter.description,
      source: entry.source,
      path: entry.path,
      overriddenByUser: entry.source === 'built-in' && userNames.has(entry.filter.name)
    })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source))
  return rows
}

export function listLoadErrors(): FilterLoadError[] {
  return Array.from(errorsByPath.values())
}

export function getUserFilterDir(): string {
  if (!userDir) {
    userDir = resolveUserDir()
    ensureUserDir(userDir)
  }
  return userDir
}

export function getBuiltInFilterDir(): string {
  if (!builtInDir) builtInDir = resolveBuiltInDir()
  return builtInDir
}

export function subscribeFilterChanges(cb: () => void): () => void {
  changeSubscribers.push(cb)
  return () => {
    changeSubscribers = changeSubscribers.filter((c) => c !== cb)
  }
}

/**
 * Pure helpers exposed for the K3 tests — bypass the singleton state so
 * tests can verify the YAML + schema path against tmp dirs without
 * spinning up chokidar.
 */
export const __filterLoaderTest = {
  loadOneFromString: (path: string, contents: string): { filter?: Filter; error?: string } => {
    try {
      const parsed = yaml.load(contents)
      const result = validateFilter(parsed)
      if (!result.ok || !result.filter) return { error: result.error ?? 'invalid filter' }
      // Re-classify ignoring singleton state.
      return { filter: result.filter }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },
  isYamlFile,
  classifyPath: (p: string, withUserDir: string): 'built-in' | 'user' => {
    const r = relative(withUserDir, p)
    return r.startsWith('built-in') ? 'built-in' : 'user'
  },
  dirname,
  resolve
}
