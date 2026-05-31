import { useEffect, useState } from 'react'
import { toast } from '@/stores/toast-store'
import type { ProviderInfo } from '@/lib/types'

interface ProviderEntry extends ProviderInfo {
  hasKey: boolean
}

export function ApiKeySettings() {
  const [providers, setProviders] = useState<ProviderEntry[]>([])
  const [encrypted, setEncrypted] = useState<boolean | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [showKey, setShowKey] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<Record<string, string | null>>({})

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
      if (result.success && result.data) {
        setTestStatus((s) => ({ ...s, [providerId]: `${label} responded` }))
        toast.success(`${label} key valid`)
      } else {
        setTestStatus((s) => ({ ...s, [providerId]: 'Invalid or rejected' }))
        toast.error(`Invalid ${label} key`)
      }
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown error'
      setTestStatus((s) => ({ ...s, [providerId]: `Error: ${msg}` }))
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
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Lamprey routes each model to its provider. Add a key for any provider whose models you want to use —
          DeepSeek (V4 Pro/Flash, V3, R1), Google (Gemma), or Alibaba DashScope (Qwen). Keys are stored
          locally and never transmitted anywhere except their own provider.
        </p>
      </div>

      <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-[11px]">
        <div className="flex items-center gap-2 text-[var(--text-muted)]">
          <span aria-hidden>{encrypted ? '🔒' : '⚠'}</span>
          <span>
            {encrypted === null
              ? 'Checking storage backend…'
              : encrypted
              ? 'Stored using OS encryption (safeStorage).'
              : 'Warning: stored as plaintext — install libsecret or run on a host with native keychain support.'}
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
                  <span className="font-mono text-[10px] text-[var(--text-muted)]">
                    {p.hasKey ? 'Stored' : 'No key'}
                  </span>
                </div>
                <a
                  href={p.docsUrl}
                  onClick={(e) => {
                    e.preventDefault()
                    window.api?.artifact?.openExternal?.(p.docsUrl)
                  }}
                  className="mt-1 inline-block font-mono text-[10px] text-[var(--accent)] hover:underline"
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
                placeholder={p.hasKey ? 'Replace key…' : 'Paste API key'}
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
                  className={`text-[11px] ${
                    status.startsWith('Invalid') || status.startsWith('Error')
                      ? 'text-[var(--error)]'
                      : 'text-[var(--success)]'
                  }`}
                >
                  {status}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
