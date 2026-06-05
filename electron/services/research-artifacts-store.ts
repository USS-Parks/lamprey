import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

// In-memory manifest of research artifacts on disk.
//
// On init the store scans `userData/artifacts/research/*.md` and rebuilds
// the manifest entries from filename + mtime. After that the orchestrator
// `registerArtifact()`s each new run so the renderer can list / open /
// download without re-scanning the directory.
//
// We deliberately do NOT use SQLite — the `.md` files on disk are the
// canonical record. The manifest is just a read cache so the renderer
// gets fast metadata. If a user deletes a file in their file manager,
// the next init rebuild picks up the change automatically.

export interface ResearchArtifactEntry {
  runId: string
  filename: string
  path: string
  question: string
  createdAt: number
  sizeBytes: number
}

const FILENAME_RE = /^research-(.+)-(\d+)\.md$/

const manifest = new Map<string, ResearchArtifactEntry>()
let inited = false

function defaultDir(): string {
  return join(app.getPath('userData'), 'artifacts', 'research')
}

/**
 * Idempotent init — scans the on-disk directory once per process and
 * populates the in-memory manifest. Safe to call multiple times.
 */
export function initResearchArtifactStore(dirOverride?: string): void {
  if (inited) return
  inited = true
  const dir = dirOverride ?? defaultDir()
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const m = entry.match(FILENAME_RE)
    if (!m) continue
    const full = join(dir, entry)
    let st
    try { st = statSync(full) } catch { continue }
    const question = m[1].replace(/-/g, ' ')
    const createdAt = Number.parseInt(m[2], 10)
    manifest.set(entry, {
      runId: entry, // filename is the stable key; no separate runId on disk
      filename: entry,
      path: full,
      question,
      createdAt: Number.isFinite(createdAt) ? createdAt : st.mtimeMs,
      sizeBytes: st.size
    })
  }
}

/**
 * Register a freshly-written artifact. Called by the orchestrator after
 * writing the `.md` file.
 */
export function registerArtifact(filename: string, fullPath: string, question: string, sizeBytes: number, createdAt: number): ResearchArtifactEntry {
  const entry: ResearchArtifactEntry = {
    runId: filename,
    filename,
    path: fullPath,
    question,
    createdAt,
    sizeBytes
  }
  manifest.set(filename, entry)
  return entry
}

export function listResearchArtifacts(): ResearchArtifactEntry[] {
  initResearchArtifactStore()
  return Array.from(manifest.values()).sort((a, b) => b.createdAt - a.createdAt)
}

export function readResearchArtifact(filename: string): { entry: ResearchArtifactEntry; content: string } | null {
  initResearchArtifactStore()
  const entry = manifest.get(filename)
  if (!entry) return null
  if (!existsSync(entry.path)) {
    manifest.delete(filename)
    return null
  }
  try {
    const content = readFileSync(entry.path, 'utf-8')
    return { entry, content }
  } catch {
    return null
  }
}

/**
 * Copy a research artifact to a user-chosen path. Returns true on
 * success. Used by the renderer's Download button via the `dialog`
 * save-file flow.
 */
export function downloadResearchArtifact(filename: string, destPath: string): boolean {
  const r = readResearchArtifact(filename)
  if (!r) return false
  const destDir = destPath.slice(0, destPath.lastIndexOf('\\') !== -1 ? destPath.lastIndexOf('\\') : destPath.lastIndexOf('/'))
  if (destDir && !existsSync(destDir)) {
    try { mkdirSync(destDir, { recursive: true }) } catch { /* ignore */ }
  }
  try {
    writeFileSync(destPath, r.content, 'utf-8')
    return true
  } catch {
    return false
  }
}

/** Reset for tests only. */
export function __resetResearchArtifactStore(): void {
  manifest.clear()
  inited = false
}
