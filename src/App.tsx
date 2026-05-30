import { useState } from 'react'

function App(): React.ReactElement {
  const [ipcResult, setIpcResult] = useState<string | null>(null)

  const testIpc = async () => {
    const result = await window.api.settings.hasApiKey()
    setIpcResult(JSON.stringify(result))
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Sidebar */}
      <div className="flex w-60 flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex h-12 items-center px-4 text-sm font-medium text-[var(--text-secondary)]">
          Conversations
        </div>
        <div className="flex-1" />
      </div>

      {/* Chat pane */}
      <div className="flex flex-1 flex-col">
        {/* Titlebar */}
        <div
          className="flex h-12 items-center justify-between border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <span className="font-mono text-sm font-semibold tracking-wide text-[var(--text-primary)]">
            Lamprey
          </span>
        </div>

        {/* Main area */}
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="text-center">
            <h1 className="font-mono text-2xl font-bold text-[var(--text-primary)]">Lamprey</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">Desktop AI assistant</p>
          </div>
          <button
            onClick={testIpc}
            className="rounded border border-[var(--border)] bg-[var(--bg-tertiary)] px-4 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            Test IPC
          </button>
          {ipcResult !== null && (
            <pre className="rounded bg-[var(--code-bg)] px-3 py-2 font-mono text-xs text-[var(--text-secondary)]">
              hasApiKey: {ipcResult}
            </pre>
          )}
        </div>
      </div>

      {/* Artifact panel */}
      <div className="flex w-[420px] flex-col border-l border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex h-12 items-center px-4 text-sm font-medium text-[var(--text-secondary)]">
          Artifacts
        </div>
        <div className="flex-1" />
      </div>
    </div>
  )
}

export default App
