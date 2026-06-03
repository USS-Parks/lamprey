import { getDb } from './database'
import type { GitHubProjectRepoLink, GitHubRepository } from './github-types'

interface RepoLinkRow {
  project_id: string
  repo_id: number
  full_name: string
  owner: string
  name: string
  default_branch: string
  html_url: string
  clone_url: string
  local_path: string | null
  linked_at: number
}

function rowToLink(row: RepoLinkRow): GitHubProjectRepoLink {
  return {
    projectId: row.project_id,
    repoId: row.repo_id,
    fullName: row.full_name,
    owner: row.owner,
    name: row.name,
    defaultBranch: row.default_branch,
    htmlUrl: row.html_url,
    cloneUrl: row.clone_url,
    localPath: row.local_path,
    linkedAt: row.linked_at
  }
}

export function getRepoLinkForProject(projectId: string): GitHubProjectRepoLink | null {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM project_github_repos WHERE project_id = ?')
    .get(projectId) as RepoLinkRow | undefined
  return row ? rowToLink(row) : null
}

export function findProjectIdForRepo(fullName: string): string | null {
  const db = getDb()
  const row = db
    .prepare('SELECT project_id FROM project_github_repos WHERE full_name = ?')
    .get(fullName) as { project_id: string } | undefined
  return row ? row.project_id : null
}

export interface UpsertRepoLinkInput {
  projectId: string
  repo: GitHubRepository
  localPath?: string | null
}

export function upsertRepoLink(input: UpsertRepoLinkInput): GitHubProjectRepoLink {
  const db = getDb()
  const now = Date.now()
  db.prepare(
    `INSERT INTO project_github_repos (
       project_id, repo_id, full_name, owner, name, default_branch,
       html_url, clone_url, local_path, linked_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       repo_id = excluded.repo_id,
       full_name = excluded.full_name,
       owner = excluded.owner,
       name = excluded.name,
       default_branch = excluded.default_branch,
       html_url = excluded.html_url,
       clone_url = excluded.clone_url,
       local_path = COALESCE(excluded.local_path, project_github_repos.local_path),
       linked_at = excluded.linked_at`
  ).run(
    input.projectId,
    input.repo.id,
    input.repo.fullName,
    input.repo.owner,
    input.repo.name,
    input.repo.defaultBranch,
    input.repo.htmlUrl,
    input.repo.cloneUrl,
    input.localPath ?? null,
    now
  )
  const stored = getRepoLinkForProject(input.projectId)
  if (!stored) throw new Error('Repo link persistence failed')
  return stored
}

export function setRepoLinkLocalPath(projectId: string, localPath: string | null): void {
  const db = getDb()
  db.prepare('UPDATE project_github_repos SET local_path = ? WHERE project_id = ?').run(
    localPath,
    projectId
  )
}

export function unlinkRepoFromProject(projectId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM project_github_repos WHERE project_id = ?').run(projectId)
}

export interface ConversationPullRequestLink {
  conversationId: string
  prNumber: number
  fullName: string
  htmlUrl: string
  title: string
  createdAt: number
}

export function linkPullRequestToConversation(input: ConversationPullRequestLink): void {
  const db = getDb()
  db.prepare(
    `INSERT OR IGNORE INTO conversation_pull_requests (
       conversation_id, pr_number, full_name, html_url, title, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    input.conversationId,
    input.prNumber,
    input.fullName,
    input.htmlUrl,
    input.title,
    input.createdAt
  )
}

export function listPullRequestsForConversation(
  conversationId: string
): ConversationPullRequestLink[] {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT * FROM conversation_pull_requests WHERE conversation_id = ? ORDER BY created_at DESC'
    )
    .all(conversationId) as Array<{
      conversation_id: string
      pr_number: number
      full_name: string
      html_url: string
      title: string
      created_at: number
    }>
  return rows.map((r) => ({
    conversationId: r.conversation_id,
    prNumber: r.pr_number,
    fullName: r.full_name,
    htmlUrl: r.html_url,
    title: r.title,
    createdAt: r.created_at
  }))
}
