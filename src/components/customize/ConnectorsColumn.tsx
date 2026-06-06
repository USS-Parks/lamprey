import { useEffect, useMemo, useState } from 'react'
import type { McpServerConfig } from '@/lib/types'
import { useMcpStore } from '@/stores/mcp-store'
import { toast } from '@/stores/toast-store'
import { ensurePlaintextConsentIfNeeded } from '@/lib/keychain-consent'
import { AddConnectorFlow } from './AddConnectorFlow'

type ServerWithStatus = McpServerConfig & { error?: string }

function statusBadge(server: ServerWithStatus): { dotClass: string; label: string; sub?: string } {
  switch (server.status) {
    case 'connected':
      return { dotClass: 'bg-[var(--success)]', label: 'Connected' }
    case 'connecting':
      return { dotClass: 'bg-[var(--warning)] animate-pulse', label: 'Connecting' }
    case 'error':
      return { dotClass: 'bg-[var(--error)]', label: 'Error', sub: server.error }
    default:
      return { dotClass: 'bg-[var(--text-muted)]', label: 'Disconnected' }
  }
}

function authBadge(auth: McpServerConfig['auth']): string | null {
  if (auth === 'google-oauth') return 'google-oauth'
  return null
}

interface GoogleOAuthPanelProps {
  onComplete: () => Promise<void>
}

function GoogleOAuthPanel({ onComplete }: GoogleOAuthPanelProps) {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [oauthBusy, setOauthBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const onSaveCreds = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return
    const consent = await ensurePlaintextConsentIfNeeded()
    if (!consent) return
    setSaving(true)
    try {
      const result = await window.api.settings.saveGoogleCredentials(
        clientId.trim(),
        clientSecret.trim()
      )
      if (result.success) {
        toast.success('Google credentials saved')
        setStatus('Credentials saved. Click Connect to authorize.')
      } else {
        toast.error(`Failed to save credentials: ${result.error}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const onAuthorize = async () => {
    const consent = await ensurePlaintextConsentIfNeeded()
    if (!consent) {
      toast.error('Google connect cancelled — plaintext storage not authorised.')
      return
    }
    setOauthBusy(true)
    setStatus(null)
    try {
      const result = await window.api.mcp.setupGoogleOAuth()
      if (result.success) {
        setStatus('Connected.')
        toast.success('Google account connected')
        await onComplete()
      } else {
        setStatus(`Error: ${result.error}`)
        toast.error(`Google OAuth failed: ${result.error}`)
      }
    } catch (err) {
      setStatus('OAuth flow failed')
      toast.error(`OAuth flow failed: ${(err as Error).message ?? 'unknown error'}`)
    } finally {
      setOauthBusy(false)
    }
  }

  return (
    <div className="space-y-2 border-t border-[var(--panel-border)] bg-[var(--bg-tertiary)]/30 px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Google OAuth
        </span>
        <span className="text-[11px] text-[var(--text-secondary)]">
          Required for Gmail / Drive connectors.
        </span>
      </div>
      <input
        type="password"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        placeholder="client_id"
        className="w-full rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      />
      <input
        type="password"
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
        placeholder="client_secret"
        className="w-full rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => void onSaveCreds()}
          disabled={saving || !clientId.trim() || !clientSecret.trim()}
          className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] hover:border-[var(--accent)] disabled:opacity-50"
        >
          Save credentials
        </button>
        <button
          onClick={() => void onAuthorize()}
          disabled={oauthBusy}
          className="rounded border border-[var(--accent)] bg-[var(--accent)] px-2 py-1 text-[11px] text-white hover:opacity-90 disabled:opacity-50"
        >
          {oauthBusy ? 'Waiting…' : 'Connect Google'}
        </button>
      </div>
      {status && (
        <p
          className={`text-[11px] ${
            status.startsWith('Error') ? 'text-[var(--error)]' : 'text-[var(--text-secondary)]'
          }`}
        >
          {status}
        </p>
      )}
    </div>
  )
}

export function ConnectorsColumn() {
  const servers = useMcpStore((s) => s.servers)
  const loadServers = useMcpStore((s) => s.loadServers)
  const reconnect = useMcpStore((s) => s.reconnect)
  const [filter, setFilter] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    void loadServers()
  }, [loadServers])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return servers
    return servers.filter(
      (s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
    )
  }, [servers, filter])

  const needsGoogleOAuth = servers.some((s) => s.auth === 'google-oauth')

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--panel-border)] px-3 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${servers.length} connector${servers.length === 1 ? '' : 's'}…`}
          className="min-w-0 flex-1 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={() => setAddOpen(true)}
          className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] hover:border-[var(--accent)]"
          title="Add a connector"
        >
          + Add
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">
            {servers.length === 0
              ? 'No connectors configured yet.'
              : 'No connectors match this filter.'}
          </div>
        )}
        {filtered.map((server) => {
          const badge = statusBadge(server)
          const auth = authBadge(server.auth)
          return (
            <div
              key={server.id}
              className="group mb-1 flex items-start gap-2 rounded border border-transparent p-2 hover:border-[var(--panel-border)] hover:bg-[var(--bg-tertiary)]"
            >
              <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${badge.dotClass}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                    {server.name}
                  </span>
                  <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                    {server.transport}
                  </span>
                  {auth && (
                    <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-[var(--accent)]">
                      {auth}
                    </span>
                  )}
                  {server.pluginId && (
                    <span
                      className="rounded bg-[var(--bg-tertiary)] px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-[var(--accent)]"
                      title={`From plugin: ${server.pluginId}`}
                    >
                      plugin: {server.pluginId}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                  {badge.label}
                  {badge.sub ? ` — ${badge.sub}` : ''}
                </div>
              </div>
              <button
                onClick={() => void reconnect(server.id)}
                disabled={server.status === 'connecting'}
                className="shrink-0 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] hover:border-[var(--accent)] disabled:opacity-50"
              >
                Reconnect
              </button>
            </div>
          )
        })}
      </div>

      {needsGoogleOAuth && <GoogleOAuthPanel onComplete={loadServers} />}

      {addOpen && <AddConnectorFlow onClose={() => setAddOpen(false)} />}
    </div>
  )
}
