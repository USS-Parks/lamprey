import { useState, useRef, useEffect } from 'react'
import { useMcpStore } from '@/stores/mcp-store'
import { useChatStore } from '@/stores/chat-store'
import type { McpServerConfig } from '@/lib/types'

type ServerWithStatus = McpServerConfig & { error?: string }

const STATUS_COLORS: Record<string, string> = {
  connected: 'bg-[var(--success)]',
  connecting: 'bg-[var(--warning)] animate-pulse',
  disconnected: 'bg-[var(--text-muted)]',
  error: 'bg-[var(--error)]'
}

function StatusDot({ status }: { status: string }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[status] || STATUS_COLORS.disconnected}`} />
  )
}

function ServerPopover({ server, onClose }: { server: ServerWithStatus; onClose: () => void }) {
  const reconnect = useMcpStore((s) => s.reconnect)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute bottom-10 left-0 z-50 w-64 rounded border border-[var(--panel-border)] bg-[var(--bg-tertiary)] p-3 shadow-lg"
    >
      <div className="mb-2 flex items-center gap-2">
        <StatusDot status={server.status} />
        <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">{server.name}</span>
        <span className="ml-auto rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--text-muted)] uppercase">
          {server.transport}
        </span>
      </div>

      <div className="mb-2 font-mono text-[13px] text-[var(--text-secondary)]">
        Status: <span className="capitalize">{server.status}</span>
        {server.error && (
          <div className="mt-1 text-[var(--error)]">{server.error}</div>
        )}
      </div>

      <div className="flex gap-2">
        {server.status !== 'connecting' && (
          <button
            onClick={() => reconnect(server.id)}
            className="rounded bg-[var(--accent-dim)] px-2 py-1 font-mono text-[13px] text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
          >
            Reconnect
          </button>
        )}
        {server.auth === 'google-oauth' && server.status === 'disconnected' && (
          <button
            onClick={() => {
              window.api?.mcp.setupGoogleOAuth()
              onClose()
            }}
            className="rounded bg-[var(--accent-dim)] px-2 py-1 font-mono text-[13px] text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
          >
            Setup OAuth
          </button>
        )}
      </div>
    </div>
  )
}

export function MCPStatusBar() {
  const servers = useMcpStore((s) => s.servers)
  const activeModel = useChatStore((s) => s.activeModel)
  const [popoverServer, setPopoverServer] = useState<string | null>(null)

  const isR1 = activeModel === 'deepseek-reasoner'
  const connectedCount = servers.filter((s) => s.status === 'connected').length

  if (servers.length === 0) return null

  return (
    <div className="flex h-8 items-center gap-3 border-t border-[var(--panel-border)] bg-[var(--bg-secondary)] px-3">
      {isR1 && (
        <span className="font-mono text-[13px] text-[var(--warning)]">
          R1 active - MCP tools unavailable
        </span>
      )}

      {!isR1 && connectedCount === 0 && servers.length > 0 && (
        <span className="font-mono text-[13px] text-[var(--text-muted)]">
          No MCP servers connected
        </span>
      )}

      {servers.map((server) => (
        <div key={server.id} className="relative">
          <button
            onClick={() => setPopoverServer(popoverServer === server.id ? null : server.id)}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <StatusDot status={server.status} />
            <span>{server.name}</span>
          </button>

          {popoverServer === server.id && (
            <ServerPopover
              server={server}
              onClose={() => setPopoverServer(null)}
            />
          )}
        </div>
      ))}
    </div>
  )
}
