import { useEffect, useState } from 'react'
import { toast } from '@/stores/toast-store'

export function ApiKeySettings() {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [encrypted, setEncrypted] = useState<boolean | null>(null)
  const [newKey, setNewKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testStatus, setTestStatus] = useState<string | null>(null)

  const refresh = async () => {
    if (!window.api) return
    const [keyResult, encResult] = await Promise.all([
      window.api.settings.hasApiKey(),
      window.api.settings.isEncryptionAvailable()
    ])
    setHasKey(keyResult.success ? Boolean(keyResult.data) : false)
    setEncrypted(encResult.success ? Boolean(encResult.data) : false)
  }

  useEffect(() => {
    refresh()
  }, [])

  const handleSave = async () => {
    const trimmed = newKey.trim()
    if (!trimmed) return
    setBusy(true)
    setTestStatus(null)
    try {
      const save = await window.api.settings.saveApiKey(trimmed)
      if (!save.success) {
        toast.error(`Failed to save key: ${save.error}`)
        return
      }
      toast.success('API key saved')
      setNewKey('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleTest = async () => {
    if (!window.api) return
    setBusy(true)
    setTestStatus(null)
    try {
      const result = await window.api.settings.testApiKey()
      if (result.success && result.data) {
        setTestStatus('Key valid — DeepSeek responded')
        toast.success('API key valid')
      } else {
        setTestStatus('Invalid key — DeepSeek rejected the request')
        toast.error('Invalid API key')
      }
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown error'
      setTestStatus(`Error: ${msg}`)
      toast.error(`Test failed: ${msg}`)
    }
    setBusy(false)
  }

  const handleDelete = async () => {
    if (!window.api) return
    if (
      !confirm(
        'Delete the stored DeepSeek API key? You will need to re-enter it before sending another message.'
      )
    )
      return
    setBusy(true)
    try {
      const result = await window.api.settings.deleteApiKey()
      if (!result.success) {
        toast.error(`Failed to delete key: ${result.error}`)
        return
      }
      toast.success('API key deleted')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">API key</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Used to authenticate requests to DeepSeek. Stored locally, never sent to anyone but
          DeepSeek's API.
        </p>
      </div>

      <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-[11px]">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${
              hasKey === null
                ? 'bg-[var(--text-muted)]'
                : hasKey
                ? 'bg-[var(--success)]'
                : 'bg-[var(--warning)]'
            }`}
          />
          <span className="font-mono text-xs text-[var(--text-primary)]">
            {hasKey === null ? 'Checking…' : hasKey ? 'Stored' : 'No key configured'}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[var(--text-muted)]">
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

      <div className="space-y-2 rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            {hasKey ? 'Replace API key' : 'Set API key'}
          </span>
          <div className="flex gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="sk-..."
              className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={busy || !newKey.trim()}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Save key
          </button>
          <button
            onClick={handleTest}
            disabled={busy || !hasKey}
            className="rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            Test connection
          </button>
          <button
            onClick={handleDelete}
            disabled={busy || !hasKey}
            className="rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs text-[var(--error)] transition-colors hover:bg-[var(--error)]/10 disabled:opacity-40"
          >
            Delete key
          </button>
          {testStatus && (
            <span
              className={`text-[11px] ${
                testStatus.startsWith('Invalid') || testStatus.startsWith('Error')
                  ? 'text-[var(--error)]'
                  : 'text-[var(--success)]'
              }`}
            >
              {testStatus}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
