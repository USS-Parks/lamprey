// Multi-tab Chromium browser. Each tab owns a WebContentsView attached to
// the main window's contentView. Only the active tab's view is visible; the
// rest are detached. Renderer drives lifecycle and bounds via IPC.

import { BrowserWindow, WebContentsView } from 'electron'

interface Tab {
  id: string
  view: WebContentsView
  title: string
  url: string
  loading: boolean
  // F1 — preview verification capture buffers. Bounded so the preview
  // tools don't OOM on a noisy page.
  consoleLogs: ConsoleEntry[]
  networkEvents: NetworkEntry[]
  // True once `attachDebugger` has wired CDP Network.* listeners. We
  // attach lazily on the first preview_network call so tabs that never
  // need it don't pay the debugger overhead.
  networkAttached: boolean
}

export interface ConsoleEntry {
  level: 'log' | 'warning' | 'error' | 'info' | 'debug'
  message: string
  line?: number
  sourceId?: string
  at: number
}

export interface NetworkEntry {
  requestId: string
  url: string
  method: string
  status?: number
  mimeType?: string
  resourceType?: string
  at: number
  finishedAt?: number
}

const CONSOLE_CAP = 500
const NETWORK_CAP = 500

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

const tabs = new Map<string, Tab>()
let activeTabId: string | null = null
let lastBounds: Bounds | null = null
let panelVisible = false
let nextId = 1

function getMainWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows()
  return wins.length > 0 ? wins[0] : null
}

function sendToRenderer(channel: string, payload: unknown): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  try {
    win.webContents.send(channel, payload)
  } catch {
    // window closing
  }
}

function emitTab(tab: Tab): void {
  sendToRenderer('browser:tabUpdated', {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    loading: tab.loading,
    canGoBack: tab.view.webContents.navigationHistory.canGoBack(),
    canGoForward: tab.view.webContents.navigationHistory.canGoForward()
  })
}

function attachTabListeners(tab: Tab): void {
  const wc = tab.view.webContents

  wc.on('did-start-loading', () => {
    tab.loading = true
    emitTab(tab)
  })
  wc.on('did-stop-loading', () => {
    tab.loading = false
    emitTab(tab)
  })
  wc.on('page-title-updated', (_e, title) => {
    tab.title = title || tab.url
    emitTab(tab)
  })
  wc.on('did-navigate', (_e, url) => {
    tab.url = url
    // Reset capture buffers on navigation so logs from the old page
    // don't pollute the new one's verification surface.
    tab.consoleLogs = []
    tab.networkEvents = []
    emitTab(tab)
  })
  wc.on('did-navigate-in-page', (_e, url) => {
    tab.url = url
    emitTab(tab)
  })

  // F1 — capture page-side console messages for the preview tools.
  // Electron 35 ships a single `event` object with named fields
  // (level: 'log' | 'warning' | 'error' | 'info' | 'debug', message,
  // sourceId, lineNumber). Older Electron versions used positional
  // args (level: number, message, line, sourceId); the cast-through-
  // unknown handles both shapes without forcing a type narrow.
  wc.on('console-message', (event: unknown) => {
    const e = event as {
      level?: number | string
      message?: unknown
      lineNumber?: number
      sourceId?: string
    }
    let level: ConsoleEntry['level'] = 'log'
    if (typeof e.level === 'string') {
      if (e.level === 'warning' || e.level === 'error' || e.level === 'info' || e.level === 'debug') {
        level = e.level
      }
    } else if (typeof e.level === 'number') {
      const byNumber: Record<number, ConsoleEntry['level']> = {
        0: 'log',
        1: 'warning',
        2: 'error',
        3: 'info',
        4: 'debug'
      }
      level = byNumber[e.level] ?? 'log'
    }
    const entry: ConsoleEntry = {
      level,
      message: String(e.message ?? ''),
      line: e.lineNumber,
      sourceId: e.sourceId,
      at: Date.now()
    }
    tab.consoleLogs.push(entry)
    if (tab.consoleLogs.length > CONSOLE_CAP) {
      tab.consoleLogs.splice(0, tab.consoleLogs.length - CONSOLE_CAP)
    }
  })

  // Pop-up handler: open new windows as new tabs in our browser instead of
  // spawning native BrowserWindows.
  wc.setWindowOpenHandler(({ url }) => {
    void newTab(url)
    return { action: 'deny' }
  })
}

/**
 * Lazy CDP attach for network capture. Called on the first
 * `preview_network` request against a tab; subsequent calls are no-ops.
 */
export function ensureNetworkCapture(tabId: string): boolean {
  const tab = tabs.get(tabId)
  if (!tab) return false
  if (tab.networkAttached) return true
  const dbg = tab.view.webContents.debugger
  try {
    if (!dbg.isAttached()) dbg.attach('1.3')
    void dbg.sendCommand('Network.enable')
  } catch (err) {
    console.warn('[browser-manager] debugger attach failed:', (err as Error).message)
    return false
  }

  dbg.on('message', (_event, method, params) => {
    if (method === 'Network.requestWillBeSent') {
      const p = params as any
      tab.networkEvents.push({
        requestId: p.requestId,
        url: p.request?.url ?? '',
        method: p.request?.method ?? 'GET',
        resourceType: p.type,
        at: Date.now()
      })
    } else if (method === 'Network.responseReceived') {
      const p = params as any
      const existing = tab.networkEvents.find((e) => e.requestId === p.requestId)
      if (existing) {
        existing.status = p.response?.status
        existing.mimeType = p.response?.mimeType
        existing.finishedAt = Date.now()
      }
    }
    if (tab.networkEvents.length > NETWORK_CAP) {
      tab.networkEvents.splice(0, tab.networkEvents.length - NETWORK_CAP)
    }
  })

  tab.networkAttached = true
  return true
}

export function getTabConsoleLogs(tabId: string, since?: number): ConsoleEntry[] {
  const tab = tabs.get(tabId)
  if (!tab) return []
  if (typeof since === 'number') return tab.consoleLogs.filter((e) => e.at > since)
  return [...tab.consoleLogs]
}

export function getTabNetworkEvents(tabId: string, since?: number): NetworkEntry[] {
  const tab = tabs.get(tabId)
  if (!tab) return []
  ensureNetworkCapture(tabId)
  if (typeof since === 'number') return tab.networkEvents.filter((e) => e.at > since)
  return [...tab.networkEvents]
}

export function clearTabConsoleLogs(tabId: string): void {
  const tab = tabs.get(tabId)
  if (tab) tab.consoleLogs = []
}

export function clearTabNetworkEvents(tabId: string): void {
  const tab = tabs.get(tabId)
  if (tab) tab.networkEvents = []
}

/**
 * Resize a tab's WebContentsView. When no bounds have been published
 * yet, falls back to the main window's content area minus a 56px top
 * chrome reservation.
 */
export function resizeTab(tabId: string, width: number, height: number): boolean {
  const tab = tabs.get(tabId)
  if (!tab) return false
  const win = getMainWindow()
  if (!win) return false
  const w = Math.round(Math.max(160, width))
  const h = Math.round(Math.max(120, height))
  const x = lastBounds ? Math.round(lastBounds.x) : 0
  const y = lastBounds ? Math.round(lastBounds.y) : 56
  tab.view.setBounds({ x, y, width: w, height: h })
  return true
}

function applyBoundsToActive(): void {
  if (!activeTabId || !lastBounds) return
  const t = tabs.get(activeTabId)
  if (!t) return
  t.view.setBounds({
    x: Math.round(lastBounds.x),
    y: Math.round(lastBounds.y),
    width: Math.round(Math.max(1, lastBounds.width)),
    height: Math.round(Math.max(1, lastBounds.height))
  })
}

function showOnly(tabId: string | null): void {
  const win = getMainWindow()
  if (!win) return
  for (const [id, t] of tabs) {
    if (id === tabId && panelVisible) {
      // ensure attached
      if (!win.contentView.children.includes(t.view)) {
        win.contentView.addChildView(t.view)
      }
      t.view.setVisible(true)
    } else {
      t.view.setVisible(false)
    }
  }
  if (tabId) applyBoundsToActive()
}

// SEC-8: the in-app browser is for web content; allowing `file:` lets the
// model navigate to arbitrary on-disk files (and read them via the page
// surface). Drop `file:` from the model-reachable scheme allow-list. The
// renderer's "open in file explorer" affordance goes through a separate
// IPC path (`files:openInExplorer`) which shells out to the OS rather than
// loading into a tab here.
function isHttpish(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith('about:')
}

// Schemes that should never reach `loadURL` regardless of how they arrived.
// `coerceUrl` already falls back to a Google search query for unrecognised
// schemes, but we'd rather emit an explicit redirect than search the string.
const FORBIDDEN_SCHEMES = /^(file|javascript|data|view-source|chrome|chrome-extension):/i

export function coerceUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return 'about:blank'
  if (FORBIDDEN_SCHEMES.test(trimmed)) {
    // Don't search the literal `file:///etc/passwd`; just send the user
    // somewhere safe. The friendly fallback is the home page.
    return 'about:blank'
  }
  if (isHttpish(trimmed)) return trimmed
  // Looks like a domain (has a dot, no spaces) → assume https
  if (/^[^\s]+\.[^\s]+$/.test(trimmed) && !trimmed.includes(' ')) {
    return `https://${trimmed}`
  }
  // Otherwise → Google search
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

export async function newTab(rawUrl?: string): Promise<Tab> {
  const win = getMainWindow()
  if (!win) throw new Error('no main window')

  const url = coerceUrl(rawUrl ?? 'https://www.google.com')
  const id = `tab-${nextId++}`
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      allowRunningInsecureContent: false,
      webSecurity: true
    }
  })
  const tab: Tab = {
    id,
    view,
    title: url,
    url,
    loading: true,
    consoleLogs: [],
    networkEvents: [],
    networkAttached: false
  }
  tabs.set(id, tab)
  attachTabListeners(tab)

  // Attach to window so it can render once shown.
  win.contentView.addChildView(view)
  view.setVisible(false)

  try {
    await view.webContents.loadURL(url)
  } catch (err: any) {
    tab.loading = false
    tab.title = `Failed to load — ${err?.message ?? 'unknown'}`
    emitTab(tab)
  }

  setActiveTab(id)
  emitTab(tab)
  return tab
}

export function closeTab(id: string): void {
  const t = tabs.get(id)
  if (!t) return
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    try {
      win.contentView.removeChildView(t.view)
    } catch {
      // already detached
    }
  }
  try {
    t.view.webContents.close()
  } catch {
    // already closed
  }
  tabs.delete(id)

  if (activeTabId === id) {
    const remaining = Array.from(tabs.keys())
    activeTabId = remaining[remaining.length - 1] ?? null
    showOnly(activeTabId)
  }
  sendToRenderer('browser:tabClosed', { id, activeTabId })
}

export function setActiveTab(id: string): void {
  if (!tabs.has(id)) return
  activeTabId = id
  showOnly(id)
  sendToRenderer('browser:activeTab', { id })
}

export function navigate(id: string, rawUrl: string): void {
  const t = tabs.get(id)
  if (!t) return
  const url = coerceUrl(rawUrl)
  t.url = url
  t.loading = true
  emitTab(t)
  t.view.webContents.loadURL(url).catch((err: any) => {
    t.loading = false
    t.title = `Failed to load — ${err?.message ?? 'unknown'}`
    emitTab(t)
  })
}

export function goBack(id: string): void {
  const t = tabs.get(id)
  if (t?.view.webContents.navigationHistory.canGoBack()) {
    t.view.webContents.navigationHistory.goBack()
  }
}

export function goForward(id: string): void {
  const t = tabs.get(id)
  if (t?.view.webContents.navigationHistory.canGoForward()) {
    t.view.webContents.navigationHistory.goForward()
  }
}

export function reload(id: string): void {
  const t = tabs.get(id)
  if (!t) return
  t.view.webContents.reload()
}

export function setBounds(bounds: Bounds): void {
  lastBounds = bounds
  applyBoundsToActive()
}

export function setVisible(visible: boolean): void {
  panelVisible = visible
  showOnly(panelVisible ? activeTabId : null)
}

export function listTabs(): Array<{ id: string; title: string; url: string; loading: boolean }> {
  return Array.from(tabs.values()).map((t) => ({
    id: t.id,
    title: t.title,
    url: t.url,
    loading: t.loading
  }))
}

export function getActiveTabId(): string | null {
  return activeTabId
}

// Model-callable browser tools need direct access to a tab's WebContentsView
// (to drive executeJavaScript, findInPage, capturePage, etc.). These helpers
// are intentionally narrow: they return the live tab record (including the
// view) but never expose the internal `tabs` Map.

export interface BrowserTabHandle {
  id: string
  view: WebContentsView
  title: string
  url: string
  loading: boolean
}

export function getTab(id: string): BrowserTabHandle | null {
  const t = tabs.get(id)
  if (!t) return null
  return { id: t.id, view: t.view, title: t.title, url: t.url, loading: t.loading }
}

export function getActiveTab(): BrowserTabHandle | null {
  if (!activeTabId) return null
  return getTab(activeTabId)
}

export function destroyAll(): void {
  const win = getMainWindow()
  for (const t of tabs.values()) {
    if (win && !win.isDestroyed()) {
      try {
        win.contentView.removeChildView(t.view)
      } catch {
        // detach failed
      }
    }
    try {
      t.view.webContents.close()
    } catch {
      // close failed
    }
  }
  tabs.clear()
  activeTabId = null
  lastBounds = null
  panelVisible = false
}
