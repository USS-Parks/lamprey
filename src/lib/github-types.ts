// Renderer-side mirrors of electron/services/github-types.ts. Two tsconfig
// roots can't share types directly; keep these in sync with the main-side
// source of truth.

export type GitHubAuthMode = 'oauth' | 'github_app' | 'gh-cli' | 'none'

export interface GitHubConnectionStatus {
  connected: boolean
  mode: GitHubAuthMode
  scopes: string[]
  login: string | null
  avatarUrl: string | null
  installationId: number | null
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
  fullName: string
  owner: string
  name: string
  private: boolean
  defaultBranch: string
  htmlUrl: string
  cloneUrl: string
  sshUrl: string
  description: string | null
  localPath?: string | null
}

export interface GitHubPullRequestRef {
  ref: string
  sha: string | null
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

export interface GitHubIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  body: string | null
  htmlUrl: string
  user: { login: string; avatarUrl: string | null }
  labels: Array<{ name: string; color: string }>
  createdAt: string
  updatedAt: string
}

export interface PullRequestReviewComment {
  id: number
  reviewId: number | null
  body: string
  path: string
  line: number | null
  startLine: number | null
  side: 'LEFT' | 'RIGHT' | null
  position: number | null
  inReplyToId: number | null
  htmlUrl: string
  user: { login: string; avatarUrl: string | null }
  createdAt: string
  updatedAt: string
}

export type PullRequestStatusState =
  | 'pending'
  | 'success'
  | 'failure'
  | 'error'
  | 'neutral'
  | 'skipped'
  | 'cancelled'
  | 'timed_out'
  | 'action_required'

export interface PullRequestStatusCheck {
  context: string
  state: PullRequestStatusState
  description: string | null
  targetUrl: string | null
  source: 'commit-status' | 'check-run'
}

export interface PullRequestStatusSummary {
  sha: string
  overall: 'success' | 'pending' | 'failure' | 'neutral'
  checks: PullRequestStatusCheck[]
}

export interface ConversationPullRequestLink {
  conversationId: string
  prNumber: number
  fullName: string
  htmlUrl: string
  title: string
  createdAt: number
}

export interface PushBranchResult {
  pushed: boolean
  stdout: string
  usedFallback: boolean
  authHint?: string
}

export interface OAuthLoginResult {
  login: string
  scopes: string[]
}
