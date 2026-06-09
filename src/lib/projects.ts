import type { Project } from './types'

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateProjectInput {
  name: string
  path?: string | null
  description?: string | null
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ProjectValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Trim, collapse internal whitespace, and remove leading/trailing junk.
 */
export function normalizeProjectName(name: string): string {
  return name.replace(/\s+/g, ' ').trim()
}

/**
 * Generate a URL-safe slug from a project name:
 * - lowercase
 * - non‑alphanumeric → hyphen
 * - collapse runs of hyphens
 * - strip leading/trailing hyphens
 * - fallback to "project" for degenerate input
 */
export function slugifyProjectName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  return slug || 'project'
}

/**
 * Validate input fields against existing projects.
 * Duplicate detection is case‑insensitive on the normalized name.
 */
export function validateCreateProjectInput(
  input: CreateProjectInput,
  existingProjects: Project[]
): ProjectValidationResult {
  const errors: string[] = []

  const name = normalizeProjectName(input.name)
  if (!name) {
    errors.push('Project name cannot be empty.')
  } else if (name.length > 128) {
    errors.push('Project name must be 128 characters or fewer.')
  }

  if (name) {
    const duplicate = existingProjects.find(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    )
    if (duplicate) {
      errors.push(`A project named "${duplicate.name}" already exists.`)
    }
  }

  if (input.path !== undefined && input.path !== null && typeof input.path !== 'string') {
    errors.push('Project path must be a string or empty.')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Minimal ISO‑8601 timestamp helper (UTC).
 */
export function nowIso(): string {
  return new Date().toISOString()
}
