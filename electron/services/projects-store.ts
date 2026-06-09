import { randomUUID } from 'crypto'
import { getDb } from './database'
import { recordEvent, type EventType } from './event-log'

export interface ProjectRow {
  id: string
  name: string
  slug: string
  path: string | null
  description: string | null
  pinned: number
  archived: number
  created_at: number
  updated_at: number
  last_activity_at: number
  last_opened_at: number | null
}

export interface Project {
  id: string
  name: string
  slug: string
  path: string | null
  description: string | null
  pinned: boolean
  archived: boolean
  createdAt: number
  updatedAt: number
  lastActivityAt: number
  lastOpenedAt: number | null
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    path: row.path,
    description: row.description,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
    lastOpenedAt: row.last_opened_at
  }
}

export function listProjects(includeArchived = false): Project[] {
  const db = getDb()
  const rows = (
    includeArchived
      ? db.prepare('SELECT * FROM projects ORDER BY pinned DESC, last_activity_at DESC').all()
      : db
          .prepare(
            'SELECT * FROM projects WHERE archived = 0 ORDER BY pinned DESC, last_activity_at DESC'
          )
          .all()
  ) as ProjectRow[]
  return rows.map(rowToProject)
}

export function getProject(id: string): Project | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
    | ProjectRow
    | undefined
  return row ? rowToProject(row) : null
}

export function findProjectByPath(path: string): Project | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as
    | ProjectRow
    | undefined
  return row ? rowToProject(row) : null
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  return slug || 'project'
}

export function createProject(input: { name: string; path?: string | null; description?: string | null }): Project {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  const slug = slugify(input.name)
  db.prepare(
    'INSERT INTO projects (id, name, slug, path, description, pinned, archived, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)'
  ).run(id, input.name, slug, input.path ?? null, input.description ?? null, now, now, now)
  emitProjectEvent('project.created', id, { name: input.name, slug, path: input.path ?? null })
  return {
    id,
    name: input.name,
    slug,
    path: input.path ?? null,
    description: input.description ?? null,
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    lastOpenedAt: null
  }
}

export function renameProject(id: string, name: string): void {
  const db = getDb()
  const slug = slugify(name)
  const now = Date.now()
  db.prepare('UPDATE projects SET name = ?, slug = ?, updated_at = ? WHERE id = ?').run(name, slug, now, id)
  // Renames are noisy bookkeeping (the model can call them mid-turn) and
  // intentionally do NOT emit an event.
}

export function setProjectPinned(id: string, pinned: boolean): void {
  const db = getDb()
  db.prepare('UPDATE projects SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id)
  emitProjectEvent('project.pinned', id, { pinned })
}

export function setProjectArchived(id: string, archived: boolean): void {
  const db = getDb()
  db.prepare('UPDATE projects SET archived = ? WHERE id = ?').run(archived ? 1 : 0, id)
  emitProjectEvent('project.archived', id, { archived })
}

export function deleteProject(id: string): void {
  const db = getDb()
  // Detach conversations from the project rather than deleting them.
  const detachResult = db
    .prepare('UPDATE conversations SET project_id = NULL WHERE project_id = ?')
    .run(id)
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  emitProjectEvent('project.deleted', id, {
    detachedConversations: detachResult.changes
  })
}

export function selectProject(id: string): Project | null {
  const db = getDb()
  const now = Date.now()
  db.prepare('UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
  return getProject(id)
}

export interface UpdateProjectInput {
  name?: string | null
  description?: string | null
  path?: string | null
}

export function updateProject(id: string, patch: UpdateProjectInput): Project | null {
  const existing = getProject(id)
  if (!existing) return null

  const db = getDb()
  const now = Date.now()
  const name = patch.name !== undefined ? (patch.name ?? existing.name) : existing.name
  const description = patch.description !== undefined ? (patch.description ?? existing.description) : existing.description
  const path = patch.path !== undefined ? (patch.path ?? existing.path) : existing.path
  const slug = patch.name !== undefined ? slugify(name) : existing.slug

  db.prepare(
    'UPDATE projects SET name = ?, slug = ?, description = ?, path = ?, updated_at = ? WHERE id = ?'
  ).run(name, slug, description, path, now, id)

  return getProject(id)
}

function emitProjectEvent(
  type: EventType,
  projectId: string,
  extra: Record<string, unknown>
): void {
  try {
    recordEvent({
      type,
      actorKind: 'user',
      projectId,
      entityKind: 'project',
      entityId: projectId,
      payload: {
        projectId,
        ...extra
      }
    })
  } catch (err) {
    console.error(`[projects-store] ${type} event failed:`, err)
  }
}

export function touchProject(id: string): void {
  const db = getDb()
  db.prepare('UPDATE projects SET last_activity_at = ? WHERE id = ?').run(Date.now(), id)
}

/**
 * Get or create a project rooted at the given path. Used to auto-bucket
 * worktree-tagged conversations without forcing the user to pre-create the
 * project entry by hand.
 */
export function ensureProjectForPath(path: string, fallbackName?: string): Project {
  const existing = findProjectByPath(path)
  if (existing) {
    if (existing.archived) setProjectArchived(existing.id, false)
    return existing
  }
  const name = fallbackName ?? deriveProjectName(path)
  return createProject({ name, path })
}

function deriveProjectName(p: string): string {
  if (!p) return 'Project'
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}
