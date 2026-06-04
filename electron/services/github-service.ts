import { shell } from 'electron'
import { spawn } from 'child_process'
import { createServer } from 'http'
import * as keychain from './keychain'
import { createOAuthSession, validateOAuthCallback, type OAuthSession } from './oauth-state'
import { runGit } from './git-runner'
import { buildAuthenticatedEnv } from './github-askpass'
import type {
  CloneRepositoryInput,
  CreatePullRequestInput,
  GitHubAuthMode,
  GitHubCompareSummary,
  GitHubConnectionStatus,
  GitHubPullRequest,
  GitHubRepository,
  GitHubTokenProvider,
  GitHubViewer,
  PushBranchInput
} from './github-types'

// SECURITY MODEL
// --------------
// 1. Tokens NEVER cross IPC to the renderer. The service exposes typed
//    methods that return non-secret data; callers never see the bearer.
// 2. Tokens NEVER appear in `.git/config` or process args. Push uses the
//    `GIT_ASKPASS` shim in `./github-askpass.ts` which reads the token from
//    a child env var.
// 3. We never log full Authorization headers, full callback URLs (they
//    contain `?code=...&state=...`), or token bodies. The OAuth flow
//    only logs the outcome (`success` / `error: code`) and never the
//    code itself.
// 4. OAuth callback is bound to 127.0.0.1, with single-use `state`
//    verified by the shared `oauth-state` helper.
//
// OAUTH SCOPES
// ------------
// We request `read:user repo` by default:
//   - read:user → for the connected viewer (login, avatar)
//   - repo      → list private repos, push branches, open PRs
// To switch to a less-privileged install, expose a per-flow scope override.
// Public-only setups can swap to `read:user public_repo`.

const REDIRECT_PORT = 9876
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`
// Fallback ports if 9876 is already bound (a stale Lamprey OAuth attempt,
// the Google MCP OAuth flow racing, or an unrelated dev server). For BYO
// OAuth Apps the user must add http://localhost:{9877,9878}/callback to
// the app's Authorization callback URLs — otherwise GitHub will reject
// the redirect_uri at the authorize step. Documented in
// docs/github-setup.md.
const CALLBACK_PORTS = [9876, 9877, 9878] as const
const DEFAULT_SCOPES = 'read:user repo'
const GITHUB_API = 'https://api.github.com'

// Keychain entry names. Centralised so the renderer-side wiper / status
// surface can stay in sync.
export const KEYCHAIN = {
  oauthClientId: 'github-oauth-client-id',
  oauthClientSecret: 'github-oauth-client-secret',
  accessToken: 'github-access-token',
  tokenScopes: 'github-token-scopes',
  appId: 'github-app-id',
  appPrivateKey: 'github-app-private-key',
  appInstallationId: 'github-app-installation-id'
} as const

// Settings keys (live in settings.json, not the keychain). The mode flag is
// non-secret and convenient to read without unlocking the keychain.
export const SETTINGS_KEYS = {
  mode: 'githubMode' // 'oauth' | 'github_app' | 'gh-cli' | 'none'
} as const

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Matches the worktree branch validator's defence-in-depth posture: ban
// leading dashes, ban argument-smuggling forms. GitHub's own grammar for
// owner/repo allows [A-Za-z0-9._-] with some position rules; this regex is
// stricter than necessary but rejects the dangerous shapes.
const SLUG_RE = /^[A-Za-z0-9._-]+$/

export function isValidSlug(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > 100) return false
  if (value.startsWith('-')) return false
  if (value.startsWith('.')) return false
  if (value.includes('..')) return false
  return SLUG_RE.test(value)
}

const BRANCH_RE = /^[A-Za-z0-9._/-]+$/

export function isValidBranchName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > 200) return false
  if (value.startsWith('-')) return false
  if (value.includes('..')) return false
  return BRANCH_RE.test(value)
}

// ---------------------------------------------------------------------------
// Token providers
// ---------------------------------------------------------------------------

class OAuthTokenProvider implements GitHubTokenProvider {
  readonly mode: GitHubAuthMode = 'oauth'
  async getAccessToken(): Promise<string | null> {
    return keychain.getKey(KEYCHAIN.accessToken)
  }
  async getScopes(): Promise<string[]> {
    const raw = keychain.getKey(KEYCHAIN.tokenScopes) ?? ''
    return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []
  }
}

class GhCliTokenProvider implements GitHubTokenProvider {
  readonly mode: GitHubAuthMode = 'gh-cli'
  async getAccessToken(): Promise<string | null> {
    const out = await spawnCapture('gh', ['auth', 'token'])
    if (out.code !== 0) return null
    const token = out.stdout.trim()
    return token.length > 0 ? token : null
  }
  async getScopes(): Promise<string[]> {
    // gh's "status" emits human-readable scope info on stderr. Best-effort
    // parse; an unparseable response just returns [].
    const out = await spawnCapture('gh', ['auth', 'status', '--show-token'])
    const text = `${out.stdout}\n${out.stderr}`
    const m = text.match(/Token scopes:\s*([^\n]+)/i)
    if (!m) return []
    return m[1].split(',').map((s) => s.replace(/['"\s]/g, '')).filter(Boolean)
  }
}

class GitHubAppTokenProvider implements GitHubTokenProvider {
  // Intentional stub — the interface boundary is the stable contract so a
  // later commit can implement App installation tokens (private-key JWT →
  // POST /app/installations/{id}/access_tokens → cache until expiry minus
  // 60s) without touching callers.
  readonly mode: GitHubAuthMode = 'github_app'
  async getAccessToken(): Promise<string | null> {
    return null
  }
  async getScopes(): Promise<string[]> {
    return []
  }
}

class NoneTokenProvider implements GitHubTokenProvider {
  readonly mode: GitHubAuthMode = 'none'
  async getAccessToken(): Promise<string | null> {
    return null
  }
  async getScopes(): Promise<string[]> {
    return []
  }
}

function buildTokenProvider(mode: GitHubAuthMode): GitHubTokenProvider {
  switch (mode) {
    case 'oauth':
      return new OAuthTokenProvider()
    case 'gh-cli':
      return new GhCliTokenProvider()
    case 'github_app':
      return new GitHubAppTokenProvider()
    default:
      return new NoneTokenProvider()
  }
}

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

export interface GitHubRequestInit {
  method?: string
  body?: unknown
  /** Override Accept header. */
  accept?: string
  signal?: AbortSignal
}

/** Pure: assemble headers for a GitHub REST request. Exported for tests. */
export function buildRequestHeaders(token: string, accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Lamprey-Harness'
  }
}

export class GitHubApiError extends Error {
  readonly status: number
  readonly responseBody: string
  constructor(status: number, message: string, responseBody: string) {
    super(message)
    this.name = 'GitHubApiError'
    this.status = status
    this.responseBody = responseBody
  }
}

async function githubRequest<T>(
  path: string,
  init: GitHubRequestInit,
  provider: GitHubTokenProvider
): Promise<T> {
  const token = await provider.getAccessToken()
  if (!token) {
    throw new GitHubApiError(401, 'No GitHub token available — connect GitHub first.', '')
  }
  const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`
  const headers = buildRequestHeaders(token, init.accept)
  const body = init.body !== undefined ? JSON.stringify(init.body) : undefined
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers,
    body,
    signal: init.signal
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // Map a 401 with auth-flavoured body to a friendlier message; we never
    // include the token or the Authorization header in the surfaced text.
    const safeMsg = res.status === 401
      ? 'GitHub rejected the token (401). It may have been revoked or expired — reconnect from Settings.'
      : `GitHub API ${res.status}: ${text.slice(0, 400)}`
    // Phase 3b: notify the IPC layer so the renderer can show an
    // actionable reconnect prompt. Best-effort; never throws.
    if (res.status === 401) {
      try { deps.onTokenRejected?.() } catch { /* noop */ }
    }
    throw new GitHubApiError(res.status, safeMsg, text)
  }
  if (res.status === 204) return undefined as unknown as T
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Mode resolution
// ---------------------------------------------------------------------------

export interface ServiceDeps {
  /** Returns the current configured mode. Implementations read settings.json. */
  readMode: () => GitHubAuthMode
  writeMode: (mode: GitHubAuthMode) => void
  /**
   * Phase 3b: called when a GitHub API request returns 401 (token rejected).
   * The IPC layer wires this to a BrowserWindow.send so the renderer can
   * show a reconnect prompt. Throttling is the deps' responsibility —
   * the service emits unconditionally.
   */
  onTokenRejected?: () => void
}

let deps: ServiceDeps = {
  // Default deps are no-ops; the IPC layer wires the real ones at register
  // time. The defaults keep the module importable in tests without booting
  // the settings file.
  readMode: () => (keychain.hasKey(KEYCHAIN.accessToken) ? 'oauth' : 'none'),
  writeMode: () => undefined,
  onTokenRejected: () => undefined
}

export function configureGitHubService(next: ServiceDeps): void {
  deps = next
}

export function currentMode(): GitHubAuthMode {
  return deps.readMode()
}

function provider(): GitHubTokenProvider {
  return buildTokenProvider(currentMode())
}

// ---------------------------------------------------------------------------
// Status + viewer
// ---------------------------------------------------------------------------

export async function getConnectionStatus(): Promise<GitHubConnectionStatus> {
  const mode = currentMode()
  const p = buildTokenProvider(mode)
  const token = await p.getAccessToken()
  if (!token) {
    return {
      connected: false,
      mode,
      scopes: [],
      login: null,
      avatarUrl: null,
      installationId: null,
      reason: mode === 'none' ? 'Not connected' : `${mode} configured but no token available`
    }
  }
  // Probe /user with the token. A successful probe doubles as a scopes
  // discovery — the response carries an `x-oauth-scopes` header for OAuth
  // tokens. We cache the scopes string in the keychain so subsequent
  // status queries don't have to round-trip when offline.
  try {
    const headers = buildRequestHeaders(token)
    const res = await fetch(`${GITHUB_API}/user`, { headers })
    if (!res.ok) {
      return {
        connected: false,
        mode,
        scopes: await p.getScopes(),
        login: null,
        avatarUrl: null,
        installationId: null,
        reason: res.status === 401 ? 'Token rejected (401)' : `Probe failed (${res.status})`
      }
    }
    const headerScopes = res.headers.get('x-oauth-scopes')
    if (mode === 'oauth' && headerScopes !== null) {
      try {
        keychain.setKey(KEYCHAIN.tokenScopes, headerScopes)
      } catch {
        // plaintext-consent gate may reject — non-fatal; UI can re-derive
        // via getScopes()
      }
    }
    const body = (await res.json()) as { login: string; avatar_url: string | null }
    const scopes = headerScopes
      ? headerScopes.split(',').map((s) => s.trim()).filter(Boolean)
      : await p.getScopes()
    return {
      connected: true,
      mode,
      scopes,
      login: body.login,
      avatarUrl: body.avatar_url,
      installationId: null
    }
  } catch (err: any) {
    return {
      connected: false,
      mode,
      scopes: [],
      login: null,
      avatarUrl: null,
      installationId: null,
      reason: `Probe error: ${err?.message ?? 'unknown'}`
    }
  }
}

export async function getViewer(): Promise<GitHubViewer> {
  const body = await githubRequest<{
    login: string
    name: string | null
    avatar_url: string | null
    html_url: string
  }>('/user', {}, provider())
  return {
    login: body.login,
    name: body.name,
    avatarUrl: body.avatar_url,
    htmlUrl: body.html_url
  }
}

// ---------------------------------------------------------------------------
// OAuth flow (browser → loopback callback)
// ---------------------------------------------------------------------------

/**
 * Pure: is this server-bind error EADDRINUSE? Used by the OAuth callback
 * loop to decide whether to retry on the next port. Anything else (EACCES,
 * config error, listener exploded mid-listen) is a hard fail.
 */
export function isPortInUseError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return code === 'EADDRINUSE'
}

/** Pure: ordered list of callback ports to attempt. Exported for tests. */
export function getCallbackPortCandidates(): readonly number[] {
  return CALLBACK_PORTS
}

/**
 * Probe whether a bundled OAuth App (client id + secret baked in at build
 * time via electron.vite.config.ts `define`) is available. Does NOT leak
 * either value — returns only a boolean for the UI to decide whether to
 * default to "Connect with Lamprey" or to the BYO form.
 */
export function isBundledClientAvailable(): boolean {
  return Boolean(
    (process.env.LAMPREY_GITHUB_CLIENT_ID || '').length > 0 &&
      (process.env.LAMPREY_GITHUB_CLIENT_SECRET || '').length > 0
  )
}

/**
 * Pure: resolve the (clientId, clientSecret) pair from three layered
 * sources. Exported so the precedence chain can be tested without
 * touching the keychain or the build env. The non-pure caller wraps this
 * by reading the keychain + bundled env vars and threading them in here.
 */
export interface CredentialSources {
  override?: { clientId?: string; clientSecret?: string }
  saved?: { clientId: string | null; clientSecret: string | null }
  bundled?: { clientId: string; clientSecret: string }
}

export interface ResolvedCredentials {
  clientId: string | null
  clientSecret: string | null
  /** Which source supplied the credential, when found. Useful for logging
   * and for the UI to surface which path the connection used. */
  source: 'override' | 'saved' | 'bundled' | 'none'
}

export function resolveOAuthCredentials(sources: CredentialSources): ResolvedCredentials {
  const o = sources.override ?? {}
  if (o.clientId && o.clientSecret) {
    return { clientId: o.clientId, clientSecret: o.clientSecret, source: 'override' }
  }
  const s = sources.saved ?? { clientId: null, clientSecret: null }
  if (s.clientId && s.clientSecret) {
    return { clientId: s.clientId, clientSecret: s.clientSecret, source: 'saved' }
  }
  const b = sources.bundled
  if (b && b.clientId && b.clientSecret) {
    return { clientId: b.clientId, clientSecret: b.clientSecret, source: 'bundled' }
  }
  return { clientId: null, clientSecret: null, source: 'none' }
}

export interface StartOAuthLoginInput {
  scopes?: string
  /** Override; defaults to the user's own OAuth app credentials in keychain. */
  clientId?: string
  clientSecret?: string
  /** Inject for tests. */
  openExternal?: (url: string) => Promise<void> | void
  /** Inject for tests — defaults to the redirect port above. */
  port?: number
}

export interface OAuthLoginResult {
  login: string
  scopes: string[]
}

export async function startOAuthLogin(input: StartOAuthLoginInput = {}): Promise<OAuthLoginResult> {
  // Credential precedence (see resolveOAuthCredentials docs): per-call
  // override → user-saved BYO → bundled build-time default. Build-time
  // default is the empty string when contributors / forks build without
  // LAMPREY_GITHUB_CLIENT_ID/SECRET env vars; in that case we fall through
  // to the error below that points the user at BYO setup.
  const resolved = resolveOAuthCredentials({
    override:
      input.clientId && input.clientSecret
        ? { clientId: input.clientId, clientSecret: input.clientSecret }
        : undefined,
    saved: {
      clientId: keychain.getKey(KEYCHAIN.oauthClientId),
      clientSecret: keychain.getKey(KEYCHAIN.oauthClientSecret)
    },
    bundled:
      process.env.LAMPREY_GITHUB_CLIENT_ID && process.env.LAMPREY_GITHUB_CLIENT_SECRET
        ? {
            clientId: process.env.LAMPREY_GITHUB_CLIENT_ID,
            clientSecret: process.env.LAMPREY_GITHUB_CLIENT_SECRET
          }
        : undefined
  })
  const { clientId, clientSecret } = resolved
  if (!clientId || !clientSecret) {
    throw new Error(
      'GitHub OAuth client credentials not configured. Create an OAuth App at ' +
        'https://github.com/settings/developers, set the callback URL to ' +
        `${REDIRECT_URI}, then save the client ID + secret in Settings → GitHub.`
    )
  }
  // Non-secret breadcrumb so the dev console hints at which source served
  // the flow (helpful when both BYO and bundled are present on the same
  // box). Never logs the credential values themselves.
  console.log('[github] oauth using', resolved.source, 'credentials')
  // Phase 3a: port-collision recovery. Try CALLBACK_PORTS in order; if a
  // port is held by another listener (stale Lamprey OAuth attempt, the
  // Google MCP flow, an unrelated dev server) we move to the next.
  // `input.port` (used by tests) pins to a single port and skips the
  // fallback list.
  const ports = input.port ? [input.port] : CALLBACK_PORTS
  const scopes = input.scopes ?? DEFAULT_SCOPES
  const session = createOAuthSession()
  const open = input.openExternal ?? ((u: string) => shell.openExternal(u))

  const bound = await tryBindCallbackServer(ports, session)
  const { server, port } = bound
  const redirect = `http://localhost:${port}/callback`

  // We bound the server BEFORE opening the browser, so the redirect URL
  // is guaranteed to match what we tell GitHub.
  const authUrl = new URL('https://github.com/login/oauth/authorize')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirect)
  authUrl.searchParams.set('scope', scopes)
  authUrl.searchParams.set('state', session.state)
  authUrl.searchParams.set('allow_signup', 'false')

  const code = await new Promise<string>((resolveCode, rejectCode) => {
    const timeout = setTimeout(() => {
      try { server.close() } catch { /* noop */ }
      rejectCode(new Error('GitHub OAuth timeout — no callback received within 2 minutes'))
    }, 120_000)

    server.once('listening', () => {
      // Already listening at this point (tryBindCallbackServer waited);
      // this fires only if a future call re-listens, which we don't do.
    })
    // Wire the request handler (server was created with a noop handler
    // by tryBindCallbackServer so the listen succeeded before we attach
    // here — request can't arrive before the listen callback returns).
    server.on('request', (req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://localhost:${port}`)
      const outcome = validateOAuthCallback(reqUrl, session)

      if (outcome.kind === 'denied') {
        res.writeHead(outcome.httpStatus, { 'Content-Type': 'text/html' })
        res.end('<html><body><h2>Authorization denied.</h2><p>You can close this tab.</p></body></html>')
        clearTimeout(timeout)
        try { server.close() } catch { /* noop */ }
        rejectCode(new Error(`OAuth denied: ${outcome.reason}`))
        return
      }
      if (outcome.kind === 'state-mismatch') {
        res.writeHead(outcome.httpStatus, { 'Content-Type': 'text/html' })
        res.end('<html><body><h2>OAuth state mismatch.</h2><p>Close this tab and start the flow again from Lamprey.</p></body></html>')
        clearTimeout(timeout)
        try { server.close() } catch { /* noop */ }
        rejectCode(new Error(outcome.reason))
        return
      }
      if (outcome.kind === 'missing-code') {
        res.writeHead(outcome.httpStatus, { 'Content-Type': 'text/plain' })
        res.end(outcome.reason)
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h2>Lamprey connected to GitHub.</h2><p>You can close this tab.</p></body></html>')
      clearTimeout(timeout)
      try { server.close() } catch { /* noop */ }
      resolveCode(outcome.code)
    })

    // Open the browser AFTER attaching the request handler.
    Promise.resolve(open(authUrl.toString())).catch((err) => {
      clearTimeout(timeout)
      try { server.close() } catch { /* noop */ }
      rejectCode(new Error(`Failed to open browser for GitHub OAuth: ${(err as Error).message}`))
    })
  })

  // Exchange code → token. We don't log the body of this exchange.
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Lamprey-Harness'
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirect,
      state: session.state
    })
  })
  if (!tokenRes.ok) {
    throw new Error(`GitHub token exchange failed (${tokenRes.status})`)
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string
    token_type?: string
    scope?: string
    error?: string
    error_description?: string
  }
  if (tokenJson.error || !tokenJson.access_token) {
    throw new Error(
      `GitHub token exchange failed: ${tokenJson.error ?? 'unknown'}${
        tokenJson.error_description ? ` — ${tokenJson.error_description}` : ''
      }`
    )
  }
  keychain.setKey(KEYCHAIN.accessToken, tokenJson.access_token)
  if (tokenJson.scope) keychain.setKey(KEYCHAIN.tokenScopes, tokenJson.scope)
  deps.writeMode('oauth')

  // Confirm with a /user probe so the caller gets the connected login.
  const viewer = await getViewer()
  console.log('[github] oauth connected as', viewer.login)
  return {
    login: viewer.login,
    scopes: tokenJson.scope
      ? tokenJson.scope.split(',').map((s) => s.trim()).filter(Boolean)
      : []
  }
}

export function disconnect(): void {
  keychain.deleteKey(KEYCHAIN.accessToken)
  keychain.deleteKey(KEYCHAIN.tokenScopes)
  deps.writeMode('none')
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

interface RawRepo {
  id: number
  full_name: string
  name: string
  owner: { login: string }
  private: boolean
  default_branch: string
  html_url: string
  clone_url: string
  ssh_url: string
  description: string | null
  updated_at: string
}

/** Pure: parse a GitHub /user/repos payload into our normalised shape. */
export function parseRepoList(raw: unknown): GitHubRepository[] {
  if (!Array.isArray(raw)) return []
  const out: GitHubRepository[] = []
  for (const item of raw as RawRepo[]) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.full_name !== 'string') continue
    out.push({
      id: item.id,
      fullName: item.full_name,
      owner: item.owner?.login ?? item.full_name.split('/')[0] ?? '',
      name: item.name,
      private: Boolean(item.private),
      defaultBranch: item.default_branch || 'main',
      htmlUrl: item.html_url,
      cloneUrl: item.clone_url,
      sshUrl: item.ssh_url,
      description: item.description ?? null
    })
  }
  return out
}

export async function listAccessibleRepositories(opts: { page?: number; perPage?: number } = {}): Promise<GitHubRepository[]> {
  const per = Math.min(100, Math.max(1, opts.perPage ?? 100))
  const page = Math.max(1, opts.page ?? 1)
  const raw = await githubRequest<unknown>(
    `/user/repos?per_page=${per}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    {},
    provider()
  )
  return parseRepoList(raw)
}

export async function getRepository(owner: string, repo: string): Promise<GitHubRepository> {
  if (!isValidSlug(owner) || !isValidSlug(repo)) {
    throw new Error('Invalid repository owner/name')
  }
  const raw = await githubRequest<RawRepo>(`/repos/${owner}/${repo}`, {}, provider())
  const [parsed] = parseRepoList([raw])
  if (!parsed) throw new Error('Unexpected repo response shape')
  return parsed
}

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

export async function cloneRepository(input: CloneRepositoryInput): Promise<{ localPath: string }> {
  if (!isValidSlug(input.owner) || !isValidSlug(input.repo)) {
    throw new Error('Invalid repository owner/name')
  }
  if (typeof input.targetDir !== 'string' || input.targetDir.length === 0) {
    throw new Error('targetDir is required')
  }
  if (input.targetDir.startsWith('-')) {
    throw new Error('targetDir must not begin with "-"')
  }
  const cloneUrl = input.cloneUrl ?? `https://github.com/${input.owner}/${input.repo}.git`
  if (input.cloneUrl && !/^(https:\/\/|git@)/i.test(input.cloneUrl)) {
    throw new Error('cloneUrl must be https:// or git@ form')
  }
  const token = await provider().getAccessToken()
  // We DO NOT embed the token in the clone URL (that would persist into
  // .git/config as the origin remote). Instead we hand git the askpass
  // helper + the token in env, exactly like push does.
  const env = token ? buildAuthenticatedEnv(token) : { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  const res = await runGitWithEnv(['clone', '--', cloneUrl, input.targetDir], process.cwd(), env)
  if (res.code !== 0) {
    throw new Error(res.stderr.trim() || 'git clone failed')
  }
  return { localPath: input.targetDir }
}

// ---------------------------------------------------------------------------
// Compare + PR
// ---------------------------------------------------------------------------

export async function compareBranchToBase(
  owner: string,
  repo: string,
  base: string,
  head: string
): Promise<GitHubCompareSummary> {
  if (!isValidSlug(owner) || !isValidSlug(repo)) throw new Error('Invalid repo')
  // `head` may carry an owner: prefix when comparing across a fork.
  const headLabel = head.includes(':')
    ? head
    : (isValidBranchName(head) ? head : null)
  if (!headLabel) throw new Error('Invalid head ref')
  if (!isValidBranchName(base)) throw new Error('Invalid base ref')
  const raw = await githubRequest<{
    status: GitHubCompareSummary['status']
    ahead_by: number
    behind_by: number
    commits: Array<{ sha: string; commit: { message: string; author: { name?: string } | null }; author: { login?: string } | null }>
    files?: Array<{ filename: string; additions: number; deletions: number; status: string }>
  }>(
    `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(headLabel)}`,
    {},
    provider()
  )
  return {
    base,
    head: headLabel,
    status: raw.status,
    aheadBy: raw.ahead_by,
    behindBy: raw.behind_by,
    commits: (raw.commits ?? []).map((c) => ({
      sha: c.sha,
      message: c.commit?.message ?? '',
      author: c.author?.login ?? c.commit?.author?.name ?? null
    })),
    files: (raw.files ?? []).map((f) => ({
      filename: f.filename,
      additions: f.additions,
      deletions: f.deletions,
      status: f.status
    }))
  }
}

/** Pure: build the JSON body for POST /repos/{owner}/{repo}/pulls. Exported for tests. */
export function buildCreatePullRequestPayload(input: CreatePullRequestInput): {
  title: string
  body: string
  head: string
  base: string
  draft: boolean
} {
  return {
    title: input.title,
    body: input.body ?? '',
    head: input.headLabel ?? input.head,
    base: input.base,
    draft: Boolean(input.draft)
  }
}

export async function createPullRequest(input: CreatePullRequestInput): Promise<GitHubPullRequest> {
  if (!isValidSlug(input.owner) || !isValidSlug(input.repo)) throw new Error('Invalid repo')
  if (!isValidBranchName(input.base)) throw new Error('Invalid base branch')
  // head can be "owner:branch"; validate the branch portion in either form.
  const headBranch = input.head.includes(':') ? input.head.split(':')[1] : input.head
  if (!isValidBranchName(headBranch)) throw new Error('Invalid head branch')
  if (!input.title || input.title.trim().length === 0) throw new Error('PR title is required')

  const raw = await githubRequest<RawPullRequest>(
    `/repos/${input.owner}/${input.repo}/pulls`,
    { method: 'POST', body: buildCreatePullRequestPayload(input) },
    provider()
  )
  return parsePullRequest(raw)
}

interface RawPullRequest {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  draft?: boolean
  merged?: boolean
  merged_at?: string | null
  html_url: string
  user: { login: string; avatar_url: string | null }
  base: { ref: string; sha: string; label: string | null }
  head: { ref: string; sha: string; label: string | null }
  created_at: string
  updated_at: string
}

/** Pure: turn a GitHub PR payload into our normalised shape. Exported for tests. */
export function parsePullRequest(raw: RawPullRequest): GitHubPullRequest {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body,
    state: raw.state,
    draft: Boolean(raw.draft),
    merged: Boolean(raw.merged) || Boolean(raw.merged_at),
    htmlUrl: raw.html_url,
    user: {
      login: raw.user?.login ?? '',
      avatarUrl: raw.user?.avatar_url ?? null
    },
    base: { ref: raw.base.ref, sha: raw.base.sha ?? null, label: raw.base.label ?? null },
    head: { ref: raw.head.ref, sha: raw.head.sha ?? null, label: raw.head.label ?? null },
    createdAt: raw.created_at,
    updatedAt: raw.updated_at
  }
}

export async function listPullRequests(
  owner: string,
  repo: string,
  opts: { state?: 'open' | 'closed' | 'all'; per_page?: number } = {}
): Promise<GitHubPullRequest[]> {
  if (!isValidSlug(owner) || !isValidSlug(repo)) throw new Error('Invalid repo')
  const state = opts.state ?? 'open'
  const per = Math.min(100, Math.max(1, opts.per_page ?? 30))
  const raw = await githubRequest<RawPullRequest[]>(
    `/repos/${owner}/${repo}/pulls?state=${state}&per_page=${per}&sort=updated&direction=desc`,
    {},
    provider()
  )
  return raw.map(parsePullRequest)
}

export async function getPullRequest(owner: string, repo: string, number: number): Promise<GitHubPullRequest> {
  if (!isValidSlug(owner) || !isValidSlug(repo)) throw new Error('Invalid repo')
  if (!Number.isInteger(number) || number <= 0) throw new Error('Invalid PR number')
  const raw = await githubRequest<RawPullRequest>(
    `/repos/${owner}/${repo}/pulls/${number}`,
    {},
    provider()
  )
  return parsePullRequest(raw)
}

// ---------------------------------------------------------------------------
// F2 — PR review threading + inline review post
// ---------------------------------------------------------------------------
//
// Two GitHub APIs are involved:
//   1. REST `/repos/.../pulls/{n}/comments` — review (line) comments + their
//      reply endpoint. This is what `getPullRequestReviewComments`,
//      `createPullRequestReview`, and `replyToReviewComment` use.
//   2. GraphQL `pullRequestReviewThread` + `resolveReviewThread` mutation —
//      thread state (resolved / open) lives only in GraphQL. We piggyback
//      on the same OAuth token via the standard /graphql endpoint.

export interface RawReviewComment {
  id: number
  pull_request_review_id: number | null
  pull_request_url: string
  diff_hunk: string
  path: string
  position: number | null
  original_position: number | null
  line: number | null
  start_line: number | null
  side: 'LEFT' | 'RIGHT' | null
  in_reply_to_id?: number
  body: string
  html_url: string
  user: { login: string; avatar_url: string | null }
  created_at: string
  updated_at: string
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

/** Pure: turn a GitHub review-comment payload into our normalised shape. Exported for tests. */
export function parseReviewComment(raw: RawReviewComment): PullRequestReviewComment {
  return {
    id: raw.id,
    reviewId: raw.pull_request_review_id,
    body: raw.body,
    path: raw.path,
    line: raw.line,
    startLine: raw.start_line,
    side: raw.side,
    position: raw.position,
    inReplyToId: raw.in_reply_to_id ?? null,
    htmlUrl: raw.html_url,
    user: { login: raw.user?.login ?? '', avatarUrl: raw.user?.avatar_url ?? null },
    createdAt: raw.created_at,
    updatedAt: raw.updated_at
  }
}

export async function getPullRequestReviewComments(
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestReviewComment[]> {
  if (!isValidSlug(owner) || !isValidSlug(repo)) throw new Error('Invalid repo')
  if (!Number.isInteger(number) || number <= 0) throw new Error('Invalid PR number')
  const raw = await githubRequest<RawReviewComment[]>(
    `/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`,
    {},
    provider()
  )
  return raw.map(parseReviewComment)
}

export interface CreatePullRequestReviewInput {
  owner: string
  repo: string
  number: number
  /** Markdown body for the overall review (optional). */
  body?: string
  /** APPROVE / REQUEST_CHANGES / COMMENT. Defaults to COMMENT. */
  event?: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  /** Optional commit SHA to pin the review to. GitHub picks the PR head if omitted. */
  commitId?: string
  /** Inline comments. `position` is the diff-hunk position; for line-anchored
   *  comments pass `line` (+ optional `start_line` for a range). */
  comments?: Array<{
    path: string
    body: string
    position?: number
    line?: number
    start_line?: number
    side?: 'LEFT' | 'RIGHT'
    start_side?: 'LEFT' | 'RIGHT'
  }>
}

export interface CreatedPullRequestReview {
  id: number
  state: string
  htmlUrl: string
  submittedAt: string | null
}

export async function createPullRequestReview(
  input: CreatePullRequestReviewInput
): Promise<CreatedPullRequestReview> {
  if (!isValidSlug(input.owner) || !isValidSlug(input.repo)) throw new Error('Invalid repo')
  if (!Number.isInteger(input.number) || input.number <= 0) throw new Error('Invalid PR number')
  const event = input.event ?? 'COMMENT'
  if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(event)) {
    throw new Error(`Invalid review event: ${event}`)
  }
  const cleanedComments = (input.comments ?? [])
    .filter((c) => c && typeof c.path === 'string' && typeof c.body === 'string')
    .map((c) => ({
      path: c.path,
      body: c.body,
      position: typeof c.position === 'number' ? c.position : undefined,
      line: typeof c.line === 'number' ? c.line : undefined,
      start_line: typeof c.start_line === 'number' ? c.start_line : undefined,
      side: c.side,
      start_side: c.start_side
    }))
  const payload: Record<string, unknown> = { event }
  if (input.body && input.body.trim()) payload.body = input.body
  if (input.commitId && input.commitId.trim()) payload.commit_id = input.commitId
  if (cleanedComments.length > 0) payload.comments = cleanedComments

  const raw = await githubRequest<{
    id: number
    state: string
    html_url: string
    submitted_at: string | null
  }>(
    `/repos/${input.owner}/${input.repo}/pulls/${input.number}/reviews`,
    { method: 'POST', body: payload },
    provider()
  )
  return {
    id: raw.id,
    state: raw.state,
    htmlUrl: raw.html_url,
    submittedAt: raw.submitted_at
  }
}

export interface ReplyToReviewCommentInput {
  owner: string
  repo: string
  number: number
  commentId: number
  body: string
}

export async function replyToReviewComment(
  input: ReplyToReviewCommentInput
): Promise<PullRequestReviewComment> {
  if (!isValidSlug(input.owner) || !isValidSlug(input.repo)) throw new Error('Invalid repo')
  if (!Number.isInteger(input.number) || input.number <= 0) throw new Error('Invalid PR number')
  if (!Number.isInteger(input.commentId) || input.commentId <= 0) {
    throw new Error('Invalid comment id')
  }
  if (!input.body || !input.body.trim()) throw new Error('reply body is required')
  const raw = await githubRequest<RawReviewComment>(
    `/repos/${input.owner}/${input.repo}/pulls/${input.number}/comments/${input.commentId}/replies`,
    { method: 'POST', body: { body: input.body } },
    provider()
  )
  return parseReviewComment(raw)
}

// ── Review threads (GraphQL only) ───────────────────────────────────────

async function graphqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const p = provider()
  const token = await p.getAccessToken()
  if (!token) {
    throw new GitHubApiError(401, 'No GitHub token available — connect GitHub first.', '')
  }
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Lamprey-Harness',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 401) {
      try { deps.onTokenRejected?.() } catch { /* noop */ }
    }
    throw new GitHubApiError(res.status, `GitHub GraphQL ${res.status}: ${text.slice(0, 400)}`, text)
  }
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string; type?: string }> }
  if (body.errors && body.errors.length > 0) {
    const first = body.errors[0]
    // Surface scope-missing errors verbatim so the model + UI can prompt
    // the user to re-auth with `pull_request:write`.
    throw new GitHubApiError(403, `GraphQL error: ${first.message}`, JSON.stringify(body.errors))
  }
  return body.data as T
}

export interface PullRequestReviewThread {
  id: string
  isResolved: boolean
  isOutdated: boolean
  path: string
  comments: Array<{
    id: string
    databaseId: number | null
    body: string
    author: { login: string } | null
    createdAt: string
  }>
}

export async function listPullRequestReviewThreads(
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestReviewThread[]> {
  if (!isValidSlug(owner) || !isValidSlug(repo)) throw new Error('Invalid repo')
  if (!Number.isInteger(number) || number <= 0) throw new Error('Invalid PR number')
  const data = await graphqlRequest<{
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: Array<{
            id: string
            isResolved: boolean
            isOutdated: boolean
            path: string
            comments: {
              nodes: Array<{
                id: string
                databaseId: number | null
                body: string
                author: { login: string } | null
                createdAt: string
              }>
            }
          }>
        }
      }
    }
  }>(
    `
      query Threads($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                isOutdated
                path
                comments(first: 100) {
                  nodes { id databaseId body author { login } createdAt }
                }
              }
            }
          }
        }
      }
    `,
    { owner, repo, number }
  )
  return (data.repository?.pullRequest?.reviewThreads?.nodes ?? []).map((n) => ({
    id: n.id,
    isResolved: n.isResolved,
    isOutdated: n.isOutdated,
    path: n.path,
    comments: (n.comments?.nodes ?? []).map((c) => ({
      id: c.id,
      databaseId: c.databaseId,
      body: c.body,
      author: c.author ? { login: c.author.login } : null,
      createdAt: c.createdAt
    }))
  }))
}

export async function resolveReviewThread(threadId: string): Promise<{ resolved: boolean }> {
  if (!threadId || typeof threadId !== 'string') throw new Error('threadId is required')
  const data = await graphqlRequest<{
    resolveReviewThread: { thread: { isResolved: boolean } }
  }>(
    `
      mutation Resolve($id: ID!) {
        resolveReviewThread(input: { threadId: $id }) {
          thread { isResolved }
        }
      }
    `,
    { id: threadId }
  )
  return { resolved: Boolean(data.resolveReviewThread?.thread?.isResolved) }
}

// ---------------------------------------------------------------------------
// F3 — Issues + PR status checks
// ---------------------------------------------------------------------------

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

interface RawIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  body: string | null
  html_url: string
  user: { login: string; avatar_url: string | null }
  labels: Array<{ name: string; color: string }>
  created_at: string
  updated_at: string
  pull_request?: unknown
}

function parseIssue(raw: RawIssue): GitHubIssue {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    body: raw.body,
    htmlUrl: raw.html_url,
    user: { login: raw.user?.login ?? '', avatarUrl: raw.user?.avatar_url ?? null },
    labels: (raw.labels ?? []).map((l) => ({ name: l.name, color: l.color })),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at
  }
}

export async function listIssues(
  owner: string,
  repo: string,
  opts: { state?: 'open' | 'closed' | 'all'; per_page?: number; labels?: string } = {}
): Promise<GitHubIssue[]> {
  if (!isValidSlug(owner) || !isValidSlug(repo)) throw new Error('Invalid repo')
  const state = opts.state ?? 'open'
  const per = Math.min(100, Math.max(1, opts.per_page ?? 30))
  const params = new URLSearchParams({
    state,
    per_page: String(per),
    sort: 'updated',
    direction: 'desc'
  })
  if (opts.labels) params.set('labels', opts.labels)
  const raw = await githubRequest<RawIssue[]>(
    `/repos/${owner}/${repo}/issues?${params.toString()}`,
    {},
    provider()
  )
  // The /issues endpoint returns PRs too (they're a subclass of issues on
  // the GitHub data model). Filter them out so the panel matches user
  // intuition; PRs already have their own list endpoint.
  return raw.filter((r) => !r.pull_request).map(parseIssue)
}

export interface PullRequestStatusCheck {
  context: string
  state: 'pending' | 'success' | 'failure' | 'error' | 'neutral' | 'skipped' | 'cancelled' | 'timed_out' | 'action_required'
  description: string | null
  targetUrl: string | null
  source: 'commit-status' | 'check-run'
}

export interface PullRequestStatusSummary {
  sha: string
  overall: 'success' | 'pending' | 'failure' | 'neutral'
  checks: PullRequestStatusCheck[]
}

/**
 * Combine the legacy commit-status API (POST-based, used by Travis-era CI)
 * and the modern check-runs API (used by GitHub Actions + most others)
 * into a single rollup. The overall status takes a worst-of of all
 * non-skipped checks: any failure/error → failure, else any pending →
 * pending, else success. Empty result rolls up to 'neutral'.
 */
export async function getPullRequestStatus(
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestStatusSummary> {
  if (!isValidSlug(owner) || !isValidSlug(repo)) throw new Error('Invalid repo')
  if (!Number.isInteger(number) || number <= 0) throw new Error('Invalid PR number')
  const pr = await getPullRequest(owner, repo, number)
  const sha = pr.head.sha
  if (!sha) {
    return { sha: '', overall: 'neutral', checks: [] }
  }

  const [commitStatus, checkRuns] = await Promise.all([
    githubRequest<{
      state: string
      statuses: Array<{
        context: string
        state: string
        description: string | null
        target_url: string | null
      }>
    }>(`/repos/${owner}/${repo}/commits/${sha}/status`, {}, provider()).catch(() => null),
    githubRequest<{
      check_runs: Array<{
        name: string
        status: string
        conclusion: string | null
        details_url: string | null
        output?: { summary?: string | null }
      }>
    }>(`/repos/${owner}/${repo}/commits/${sha}/check-runs`, {}, provider()).catch(() => null)
  ])

  const checks: PullRequestStatusCheck[] = []
  if (commitStatus?.statuses) {
    for (const s of commitStatus.statuses) {
      checks.push({
        context: s.context,
        state: (s.state as PullRequestStatusCheck['state']) ?? 'pending',
        description: s.description,
        targetUrl: s.target_url,
        source: 'commit-status'
      })
    }
  }
  if (checkRuns?.check_runs) {
    for (const c of checkRuns.check_runs) {
      const state: PullRequestStatusCheck['state'] =
        c.status === 'completed'
          ? ((c.conclusion ?? 'neutral') as PullRequestStatusCheck['state'])
          : 'pending'
      checks.push({
        context: c.name,
        state,
        description: c.output?.summary ?? null,
        targetUrl: c.details_url,
        source: 'check-run'
      })
    }
  }

  let overall: PullRequestStatusSummary['overall'] = 'neutral'
  let sawPending = false
  let sawFailure = false
  let sawSuccess = false
  for (const c of checks) {
    if (c.state === 'skipped' || c.state === 'neutral' || c.state === 'cancelled') continue
    if (c.state === 'failure' || c.state === 'error' || c.state === 'timed_out' || c.state === 'action_required') {
      sawFailure = true
    } else if (c.state === 'pending') {
      sawPending = true
    } else if (c.state === 'success') {
      sawSuccess = true
    }
  }
  if (sawFailure) overall = 'failure'
  else if (sawPending) overall = 'pending'
  else if (sawSuccess) overall = 'success'

  return { sha, overall, checks }
}

export async function unresolveReviewThread(threadId: string): Promise<{ resolved: boolean }> {
  if (!threadId || typeof threadId !== 'string') throw new Error('threadId is required')
  const data = await graphqlRequest<{
    unresolveReviewThread: { thread: { isResolved: boolean } }
  }>(
    `
      mutation Unresolve($id: ID!) {
        unresolveReviewThread(input: { threadId: $id }) {
          thread { isResolved }
        }
      }
    `,
    { id: threadId }
  )
  return { resolved: Boolean(data.unresolveReviewThread?.thread?.isResolved) }
}

// ---------------------------------------------------------------------------
// Push (token-authenticated via askpass)
// ---------------------------------------------------------------------------

/**
 * Pure: decide whether `pushBranch` should try a token-authenticated push,
 * fall back to plain `git push`, or refuse. Tested as a unit so the IPC
 * handler can stay thin.
 */
export type PushPlan =
  | { kind: 'token'; reason: 'connected' }
  | { kind: 'plain'; reason: 'no-token' }
  | { kind: 'refuse'; reason: string }

export function planPushBranch(input: {
  hasToken: boolean
  mode: GitHubAuthMode
  branchValid: boolean
}): PushPlan {
  if (!input.branchValid) return { kind: 'refuse', reason: 'invalid branch name' }
  if (input.hasToken && input.mode !== 'none') return { kind: 'token', reason: 'connected' }
  return { kind: 'plain', reason: 'no-token' }
}

export interface PushBranchResult {
  pushed: boolean
  stdout: string
  /** Set when push fell back to plain `git push` (no GitHub token). */
  usedFallback: boolean
  /** Set when both token-auth + plain push failed; surfaces a helpful message. */
  authHint?: string
}

export async function pushBranch(input: PushBranchInput): Promise<PushBranchResult> {
  if (!isValidBranchName(input.branch)) throw new Error('Invalid branch name')
  const p = provider()
  const token = await p.getAccessToken()
  const plan = planPushBranch({
    hasToken: token !== null,
    mode: p.mode,
    branchValid: true
  })
  if (plan.kind === 'refuse') throw new Error(plan.reason)

  const refspec = `refs/heads/${input.branch}:refs/heads/${input.branch}`
  const setUpstream = input.setUpstream !== false
  const args = ['push']
  if (setUpstream) args.push('--set-upstream')
  args.push('origin', refspec)

  // When we have a token, swap in the github.com remote URL with auth via
  // the askpass helper. We DO NOT rewrite the user's configured remote —
  // we pass the URL on the command line for this single invocation. That
  // means the URL CAN appear in process args, but the URL is non-secret
  // (the token is provided via env to askpass, separately).
  if (plan.kind === 'token' && token) {
    const env = buildAuthenticatedEnv(token)
    // First try: keep the user's configured `origin` remote and let askpass
    // supply creds when prompted. This preserves any custom remote config
    // the user has set.
    const tokenRes = await runGitWithEnv(args, input.cwd, env)
    if (tokenRes.code === 0) {
      return { pushed: true, stdout: tokenRes.stdout.trim(), usedFallback: false }
    }
    // If the failure looks like a missing-remote case (e.g. fresh local
    // repo with no `origin`), retry with an explicit URL that points at
    // the GitHub repo. Token still rides via askpass env.
    if (/origin.*does not appear to be a git repository/i.test(tokenRes.stderr) ||
        /no configured push destination/i.test(tokenRes.stderr) ||
        /No such remote/i.test(tokenRes.stderr)) {
      const url = `https://github.com/${input.owner}/${input.repo}.git`
      const argsWithUrl = ['push']
      if (setUpstream) argsWithUrl.push('--set-upstream')
      argsWithUrl.push(url, refspec)
      const retry = await runGitWithEnv(argsWithUrl, input.cwd, env)
      if (retry.code === 0) {
        return { pushed: true, stdout: retry.stdout.trim(), usedFallback: false }
      }
      return {
        pushed: false,
        stdout: retry.stdout,
        usedFallback: false,
        authHint: friendlyAuthHint(retry.stderr, p.mode)
      }
    }
    return {
      pushed: false,
      stdout: tokenRes.stdout,
      usedFallback: false,
      authHint: friendlyAuthHint(tokenRes.stderr, p.mode)
    }
  }

  // No GitHub token — fall back to plain `git push`, which relies on the
  // user's local credentials.
  const plain = await runGit(args, input.cwd)
  if (plain.code === 0) {
    return { pushed: true, stdout: plain.stdout.trim(), usedFallback: true }
  }
  return {
    pushed: false,
    stdout: plain.stdout,
    usedFallback: true,
    authHint: friendlyAuthHint(plain.stderr, p.mode)
  }
}

/** Pure: map a git-push stderr blob into a user-readable hint. Exported for tests. */
export function friendlyAuthHint(stderr: string, mode: GitHubAuthMode): string | undefined {
  const txt = stderr.toLowerCase()
  if (txt.includes('authentication failed') || txt.includes('could not read username') || txt.includes('403')) {
    if (mode === 'none') {
      return 'Push failed: no GitHub credentials. Connect GitHub in Settings, or configure local Git credentials.'
    }
    return 'Push failed: GitHub rejected the credentials. Try reconnecting GitHub in Settings.'
  }
  if (txt.includes('rejected') && txt.includes('non-fast-forward')) {
    return 'Push rejected (non-fast-forward). Pull/rebase the latest base branch and retry.'
  }
  return undefined
}

/**
 * Try to bind an HTTP server to `127.0.0.1:<port>` for each port in
 * `ports` in order, returning the first one that succeeds. Refuses to
 * accept anything other than EADDRINUSE as retryable — a permissions
 * error (EACCES on a privileged port) or a Node-level failure is
 * surfaced immediately so the user gets the real reason, not a
 * misleading "tried 3 ports" message.
 *
 * The returned server is bound with a no-op `request` handler; the
 * caller attaches a real handler via `server.on('request', ...)` AFTER
 * receiving the server, so the request handler closes over the OAuth
 * session that was just created.
 */
async function tryBindCallbackServer(
  ports: readonly number[],
  // The session is captured here only so the helper can produce a
  // diagnostic error message including the state value if the caller
  // wants it; we don't otherwise use it.
  _session: OAuthSession
): Promise<{ server: import('http').Server; port: number }> {
  const errors: string[] = []
  for (const port of ports) {
    try {
      const server = await new Promise<import('http').Server>((resolve, reject) => {
        // Empty request handler — overwritten by caller via
        // server.on('request', …) after we return.
        const s = createServer(() => undefined)
        const onError = (err: Error & { code?: string }) => {
          s.removeListener('listening', onListening)
          reject(err)
        }
        const onListening = () => {
          s.removeListener('error', onError)
          resolve(s)
        }
        s.once('error', onError)
        s.once('listening', onListening)
        s.listen(port, '127.0.0.1')
      })
      return { server, port }
    } catch (err) {
      if (isPortInUseError(err)) {
        errors.push(`:${port} in use`)
        continue
      }
      throw new Error(
        `Failed to start OAuth callback server on port ${port}: ${(err as Error).message}`,
        { cause: err }
      )
    }
  }
  throw new Error(
    `All OAuth callback ports unavailable (${errors.join(', ')}). ` +
      `Quit any other Lamprey instance and retry. If the problem persists, ` +
      `kill the holding process or restart your machine.`
  )
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

interface RunResult {
  stdout: string
  stderr: string
  code: number
}

function runGitWithEnv(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd, env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8') })
    proc.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8') })
    proc.on('error', (err) => resolve({ stdout, stderr: stderr + String(err), code: -1 }))
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }))
  })
}

function spawnCapture(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8') })
    proc.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8') })
    proc.on('error', (err) => resolve({ stdout, stderr: stderr + String(err), code: -1 }))
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }))
  })
}
