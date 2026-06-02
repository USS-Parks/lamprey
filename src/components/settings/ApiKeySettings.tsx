import { useEffect, useState } from 'react'
import { toast } from '@/stores/toast-store'
import type { ProviderInfo } from '@/lib/types'

interface ProviderEntry extends ProviderInfo {
  hasKey: boolean
}

interface TestResult {
  ok: boolean
  message: string
}

export function ApiKeySettings() {
  const [providers, setProviders] = useState<ProviderEntry[]>([])
  const [encrypted, setEncrypted] = useState<boolean | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [showKey, setShowKey] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<Record<string, TestResult | null>>({})

  const refresh = async () => {
    if (!window.api) return
    const [list, enc] = await Promise.all([
      window.api.settings.listProviderKeys(),
      window.api.settings.isEncryptionAvailable()
    ])
    if (list.success) setProviders(list.data as ProviderEntry[])
    setEncrypted(enc.success ? Boolean(enc.data) : false)
  }

  useEffect(() => {
    refresh()
  }, [])

  const handleSave = async (providerId: string) => {
    const trimmed = (drafts[providerId] || '').trim()
    if (!trimmed) return
    setBusy(providerId)
    setTestStatus((s) => ({ ...s, [providerId]: null }))
    try {
      const save = await window.api.settings.saveProviderKey(providerId, trimmed)
      if (!save.success) {
        toast.error(`Failed to save ${providerId} key: ${save.error}`)
        return
      }
      toast.success(`${providerId} key saved`)
      setDrafts((s) => ({ ...s, [providerId]: '' }))
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const handleTest = async (providerId: string, label: string) => {
    setBusy(providerId)
    setTestStatus((s) => ({ ...s, [providerId]: null }))
    try {
      const result = await window.api.settings.testProviderKey(providerId)
      // The IPC handler now returns { ok, reason?, modelCount? } in `data`.
      const data = (result.success ? (result.data as { ok: boolean; reason?: string; modelCount?: number } | boolean | undefined) : undefined)
      if (typeof data === 'object' && data !== null) {
        if (data.ok) {
          const detail = typeof data.modelCount === 'number'
            ? `${label} authenticated (${data.modelCount} models exposed by /v1/models).`
            : `${label} authenticated.`
          setTestStatus((s) => ({ ...s, [providerId]: { ok: true, message: detail } }))
          toast.success(`${label} key valid`)
        } else {
          const reason = data.reason || 'Provider rejected the key.'
          setTestStatus((s) => ({ ...s, [providerId]: { ok: false, message: reason } }))
          toast.error(`${label} key check failed: ${reason}`)
        }
      } else if (typeof data === 'boolean') {
        const msg = data ? `${label} authenticated.` : 'Provider rejected the key.'
        setTestStatus((s) => ({ ...s, [providerId]: { ok: data, message: msg } }))
        if (data) toast.success(`${label} key valid`)
        else toast.error(`Invalid ${label} key`)
      } else {
        const reason = result.success ? 'No response from provider.' : (result.error || 'Unknown error.')
        setTestStatus((s) => ({ ...s, [providerId]: { ok: false, message: reason } }))
        toast.error(`${label} test failed: ${reason}`)
      }
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown error'
      setTestStatus((s) => ({ ...s, [providerId]: { ok: false, message: msg } }))
      toast.error(`${label} test failed: ${msg}`)
    }
    setBusy(null)
  }

  const handleDelete = async (providerId: string, label: string) => {
    if (!confirm(`Delete the stored ${label} API key?`)) return
    setBusy(providerId)
    try {
      const result = await window.api.settings.deleteProviderKey(providerId)
      if (!result.success) {
        toast.error(`Failed to delete ${label} key: ${result.error}`)
        return
      }
      toast.success(`${label} key deleted`)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">Provider API keys</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Each model routes to a real provider over its published API endpoint. Add a key per
          provider to unlock that provider's models. Keys are encrypted with Electron safeStorage
          and stored locally in your userData directory; they are only transmitted to the provider
          they belong to.
        </p>
      </div>

      <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-[13px]">
        <div className="flex items-center gap-2 text-[var(--text-muted)]">
          <span
            className={`inline-block rounded px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider ${
              encrypted
                ? 'bg-[var(--success)]/15 text-[var(--success)]'
                : encrypted === false
                ? 'bg-[var(--warning)]/15 text-[var(--warning)]'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
            }`}
          >
            {encrypted === null ? 'checking' : encrypted ? 'encrypted' : 'plaintext'}
          </span>
          <span>
            {encrypted === null
              ? 'Checking storage backend...'
              : encrypted
              ? 'Stored using OS-level encryption (Electron safeStorage), persisted to userData/keys.json.'
              : 'safeStorage is unavailable on this host. Keys are written as plaintext. Install libsecret (Linux) or run on a host with a native keychain.'}
          </span>
        </div>
      </div>

      {providers.map((p) => {
        const draft = drafts[p.id] || ''
        const visible = showKey[p.id] || false
        const status = testStatus[p.id]
        return (
          <div key={p.id} className="space-y-2 rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={`inline-block h-2 w-2 rounded-full ${
                      p.hasKey ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'
                    }`}
                  />
                  <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                    {p.label}
                  </span>
                  <span className="font-mono text-[12px] text-[var(--text-muted)]">
                    {p.hasKey ? 'Stored' : 'No key'}
                  </span>
                </div>
                <a
                  href={p.docsUrl}
                  onClick={(e) => {
                    e.preventDefault()
                    window.api?.artifact?.openExternal?.(p.docsUrl)
                  }}
                  className="mt-1 inline-block font-mono text-[12px] text-[var(--accent)] hover:underline"
                >
                  Get a key →
                </a>
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type={visible ? 'text' : 'password'}
                value={draft}
                onChange={(e) => setDrafts((s) => ({ ...s, [p.id]: e.target.value }))}
                placeholder={p.hasKey ? 'Replace key...' : 'Paste API key'}
                className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => ({ ...s, [p.id]: !visible }))}
                className="rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                {visible ? 'Hide' : 'Show'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={() => handleSave(p.id)}
                disabled={busy === p.id || !draft.trim()}
                className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Save key
              </button>
              <button
                onClick={() => handleTest(p.id, p.label)}
                disabled={busy === p.id || !p.hasKey}
                className="rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
              >
                Test
              </button>
              <button
                onClick={() => handleDelete(p.id, p.label)}
                disabled={busy === p.id || !p.hasKey}
                className="rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs text-[var(--error)] transition-colors hover:bg-[var(--error)]/10 disabled:opacity-40"
              >
                Delete
              </button>
              {status && (
                <span
                  className={`text-[13px] ${
                    status.ok ? 'text-[var(--success)]' : 'text-[var(--error)]'
                  }`}
                >
                  {status.message}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
