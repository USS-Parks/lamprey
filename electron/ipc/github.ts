import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import * as github from '../services/github-service'
import * as keychain from '../services/keychain'
import * as repoStore from '../services/github-repo-store'
import { getProject } from '../services/projects-store'
import type {
  GitHubAuthMode,
  GitHubProjectRepoLink,
  GitHubRepository
} from '../services/github-types'

// Mode persistence: lives in settings.json so the renderer can poll it
// without touching the keychain. The settings IPC writes a generic JSON
// blob; we re-read/re-write the file directly here so we don't depend on
// `settings.ts` exporting anything (it currently doesn't).
const getSettingsPath = () => join(app.getPath('userData'), 'settings.json')

function readSettingsFile(): Record<string, unknown> {
  const p = getSettingsPath()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

function writeSettingsFile(next: Record<string, unknown>): void {
  writeFileSync(getSettingsPath(), JSON.stringify(next, null, 2), 'utf-8')
}

function readMode(): GitHubAuthMode {
  const settings = readSettingsFile()
  const raw = settings[github.SETTINGS_KEYS.mode]
  if (raw === 'oauth' || raw === 'github_app' || raw === 'gh-cli' || raw === 'none') {
    return raw
  }
  // Implicit oauth when we have a stored token but no explicit mode.
  if (keychain.hasKey(github.KEYCHAIN.accessToken)) return 'oauth'
  return 'none'
}

function writeMode(mode: GitHubAuthMode): void {
  const settings = readSettingsFile()
  settings[github.SETTINGS_KEYS.mode] = mode
  writeSettingsFile(settings)
}

function ownerWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

function envelope<T>(value: T): { success: true; data: T } {
  return { success: true, data: value }
}

function failure(message: string): { success: false; error: string } {
  return { success: false, error: message }
}

/**
 * Decorate a repo with the local clone path that's stored in the project
 * link table, when one exists. Cheap enough to do on every list call so
 * the repo picker can show a "cloned" badge without a second round-trip.
 */
function enrichRepoWithLocalPath(repo: GitHubRepository): GitHubRepository {
  const projectId = repoStore.findProjectIdForRepo(repo.fullName)
  if (!projectId) return repo
  const link = repoStore.getRepoLinkForProject(projectId)
  return link?.localPath ? { ...repo, localPath: link.localPath } : repo
}

// Phase 3b: throttle the token-rejected emit so a burst of 401s (e.g. a
// failed page-load that fans out N requests) shows the prompt once. Reset
// when the user reconnects.
let tokenRejectedLatchAt: number | null = null
const TOKEN_REJECTED_THROTTLE_MS = 60_000

function emitTokenRejected(): void {
  const now = Date.now()
  if (tokenRejectedLatchAt && now - tokenRejectedLatchAt < TOKEN_REJECTED_THROTTLE_MS) return
  tokenRejectedLatchAt = now
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send('github:tokenRejected')
    } catch {
      /* window closed */
    }
  }
}

export function registerGitHubHandlers(): void {
  github.configureGitHubService({
    readMode,
    writeMode,
    onTokenRejected: emitTokenRejected
  })

  // -------------------------------------------------------------------------
  // OAuth client + mode management (renderer never sees the secret).
  // -------------------------------------------------------------------------

  ipcMain.handle('github:saveOAuthClient', async (_e, args: { clientId: string; clientSecret: string }) => {
    try {
      if (!args || typeof args.clientId !== 'string' || typeof args.clientSecret !== 'string') {
        return failure('clientId and clientSecret are required')
      }
      keychain.setKey(github.KEYCHAIN.oauthClientId, args.clientId.trim())
      keychain.setKey(github.KEYCHAIN.oauthClientSecret, args.clientSecret.trim())
      return envelope(null)
    } catch (err: any) {
      return failure(err?.message ?? 'Failed to save OAuth client')
    }
  })

  ipcMain.handle('github:hasOAuthClient', async () => {
    try {
      return envelope(
        keychain.hasKey(github.KEYCHAIN.oauthClientId) &&
          keychain.hasKey(github.KEYCHAIN.oauthClientSecret)
      )
    } catch (err: any) {
      return failure(err?.message ?? 'Probe failed')
    }
  })

  // Whether the build was produced with bundled OAuth App credentials
  // (LAMPREY_GITHUB_CLIENT_ID + SECRET env vars set at electron-vite
  // build time). Returns only a boolean — never the values themselves.
  ipcMain.handle('github:hasBundledClient', async () => {
    try {
      return envelope(github.isBundledClientAvailable())
    } catch (err: any) {
      return failure(err?.message ?? 'Probe failed')
    }
  })

  ipcMain.handle('github:setMode', async (_e, mode: GitHubAuthMode) => {
    try {
      if (mode !== 'oauth' && mode !== 'github_app' && mode !== 'gh-cli' && mode !== 'none') {
        return failure(`Unknown mode: ${String(mode)}`)
      }
      writeMode(mode)
      return envelope(null)
    } catch (err: any) {
      return failure(err?.message ?? 'Failed to set mode')
    }
  })

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  ipcMain.handle('github:status', async () => {
    try {
      const status = await github.getConnectionStatus()
      return envelope(status)
    } catch (err: any) {
      return failure(err?.message ?? 'Status probe failed')
    }
  })

  ipcMain.handle('github:connect', async () => {
    try {
      const result = await github.startOAuthLogin()
      tokenRejectedLatchAt = null // fresh token; let the next 401 fire
      return envelope(result)
    } catch (err: any) {
      // Token-exchange / OAuth errors come back as Error.message; we already
      // strip secrets at the service layer, so it's safe to surface.
      return failure(err?.message ?? 'GitHub connect failed')
    }
  })

  ipcMain.handle('github:disconnect', async () => {
    try {
      github.disconnect()
      tokenRejectedLatchAt = null
      return envelope(null)
    } catch (err: any) {
      return failure(err?.message ?? 'Disconnect failed')
    }
  })

  ipcMain.handle('github:viewer', async () => {
    try {
      return envelope(await github.getViewer())
    } catch (err: any) {
      return failure(err?.message ?? 'Viewer fetch failed')
    }
  })

  // -------------------------------------------------------------------------
  // Repositories
  // -------------------------------------------------------------------------

  ipcMain.handle('github:repositories', async (_e, args?: { page?: number; perPage?: number }) => {
    try {
      const repos = await github.listAccessibleRepositories({
        page: args?.page,
        perPage: args?.perPage
      })
      return envelope(repos.map(enrichRepoWithLocalPath))
    } catch (err: any) {
      return failure(err?.message ?? 'List repositories failed')
    }
  })

  ipcMain.handle('github:getRepository', async (_e, args: { owner: string; repo: string }) => {
    try {
      const repo = await github.getRepository(args.owner, args.repo)
      return envelope(enrichRepoWithLocalPath(repo))
    } catch (err: any) {
      return failure(err?.message ?? 'Get repository failed')
    }
  })

  ipcMain.handle('github:pickCloneDir', async () => {
    try {
      const win = ownerWindow()
      const result = win
        ? await dialog.showOpenDialog(win, {
            title: 'Choose where to clone the GitHub repository',
            properties: ['openDirectory', 'createDirectory']
          })
        : await dialog.showOpenDialog({
            title: 'Choose where to clone the GitHub repository',
            properties: ['openDirectory', 'createDirectory']
          })
      if (result.canceled || result.filePaths.length === 0) {
        return envelope(null)
      }
      return envelope(result.filePaths[0])
    } catch (err: any) {
      return failure(err?.message ?? 'Could not open folder picker')
    }
  })

  ipcMain.handle('github:clone', async (_e, args: { owner: string; repo: string; targetDir: string }) => {
    try {
      const result = await github.cloneRepository({
        owner: args.owner,
        repo: args.repo,
        targetDir: args.targetDir
      })
      return envelope(result)
    } catch (err: any) {
      return failure(err?.message ?? 'Clone failed')
    }
  })

  // Phase 3d: resolve <baseDir>/<repo-name> using Node's path module so
  // the renderer doesn't have to platform-sniff the path separator.
  // Validates that repoName is a simple slug — refuses anything that
  // could path-traverse out of baseDir (e.g. "..", "a/b").
  ipcMain.handle(
    'github:resolveCloneTarget',
    async (_e, args: { baseDir: string; repoName: string }) => {
      try {
        if (!args?.baseDir || typeof args.baseDir !== 'string') {
          return failure('baseDir required')
        }
        if (!github.isValidSlug(args.repoName)) {
          return failure(`Invalid repoName: ${args.repoName}`)
        }
        // Already-pointed-at-the-repo cases: don't double-nest.
        const trimmedBase = args.baseDir.replace(/[\\/]+$/, '')
        const targetPath = trimmedBase.endsWith(args.repoName)
          ? trimmedBase
          : resolve(trimmedBase, args.repoName)
        return envelope({ targetPath })
      } catch (err: any) {
        return failure(err?.message ?? 'Resolve failed')
      }
    }
  )

  // -------------------------------------------------------------------------
  // Project ↔ repo association
  // -------------------------------------------------------------------------

  ipcMain.handle('github:getProjectRepo', async (_e, args: { projectId: string }) => {
    try {
      if (!args?.projectId) return failure('projectId required')
      return envelope(repoStore.getRepoLinkForProject(args.projectId))
    } catch (err: any) {
      return failure(err?.message ?? 'Lookup failed')
    }
  })

  ipcMain.handle(
    'github:assignRepoToProject',
    async (_e, args: { projectId: string; owner: string; repo: string; localPath?: string | null }) => {
      try {
        if (!args?.projectId) return failure('projectId required')
        const project = getProject(args.projectId)
        if (!project) return failure(`Project ${args.projectId} not found`)
        const repo = await github.getRepository(args.owner, args.repo)
        const link: GitHubProjectRepoLink = repoStore.upsertRepoLink({
          projectId: args.projectId,
          repo,
          localPath: args.localPath ?? project.path ?? null
        })
        return envelope(link)
      } catch (err: any) {
        return failure(err?.message ?? 'Assign failed')
      }
    }
  )

  ipcMain.handle('github:unlinkRepo', async (_e, args: { projectId: string }) => {
    try {
      if (!args?.projectId) return failure('projectId required')
      repoStore.unlinkRepoFromProject(args.projectId)
      return envelope(null)
    } catch (err: any) {
      return failure(err?.message ?? 'Unlink failed')
    }
  })

  // -------------------------------------------------------------------------
  // Compare + PRs
  // -------------------------------------------------------------------------

  ipcMain.handle(
    'github:compare',
    async (_e, args: { owner: string; repo: string; base: string; head: string }) => {
      try {
        const summary = await github.compareBranchToBase(args.owner, args.repo, args.base, args.head)
        return envelope(summary)
      } catch (err: any) {
        return failure(err?.message ?? 'Compare failed')
      }
    }
  )

  ipcMain.handle(
    'github:createPullRequest',
    async (
      _e,
      args: {
        owner: string
        repo: string
        title: string
        body?: string
        head: string
        base: string
        draft?: boolean
        headLabel?: string
        /** When provided, the PR is linked to this conversation in the local DB. */
        conversationId?: string
      }
    ) => {
      try {
        const pr = await github.createPullRequest(args)
        if (args.conversationId) {
          try {
            repoStore.linkPullRequestToConversation({
              conversationId: args.conversationId,
              prNumber: pr.number,
              fullName: `${args.owner}/${args.repo}`,
              htmlUrl: pr.htmlUrl,
              title: pr.title,
              createdAt: Date.now()
            })
          } catch (linkErr: any) {
            // Persistence failure must not block the PR creation result.
            console.warn('[github] failed to link PR to conversation:', linkErr?.message)
          }
        }
        return envelope(pr)
      } catch (err: any) {
        return failure(err?.message ?? 'PR creation failed')
      }
    }
  )

  ipcMain.handle(
    'github:pullRequests',
    async (
      _e,
      args: { owner: string; repo: string; state?: 'open' | 'closed' | 'all'; per_page?: number }
    ) => {
      try {
        const prs = await github.listPullRequests(args.owner, args.repo, {
          state: args.state,
          per_page: args.per_page
        })
        return envelope(prs)
      } catch (err: any) {
        return failure(err?.message ?? 'List PRs failed')
      }
    }
  )

  ipcMain.handle(
    'github:getPullRequest',
    async (_e, args: { owner: string; repo: string; number: number }) => {
      try {
        const pr = await github.getPullRequest(args.owner, args.repo, args.number)
        return envelope(pr)
      } catch (err: any) {
        return failure(err?.message ?? 'Get PR failed')
      }
    }
  )

  ipcMain.handle(
    'github:listConversationPullRequests',
    async (_e, args: { conversationId: string }) => {
      try {
        if (!args?.conversationId) return failure('conversationId required')
        return envelope(repoStore.listPullRequestsForConversation(args.conversationId))
      } catch (err: any) {
        return failure(err?.message ?? 'List conversation PRs failed')
      }
    }
  )

  // -------------------------------------------------------------------------
  // F2 — PR review threading + inline review post
  // -------------------------------------------------------------------------

  ipcMain.handle(
    'github:listPullRequestReviewComments',
    async (_e, args: { owner: string; repo: string; number: number }) => {
      try {
        return envelope(
          await github.getPullRequestReviewComments(args.owner, args.repo, args.number)
        )
      } catch (err: any) {
        return failure(err?.message ?? 'List review comments failed')
      }
    }
  )

  ipcMain.handle(
    'github:listPullRequestReviewThreads',
    async (_e, args: { owner: string; repo: string; number: number }) => {
      try {
        return envelope(
          await github.listPullRequestReviewThreads(args.owner, args.repo, args.number)
        )
      } catch (err: any) {
        return failure(err?.message ?? 'List review threads failed')
      }
    }
  )

  ipcMain.handle(
    'github:createPullRequestReview',
    async (_e, args: github.CreatePullRequestReviewInput) => {
      try {
        return envelope(await github.createPullRequestReview(args))
      } catch (err: any) {
        return failure(err?.message ?? 'Create review failed')
      }
    }
  )

  ipcMain.handle(
    'github:replyToReviewComment',
    async (_e, args: github.ReplyToReviewCommentInput) => {
      try {
        return envelope(await github.replyToReviewComment(args))
      } catch (err: any) {
        return failure(err?.message ?? 'Reply to review comment failed')
      }
    }
  )

  ipcMain.handle(
    'github:resolveReviewThread',
    async (_e, args: { threadId: string }) => {
      try {
        return envelope(await github.resolveReviewThread(args.threadId))
      } catch (err: any) {
        return failure(err?.message ?? 'Resolve review thread failed')
      }
    }
  )

  ipcMain.handle(
    'github:unresolveReviewThread',
    async (_e, args: { threadId: string }) => {
      try {
        return envelope(await github.unresolveReviewThread(args.threadId))
      } catch (err: any) {
        return failure(err?.message ?? 'Unresolve review thread failed')
      }
    }
  )

  // F3 — issues + status checks.
  ipcMain.handle(
    'github:listIssues',
    async (
      _e,
      args: { owner: string; repo: string; state?: 'open' | 'closed' | 'all'; per_page?: number; labels?: string }
    ) => {
      try {
        return envelope(await github.listIssues(args.owner, args.repo, args))
      } catch (err: any) {
        return failure(err?.message ?? 'List issues failed')
      }
    }
  )

  ipcMain.handle(
    'github:getPullRequestStatus',
    async (_e, args: { owner: string; repo: string; number: number }) => {
      try {
        return envelope(await github.getPullRequestStatus(args.owner, args.repo, args.number))
      } catch (err: any) {
        return failure(err?.message ?? 'Get PR status failed')
      }
    }
  )

  // -------------------------------------------------------------------------
  // Push (token-authenticated where possible)
  // -------------------------------------------------------------------------

  ipcMain.handle(
    'github:pushBranch',
    async (
      _e,
      args: { cwd: string; branch: string; owner: string; repo: string; setUpstream?: boolean }
    ) => {
      try {
        const result = await github.pushBranch(args)
        return envelope(result)
      } catch (err: any) {
        return failure(err?.message ?? 'Push failed')
      }
    }
  )

  // -------------------------------------------------------------------------
  // Open in browser (just a typed pass-through to shell.openExternal that's
  // gated to GitHub URLs so the renderer can't smuggle arbitrary URLs through
  // this channel).
  // -------------------------------------------------------------------------

  ipcMain.handle('github:openInBrowser', async (_e, url: string) => {
    try {
      if (typeof url !== 'string') return failure('url required')
      const u = new URL(url)
      if (u.protocol !== 'https:' || u.hostname !== 'github.com') {
        return failure('Only https://github.com URLs are allowed')
      }
      await shell.openExternal(u.toString())
      return envelope(null)
    } catch (err: any) {
      return failure(err?.message ?? 'Open in browser failed')
    }
  })
}
