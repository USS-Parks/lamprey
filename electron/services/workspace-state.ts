import { existsSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'
import { app } from 'electron'

// Persistent "active workspace" path — the folder the user picked via the
// ChatInput chip. Tool execution (workspace_context, shell_command,
// apply_patch) resolves cwd against this so the model operates on the
// user's chosen directory, not the folder Lamprey itself was launched from.
//
// Stored as a single-line text file under userData so it cannot collide
// with concurrent settings.json read-modify-writes from settings.ts. Read
// is lazy + cached for 1s so a chat round doesn't stat the file per tool
// call. Fallback to process.cwd() when nothing is persisted, the file is
// unreadable, or the persisted path no longer exists.

const FILE_NAME = 'active-workspace.txt'
const CACHE_MS = 1000

let cachedPath: string | null = null
let cachedAt = 0

function statePath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

function isDirectorySafe(absolute: string): boolean {
  try {
    return existsSync(absolute) && statSync(absolute).isDirectory()
  } catch {
    return false
  }
}

export function getActiveWorkspace(): string {
  const now = Date.now()
  if (cachedPath && now - cachedAt < CACHE_MS) return cachedPath
  const p = statePath()
  let persisted: string | null = null
  try {
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf8').trim()
      if (raw.length > 0 && isDirectorySafe(raw)) persisted = resolve(raw)
    }
  } catch {
    // Corrupted file or perms — silently fall back; the file is rewritable.
  }
  cachedPath = persisted ?? process.cwd()
  cachedAt = now
  return cachedPath
}

export function setActiveWorkspace(candidate: string): { path: string } {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new Error('setActiveWorkspace: path must be a non-empty string')
  }
  const absolute = resolve(candidate)
  if (!existsSync(absolute)) {
    throw new Error(`setActiveWorkspace: "${absolute}" does not exist`)
  }
  if (!isDirectorySafe(absolute)) {
    // A file path here would become the cwd for shell_command,
    // apply_patch, and workspace_context — every workspace-relative tool
    // would fail in confusing ways.
    throw new Error(`setActiveWorkspace: "${absolute}" is not a directory`)
  }
  writeFileSync(statePath(), absolute, 'utf8')
  cachedPath = absolute
  cachedAt = Date.now()
  return { path: absolute }
}

export function clearActiveWorkspace(): void {
  try {
    const p = statePath()
    if (existsSync(p)) unlinkSync(p)
  } catch {
    // ignore — caller falls back to process.cwd() via getActiveWorkspace.
  }
  cachedPath = null
  cachedAt = 0
}

/** Test-only: drop the cache so tests can stub the file. */
export function __resetWorkspaceStateCache(): void {
  cachedPath = null
  cachedAt = 0
}
