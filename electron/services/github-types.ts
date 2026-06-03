// GitHub integration types shared between the service, IPC, and renderer.
// Renderer-side mirrors live in src/lib/github-types.ts because the two
// tsconfig roots can't share types directly. Keep these in sync.

export type GitHubAuthMode = 'oauth' | 'github_app' | 'gh-cli' | 'none'

export interface GitHubConnectionStatus {
  connected: boolean
  mode: GitHubAuthMode
  scopes: string[]
  /** Login of the authenticated user/account, when known. */
  login: string | null
  /** Avatar URL of the authenticated user/account, when known. */
  avatarUrl: string | null
  /** Optional installation id when mode === 'github_app'. */
  installationId: number | null
  /** Non-secret status reason for display ("token expired", "client id missing", etc.). */
  reason?: string
}

export interface GitHubViewer {
  login: string
  name: string | null
  avatarUrl: string | null
  htmlUrl: string
}

export interface GitHubRepository {
  id: number
  /** e.g. "octocat/Hello-World" */
  fullName: string
  owner: string
  name: string
  private: boolean
  defaultBranch: string
  htmlUrl: string
  cloneUrl: string
  sshUrl: string
  description: string | null
  /** Lamprey-local: filled in by the IPC layer when a local clone is known. */
  localPath?: string | null
}

export interface GitHubPullRequestRef {
  /** Branch name. */
  ref: string
  /** Commit SHA at the time of PR creation, when known. */
  sha: string | null
  /** "owner:branch" when the head is a fork; null for same-repo PRs. */
  label: string | null
}

export interface GitHubPullRequest {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  draft: boolean
  merged: boolean
  htmlUrl: string
  user: { login: string; avatarUrl: string | null }
  base: GitHubPullRequestRef
  head: GitHubPullRequestRef
  createdAt: string
  updatedAt: string
}

export interface GitHubCompareSummary {
  base: string
  head: string
  status: 'identical' | 'ahead' | 'behind' | 'diverged'
  aheadBy: number
  behindBy: number
  commits: Array<{ sha: string; message: string; author: string | null }>
  files: Array<{ filename: string; additions: number; deletions: number; status: string }>
}

export interface CreatePullRequestInput {
  owner: string
  repo: string
  title: string
  body?: string
  head: string
  base: string
  draft?: boolean
  /** When the head is on a fork, pass "fork-owner:branch". */
  headLabel?: string
}

export interface CloneRepositoryInput {
  owner: string
  repo: string
  targetDir: string
  /** Override clone URL (e.g. SSH). Defaults to https clone URL. */
  cloneUrl?: string
}

export interface PushBranchInput {
  cwd: string
  branch: string
  /** Set upstream to origin/<branch>. Defaults to true. */
  setUpstream?: boolean
  /** Owner/repo to authenticate against (used to refuse tokens for unrelated repos). */
  owner: string
  repo: string
}

export interface GitHubProjectRepoLink {
  projectId: string
  repoId: number
  fullName: string
  owner: string
  name: string
  defaultBranch: string
  htmlUrl: string
  cloneUrl: string
  localPath: string | null
  linkedAt: number
}

/**
 * A token provider abstracts how we obtain a bearer token for REST/git ops.
 * - 'oauth'      → user token from keychain (read once, lifetime managed by user).
 * - 'github_app' → installation token exchanged JIT from app private key + installation id.
 * - 'gh-cli'     → shell out to `gh auth token`.
 *
 * The GitHub App path is intentionally a stub right now — the interface is the
 * stable contract, so a future commit can implement App installation tokens
 * without touching callers.
 */
export interface GitHubTokenProvider {
  readonly mode: GitHubAuthMode
  /** Returns a bearer token, or null when no usable credential is available. */
  getAccessToken(): Promise<string | null>
  /**
   * Returns the user-visible scopes the token was issued with, when known.
   * GitHub App installation tokens are scope-less (permissions live on the
   * installation), so this returns []. OAuth tokens carry their scopes in
   * the `x-oauth-scopes` response header.
   */
  getScopes(): Promise<string[]>
}
