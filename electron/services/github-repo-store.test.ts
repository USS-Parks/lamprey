import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The migrations that create the GitHub-integration tables live in
// `electron/services/database.ts` and run as side effects of `getDb()`.
// We can't open a real sqlite handle in vitest (the better-sqlite3 native
// module is built against Electron's Node ABI, not system Node — the same
// reason every other DB-touching test in this repo uses an in-memory
// fallback path instead of the real DB).
//
// Instead this test treats the migration SQL as a contract: the DDL
// strings for `project_github_repos` and `conversation_pull_requests`
// must be present and must include every column the github-repo-store
// reads or writes. That catches:
//   - someone deleting the migration entirely
//   - someone renaming a column or dropping one
// Integration concerns (the DDL actually executes, the FK cascade fires,
// COALESCE behaves) are covered by `npm run smoke:bundle` at boot in
// CI — the first `getDb()` call evaluates these statements for real.

const DB_SOURCE = readFileSync(
  join(__dirname, 'database.ts'),
  'utf-8'
)

describe('database.ts migration — project_github_repos', () => {
  it('keeps the CREATE TABLE statement', () => {
    expect(DB_SOURCE).toMatch(/CREATE TABLE IF NOT EXISTS project_github_repos/)
  })

  it.each([
    'project_id',
    'repo_id',
    'full_name',
    'owner',
    'name',
    'default_branch',
    'html_url',
    'clone_url',
    'local_path',
    'linked_at'
  ])('declares the %s column', (col) => {
    // Match the column name as a whole word in the migration block so a
    // mention elsewhere in database.ts doesn't accidentally satisfy this.
    const re = new RegExp(`CREATE TABLE IF NOT EXISTS project_github_repos[\\s\\S]*?\\b${col}\\b[\\s\\S]*?\\);`, 'm')
    expect(DB_SOURCE).toMatch(re)
  })

  it('keeps ON DELETE CASCADE on the projects foreign key', () => {
    expect(DB_SOURCE).toMatch(
      /project_id TEXT PRIMARY KEY REFERENCES projects\(id\) ON DELETE CASCADE/
    )
  })

  it('keeps the helper index idx_project_github_repos_full_name', () => {
    expect(DB_SOURCE).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_project_github_repos_full_name/
    )
  })
})

describe('database.ts migration — conversation_pull_requests', () => {
  it('keeps the CREATE TABLE statement', () => {
    expect(DB_SOURCE).toMatch(/CREATE TABLE IF NOT EXISTS conversation_pull_requests/)
  })

  it.each([
    'conversation_id',
    'pr_number',
    'full_name',
    'html_url',
    'title',
    'created_at'
  ])('declares the %s column', (col) => {
    const re = new RegExp(`CREATE TABLE IF NOT EXISTS conversation_pull_requests[\\s\\S]*?\\b${col}\\b[\\s\\S]*?\\);`, 'm')
    expect(DB_SOURCE).toMatch(re)
  })

  it('cascades on conversation deletion (FK)', () => {
    expect(DB_SOURCE).toMatch(
      /conversation_id TEXT NOT NULL REFERENCES conversations\(id\) ON DELETE CASCADE/
    )
  })

  it('uses a composite primary key so re-link is idempotent', () => {
    expect(DB_SOURCE).toMatch(
      /PRIMARY KEY \(conversation_id, full_name, pr_number\)/
    )
  })
})
