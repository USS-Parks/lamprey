import { useEffect, useState } from 'react'
import { toast } from '@/stores/toast-store'

// Web-tools settings panel.
//
// Lets the user pick a search provider (Brave, Tavily, SerpAPI, SearXNG),
// store its API key (for the first three) or endpoint (for SearXNG), and
// run a one-query smoke test. API keys are written to the keychain in main;
// the renderer never sees raw key material — `hasKey` is the only signal we
// get back. Settings are persisted to userData/settings.json under the
// `webTools` key.

type ProviderId = 'brave' | 'tavily' | 'serpapi' | 'searxng'

interface ProviderEntry {
  id: ProviderId
  label: string
  requiresKey: boolean
  requiresEndpoint: boolean
  hasKey: boolean
  active: boolean
}

interface ProviderState {
  provider: ProviderId
  searxngEndpoint: string | null
  providers: ProviderEntry[]
}

interface TestStatus {
  ok: boolean
  message: string
}

// Lightweight escape hatch: preload.ts is owned by the main integrator,
// so until they wire window.api.webTools we read through ipcRenderer via
// the structured-but-untyped surface. Once preload is updated this cast
// becomes a no-op.
type WebToolsApi = {
  setProvider: (
    provider: ProviderId,
    opts: { apiKey?: string; endpoint?: string }
  ) => Promise<{ success: boolean; error?: string }>
  getProvider: () => Promise<{ success: boolean; data?: ProviderState; error?: string }>
  testAdapter: () => Promise<{
    success: boolean
    data?: { ok: boolean; error?: string }
    error?: string
  }>
  deleteKey?: (provider: ProviderId) => Promise<{ success: boolean; error?: string }>
}

function getApi(): WebToolsApi | null {
  if (typeof window === 'undefined') return null
  const api = (window as unknown as { api?: { webTools?: WebToolsApi } }).api
  return api?.webTools ?? null
}

const DOC_LINKS: Record<ProviderId, string> = {
  brave: 'https://api.search.brave.com/app/keys',
  tavily: 'https://app.tavily.com/home',
  serpapi: 'https://serpapi.com/manage-api-key',
  searxng: 'https://docs.searxng.org/admin/installation.html'
}

export function WebToolsSettings() {
  const [state, setState] = useState<ProviderState | null>(null)
  const [drafts, setDrafts] = useState<Record<ProviderId, string>>({
    brave: '',
    tavily: '',
    serpapi: '',
    searxng: ''
  })
  const [showKey, setShowKey] = useState<Record<ProviderId, boolean>>({
    brave: false,
    tavily: false,
    serpapi: false,
    searxng: false
  })
  const [endpoint, setEndpoint] = useState<string>('')
  const [busy, setBusy] = useState<ProviderId | 'test' | null>(null)
  const [testStatus, setTestStatus] = useState<TestStatus | null>(null)
  const [apiMissing, setApiMissing] = useState(false)

  const refresh = async () => {
    const api = getApi()
    if (!api) {
      setApiMissing(true)
      return
    }
    setApiMissing(false)
    try {
      const result = await api.getProvider()
      if (result.success && result.data) {
        setState(result.data)
        setEndpoint(result.data.searxngEndpoint ?? '')
      }
    } catch (err) {
      console.error('[WebToolsSettings] refresh failed', err)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const handleActivate = async (id: ProviderId) => {
    const api = getApi()
    if (!api) return
    setBusy(id)
    try {
      const r = await api.setProvider(id, {})
      if (!r.success) {
        toast.error(`Failed to activate ${id}: ${r.error}`)
        return
      }
      toast.success(`Active provider: ${id}`)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const handleSaveKey = async (id: ProviderId) => {
    const api = getApi()
    if (!api) return
    const draft = drafts[id].trim()
    if (!draft) return
    setBusy(id)
    setTestStatus(null)
    try {
      const r = await api.setProvider(id, { apiKey: draft })
      if (!r.success) {
        toast.error(`Failed to save ${id} key: ${r.error}`)
        return
      }
      toast.success(`${id} key saved`)
      setDrafts((s) => ({ ...s, [id]: '' }))
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const handleSaveEndpoint = async () => {
    const api = getApi()
    if (!api) return
    const trimmed = endpoint.trim()
    if (!trimmed) return
    setBusy('searxng')
    try {
      const r = await api.setProvider('searxng', { endpoint: trimmed })
      if (!r.success) {
        toast.error(`Failed to save SearXNG endpoint: ${r.error}`)
        return
      }
      toast.success('SearXNG endpoint saved')
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const handleDeleteKey = async (id: ProviderId) => {
    const api = getApi()
    if (!api?.deleteKey) return
    if (!confirm(`Delete stored ${id} API key?`)) return
    setBusy(id)
    try {
      const r = await api.deleteKey(id)
      if (!r.success) {
        toast.error(`Failed to delete ${id} key: ${r.error}`)
        return
      }
      toast.success(`${id} key deleted`)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const handleTest = async () => {
    const api = getApi()
    if (!api) return
    setBusy('test')
    setTestStatus(null)
    try {
      const result = await api.testAdapter()
      if (!result.success) {
        const msg = result.error ?? 'Test failed.'
        setTestStatus({ ok: false, message: msg })
        toast.error(`Web search test failed: ${msg}`)
        return
      }
      if (result.data?.ok) {
        setTestStatus({ ok: true, message: 'Adapter responded with at least one result.' })
        toast.success('Web search test passed')
      } else {
        const msg = result.data?.error ?? 'Adapter returned no results.'
        setTestStatus({ ok: false, message: msg })
        toast.error(`Web search test failed: ${msg}`)
      }
    } finally {
      setBusy(null)
    }
  }

  if (apiMissing) {
    return (
      <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-[13px] text-[var(--text-muted)]">
        Web tools settings are unavailable — running outside Electron, or preload has not exposed
        the <code>webTools</code> namespace yet.
      </div>
    )
  }

  if (!state) {
    return (
      <div className="text-[13px] text-[var(--text-muted)]">Loading web tools settings…</div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">Web tools</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Pick the search provider that powers <code>web_search</code>, <code>web_open</code>,{' '}
          <code>web_find</code>, and <code>image_search</code>. Brave / Tavily / SerpAPI need an
          API key; SearXNG only needs the URL of a SearXNG instance you trust. Keys are encrypted
          with safeStorage in your userData directory; only the configured provider ever sees them.
        </p>
      </div>

      <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            Active provider
          </span>
          <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
            {state.provider}
          </span>
          <button
            onClick={handleTest}
            disabled={busy !== null}
            className="ml-auto rounded border border-[var(--border)] bg-transparent px-3 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            {busy === 'test' ? 'Testing…' : 'Test active adapter'}
          </button>
        </div>
        {testStatus && (
          <div
            className={`mt-2 text-[13px] ${
              testStatus.ok ? 'text-[var(--success)]' : 'text-[var(--error)]'
            }`}
          >
            {testStatus.message}
          </div>
        )}
      </div>

      {state.providers.map((p) => {
        const draft = drafts[p.id]
        const visible = showKey[p.id]
        const isActive = p.active
        return (
          <div
            key={p.id}
            className="space-y-2 rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={`inline-block h-2 w-2 rounded-full ${
                      p.requiresKey
                        ? p.hasKey
                          ? 'bg-[var(--success)]'
                          : 'bg-[var(--warning)]'
                        : 'bg-[var(--accent)]'
                    }`}
                  />
                  <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                    {p.label}
                  </span>
                  {isActive && (
                    <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--accent)]">
                      Active
                    </span>
                  )}
                  {p.requiresKey ? (
                    <span className="font-mono text-[12px] text-[var(--text-muted)]">
                      {p.hasKey ? 'Key stored' : 'No key'}
                    </span>
                  ) : (
                    <span className="font-mono text-[12px] text-[var(--text-muted)]">
                      No key required
                    </span>
                  )}
                </div>
                <a
                  href={DOC_LINKS[p.id]}
                  onClick={(e) => {
                    e.preventDefault()
                    const win = window as unknown as {
                      api?: { artifact?: { openExternal?: (u: string) => void } }
                    }
                    win.api?.artifact?.openExternal?.(DOC_LINKS[p.id])
                  }}
                  className="mt-1 inline-block font-mono text-[12px] text-[var(--accent)] hover:underline"
                >
                  {p.requiresKey ? 'Get a key →' : 'About SearXNG →'}
                </a>
              </div>
              {!isActive && (
                <button
                  onClick={() => handleActivate(p.id)}
                  disabled={busy !== null}
                  className="rounded border border-[var(--border)] bg-transparent px-2.5 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
                >
                  Use this provider
                </button>
              )}
            </div>

            {p.requiresKey && (
              <>
                <div className="flex gap-2">
                  <input
                    type={visible ? 'text' : 'password'}
                    value={draft}
                    onChange={(e) =>
                      setDrafts((s) => ({ ...s, [p.id]: e.target.value }))
                    }
                    placeholder={p.hasKey ? 'Replace key…' : 'Paste API key'}
                    className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setShowKey((s) => ({ ...s, [p.id]: !visible }))
                    }
                    className="rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    {visible ? 'Hide' : 'Show'}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={() => handleSaveKey(p.id)}
                    disabled={busy !== null || !draft.trim()}
                    className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    Save key
                  </button>
                  <button
                    onClick={() => handleDeleteKey(p.id)}
                    disabled={busy !== null || !p.hasKey}
                    className="rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs text-[var(--error)] transition-colors hover:bg-[var(--error)]/10 disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}

            {p.requiresEndpoint && (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder="https://searxng.example.com"
                    className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={handleSaveEndpoint}
                    disabled={busy !== null || !endpoint.trim()}
                    className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    Save endpoint
                  </button>
                  {state.searxngEndpoint && (
                    <span className="font-mono text-[12px] text-[var(--text-muted)]">
                      Current: {state.searxngEndpoint}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
