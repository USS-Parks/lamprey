import { describe, it, expect } from 'vitest'
import {
  normalizeProjectName,
  slugifyProjectName,
  validateCreateProjectInput
} from './projects'
import type { Project } from './types'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Default Project',
    slug: 'default-project',
    path: null,
    description: null,
    pinned: false,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    lastActivityAt: 1,
    lastOpenedAt: null,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// normalizeProjectName
// ---------------------------------------------------------------------------

describe('normalizeProjectName', () => {
  it('trims leading/trailing whitespace', () => {
    expect(normalizeProjectName('  hello  ')).toBe('hello')
  })

  it('collapses multiple internal spaces', () => {
    expect(normalizeProjectName('hello   world')).toBe('hello world')
  })

  it('returns empty string for whitespace-only', () => {
    expect(normalizeProjectName('   ')).toBe('')
  })

  it('preserves internal content', () => {
    expect(normalizeProjectName('My Project 1')).toBe('My Project 1')
  })
})

// ---------------------------------------------------------------------------
// slugifyProjectName
// ---------------------------------------------------------------------------

describe('slugifyProjectName', () => {
  it('lowercases', () => {
    expect(slugifyProjectName('HELLO')).toBe('hello')
  })

  it('replaces spaces with hyphens', () => {
    expect(slugifyProjectName('hello world')).toBe('hello-world')
  })

  it('replaces special characters with hyphens', () => {
    expect(slugifyProjectName('proj#1 & test')).toBe('proj-1-test')
  })

  it('collapses multiple hyphens', () => {
    expect(slugifyProjectName('a---b')).toBe('a-b')
  })

  it('strips leading/trailing hyphens', () => {
    expect(slugifyProjectName('-hello-')).toBe('hello')
  })

  it('falls back to "project" for empty result', () => {
    expect(slugifyProjectName('---')).toBe('project')
  })

  it('falls back to "project" for empty string', () => {
    expect(slugifyProjectName('')).toBe('project')
  })

  it('preserves numbers', () => {
    expect(slugifyProjectName('test 123')).toBe('test-123')
  })
})

// ---------------------------------------------------------------------------
// validateCreateProjectInput
// ---------------------------------------------------------------------------

describe('validateCreateProjectInput', () => {
  it('rejects empty name', () => {
    const result = validateCreateProjectInput({ name: '' }, [])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Project name cannot be empty.')
  })

  it('rejects whitespace-only name', () => {
    const result = validateCreateProjectInput({ name: '   ' }, [])
    expect(result.valid).toBe(false)
  })

  it('rejects name > 128 characters', () => {
    const result = validateCreateProjectInput({ name: 'a'.repeat(129) }, [])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('128')
  })

  it('accepts valid name', () => {
    const result = validateCreateProjectInput({ name: 'My Project' }, [])
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects duplicate name (case-insensitive)', () => {
    const existing = [makeProject({ name: 'My Project', slug: 'my-project' })]
    const result = validateCreateProjectInput({ name: 'my project' }, existing)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('already exists')
  })

  it('rejects duplicate with different casing', () => {
    const existing = [makeProject({ name: 'My Project' })]
    const result = validateCreateProjectInput({ name: 'MY PROJECT' }, existing)
    expect(result.valid).toBe(false)
  })

  it('accepts non-duplicate name', () => {
    const existing = [makeProject({ name: 'Project A', slug: 'project-a' })]
    const result = validateCreateProjectInput({ name: 'Project B' }, existing)
    expect(result.valid).toBe(true)
  })

  it('rejects invalid path type', () => {
    const result = validateCreateProjectInput(
      { name: 'Test', path: 123 as any },
      []
    )
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('path')
  })

  it('accepts null path', () => {
    const result = validateCreateProjectInput({ name: 'Test', path: null }, [])
    expect(result.valid).toBe(true)
  })

  it('accepts valid path', () => {
    const result = validateCreateProjectInput(
      { name: 'Test', path: '/some/path' },
      []
    )
    expect(result.valid).toBe(true)
  })
})
