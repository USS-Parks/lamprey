import { randomUUID } from 'crypto'
import { getDb } from './database'
import { recordEvent, type EventType } from './event-log'

export interface ProjectRow {
  id: string
  name: string
  path: string | null
  pinned: number
  archived: number
  created_at: number
  last_activity_at: number
}

export interface Project {
  id: string
  name: string
  path: string | null
  pinned: boolean
  archived: boolean
  createdAt: number
  lastActivityAt: number
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at
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

export function createProject(input: { name: string; path?: string | null }): Project {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    'INSERT INTO projects (id, name, path, pinned, archived, created_at, last_activity_at) VALUES (?, ?, ?, 0, 0, ?, ?)'
  ).run(id, input.name, input.path ?? null, now, now)
  emitProjectEvent('project.created', id, { name: input.name, path: input.path ?? null })
  return {
    id,
    name: input.name,
    path: input.path ?? null,
    pinned: false,
    archived: false,
    createdAt: now,
    lastActivityAt: now
  }
}

export function renameProject(id: string, name: string): void {
  const db = getDb()
  db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, id)
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
