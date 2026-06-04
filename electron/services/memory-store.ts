import { app, BrowserWindow } from 'electron'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { basename, join, resolve } from 'path'
import chokidar, { FSWatcher } from 'chokidar'
import { getDb } from './database'
import {
  MemoryType,
  MemoryWriteInput,
  memorySlug,
  parseMemoryMarkdown,
  serializeMemoryMarkdown
} from './memory-frontmatter'

// File-backed memory store (parity Track 3, prompt D1).
//
// Memory files live at
//   userData/lamprey-memory/<projectSlug>/<slug>.md
//
// The SQLite `memory_index` table mirrors the files for typed list /
// FTS search; the files themselves are canonical, so external editors
// (and version control) can mutate the store freely. A chokidar
// watcher catches external edits and re-syncs the mirror so the next
// `listMemoryFiles()` reads up-to-date rows.
//
// The legacy renderer + tool ecosystem still hits `memory:add` /
// `memory:list` etc. with numeric ids. Those handlers fall through to
// the back-compat shims below, which write/read files under the
// `__global__` project slug with `type: project`.
//
// When the SQLite binding is unavailable (test environments where the
// native better-sqlite3 binding is built for Electron's ABI, not for
// system Node), the store falls back to an in-memory mirror keyed on
// the file `name`. The fallback mirrors only what the SQLite index
// holds; the files themselves remain canonical either way.

const DEFAULT_PROJECT_SLUG = '__global__'
const MIGRATION_MARKER = '.migrated-from-sqlite'
const MEMORY_INDEX_FILENAME = 'MEMORY.md'
const MEMORY_INDEX_MAX_LINES = 200
// `[[link-name]]` pattern — link targets are memory slugs so we accept
// the same chars `memorySlug()` emits. Spaces inside the brackets are
// tolerated and slug-normalized on resolve.
const MEMORY_LINK_RE = /\[\[([^[\]\n]+?)\]\]/g

export interface MemoryFile {
  name: string
  projectSlug: string
  description: string
  type: MemoryType
  body: string
  filePath: string
  sourceConversationId: string | null
  createdAt: number
  updatedAt: number
}

// Legacy shape preserved for the in-flight UI + IPC handlers. `id` is
// the rowid of the mirror row (or a synthesized monotonic id under the
// memory fallback) so the legacy `memory:update(id)` / `delete(id)`
// paths can still address a specific entry.
export interface LegacyMemoryEntry {
  id: number
  content: string
  createdAt: number
  updatedAt: number
  sourceConversationId?: string
  // New optional surface so callers that *can* read the typed shape
  // (post-D3 UI, tools tagged for typed memory) get the type/name
  // without forcing the legacy callers to migrate.
  name?: string
  description?: string
  type?: MemoryType
  projectSlug?: string
  filePath?: string
}

let baseDirCache: string | null = null
let watcher: FSWatcher | null = null
let initialized = false

// In-memory mirror keyed by name. Populated by scanAndSync on every
// list/read, regardless of whether the DB path is available — so the
// fallback path is always primed with the latest on-disk state.
const memoryMirror = new Map<string, MemoryFile>()
const memoryRowIds = new Map<string, number>()
let nextMemoryRowId = 1

let useFallback = false
function activateFallback(reason: string): void {
  if (!useFallback) {
    useFallback = true
    console.warn(`[memory-store] SQLite mirror unavailable, falling back to memory: ${reason}`)
  }
}

function memoryBaseDir(): string {
  if (baseDirCache) return baseDirCache
  baseDirCache = join(app.getPath('userData'), 'lamprey-memory')
  return baseDirCache
}

function projectDir(projectSlug: string): string {
  const base = memoryBaseDir()
  return join(base, projectSlug)
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function isMemoryFile(name: string): boolean {
  return name.toLowerCase().endsWith('.md') && !name.toLowerCase().startsWith('memory.')
}

function listProjectSlugs(): string[] {
  const base = memoryBaseDir()
  ensureDir(base)
  const out: string[] = []
  for (const entry of readdirSync(base)) {
    const full = join(base, entry)
    try {
      if (statSync(full).isDirectory()) out.push(entry)
    } catch {
      // ignore dangling entries
    }
  }
  if (out.length === 0) {
    ensureDir(projectDir(DEFAULT_PROJECT_SLUG))
    out.push(DEFAULT_PROJECT_SLUG)
  }
  return out
}

function parseFile(filePath: string, projectSlug: string): MemoryFile | null {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const fallbackName = basename(filePath, '.md')
    const parsed = parseMemoryMarkdown(raw, fallbackName)
    const stats = statSync(filePath)
    return {
      name: parsed.name,
      projectSlug,
      description: parsed.description,
      type: parsed.type,
      body: parsed.body,
      filePath,
      sourceConversationId: null,
      createdAt: Math.floor(stats.birthtimeMs || stats.ctimeMs || Date.now()),
      updatedAt: Math.floor(stats.mtimeMs || Date.now())
    }
  } catch (err) {
    console.error('[memory-store] failed to parse file', filePath, err)
    return null
  }
}

function rememberRowId(name: string): number {
  let id = memoryRowIds.get(name)
  if (id !== undefined) return id
  id = nextMemoryRowId++
  memoryRowIds.set(name, id)
  return id
}

function upsertIndexRow(file: MemoryFile): void {
  memoryMirror.set(file.name, file)
  rememberRowId(file.name)
  if (useFallback) return
  try {
    const db = getDb()
    db.prepare(
      `INSERT INTO memory_index
         (name, project_slug, type, description, body, source_conversation_id,
          file_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         project_slug = excluded.project_slug,
         type         = excluded.type,
         description  = excluded.description,
         body         = excluded.body,
         file_path    = excluded.file_path,
         updated_at   = excluded.updated_at`
    ).run(
      file.name,
      file.projectSlug,
      file.type,
      file.description,
      file.body,
      file.sourceConversationId,
      file.filePath,
      file.createdAt,
      file.updatedAt
    )
  } catch (err) {
    activateFallback((err as Error)?.message ?? 'unknown')
  }
}

function deleteIndexRowByName(name: string): void {
  memoryMirror.delete(name)
  memoryRowIds.delete(name)
  if (useFallback) return
  try {
    const db = getDb()
    db.prepare('DELETE FROM memory_index WHERE name = ?').run(name)
  } catch (err) {
    activateFallback((err as Error)?.message ?? 'unknown')
  }
}

function deleteIndexRowByFilePath(filePath: string): void {
  const resolved = resolve(filePath)
  for (const [name, file] of memoryMirror) {
    if (file.filePath === resolved) {
      memoryMirror.delete(name)
      memoryRowIds.delete(name)
      break
    }
  }
  if (useFallback) return
  try {
    const db = getDb()
    db.prepare('DELETE FROM memory_index WHERE file_path = ?').run(resolved)
  } catch (err) {
    activateFallback((err as Error)?.message ?? 'unknown')
  }
}

function scanAndSync(): void {
  const seen = new Set<string>()
  for (const slug of listProjectSlugs()) {
    const dir = projectDir(slug)
    ensureDir(dir)
    for (const entry of readdirSync(dir)) {
      if (!isMemoryFile(entry)) continue
      const full = join(dir, entry)
      let stats
      try {
        stats = statSync(full)
      } catch {
        continue
      }
      if (!stats.isFile()) continue
      const file = parseFile(full, slug)
      if (!file) continue
      file.filePath = resolve(full)
      upsertIndexRow(file)
      seen.add(file.name)
    }
  }

  // Drop mirror entries whose backing file is gone.
  const stale: string[] = []
  for (const name of memoryMirror.keys()) {
    if (!seen.has(name)) stale.push(name)
  }
  for (const name of stale) deleteIndexRowByName(name)
}

function broadcastChange(): void {
  // The memory index is regenerated as part of the broadcast so a single
  // write touches both the renderer cache and the on-disk MEMORY.md
  // (which the system-prompt builder pulls on every chat turn).
  try {
    regenerateMemoryIndexAllProjects()
  } catch (err) {
    console.error('[memory-store] index regen failed:', (err as Error).message)
  }
  const list = listMemoryFiles()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('memory:changed', list)
  }
}

// ───────────────────────────────────────────────────────────────────────
// D2 — MEMORY.md always-loaded index + [[link]] graph
// ───────────────────────────────────────────────────────────────────────

function memoryIndexPath(projectSlug: string = DEFAULT_PROJECT_SLUG): string {
  return join(projectDir(projectSlug), MEMORY_INDEX_FILENAME)
}

function indexLineFor(file: MemoryFile): string {
  // Mirror the format used in the user's hand-authored MEMORY.md
  // (CLAUDE.md memory section):
  //   - [Title](slug.md) — one-line hook
  // Falls back to the slug when no description is present so the user
  // still gets a clickable file pointer.
  const fileName = `${file.name}.md`
  const title = file.description?.trim() || file.name
  const hook = file.description?.trim() || `${file.type} memory`
  return `- [${title}](${fileName}) — ${hook}`
}

/**
 * Write `MEMORY.md` for a single project. The file is a 1-line-per-entry
 * index of every memory in that project, capped at MEMORY_INDEX_MAX_LINES
 * (matches the system-prompt truncation so the on-disk index and the
 * injected `<memory_index>` block stay consistent).
 */
export function regenerateMemoryIndex(
  projectSlug: string = DEFAULT_PROJECT_SLUG
): string {
  const dir = projectDir(projectSlug)
  ensureDir(dir)
  // Don't fire scanAndSync here — broadcastChange's callers already drove
  // a write/delete that populated the in-memory mirror, and re-scanning
  // would pull *this* MEMORY.md (it's filtered by isMemoryFile, so
  // actually it can't — but skipping the scan keeps regen cheap).
  const files = listFromMirror({ projectSlug })
  // Stable sort: type first (so user/feedback/project/reference group
  // visually), then by description/name. This keeps the index diff-stable
  // across small edits.
  files.sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type)
    const left = (a.description || a.name).toLowerCase()
    const right = (b.description || b.name).toLowerCase()
    return left.localeCompare(right)
  })
  const lines = files.slice(0, MEMORY_INDEX_MAX_LINES).map(indexLineFor)
  const truncated = files.length > MEMORY_INDEX_MAX_LINES
  const body =
    lines.length === 0
      ? '# Memory index\n\n_(no memories yet)_\n'
      : `# Memory index\n\n${lines.join('\n')}\n${
          truncated ? `\n_(+ ${files.length - MEMORY_INDEX_MAX_LINES} more)_\n` : ''
        }`
  const path = memoryIndexPath(projectSlug)
  writeFileSync(path, body, 'utf-8')
  return body
}

function regenerateMemoryIndexAllProjects(): void {
  // Collect slugs from both the mirror and the FS so a project that
  // has no entries left (everything deleted) still gets its MEMORY.md
  // collapsed back to the empty-state placeholder.
  const slugs = new Set<string>([DEFAULT_PROJECT_SLUG])
  for (const file of memoryMirror.values()) slugs.add(file.projectSlug)
  for (const slug of listProjectSlugs()) slugs.add(slug)
  for (const slug of slugs) {
    try {
      regenerateMemoryIndex(slug)
    } catch (err) {
      console.error(
        `[memory-store] regenerate MEMORY.md failed for ${slug}:`,
        (err as Error).message
      )
    }
  }
}

/**
 * Read the on-disk MEMORY.md for a project, returning the raw text.
 * Returns an empty string when no index exists yet. The system-prompt
 * builder calls this on every chat turn to inject the `<memory_index>`
 * block.
 */
export function loadMemoryIndex(
  projectSlug: string = DEFAULT_PROJECT_SLUG
): string {
  const path = memoryIndexPath(projectSlug)
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf-8')
  } catch (err) {
    console.error('[memory-store] loadMemoryIndex failed:', (err as Error).message)
    return ''
  }
}

/**
 * Build the `<memory_index>` system-prompt block for a project. Returns
 * an empty string when the index would be empty so chat.ts can skip the
 * block entirely (rather than emit a noisy empty tag).
 */
export function buildMemoryIndexBlock(
  projectSlug: string = DEFAULT_PROJECT_SLUG
): string {
  const raw = loadMemoryIndex(projectSlug)
  const trimmed = raw.trim()
  if (!trimmed || /\(no memories yet\)/i.test(trimmed)) return ''
  // Cap the injected payload at MEMORY_INDEX_MAX_LINES so a corrupted /
  // unexpectedly long MEMORY.md (e.g. user pasted notes) can't blow up
  // the prompt budget.
  const lines = trimmed.split('\n').slice(0, MEMORY_INDEX_MAX_LINES + 4) // header + spacer + lines
  return `<memory_index>\n${lines.join('\n')}\n</memory_index>`
}

export interface BrokenMemoryLink {
  from: string
  fromFilePath: string
  target: string
}

function extractLinks(body: string): string[] {
  const out = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = MEMORY_LINK_RE.exec(body)) !== null) {
    const cleaned = m[1].trim()
    if (cleaned) out.add(cleaned)
  }
  return [...out]
}

/**
 * Scan every memory body for `[[link-name]]` markers and return the
 * ones whose target slug has no matching file. D3's MemoryLinkGraph
 * surfaces these as "to-write" pips so the user can convert a casual
 * cross-reference into a real entry.
 */
export function getBrokenMemoryLinks(
  projectSlug: string = DEFAULT_PROJECT_SLUG
): BrokenMemoryLink[] {
  scanAndSync()
  const files = listFromMirror({ projectSlug })
  const knownSlugs = new Set(files.map((f) => f.name))
  const out: BrokenMemoryLink[] = []
  for (const file of files) {
    for (const raw of extractLinks(file.body)) {
      const target = memorySlug(raw)
      if (target === file.name) continue
      if (knownSlugs.has(target)) continue
      out.push({ from: file.name, fromFilePath: file.filePath, target })
    }
  }
  return out
}

function migrateLegacyEntries(): void {
  const base = memoryBaseDir()
  const markerPath = join(base, MIGRATION_MARKER)
  if (existsSync(markerPath)) return

  let rows: { id: number; content: string; created_at: number; updated_at: number; source_conversation_id: string | null }[] = []
  try {
    const db = getDb()
    rows = db.prepare(
      'SELECT id, content, created_at, updated_at, source_conversation_id FROM memory_entries ORDER BY id ASC'
    ).all() as any
  } catch (err) {
    // No legacy table available — either a fresh install or test env
    // without the SQLite binding. Either way, mark migration as done
    // so we don't keep trying on every boot.
    console.warn('[memory-store] legacy migration skipped:', (err as Error).message)
  }

  const targetDir = projectDir(DEFAULT_PROJECT_SLUG)
  ensureDir(targetDir)

  for (const row of rows) {
    const firstLine = (row.content.split('\n')[0] || '').trim()
    const baseName = firstLine ? memorySlug(firstLine) : `migrated_${row.id}`
    const fileName = `${baseName}__${row.id}`
    const filePath = join(targetDir, `${fileName}.md`)
    if (existsSync(filePath)) continue
    const description = firstLine.length > 120 ? firstLine.slice(0, 117) + '…' : firstLine
    const markdown = serializeMemoryMarkdown({
      name: fileName,
      description,
      type: 'project',
      body: row.content
    })
    try {
      writeFileSync(filePath, markdown, 'utf-8')
    } catch (err) {
      console.error('[memory-store] migrate write failed', filePath, err)
    }
  }

  try {
    writeFileSync(markerPath, new Date().toISOString(), 'utf-8')
  } catch (err) {
    console.error('[memory-store] failed to write migration marker', err)
  }
}

export function initializeMemoryStore(): void {
  if (initialized) return
  initialized = true

  const base = memoryBaseDir()
  ensureDir(base)
  ensureDir(projectDir(DEFAULT_PROJECT_SLUG))

  migrateLegacyEntries()
  scanAndSync()

  watcher = chokidar.watch(base, {
    ignoreInitial: true,
    persistent: true,
    ignored: (p) => basename(p).startsWith('.'),
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
  })

  const onAddOrChange = (filePath: string) => {
    if (!isMemoryFile(basename(filePath))) return
    const slug = guessProjectSlugFromPath(filePath)
    if (!slug) return
    const file = parseFile(filePath, slug)
    if (!file) return
    file.filePath = resolve(filePath)
    upsertIndexRow(file)
    broadcastChange()
  }

  const onUnlink = (filePath: string) => {
    if (!isMemoryFile(basename(filePath))) return
    deleteIndexRowByFilePath(filePath)
    broadcastChange()
  }

  watcher.on('add', onAddOrChange)
  watcher.on('change', onAddOrChange)
  watcher.on('unlink', onUnlink)
  watcher.on('error', (err) => console.error('[memory-store] watcher error:', err))

  console.log(`[memory-store] watching ${base}`)
}

export function shutdownMemoryStore(): void {
  if (watcher) {
    watcher.close().catch(() => {})
    watcher = null
  }
  initialized = false
}

function guessProjectSlugFromPath(filePath: string): string | null {
  const base = memoryBaseDir()
  const rel = resolve(filePath).slice(resolve(base).length).replace(/^[\\/]+/, '')
  const parts = rel.split(/[\\/]+/).filter(Boolean)
  if (parts.length < 2) return null
  return parts[0]
}

// ───────────────────────────────────────────────────────────────────────
// Typed file-backed API (new in D1)
// ───────────────────────────────────────────────────────────────────────

function rowToMemoryFile(row: any): MemoryFile {
  return {
    name: row.name,
    projectSlug: row.project_slug,
    description: row.description,
    type: row.type,
    body: row.body,
    filePath: row.file_path,
    sourceConversationId: row.source_conversation_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export interface MemoryListFilter {
  type?: MemoryType
  projectSlug?: string
}

function listFromMirror(filter?: MemoryListFilter): MemoryFile[] {
  const out: MemoryFile[] = []
  for (const file of memoryMirror.values()) {
    if (filter?.type && file.type !== filter.type) continue
    if (filter?.projectSlug && file.projectSlug !== filter.projectSlug) continue
    out.push({ ...file })
  }
  return out.sort((a, b) => (b.updatedAt - a.updatedAt) || a.name.localeCompare(b.name))
}

export function listMemoryFiles(filter?: MemoryListFilter): MemoryFile[] {
  // Re-scan on each list so external edits show up even if chokidar
  // hasn't fired yet (tests bypass the watcher; production code calls
  // are still in the microsecond range because the dir is small).
  scanAndSync()
  if (useFallback) return listFromMirror(filter)
  try {
    const db = getDb()
    const where: string[] = []
    const params: any[] = []
    if (filter?.type) {
      where.push('type = ?')
      params.push(filter.type)
    }
    if (filter?.projectSlug) {
      where.push('project_slug = ?')
      params.push(filter.projectSlug)
    }
    const sql =
      'SELECT * FROM memory_index' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY updated_at DESC, name ASC'
    return (db.prepare(sql).all(...params) as any[]).map(rowToMemoryFile)
  } catch (err) {
    activateFallback((err as Error)?.message ?? 'unknown')
    return listFromMirror(filter)
  }
}

export function readMemoryFile(name: string): MemoryFile | null {
  scanAndSync()
  if (useFallback) {
    const found = memoryMirror.get(name)
    return found ? { ...found } : null
  }
  try {
    const db = getDb()
    const row = db.prepare('SELECT * FROM memory_index WHERE name = ?').get(name) as any
    return row ? rowToMemoryFile(row) : null
  } catch (err) {
    activateFallback((err as Error)?.message ?? 'unknown')
    const found = memoryMirror.get(name)
    return found ? { ...found } : null
  }
}

export function writeMemoryFile(input: MemoryWriteInput & {
  projectSlug?: string
  sourceConversationId?: string | null
}): MemoryFile {
  const projectSlug = input.projectSlug?.trim() || DEFAULT_PROJECT_SLUG
  const dir = projectDir(projectSlug)
  ensureDir(dir)

  const slug = memorySlug(input.name)
  const finalName = slug
  const filePath = join(dir, `${slug}.md`)
  const markdown = serializeMemoryMarkdown({
    name: finalName,
    description: input.description ?? '',
    type: input.type,
    body: input.body
  })
  writeFileSync(filePath, markdown, 'utf-8')

  const stats = statSync(filePath)
  const file: MemoryFile = {
    name: finalName,
    projectSlug,
    description: (input.description ?? '').trim(),
    type: input.type,
    body: input.body.trim(),
    filePath: resolve(filePath),
    sourceConversationId: input.sourceConversationId ?? null,
    createdAt: Math.floor(stats.birthtimeMs || stats.ctimeMs || Date.now()),
    updatedAt: Math.floor(stats.mtimeMs || Date.now())
  }
  upsertIndexRow(file)
  broadcastChange()
  return file
}

export function deleteMemoryFile(name: string): boolean {
  const existing = memoryMirror.get(name)
  if (!existing) {
    // Fall through to DB lookup for the edge case where the mirror is
    // out of sync (e.g. the watcher hasn't picked up an external edit).
    if (!useFallback) {
      try {
        const db = getDb()
        const row = db.prepare('SELECT file_path FROM memory_index WHERE name = ?').get(name) as
          | { file_path: string }
          | undefined
        if (!row) return false
        if (existsSync(row.file_path)) unlinkSync(row.file_path)
        deleteIndexRowByName(name)
        broadcastChange()
        return true
      } catch (err) {
        activateFallback((err as Error)?.message ?? 'unknown')
      }
    }
    return false
  }
  try {
    if (existsSync(existing.filePath)) unlinkSync(existing.filePath)
  } catch (err) {
    console.error('[memory-store] delete unlink failed', existing.filePath, err)
  }
  deleteIndexRowByName(name)
  broadcastChange()
  return true
}

export function searchMemoryFiles(query: string, limit = 50): MemoryFile[] {
  const q = query.trim()
  if (!q) return []
  scanAndSync()

  const fallbackSearch = (): MemoryFile[] => {
    const lc = q.toLowerCase()
    const out: MemoryFile[] = []
    for (const file of memoryMirror.values()) {
      const hay = `${file.name}\n${file.description}\n${file.body}`.toLowerCase()
      if (hay.includes(lc)) out.push({ ...file })
    }
    return out
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
  }

  if (useFallback) return fallbackSearch()

  try {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT memory_index.*
         FROM memory_index_fts
         JOIN memory_index ON memory_index.rowid = memory_index_fts.rowid
         WHERE memory_index_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(q, limit) as any[]
    return rows.map(rowToMemoryFile)
  } catch (err) {
    console.warn('[memory-store] FTS query failed, falling back:', (err as Error).message)
    if (!useFallback) activateFallback((err as Error)?.message ?? 'unknown')
    return fallbackSearch()
  }
}

// ───────────────────────────────────────────────────────────────────────
// Legacy back-compat surface (preserves the pre-D1 IPC contract)
// ───────────────────────────────────────────────────────────────────────
//
// D3 rebuilds the renderer panel and stops calling these. Until then,
// the legacy MemoryPanel keeps working: each legacy memory becomes a
// file with `type: project` and an auto-generated name. The numeric
// `id` exposed to the renderer is the rowid of the mirror row (or a
// synthesized monotonic id under the memory fallback) so update /
// delete by id still target a specific file.

function pickAutoName(content: string): string {
  const firstLine = (content.split('\n')[0] || '').trim()
  const slug = firstLine ? memorySlug(firstLine) : 'memory'
  let candidate = slug
  let suffix = 1
  while (memoryMirror.has(candidate) || existsSync(join(projectDir(DEFAULT_PROJECT_SLUG), `${candidate}.md`))) {
    suffix += 1
    candidate = `${slug}_${suffix}`
  }
  return candidate
}

function fileToLegacyEntry(file: MemoryFile): LegacyMemoryEntry {
  return {
    id: rememberRowId(file.name),
    content: file.body,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    sourceConversationId: file.sourceConversationId ?? undefined,
    name: file.name,
    description: file.description,
    type: file.type,
    projectSlug: file.projectSlug,
    filePath: file.filePath
  }
}

export function listMemories(): LegacyMemoryEntry[] {
  const files = listMemoryFiles()
  return files
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(fileToLegacyEntry)
}

export function addMemory(content: string, sourceConversationId?: string): LegacyMemoryEntry {
  const name = pickAutoName(content)
  const description = (content.split('\n')[0] || '').trim().slice(0, 120)
  const file = writeMemoryFile({
    name,
    description,
    type: 'project',
    body: content,
    sourceConversationId: sourceConversationId ?? null
  })
  return fileToLegacyEntry(file)
}

function findFileByLegacyId(id: number): MemoryFile | null {
  for (const [name, rowId] of memoryRowIds) {
    if (rowId === id) {
      const file = memoryMirror.get(name)
      if (file) return file
    }
  }
  return null
}

export function updateMemory(id: number, content: string): LegacyMemoryEntry | null {
  const existing = findFileByLegacyId(id)
  if (!existing) return null
  const description = (content.split('\n')[0] || '').trim().slice(0, 120)
  const updated = writeMemoryFile({
    name: existing.name,
    description: description || existing.description,
    type: existing.type,
    body: content,
    projectSlug: existing.projectSlug,
    sourceConversationId: existing.sourceConversationId ?? null
  })
  return fileToLegacyEntry(updated)
}

export function deleteMemory(id: number): void {
  const existing = findFileByLegacyId(id)
  if (!existing) return
  deleteMemoryFile(existing.name)
}

export function clearAllMemories(): void {
  const files = listMemoryFiles()
  for (const file of files) {
    try {
      if (existsSync(file.filePath)) unlinkSync(file.filePath)
    } catch (err) {
      console.error('[memory-store] clearAll unlink failed', file.filePath, err)
    }
  }
  memoryMirror.clear()
  memoryRowIds.clear()
  if (!useFallback) {
    try {
      const db = getDb()
      db.prepare('DELETE FROM memory_index').run()
    } catch (err) {
      activateFallback((err as Error)?.message ?? 'unknown')
    }
  }
  broadcastChange()
}

export interface ExportEntry {
  name: string
  description: string
  type: MemoryType
  projectSlug: string
  body: string
  createdAt: number
  updatedAt: number
}

export function exportMemories(): string {
  const files = listMemoryFiles()
  const out: ExportEntry[] = files.map((f) => ({
    name: f.name,
    description: f.description,
    type: f.type,
    projectSlug: f.projectSlug,
    body: f.body,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt
  }))
  return JSON.stringify(out, null, 2)
}

export function importMemories(
  entries:
    | ExportEntry[]
    | { content: string; sourceConversationId?: string | null }[]
): void {
  for (const raw of entries) {
    if ((raw as ExportEntry).body !== undefined && (raw as ExportEntry).name) {
      const entry = raw as ExportEntry
      writeMemoryFile({
        name: entry.name,
        description: entry.description ?? '',
        type: entry.type ?? 'project',
        body: entry.body,
        projectSlug: entry.projectSlug ?? DEFAULT_PROJECT_SLUG
      })
    } else if ((raw as { content: string }).content !== undefined) {
      const legacy = raw as { content: string; sourceConversationId?: string | null }
      addMemory(legacy.content, legacy.sourceConversationId ?? undefined)
    }
  }
}

// Old single `<memory>` block consumed by the system-prompt builder.
// D2 will introduce the `<memory_index>` block alongside this; for now
// we render the body of every memory file in stable order so the
// existing chat path keeps surfacing the same content.
export function buildMemoryBlock(): string {
  const entries = listMemories()
  if (entries.length === 0) return ''
  const lines = entries.map((e, i) => `${i + 1}. ${e.content}`)
  return `<memory>\n${lines.join('\n')}\n</memory>`
}

// Test hook — lets unit tests force re-init against a stubbed userData
// directory without leaking watchers between cases.
export const __memoryStoreTest = {
  resetForTests: (): void => {
    if (watcher) {
      watcher.close().catch(() => {})
      watcher = null
    }
    initialized = false
    baseDirCache = null
    memoryMirror.clear()
    memoryRowIds.clear()
    nextMemoryRowId = 1
    useFallback = false
  },
  forceFallback: (): void => {
    useFallback = true
  },
  isUsingFallback: (): boolean => useFallback,
  memoryBaseDir,
  projectDir,
  scanAndSync,
  DEFAULT_PROJECT_SLUG
}
