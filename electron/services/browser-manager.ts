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
}

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
    emitTab(tab)
  })
  wc.on('did-navigate-in-page', (_e, url) => {
    tab.url = url
    emitTab(tab)
  })

  // Pop-up handler: open new windows as new tabs in our browser instead of
  // spawning native BrowserWindows.
  wc.setWindowOpenHandler(({ url }) => {
    void newTab(url)
    return { action: 'deny' }
  })
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

function isHttpish(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith('about:') || url.startsWith('file:')
}

export function coerceUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return 'about:blank'
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
  const tab: Tab = { id, view, title: url, url, loading: true }
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
