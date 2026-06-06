import { useEffect, useState } from 'react'
import { toast } from '@/stores/toast-store'
import { useGitHubStore } from '@/stores/github-store'
import { ensurePlaintextConsentIfNeeded } from '@/lib/keychain-consent'
import { github as githubClient } from '@/lib/ipc-client'
import type { GitHubRepository } from '@/lib/github-types'

// GitHub OAuth integration with GitHub App-ready architecture.
//
// The token-provider abstraction in electron/services/github-service.ts
// supports three modes; this UI currently exposes:
//   - OAuth (full flow, store user's OAuth App client id + secret, browse
//     to github.com/login/oauth/authorize, callback to 127.0.0.1:9876).
//   - gh-cli (uses `gh auth token` as the bearer; only available when the
//     gh CLI is installed and authenticated).
// GitHub App mode is wired through the same provider but the
// installation-token exchange is deferred — see README "Future work".

export function GitHubSettings(): React.ReactElement {
  const { status, loadingStatus, refreshStatus, refreshRepos, repos, loadingRepos } =
    useGitHubStore()
  const [hasClient, setHasClient] = useState<boolean | null>(null)
  const [hasBundled, setHasBundled] = useState<boolean | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [savingClient, setSavingClient] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [editingClient, setEditingClient] = useState(false)

  useEffect(() => {
    void refreshStatus()
    void window.api?.github?.hasOAuthClient().then((res) => {
      if (res.success) setHasClient(res.data)
    })
    void window.api?.github?.hasBundledClient().then((res) => {
      if (res.success) setHasBundled(res.data)
    })
  }, [refreshStatus])

  const handleSaveClient = async () => {
    const id = clientId.trim()
    const secret = clientSecret.trim()
    if (!id || !secret) {
      toast.warning('Both client ID and client secret are required.')
      return
    }
    const ok = await ensurePlaintextConsentIfNeeded()
    if (!ok) return
    setSavingClient(true)
    try {
      const res = await githubClient.saveOAuthClient(id, secret)
      if (!res.success) {
        toast.error(`Failed to save OAuth client: ${res.error}`)
        return
      }
      toast.success('GitHub OAuth client saved')
      setHasClient(true)
      setClientId('')
      setClientSecret('')
      setEditingClient(false)
    } finally {
      setSavingClient(false)
    }
  }

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const res = await githubClient.connect()
      if (!res.success) {
        toast.error(`GitHub connect failed: ${res.error}`)
        return
      }
      toast.success(`Connected as ${res.data.login}`)
      await refreshStatus()
      await refreshRepos()
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect GitHub? Local Git operations will continue to work.')) {
      return
    }
    const res = await githubClient.disconnect()
    if (!res.success) {
      toast.error(`Disconnect failed: ${res.error}`)
      return
    }
    toast.success('GitHub disconnected')
    await refreshStatus()
  }

  const handleUseGhCli = async () => {
    const res = await githubClient.setMode('gh-cli')
    if (!res.success) {
      toast.error(`Could not switch to gh CLI mode: ${res.error}`)
      return
    }
    await refreshStatus()
    const st = useGitHubStore.getState().status
    if (st?.connected) {
      toast.success(`Using gh CLI (as ${st.login ?? 'unknown'})`)
    } else {
      toast.warning('Switched to gh CLI mode, but no token came back. Run `gh auth login` first.')
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">GitHub</h3>
          <a
            href="https://github.com/USS-Parks/lamprey/blob/main/docs/github-setup.md"
            onClick={(e) => {
              e.preventDefault()
              void githubClient
                .openInBrowser('https://github.com/USS-Parks/lamprey/blob/main/docs/github-setup.md')
                .catch(() => {
                  /* gating handles the toast */
                })
            }}
            className="font-mono text-[11px] text-[var(--accent)] hover:underline"
          >
            Setup guide →
          </a>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Connect a GitHub account so Lamprey can list repos, clone, push branches with
          token-authenticated git, and open pull requests. Tokens are stored encrypted in
          the local keychain — they never reach the renderer or appear in process args.
          Default scopes: <code className="font-mono text-[12px]">read:user repo</code>.
        </p>
      </div>

      <StatusCard
        status={status}
        loading={loadingStatus}
        onDisconnect={handleDisconnect}
        onRefresh={() => {
          void refreshStatus()
          void refreshRepos()
        }}
      />

      {status?.connected ? null : (
        <div className="space-y-3 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3">
          {/*
            Primary action defaults to the bundled Lamprey OAuth App when
            the build provided one (LAMPREY_GITHUB_CLIENT_ID + SECRET env
            vars at build time). The BYO + gh-cli paths stay accessible
            behind a disclosure so contributor builds (no bundled creds)
            and power users (their own OAuth App) still have a path.
          */}
          {hasBundled ? (
            <ConnectWithBundled
              connecting={connecting}
              onConnect={() => void handleConnect()}
              onUseGhCli={() => void handleUseGhCli()}
              advancedOpen={showAdvanced}
              onToggleAdvanced={() => setShowAdvanced((v) => !v)}
            />
          ) : (
            <div className="text-[12px] text-[var(--text-muted)]">
              This build does not bundle Lamprey's OAuth App credentials. Use one
              of the manual paths below.
            </div>
          )}

          {(showAdvanced || !hasBundled) && (
            <div className={hasBundled ? 'space-y-3 border-t border-[var(--panel-border)] pt-3' : 'space-y-3'}>
              <div>
                <div className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                  Bring your own OAuth App
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
                  Register one at{' '}
                  <a
                    href="https://github.com/settings/developers"
                    onClick={(e) => {
                      e.preventDefault()
                      void githubClient
                        .openInBrowser('https://github.com/settings/developers')
                        .catch(() => {
                          /* gating handles the toast */
                        })
                    }}
                    className="text-[var(--accent)] hover:underline"
                  >
                    github.com/settings/developers
                  </a>
                  . Callback URL: <code className="font-mono">http://localhost:9876/callback</code>.
                  Paste the client ID + secret below.
                </p>
              </div>
              {hasClient && !editingClient ? (
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[12px] text-[var(--text-secondary)]">
                    Client credentials saved.
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingClient(true)}
                    className="rounded border border-[var(--panel-border)] bg-transparent px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                  >
                    Replace
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="OAuth App Client ID (Iv1.xxxxx)"
                    className="w-full rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                  <div className="flex gap-2">
                    <input
                      type={showSecret ? 'text' : 'password'}
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder="OAuth App Client Secret"
                      className="flex-1 rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      className="rounded border border-[var(--panel-border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      {showSecret ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSaveClient()}
                      disabled={savingClient || !clientId.trim() || !clientSecret.trim()}
                      className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      Save client
                    </button>
                    {hasClient && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingClient(false)
                          setClientId('')
                          setClientSecret('')
                        }}
                        className="rounded border border-[var(--panel-border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 border-t border-[var(--panel-border)] pt-3">
                <button
                  type="button"
                  onClick={() => void handleConnect()}
                  disabled={connecting || !hasClient}
                  className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  title={hasClient ? 'Open browser to GitHub authorize page' : 'Save OAuth client credentials first'}
                >
                  {connecting ? 'Waiting for browser…' : 'Connect with your OAuth App'}
                </button>
                {!hasBundled && (
                  <button
                    type="button"
                    onClick={() => void handleUseGhCli()}
                    className="rounded border border-[var(--panel-border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                  >
                    Use local `gh` CLI
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {status?.connected && (
        <RepoCounter repos={repos} loading={loadingRepos} onRefresh={refreshRepos} />
      )}
    </div>
  )
}

interface StatusCardProps {
  status: ReturnType<typeof useGitHubStore.getState>['status']
  loading: boolean
  onDisconnect: () => void
  onRefresh: () => void
}

function StatusCard({ status, loading, onDisconnect, onRefresh }: StatusCardProps): React.ReactElement {
  const modeLabel: Record<string, string> = {
    oauth: 'OAuth token',
    github_app: 'GitHub App',
    'gh-cli': 'Local gh CLI',
    none: 'Not connected'
  }
  const dotClass =
    status?.connected ? 'bg-[var(--success)]' : status?.reason ? 'bg-[var(--warning)]' : 'bg-[var(--text-muted)]'

  return (
    <div className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {status?.avatarUrl ? (
            <img
              src={status.avatarUrl}
              alt=""
              width={32}
              height={32}
              className="rounded-full border border-[var(--panel-border)]"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--panel-border)] bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
              <GitHubGlyph />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
              <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                {status?.connected ? `@${status.login}` : 'Not connected'}
              </span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {modeLabel[status?.mode ?? 'none'] ?? status?.mode}
              </span>
            </div>
            {status?.scopes && status.scopes.length > 0 && (
              <div className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">
                scopes: {status.scopes.join(', ')}
              </div>
            )}
            {status?.reason && !status.connected && (
              <div className="mt-1 text-[11px] text-[var(--warning)]">{status.reason}</div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="rounded border border-[var(--panel-border)] bg-transparent px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {status?.connected && (
            <button
              type="button"
              onClick={onDisconnect}
              className="rounded border border-[var(--panel-border)] bg-transparent px-3 py-1 text-xs text-[var(--error)] hover:bg-[var(--error)]/10"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface RepoCounterProps {
  repos: GitHubRepository[]
  loading: boolean
  onRefresh: () => void
}

function RepoCounter({ repos, loading, onRefresh }: RepoCounterProps): React.ReactElement {
  return (
    <div className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
            Accessible repositories
          </div>
          <div className="mt-1 text-[12px] text-[var(--text-muted)]">
            {loading ? 'Loading…' : `${repos.length} repos visible to this token`}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={loading}
          className="rounded border border-[var(--panel-border)] bg-transparent px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
        >
          Refresh repo list
        </button>
      </div>
    </div>
  )
}

interface ConnectWithBundledProps {
  connecting: boolean
  onConnect: () => void
  onUseGhCli: () => void
  advancedOpen: boolean
  onToggleAdvanced: () => void
}

function ConnectWithBundled({
  connecting,
  onConnect,
  onUseGhCli,
  advancedOpen,
  onToggleAdvanced
}: ConnectWithBundledProps): React.ReactElement {
  return (
    <div className="space-y-3">
      <div>
        <div className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
          Connect with Lamprey
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
          Authorize in your browser. Lamprey will ask for{' '}
          <code className="font-mono">read:user</code> and{' '}
          <code className="font-mono">repo</code> scope.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConnect}
          disabled={connecting}
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {connecting ? 'Waiting for browser…' : 'Connect GitHub'}
        </button>
        <button
          type="button"
          onClick={onUseGhCli}
          className="rounded border border-[var(--panel-border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          Use local `gh` CLI
        </button>
        <button
          type="button"
          onClick={onToggleAdvanced}
          className="ml-auto rounded border border-transparent bg-transparent px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          {advancedOpen ? 'Hide advanced ▴' : 'Advanced ▾'}
        </button>
      </div>
    </div>
  )
}

function GitHubGlyph(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  )
}
