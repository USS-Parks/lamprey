import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useUiStore, type ShellKind } from '@/stores/ui-store'

// Per-shell-kind session id. Each Codex shell (PowerShell, Git Bash, WSL,
// cmd) gets its own pty so swapping shells in the launcher doesn't kill
// the previous session — it just hides while the new one runs.
const terminalIdFor = (kind: ShellKind): string => `lamprey-main:${kind}`

const spawnPromises = new Map<string, Promise<boolean>>()

// Per-session ring buffer of pty output. Survives panel unmount/remount and
// shell-kind switches so the next mounted xterm can replay history on attach.
// Cap each session at ~256 KB to bound memory.
const HISTORY_CAP = 256 * 1024
const historyBuffers = new Map<string, string>()
const historyListenerInstalled = { value: false }

function recordHistory(id: string, chunk: string): void {
  const prev = historyBuffers.get(id) ?? ''
  const next = prev + chunk
  historyBuffers.set(id, next.length > HISTORY_CAP ? next.slice(-HISTORY_CAP) : next)
}

function clearHistory(id: string): void {
  historyBuffers.delete(id)
}

// Install a single, module-level pty-data listener that records every chunk
// into the per-session history buffer. The component-level listener (below)
// still mirrors chunks into the live xterm; this one only captures.
function ensureHistoryListener(): void {
  if (historyListenerInstalled.value) return
  if (!window.api?.terminal) return
  historyListenerInstalled.value = true
  window.api.terminal.onData((e: { id: string; chunk: string }) => {
    recordHistory(e.id, e.chunk)
  })
  window.api.terminal.onExit((e: { id: string; code: number | null }) => {
    recordHistory(
      e.id,
      `\r\n[shell exited${e.code != null ? ` (code ${e.code})` : ''}]\r\n`
    )
  })
}

async function ensureSpawned(id: string, shellKind: ShellKind): Promise<boolean> {
  if (!window.api?.terminal) return false
  ensureHistoryListener()
  const cached = spawnPromises.get(id)
  if (cached) return cached
  const promise = (async () => {
    const wd = await window.api.files.getWorkdir()
    const cwd = wd.success && wd.data ? wd.data.path : undefined
    const res = await window.api.terminal.spawn({ id, cwd, shellKind })
    return res.success
  })()
  spawnPromises.set(id, promise)
  return promise
}

export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const activeShell = useUiStore((s) => s.activeShell)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (!window.api?.terminal) {
      container.innerText = 'Terminal API unavailable.'
      return
    }

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
      fontSize: 13,
      theme: {
        background: '#000000',
        foreground: '#e8e8e8'
      },
      convertEol: true,
      scrollback: 5000
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const sessionId = terminalIdFor(activeShell)

    // Replay buffered history so re-mounting (panel close/open, shell switch)
    // restores what the previous xterm rendered.
    const replay = historyBuffers.get(sessionId)
    if (replay) term.write(replay)

    // Pipe keystrokes to backend.
    const inputDisposable = term.onData((data) => {
      void window.api.terminal.write({ id: sessionId, data })
    })

    // Mirror pty data into the live xterm. History recording is handled by
    // the module-level listener installed in ensureSpawned() — don't double
    // record here.
    const onData = (e: { id: string; chunk: string }) => {
      if (e.id !== sessionId) return
      term.write(e.chunk)
    }
    const onExit = (e: { id: string; code: number | null }) => {
      if (e.id !== sessionId) return
      term.write(`\r\n[shell exited${e.code != null ? ` (code ${e.code})` : ''}]\r\n`)
      spawnPromises.delete(sessionId)
      clearHistory(sessionId)
    }
    const offData = window.api.terminal.onData(onData)
    const offExit = window.api.terminal.onExit(onExit)

    void (async () => {
      const ok = await ensureSpawned(sessionId, activeShell)
      if (!ok) {
        term.write(`\x1b[31m[failed to spawn ${activeShell}]\x1b[0m\r\n`)
      }
    })()

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        // container may have zero size briefly during transitions
      }
    })
    ro.observe(container)

    return () => {
      ro.disconnect()
      inputDisposable.dispose()
      // Remove only this mount's listeners. The module-level history listener
      // (installed inside ensureSpawned) stays alive so background ptys keep
      // recording into their buffers while the panel is unmounted.
      offData?.()
      offExit?.()
      try {
        term.dispose()
      } catch {
        // already disposed
      }
      termRef.current = null
      fitRef.current = null
    }
  }, [activeShell])

  return (
    <div className="flex flex-1 flex-col bg-black">
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  )
}
