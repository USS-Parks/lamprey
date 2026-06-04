import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'fs'
import { join, basename, resolve } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { parseWorkflowScript, type WorkflowMeta } from './workflow-meta'

// Workflow library — discovers `.js` workflow scripts shipped with Lamprey
// (`resources/workflows/`) plus user-authored ones (`userData/workflows/scripts/`).
// Both directories are scanned at startup; user scripts shadow built-ins of the
// same name.
//
// B1 introduced the runner. B4 ships the library + the nested-workflow API:
// `workflow('adversarial-verify', { claim })` resolves the script and runs it
// inline within the current workflow. The 4 built-ins demonstrate canonical
// patterns described in the parity plan §4.

export interface LibraryEntry {
  /** From the script's `export const meta = { name: ... }`. */
  name: string
  /** From meta.description. */
  description: string
  /** Absolute path to the source file. */
  filePath: string
  /** Fully validated meta object. */
  meta: WorkflowMeta
  /** Raw script source — what the runner needs. */
  source: string
  /** 'builtin' for shipped scripts, 'user' for userData ones. */
  origin: 'builtin' | 'user'
}

const library = new Map<string, LibraryEntry>()
let initialised = false

function builtinDir(): string {
  if (is.dev) return join(__dirname, '../../resources/workflows')
  return join(process.resourcesPath, 'workflows')
}

function userDir(): string {
  try {
    return join(app.getPath('userData'), 'workflows', 'scripts')
  } catch {
    return ''
  }
}

function ensureDir(dir: string): void {
  if (!dir) return
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function scanDir(dir: string, origin: 'builtin' | 'user'): LibraryEntry[] {
  if (!dir || !existsSync(dir)) return []
  const entries: LibraryEntry[] = []
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.js')) continue
    const filePath = join(dir, name)
    try {
      const stats = statSync(filePath)
      if (!stats.isFile()) continue
      const source = readFileSync(filePath, 'utf-8')
      const parsed = parseWorkflowScript(source)
      entries.push({
        name: parsed.meta.name,
        description: parsed.meta.description,
        filePath,
        meta: parsed.meta,
        source,
        origin
      })
    } catch (err) {
      console.warn(`[workflow-library] failed to load ${filePath}:`, err)
    }
  }
  return entries
}

export function initializeWorkflowLibrary(): void {
  if (initialised) return
  initialised = true
  library.clear()
  const builtinEntries = scanDir(builtinDir(), 'builtin')
  for (const entry of builtinEntries) library.set(entry.name, entry)
  const u = userDir()
  ensureDir(u)
  const userEntries = scanDir(u, 'user')
  for (const entry of userEntries) library.set(entry.name, entry) // user wins
  console.log(`[workflow-library] loaded ${library.size} workflows`)
}

export function getWorkflow(name: string): LibraryEntry | null {
  if (!initialised) initializeWorkflowLibrary()
  return library.get(name) ?? null
}

export function listWorkflows(): LibraryEntry[] {
  if (!initialised) initializeWorkflowLibrary()
  return [...library.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function workflowFileName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'workflow'}.js`
}

export function validateWorkflowSource(source: string): WorkflowMeta {
  return parseWorkflowScript(source).meta
}

export function saveUserWorkflow(source: string): LibraryEntry {
  if (!initialised) initializeWorkflowLibrary()
  const parsed = parseWorkflowScript(source)
  const dir = userDir()
  ensureDir(dir)
  const filePath = join(dir, workflowFileName(parsed.meta.name))
  writeFileSync(filePath, source, 'utf-8')
  const entry: LibraryEntry = {
    name: parsed.meta.name,
    description: parsed.meta.description,
    filePath,
    meta: parsed.meta,
    source,
    origin: 'user'
  }
  library.set(entry.name, entry)
  return entry
}

// Test seam — bypass disk discovery and inject entries directly.
export const __workflowLibraryTest = {
  reset(): void {
    library.clear()
    initialised = false
  },
  register(entry: LibraryEntry): void {
    library.set(entry.name, entry)
    initialised = true
  },
  builtinDir,
  userDir,
  scanDir,
  /** Synchronous helper for tests that need to confirm a resources/ file
   *  parses cleanly; bypasses the chokidar / app.getPath layers. */
  parsePath(filePath: string): LibraryEntry {
    const source = readFileSync(filePath, 'utf-8')
    const parsed = parseWorkflowScript(source)
    return {
      name: parsed.meta.name,
      description: parsed.meta.description,
      filePath: resolve(filePath),
      meta: parsed.meta,
      source,
      origin: 'builtin'
    }
  },
  builtinFileNames(): string[] {
    const dir = builtinDir()
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.js'))
      .map((f) => basename(f))
  }
}
