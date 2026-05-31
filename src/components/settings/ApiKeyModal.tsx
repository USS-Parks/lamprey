import { useEffect, useState } from 'react'
import type { ProviderInfo } from '@/lib/types'

interface ApiKeyModalProps {
  onComplete: () => void
}

interface ProviderEntry extends ProviderInfo {
  hasKey: boolean
}

export function ApiKeyModal({ onComplete }: ApiKeyModalProps) {
  const [providers, setProviders] = useState<ProviderEntry[]>([])
  const [selected, setSelected] = useState<string>('deepseek')
  const [key, setKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      const result = await window.api.settings.listProviderKeys()
      if (result.success) {
        const list = result.data as ProviderEntry[]
        setProviders(list)
        const firstMissing = list.find((p) => !p.hasKey)
        if (firstMissing) setSelected(firstMissing.id)
      }
    })()
  }, [])

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
      if (result.success && result.data) {
        onComplete()
      } else {
        setError('Invalid API key. Check it and try again.')
      }
    } catch {
      setError('Connection failed. Check your network and try again.')
    } finally {
      setTesting(false)
    }
  }

  const currentProvider = providers.find((p) => p.id === selected)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="w-[460px] rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
        <h2 className="font-mono text-lg font-semibold text-[var(--text-primary)]">
          Welcome to the Lamprey Harness
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Multi-agent coding UI for DeepSeek V4 Pro &amp; Flash, Gemma, and Qwen. Drop in a key for at
          least one provider to get started — you can add the rest from Settings → API Keys later.
        </p>

        <label className="mt-4 block">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Provider</span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.hasKey ? ' · key already stored' : ''}
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
            className="mt-2 inline-block font-mono text-[10px] text-[var(--accent)] hover:underline"
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
          {testing ? 'Validating…' : 'Connect'}
        </button>

        <p className="mt-3 text-[10px] text-[var(--text-muted)]">
          Keys are encrypted with OS-level storage (safeStorage) and never leave this device except to
          call the provider's own API.
        </p>
      </div>
    </div>
  )
}
