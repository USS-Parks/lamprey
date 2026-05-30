import { useState } from 'react'

interface ApiKeyModalProps {
  onComplete: () => void
}

export function ApiKeyModal({ onComplete }: ApiKeyModalProps) {
  const [key, setKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!key.trim()) return
    setTesting(true)
    setError('')

    try {
      await window.api.settings.saveApiKey(key.trim())
      const result = await window.api.settings.testApiKey()
      if (result.success && result.data) {
        onComplete()
      } else {
        setError('Invalid API key. Check your key and try again.')
      }
    } catch {
      setError('Connection failed. Check your network and try again.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="w-[420px] rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
        <h2 className="font-mono text-lg font-semibold text-[var(--text-primary)]">
          Welcome to Lamprey
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Enter your DeepSeek API key to get started.
        </p>

        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="sk-..."
          className="mt-4 w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          autoFocus
        />

        {error && (
          <p className="mt-2 text-xs text-[var(--error)]">{error}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={!key.trim() || testing}
          className="mt-4 w-full rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {testing ? 'Validating...' : 'Connect'}
        </button>

        <p className="mt-3 text-[10px] text-[var(--text-muted)]">
          Your key is encrypted using OS-level storage and never leaves this device.
        </p>
      </div>
    </div>
  )
}
