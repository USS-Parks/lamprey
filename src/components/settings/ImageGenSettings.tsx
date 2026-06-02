import { useEffect, useState } from 'react'
import { toast } from '@/stores/toast-store'

// Image Generation provider settings panel.
//
// Lets the user pick an image-gen provider (OpenAI today, Stability stub
// reserved), paste an API key (encrypted via safeStorage in the main
// process), choose a model + default canvas size, and run a small canary
// generation to confirm everything is wired up. The component never sees
// the stored key — `imageGen:getProvider` returns only `hasKey: boolean`.

type ImageGenProviderId = 'openai' | 'stability'

interface ProviderSnapshot {
  provider: ImageGenProviderId
  model: string
  size: string
  hasKey: boolean
}

interface TestSample {
  mimeType: string
  byteLength: number
}

interface TestResult {
  ok: boolean
  error?: string
  sample?: TestSample
}

interface ProviderOption {
  id: ImageGenProviderId
  label: string
  hint: string
  docsUrl: string
  models: Array<{ value: string; label: string }>
  /** True when the provider has a real implementation today. */
  available: boolean
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    id: 'openai',
    label: 'OpenAI Images',
    hint:
      'Uses OpenAI\'s Images API: gpt-image-1 for generate/edit, dall-e-2 for variations.',
    docsUrl: 'https://platform.openai.com/account/api-keys',
    models: [
      { value: 'gpt-image-1', label: 'gpt-image-1 (default)' },
      { value: 'dall-e-3', label: 'dall-e-3' },
      { value: 'dall-e-2', label: 'dall-e-2' }
    ],
    available: true
  },
  {
    id: 'stability',
    label: 'Stability AI',
    hint: 'Reserved. Provider stub returns "not yet implemented" today.',
    docsUrl: 'https://platform.stability.ai/account/keys',
    models: [{ value: 'stable-diffusion-xl', label: 'stable-diffusion-xl' }],
    available: false
  }
]

const SIZE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1024x1024', label: '1024 × 1024 (square)' },
  { value: '1024x1536', label: '1024 × 1536 (portrait)' },
  { value: '1536x1024', label: '1536 × 1024 (landscape)' },
  { value: 'auto', label: 'auto' }
]

function findProviderOption(id: ImageGenProviderId): ProviderOption {
  return PROVIDER_OPTIONS.find((p) => p.id === id) ?? PROVIDER_OPTIONS[0]
}

// Bridge into the preload `imageGen:*` channels. Typed locally so this file
// compiles before the preload bridge is wired up (the preload edit is owned
// by the session orchestrator). Once preload.ts exposes `window.api.imageGen`
// with the same shape, this cast becomes a no-op.
type IpcEnvelope<T> = { success: true; data: T } | { success: false; error: string }
interface ImageGenBridge {
  setProvider: (
    provider: ImageGenProviderId,
    opts?: { apiKey?: string; model?: string; size?: string }
  ) => Promise<IpcEnvelope<ProviderSnapshot>>
  getProvider: () => Promise<IpcEnvelope<ProviderSnapshot>>
  test: () => Promise<IpcEnvelope<TestResult>>
}

function imageGenBridge(): ImageGenBridge | null {
  const api = (window as unknown as { api?: { imageGen?: ImageGenBridge } }).api
  return api?.imageGen ?? null
}

export function ImageGenSettings() {
  const [snapshot, setSnapshot] = useState<ProviderSnapshot | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [model, setModel] = useState('')
  const [size, setSize] = useState('1024x1024')
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const bridge = imageGenBridge()
  const apiAvailable = bridge !== null

  const refresh = async () => {
    if (!bridge) return
    const res = await bridge.getProvider()
    if (res.success) {
      const data = res.data
      setSnapshot(data)
      setModel((m) => m || data.model || 'gpt-image-1')
      setSize((s) => s || data.size || '1024x1024')
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!apiAvailable) {
    return (
      <div className="space-y-3">
        <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">
          Image Generation
        </h3>
        <p className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-[13px] text-[var(--text-muted)]">
          Image generation settings are unavailable in this build. Update the
          preload bridge (`window.api.imageGen.*`) to expose this surface.
        </p>
      </div>
    )
  }

  const currentProvider: ImageGenProviderId = snapshot?.provider ?? 'openai'
  const option = findProviderOption(currentProvider)

  const handleProviderChange = async (next: ImageGenProviderId) => {
    if (!bridge) return
    setBusy(true)
    setTestResult(null)
    try {
      const opt = findProviderOption(next)
      const opts: { model?: string; size?: string } = {
        size: size || '1024x1024',
        model: opt.models[0]?.value
      }
      const res = await bridge.setProvider(next, opts)
      if (!res.success) {
        toast.error(`Failed to switch image provider: ${res.error}`)
        return
      }
      setModel(opt.models[0]?.value ?? '')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleSaveKey = async () => {
    if (!bridge) return
    const trimmed = keyDraft.trim()
    if (!trimmed) return
    setBusy(true)
    setTestResult(null)
    try {
      const res = await bridge.setProvider(currentProvider, {
        apiKey: trimmed,
        model: model || option.models[0]?.value,
        size: size || '1024x1024'
      })
      if (!res.success) {
        toast.error(`Failed to save key: ${res.error}`)
        return
      }
      toast.success(`${option.label} key saved`)
      setKeyDraft('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteKey = async () => {
    if (!bridge) return
    if (!confirm(`Delete the stored ${option.label} key?`)) return
    setBusy(true)
    setTestResult(null)
    try {
      const res = await bridge.setProvider(currentProvider, {
        apiKey: '',
        model: model || option.models[0]?.value,
        size: size || '1024x1024'
      })
      if (!res.success) {
        toast.error(`Failed to delete key: ${res.error}`)
        return
      }
      toast.success(`${option.label} key deleted`)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleSaveDefaults = async () => {
    if (!bridge) return
    setBusy(true)
    setTestResult(null)
    try {
      const res = await bridge.setProvider(currentProvider, {
        model: model || option.models[0]?.value,
        size: size || '1024x1024'
      })
      if (!res.success) {
        toast.error(`Failed to save defaults: ${res.error}`)
        return
      }
      toast.success('Image gen defaults saved')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleTest = async () => {
    if (!bridge) return
    setBusy(true)
    setTestResult(null)
    try {
      const res = await bridge.test()
      const data: TestResult = res.success
        ? res.data
        : { ok: false, error: res.error }
      setTestResult(data)
      if (data.ok) toast.success('Image gen test succeeded')
      else toast.error(`Image gen test failed: ${data.error ?? 'unknown'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">
          Image Generation
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Configure the provider that powers `image_generate`, `image_edit`,
          and `image_variation`. Keys are encrypted with safeStorage and
          stored locally; only the configured provider ever sees them.
        </p>
      </div>

      <section className="space-y-3 rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3">
        <label className="block">
          <span className="block font-mono text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
            Provider
          </span>
          <select
            value={currentProvider}
            onChange={(e) => handleProviderChange(e.target.value as ImageGenProviderId)}
            disabled={busy}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          >
            {PROVIDER_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.available ? '' : ' (stub)'}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[13px] leading-relaxed text-[var(--text-muted)]">
            {option.hint}
          </span>
        </label>

        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${
              snapshot?.hasKey ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'
            }`}
          />
          <span className="font-mono text-[12px] text-[var(--text-muted)]">
            {snapshot?.hasKey ? 'Key stored' : 'No key on file'}
          </span>
          <a
            href={option.docsUrl}
            onClick={(e) => {
              e.preventDefault()
              window.api?.artifact?.openExternal?.(option.docsUrl)
            }}
            className="ml-auto font-mono text-[12px] text-[var(--accent)] hover:underline"
          >
            Get a key →
          </a>
        </div>

        <div className="flex gap-2">
          <input
            type={showKey ? 'text' : 'password'}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder={snapshot?.hasKey ? 'Replace key...' : 'Paste API key'}
            disabled={busy}
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

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSaveKey}
            disabled={busy || !keyDraft.trim()}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Save key
          </button>
          <button
            onClick={handleDeleteKey}
            disabled={busy || !snapshot?.hasKey}
            className="rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs text-[var(--error)] transition-colors hover:bg-[var(--error)]/10 disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3">
        <h4 className="font-mono text-[13px] uppercase tracking-wider text-[var(--text-muted)]">
          Defaults
        </h4>

        <label className="block">
          <span className="block font-mono text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
            Model
          </span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          >
            {option.models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block font-mono text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
            Canvas size
          </span>
          <select
            value={size}
            onChange={(e) => setSize(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          >
            {SIZE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={handleSaveDefaults}
            disabled={busy}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Save defaults
          </button>
          <button
            onClick={handleTest}
            disabled={busy || !snapshot?.hasKey}
            className="rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            Test
          </button>
          {testResult && (
            <span
              className={`text-[13px] ${
                testResult.ok ? 'text-[var(--success)]' : 'text-[var(--error)]'
              }`}
            >
              {testResult.ok
                ? `OK · ${testResult.sample?.mimeType ?? 'image'} (${testResult.sample?.byteLength ?? 0} bytes)`
                : testResult.error ?? 'failed'}
            </span>
          )}
        </div>
      </section>
    </div>
  )
}
