import { useEffect, useMemo, useState } from 'react'
import { toast } from '@/stores/toast-store'
import { useMcpStore } from '@/stores/mcp-store'
import { CONNECTORS_CATALOG, type CatalogEntry } from '@/data/connectors-catalog'

interface AddConnectorFlowProps {
  onClose: () => void
}

type Tab = 'catalog' | 'json'

const PLACEHOLDER_JSON = `{
  "id": "my-mcp-server",
  "name": "My MCP Server",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@scope/my-mcp-server"],
  "auth": "none",
  "enabled": true
}`

export function AddConnectorFlow({ onClose }: AddConnectorFlowProps) {
  const [tab, setTab] = useState<Tab>('catalog')
  const [jsonText, setJsonText] = useState(PLACEHOLDER_JSON)
  const [parseError, setParseError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const loadServers = useMcpStore((s) => s.loadServers)
  const existing = useMcpStore((s) => s.servers)

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogEntry[]>()
    for (const e of CONNECTORS_CATALOG) {
      const arr = map.get(e.category) ?? []
      arr.push(e)
      map.set(e.category, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [])

  const existingIds = useMemo(() => new Set(existing.map((s) => s.id)), [existing])

  useEffect(() => {
    setParseError(null)
  }, [jsonText])

  const onAddFromCatalog = async (entry: CatalogEntry) => {
    if (existingIds.has(entry.id)) {
      toast.error(`Connector "${entry.id}" is already installed.`)
      return
    }
    setBusy(true)
    try {
      const result = await window.api.mcp.addServer(entry)
      if (result.success) {
        toast.success(`Added connector "${entry.name}"`)
        await loadServers()
        onClose()
      } else {
        toast.error(`Failed to add connector: ${result.error}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const onAddFromJson = async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch (err) {
      setParseError(`Not valid JSON: ${(err as Error).message}`)
      return
    }
    // Accept either a single server object OR the Claude Code shape:
    // `{ mcpServers: { id1: {...}, id2: {...} } }`. When the wrapper is
    // detected, unwrap to a single entry and require there is exactly one.
    if (parsed && typeof parsed === 'object' && 'mcpServers' in parsed) {
      const entries = Object.entries(
        (parsed as { mcpServers: Record<string, unknown> }).mcpServers ?? {}
      )
      if (entries.length === 0) {
        setParseError('mcpServers object is empty')
        return
      }
      if (entries.length > 1) {
        setParseError('JSON paste supports one server at a time')
        return
      }
      const [id, body] = entries[0]
      parsed = { id, ...(body as Record<string, unknown>) }
    }
    setBusy(true)
    try {
      const result = await window.api.mcp.addServer(parsed)
      if (result.success) {
        toast.success('Connector added')
        await loadServers()
        onClose()
      } else {
        setParseError(result.error)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex h-[600px] w-[700px] flex-col overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--bg-secondary)] shadow-2xl">
        <header className="flex h-12 shrink-0 items-center border-b border-[var(--panel-border)] px-4">
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">
            Add connector
          </span>
          <div className="ml-3 flex items-center gap-1">
            <button
              onClick={() => setTab('catalog')}
              className={`rounded px-2 py-0.5 text-[12px] ${
                tab === 'catalog'
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
              }`}
            >
              Catalog
            </button>
            <button
              onClick={() => setTab('json')}
              className={`rounded px-2 py-0.5 text-[12px] ${
                tab === 'json'
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
              }`}
            >
              JSON paste
            </button>
          </div>
          <div className="flex-1" />
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'catalog' && (
            <div className="space-y-4">
              {grouped.map(([category, list]) => (
                <section key={category}>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {category}
                  </h3>
                  <div className="space-y-2">
                    {list.map((entry) => {
                      const installed = existingIds.has(entry.id)
                      return (
                        <div
                          key={entry.id}
                          className="flex items-start gap-3 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                                {entry.name}
                              </span>
                              <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                                {entry.transport}
                              </span>
                              {entry.auth === 'google-oauth' && (
                                <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-[var(--accent)]">
                                  google-oauth
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                              {entry.description}
                            </p>
                            {entry.command && (
                              <code className="mt-1 block truncate font-mono text-[10px] text-[var(--text-muted)]">
                                {entry.command} {(entry.args ?? []).join(' ')}
                              </code>
                            )}
                          </div>
                          <button
                            onClick={() => void onAddFromCatalog(entry)}
                            disabled={busy || installed}
                            className="shrink-0 rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-[11px] text-white hover:opacity-90 disabled:opacity-50"
                          >
                            {installed ? 'Installed' : 'Add'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))}
              {grouped.length === 0 && (
                <p className="text-center text-[12px] text-[var(--text-muted)]">
                  Catalog is empty.
                </p>
              )}
            </div>
          )}

          {tab === 'json' && (
            <div className="space-y-3">
              <p className="text-[12px] text-[var(--text-secondary)]">
                Paste either a single connector object or the standard
                <code className="mx-1 rounded bg-[var(--bg-tertiary)] px-1 py-0 font-mono text-[10px]">.mcp.json</code>
                <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0 font-mono text-[10px]">mcpServers</code>
                wrapper with one entry.
              </p>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                spellCheck={false}
                rows={16}
                className="w-full resize-y rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-2 font-mono text-[12px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
              {parseError && (
                <div className="rounded border border-[var(--error)] bg-[var(--error)]/10 px-2 py-1.5 text-[11px] text-[var(--error)]">
                  {parseError}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-[var(--panel-border)] px-4 py-3">
          <button
            onClick={onClose}
            className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-3 py-1.5 text-[12px] hover:border-[var(--accent)]"
          >
            Cancel
          </button>
          <div className="flex-1" />
          {tab === 'json' && (
            <button
              onClick={() => void onAddFromJson()}
              disabled={busy}
              className="rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Adding…' : 'Add connector'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
