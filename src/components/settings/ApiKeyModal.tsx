import { useEffect, useState } from 'react'
import type { ProviderInfo } from '@/lib/types'

interface ApiKeyModalProps {
  onComplete: () => void
  onDismiss?: () => void
  defaultProvider?: string
  required?: boolean
}

interface ProviderEntry extends ProviderInfo {
  hasKey: boolean
}

export function ApiKeyModal({ onComplete, onDismiss, defaultProvider, required = true }: ApiKeyModalProps) {
  const [providers, setProviders] = useState<ProviderEntry[]>([])
  const [selected, setSelected] = useState<string>(defaultProvider ?? 'deepseek')
  const [key, setKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      const result = await window.api.settings.listProviderKeys()
      if (result.success) {
        const list = result.data as ProviderEntry[]
        setProviders(list)
        if (defaultProvider && list.some((p) => p.id === defaultProvider)) {
          setSelected(defaultProvider)
          return
        }
        const firstMissing = list.find((p) => !p.hasKey)
        if (firstMissing) setSelected(firstMissing.id)
      }
    })()
  }, [defaultProvider])

  const handleSubmit = async () => {
    if (!key.trim()) return
    setTesting(true)
    setError('')

    try {
      const save = await window.api.settings.saveProviderKey(selected, key.trim())
      if (!save.success) {
        setError(save.error || 'Failed to save key.')
        return
      }
      const result = await window.api.settings.testProviderKey(selected)
      const data = result.success
        ? (result.data as { ok: boolean; reason?: string } | boolean | undefined)
        : undefined
      if (typeof data === 'object' && data !== null) {
        if (data.ok) {
          onComplete()
        } else {
          setError(data.reason || 'Provider rejected the key.')
        }
      } else if (typeof data === 'boolean') {
        if (data) onComplete()
        else setError('Provider rejected the key.')
      } else {
        setError(result.success ? 'No response from provider.' : (result.error || 'Unknown error.'))
      }
    } catch {
      setError('Connection failed. Check your network and try again.')
    } finally {
      setTesting(false)
    }
  }

  const currentProvider = providers.find((p) => p.id === selected)
  const scoped = !!defaultProvider

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="relative w-[460px] rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
        {!required && onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Close"
            title="Close"
            className="absolute right-3 top-3 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        <h2 className="font-mono text-lg font-semibold text-[var(--text-primary)]">
          {scoped && currentProvider ? `Add a ${currentProvider.label} API key` : 'Welcome to the Lamprey Harness'}
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Bring your own key for any supported provider. Paste a real key from that provider's
          dashboard; we authenticate against the provider's published API endpoint before unlocking
          its models.
        </p>

        <label className="mt-4 block">
          <span className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">Provider</span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.hasKey ? ' (key stored)' : ''}
              </option>
            ))}
          </select>
        </label>

        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder={selected === 'deepseek' ? 'sk-...' : 'API key'}
          className="mt-3 w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          autoFocus
        />

        {currentProvider && (
          <a
            href={currentProvider.docsUrl}
            onClick={(e) => {
              e.preventDefault()
              window.api?.artifact?.openExternal?.(currentProvider.docsUrl)
            }}
            className="mt-2 inline-block font-mono text-[12px] text-[var(--accent)] hover:underline"
          >
            Get a {currentProvider.label} key →
          </a>
        )}

        {error && <p className="mt-2 text-xs text-[var(--error)]">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={!key.trim() || testing}
          className="mt-4 w-full rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {testing ? 'Validating...' : 'Connect'}
        </button>

        <p className="mt-3 text-[12px] text-[var(--text-muted)]">
          Keys are encrypted with OS-level storage (Electron safeStorage) and never leave this
          device except to call the provider's own API.
        </p>
      </div>
    </div>
  )
}
