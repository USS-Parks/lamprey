import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  coerceUrl,
  getActiveTab,
  getTab,
  getTabConsoleLogs,
  getTabNetworkEvents,
  newTab,
  resizeTab,
  type BrowserTabHandle
} from './browser-manager'
import {
  destroyDevServer,
  getDevServer,
  listDevServers,
  spawnDevServer,
  stopDevServer,
  URL_PATTERNS,
  waitForOutput,
  type DevServerHandle
} from './dev-server-manager'

// Thin executor layer that wraps the existing multi-tab browser-manager so
// the model can drive the in-app Chromium surface. Descriptors and registry
// wiring live in browser-tool-pack.ts; permission gating runs through the
// permission service via descriptor.requiresApproval. This module
// deliberately does NOT import electron's WebContentsView constructor — it
// operates on handles produced by browser-manager.

const NO_TAB = 'Error: No active browser tab. Use browser_open first.'
const NAV_TIMEOUT_MS = 15_000
const FIND_TIMEOUT_MS = 5_000

function resolveTabArg(tabId?: string): BrowserTabHandle | null {
  if (tabId) return getTab(tabId)
  return getActiveTab()
}

// ── browser_open ────────────────────────────────────────────────────────────

export interface BrowserOpenArgs {
  url: string
  new_tab?: boolean
}

export async function executeBrowserOpen(args: BrowserOpenArgs): Promise<string> {
  const rawUrl = (args?.url ?? '').trim()
  if (!rawUrl) return 'Error: url is required.'

  // Apply the same coercion the new-tab path goes through, so bare inputs
  // like "example.com" or "weather in tokyo" behave identically regardless
  // of whether a tab already exists.
  const url = coerceUrl(rawUrl)

  const newTabRequested = args?.new_tab === true
  const active = getActiveTab()

  // If no active tab exists OR new_tab requested, spawn a new tab.
  if (!active || newTabRequested) {
    try {
      const tab = await newTab(url)
      return `Opened ${tab.url} (tab ${tab.id}, title "${tab.title}")`
    } catch (err: any) {
      return `Error: failed to open new tab — ${err?.message ?? 'unknown'}`
    }
  }

  // Reuse the active tab.
  const wc = active.view.webContents
  const waitStop = new Promise<void>((resolveOuter) => {
    let done = false
    const onStop = (): void => {
      if (done) return
      done = true
      wc.removeListener('did-stop-loading', onStop)
      clearTimeout(timer)
      resolveOuter()
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      wc.removeListener('did-stop-loading', onStop)
      resolveOuter()
    }, NAV_TIMEOUT_MS)
    wc.on('did-stop-loading', onStop)
  })

  try {
    await wc.loadURL(url)
  } catch (err: any) {
    return `Error: failed to load ${url} — ${err?.message ?? 'unknown'}`
  }
  await waitStop
  const refreshed = getTab(active.id)
  const title = refreshed?.title ?? wc.getTitle()
  const finalUrl = refreshed?.url ?? wc.getURL()
  return `Opened ${finalUrl} (tab ${active.id}, title "${title}")`
}

// ── browser_click ───────────────────────────────────────────────────────────

export interface BrowserClickArgs {
  selector: string
  tab_id?: string
}

export async function executeBrowserClick(args: BrowserClickArgs): Promise<string> {
  const selector = (args?.selector ?? '').trim()
  if (!selector) return 'Error: selector is required.'
  const tab = resolveTabArg(args?.tab_id)
  if (!tab) return NO_TAB

  // JSON-encode the selector so the model can't break out of the string.
  const js = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'not-found';
    try { el.click(); return 'clicked'; }
    catch (e) { return 'click-error: ' + (e && e.message ? e.message : String(e)); }
  })()`

  try {
    const result = await tab.view.webContents.executeJavaScript(js, true)
    return typeof result === 'string' ? result : String(result)
  } catch (err: any) {
    return `Error: executeJavaScript failed — ${err?.message ?? 'unknown'}`
  }
}

// ── browser_type ────────────────────────────────────────────────────────────

export interface BrowserTypeArgs {
  selector: string
  text: string
  tab_id?: string
}

export async function executeBrowserType(args: BrowserTypeArgs): Promise<string> {
  const selector = (args?.selector ?? '').trim()
  const text = typeof args?.text === 'string' ? args.text : ''
  if (!selector) return 'Error: selector is required.'
  const tab = resolveTabArg(args?.tab_id)
  if (!tab) return NO_TAB

  const js = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'not-found';
    try {
      if (typeof el.focus === 'function') el.focus();
      const value = ${JSON.stringify(text)};
      if ('value' in el) {
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'typed';
      }
      if (el.isContentEditable) {
        el.textContent = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return 'typed';
      }
      return 'not-editable';
    } catch (e) {
      return 'type-error: ' + (e && e.message ? e.message : String(e));
    }
  })()`

  try {
    const result = await tab.view.webContents.executeJavaScript(js, true)
    return typeof result === 'string' ? result : String(result)
  } catch (err: any) {
    return `Error: executeJavaScript failed — ${err?.message ?? 'unknown'}`
  }
}

// ── browser_find ────────────────────────────────────────────────────────────

export interface BrowserFindArgs {
  text: string
  tab_id?: string
  case_sensitive?: boolean
}

export async function executeBrowserFind(args: BrowserFindArgs): Promise<string> {
  const text = typeof args?.text === 'string' ? args.text : ''
  if (text === '') return 'Error: text is required.'
  const tab = resolveTabArg(args?.tab_id)
  if (!tab) return NO_TAB

  const wc = tab.view.webContents
  const matchCase = args?.case_sensitive === true

  const matches = await new Promise<number>((resolveInner) => {
    let settled = false
    const finish = (n: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        wc.removeListener('found-in-page', onFound)
      } catch {
        // already detached
      }
      resolveInner(n)
    }
    const onFound = (_e: unknown, result: { matches?: number; finalUpdate?: boolean }): void => {
      if (result?.finalUpdate) {
        finish(typeof result.matches === 'number' ? result.matches : 0)
      }
    }
    const timer = setTimeout(() => finish(0), FIND_TIMEOUT_MS)
    wc.on('found-in-page', onFound)
    try {
      wc.findInPage(text, { findNext: false, matchCase })
    } catch {
      finish(0)
    }
  })

  try {
    wc.stopFindInPage('clearSelection')
  } catch {
    // best effort
  }

  if (matches > 0) return `Found ${matches} match(es)`
  return 'No matches'
}

// ── browser_screenshot ──────────────────────────────────────────────────────

export interface BrowserScreenshotArgs {
  tab_id?: string
  full_page?: boolean
}

function ensureScreenshotDir(): string {
  const dir = join(app.getPath('userData'), 'artifacts', 'browser-screenshots')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export async function executeBrowserScreenshot(
  args: BrowserScreenshotArgs
): Promise<string> {
  const tab = resolveTabArg(args?.tab_id)
  if (!tab) return NO_TAB

  try {
    const image = await tab.view.webContents.capturePage()
    const png = image.toPNG()
    const dir = ensureScreenshotDir()
    const filename = `screenshot-${Date.now()}.png`
    const outPath = join(dir, filename)
    writeFileSync(outPath, png)
    return `Screenshot saved to ${outPath}`
  } catch (err: any) {
    return `Error: capturePage failed — ${err?.message ?? 'unknown'}`
  }
}

// ────────────────────────────────────────────────────────────────────────
// F1 — Preview verification family.
//
// The preview_* tools are the "drive a dev server like a tester would"
// surface: spawn the server, wait for the URL to print, open it in a
// tab, capture console + network, snapshot the DOM, screenshot the
// viewport, click / fill / resize, then stop everything.
//
// Tools that mutate page state (preview_click, preview_fill,
// preview_eval, preview_resize) carry write/network risk and will gate
// through the permission service once T2:C1 lands the descriptor
// registrations. The executor layer here is descriptor-agnostic.
// ────────────────────────────────────────────────────────────────────────

const PREVIEW_WAIT_DEFAULT_MS = 30_000

// session.id → tabId. preview_start opens a tab pointed at the dev
// server's URL; subsequent preview_* calls without a tab_id default
// to the most recently started one.
const previewTabBySession = new Map<string, string>()
let lastPreviewTabId: string | null = null

function activePreviewTab(): BrowserTabHandle | null {
  if (lastPreviewTabId) {
    const t = getTab(lastPreviewTabId)
    if (t) return t
  }
  return getActiveTab()
}

function resolvePreviewTab(tabId?: string): BrowserTabHandle | null {
  if (tabId) return getTab(tabId)
  return activePreviewTab()
}

export interface PreviewStartArgs {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  /** Regex pattern (string) to wait for in the dev-server output before
   *  treating it as ready. Defaults to a localhost-URL pattern. */
  ready_pattern?: string
  /** Milliseconds to wait for the ready pattern. Defaults to 30000. */
  timeout_ms?: number
  /** When `true`, open the printed URL in a browser tab and return
   *  the tab id. Defaults to `true`. */
  open_tab?: boolean
}

export interface PreviewStartResult {
  sessionId: string
  command: string
  pid: number | null
  url: string | null
  tabId: string | null
  output: string
}

function safeRegex(source: string): RegExp {
  try {
    return new RegExp(source)
  } catch {
    return URL_PATTERNS.generic
  }
}

export async function executePreviewStart(args: PreviewStartArgs): Promise<string> {
  const command = (args?.command ?? '').trim()
  if (!command) return 'Error: command is required.'
  const cwd = typeof args?.cwd === 'string' ? args.cwd : undefined
  const sessionArgs = Array.isArray(args?.args) ? args.args.filter((a) => typeof a === 'string') : []
  const env = args?.env && typeof args.env === 'object' ? (args.env as NodeJS.ProcessEnv) : undefined
  const readyPattern = args?.ready_pattern
    ? safeRegex(args.ready_pattern)
    : URL_PATTERNS.vite
  const timeoutMs = typeof args?.timeout_ms === 'number' ? args.timeout_ms : PREVIEW_WAIT_DEFAULT_MS
  const openTab = args?.open_tab !== false

  let handle: DevServerHandle
  try {
    handle = spawnDevServer({ command, args: sessionArgs, cwd, env })
  } catch (err: any) {
    return `Error: spawn failed — ${err?.message ?? 'unknown'}`
  }
  if (handle.status === 'failed') {
    return `Error: dev server failed to start — ${handle.output.trim()}`
  }

  let url: string | null
  try {
    url = await waitForOutput(handle.id, readyPattern, timeoutMs)
  } catch (err: any) {
    const partial = getDevServer(handle.id)
    return JSON.stringify({
      sessionId: handle.id,
      pid: handle.pid,
      url: null,
      tabId: null,
      output: partial?.output ?? handle.output,
      warning: err?.message ?? 'ready pattern did not match'
    })
  }

  let tabId: string | null = null
  if (openTab && url) {
    try {
      const tab = await newTab(url)
      tabId = tab.id
      previewTabBySession.set(handle.id, tab.id)
      lastPreviewTabId = tab.id
    } catch (err) {
      console.error('[preview-start] open-tab failed:', (err as Error).message)
    }
  }

  const result: PreviewStartResult = {
    sessionId: handle.id,
    command,
    pid: handle.pid,
    url,
    tabId,
    output: getDevServer(handle.id)?.output ?? ''
  }
  return JSON.stringify(result)
}

export async function executePreviewStop(args: { sessionId?: string; all?: boolean } = {}): Promise<string> {
  if (args?.all === true) {
    const handles = listDevServers()
    for (const h of handles) destroyDevServer(h.id)
    previewTabBySession.clear()
    lastPreviewTabId = null
    return `Stopped ${handles.length} dev server(s).`
  }
  const id = (args?.sessionId ?? '').trim()
  if (!id) return 'Error: sessionId is required (or pass all: true).'
  const handle = getDevServer(id)
  if (!handle) return `Error: unknown sessionId ${id}`
  stopDevServer(id)
  destroyDevServer(id)
  const tabId = previewTabBySession.get(id)
  previewTabBySession.delete(id)
  if (lastPreviewTabId === tabId) lastPreviewTabId = null
  return JSON.stringify({
    sessionId: id,
    stoppedTabId: tabId ?? null,
    finalOutput: handle.output
  })
}

export interface PreviewLogsArgs {
  tab_id?: string
  since?: number
  level?: 'log' | 'warning' | 'error' | 'info' | 'debug'
  limit?: number
}

export async function executePreviewConsoleLogs(args: PreviewLogsArgs = {}): Promise<string> {
  const tab = resolvePreviewTab(args?.tab_id)
  if (!tab) return 'Error: no preview tab. Run preview_start first.'
  const since = typeof args?.since === 'number' ? args.since : undefined
  const limit = typeof args?.limit === 'number' ? Math.min(Math.max(args.limit, 1), 500) : 100
  let entries = getTabConsoleLogs(tab.id, since)
  if (args?.level) entries = entries.filter((e) => e.level === args.level)
  entries = entries.slice(-limit)
  return JSON.stringify({ tabId: tab.id, count: entries.length, entries })
}

export async function executePreviewNetwork(args: PreviewLogsArgs = {}): Promise<string> {
  const tab = resolvePreviewTab(args?.tab_id)
  if (!tab) return 'Error: no preview tab. Run preview_start first.'
  const since = typeof args?.since === 'number' ? args.since : undefined
  const limit = typeof args?.limit === 'number' ? Math.min(Math.max(args.limit, 1), 500) : 100
  const entries = getTabNetworkEvents(tab.id, since).slice(-limit)
  return JSON.stringify({ tabId: tab.id, count: entries.length, entries })
}

export interface PreviewSnapshotArgs {
  tab_id?: string
  selector?: string
  max_bytes?: number
}

export async function executePreviewSnapshot(args: PreviewSnapshotArgs = {}): Promise<string> {
  const tab = resolvePreviewTab(args?.tab_id)
  if (!tab) return 'Error: no preview tab.'
  const selector =
    typeof args?.selector === 'string' && args.selector.trim() ? args.selector.trim() : 'body'
  const maxBytes = typeof args?.max_bytes === 'number' ? Math.min(args.max_bytes, 200_000) : 16_384
  const js = `(() => {
    try {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ error: 'selector not found', selector: ${JSON.stringify(selector)} });
      const html = el.outerHTML;
      return JSON.stringify({
        selector: ${JSON.stringify(selector)},
        title: document.title,
        url: location.href,
        bytes: html.length,
        html: html.length > ${maxBytes} ? html.slice(0, ${maxBytes}) + '\\n<!-- truncated -->' : html
      });
    } catch (e) {
      return JSON.stringify({ error: 'snapshot failed: ' + (e && e.message ? e.message : String(e)) });
    }
  })()`
  try {
    return await tab.view.webContents.executeJavaScript(js, true)
  } catch (err: any) {
    return `Error: snapshot failed — ${err?.message ?? 'unknown'}`
  }
}

export interface PreviewInspectArgs {
  selector: string
  properties?: string[]
  tab_id?: string
}

export async function executePreviewInspect(args: PreviewInspectArgs): Promise<string> {
  const selector = (args?.selector ?? '').trim()
  if (!selector) return 'Error: selector is required.'
  const tab = resolvePreviewTab(args?.tab_id)
  if (!tab) return 'Error: no preview tab.'
  const props = Array.isArray(args?.properties) && args.properties.length > 0
    ? args.properties.filter((p) => typeof p === 'string')
    : ['textContent', 'innerText', 'value', 'tagName', 'id', 'className']
  const js = `(() => {
    try {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ found: false });
      const out = { found: true, attributes: {} };
      const props = ${JSON.stringify(props)};
      for (const key of props) {
        try {
          let v = el[key];
          if (typeof v === 'string') v = v.slice(0, 2000);
          out[key] = v == null ? null : v;
        } catch { out[key] = null; }
      }
      const computed = window.getComputedStyle(el);
      for (const css of ['display','visibility','width','height','color','background-color']) {
        out['computed.' + css] = computed.getPropertyValue(css);
      }
      for (const a of Array.from(el.attributes || [])) {
        out.attributes[a.name] = a.value;
      }
      const rect = el.getBoundingClientRect();
      out.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      return JSON.stringify(out);
    } catch (e) {
      return JSON.stringify({ error: String(e && e.message ? e.message : e) });
    }
  })()`
  try {
    return await tab.view.webContents.executeJavaScript(js, true)
  } catch (err: any) {
    return `Error: inspect failed — ${err?.message ?? 'unknown'}`
  }
}

export interface PreviewEvalArgs {
  expression: string
  tab_id?: string
}

/**
 * Arbitrary JS evaluation against the preview tab. Carries write +
 * network + secret risk because the page could be any localhost
 * dev-server (e.g. an admin UI). The descriptor registration (post
 * T2:C1) MUST gate this through the approval flow.
 */
export async function executePreviewEval(args: PreviewEvalArgs): Promise<string> {
  const expression = typeof args?.expression === 'string' ? args.expression.trim() : ''
  if (!expression) return 'Error: expression is required.'
  const tab = resolvePreviewTab(args?.tab_id)
  if (!tab) return 'Error: no preview tab.'
  const wrapped = `(async () => {
    try {
      const result = await (async () => { return (${expression}); })();
      return JSON.stringify({ ok: true, value: result == null ? null : (typeof result === 'object' ? result : String(result)) });
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })()`
  try {
    return await tab.view.webContents.executeJavaScript(wrapped, true)
  } catch (err: any) {
    return `Error: eval failed — ${err?.message ?? 'unknown'}`
  }
}

export interface PreviewScreenshotArgs {
  tab_id?: string
}

export async function executePreviewScreenshot(args: PreviewScreenshotArgs = {}): Promise<string> {
  const tab = resolvePreviewTab(args?.tab_id)
  if (!tab) return 'Error: no preview tab.'
  try {
    const image = await tab.view.webContents.capturePage()
    const png = image.toPNG()
    const dir = ensureScreenshotDir()
    const outPath = join(dir, `preview-${Date.now()}.png`)
    writeFileSync(outPath, png)
    return JSON.stringify({ path: outPath, bytes: png.length, tabId: tab.id })
  } catch (err: any) {
    return `Error: screenshot failed — ${err?.message ?? 'unknown'}`
  }
}

export interface PreviewFillArgs {
  selector: string
  value: string
  tab_id?: string
}

export async function executePreviewFill(args: PreviewFillArgs): Promise<string> {
  const selector = (args?.selector ?? '').trim()
  const value = typeof args?.value === 'string' ? args.value : ''
  if (!selector) return 'Error: selector is required.'
  const tab = resolvePreviewTab(args?.tab_id)
  if (!tab) return 'Error: no preview tab.'
  const js = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return JSON.stringify({ filled: false, reason: 'not-found' });
    try {
      if (typeof el.focus === 'function') el.focus();
      const v = ${JSON.stringify(value)};
      if ('value' in el) {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return JSON.stringify({ filled: true });
      }
      if (el.isContentEditable) {
        el.textContent = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return JSON.stringify({ filled: true });
      }
      return JSON.stringify({ filled: false, reason: 'not-editable' });
    } catch (e) {
      return JSON.stringify({ filled: false, reason: String(e && e.message ? e.message : e) });
    }
  })()`
  try {
    return await tab.view.webContents.executeJavaScript(js, true)
  } catch (err: any) {
    return `Error: fill failed — ${err?.message ?? 'unknown'}`
  }
}

export interface PreviewClickArgs {
  selector: string
  tab_id?: string
}

export async function executePreviewClick(args: PreviewClickArgs): Promise<string> {
  const selector = (args?.selector ?? '').trim()
  if (!selector) return 'Error: selector is required.'
  const tab = resolvePreviewTab(args?.tab_id)
  if (!tab) return 'Error: no preview tab.'
  const js = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return JSON.stringify({ clicked: false, reason: 'not-found' });
    try { el.click(); return JSON.stringify({ clicked: true }); }
    catch (e) { return JSON.stringify({ clicked: false, reason: String(e && e.message ? e.message : e) }); }
  })()`
  try {
    return await tab.view.webContents.executeJavaScript(js, true)
  } catch (err: any) {
    return `Error: click failed — ${err?.message ?? 'unknown'}`
  }
}

export interface PreviewResizeArgs {
  width: number
  height: number
  tab_id?: string
}

export async function executePreviewResize(args: PreviewResizeArgs): Promise<string> {
  const tab = resolvePreviewTab(args?.tab_id)
  if (!tab) return 'Error: no preview tab.'
  const width = typeof args?.width === 'number' ? args.width : 0
  const height = typeof args?.height === 'number' ? args.height : 0
  if (width < 160 || height < 120) {
    return 'Error: width >= 160 and height >= 120 are required.'
  }
  const ok = resizeTab(tab.id, width, height)
  if (!ok) return 'Error: resize failed — no main window or tab.'
  return JSON.stringify({ tabId: tab.id, width: Math.round(width), height: Math.round(height) })
}

// ── browser_get_current_tab ─────────────────────────────────────────────────

export async function executeBrowserGetCurrentTab(): Promise<string> {
  const tab = getActiveTab()
  if (!tab) return 'No active tab'
  const wc = tab.view.webContents
  const info = {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    loading: tab.loading,
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward()
  }
  return JSON.stringify(info)
}

// ── browser_evaluate_readonly ───────────────────────────────────────────────
//
// The previous version accepted arbitrary JS with a regex blocklist. That
// is a permission bypass — `document.querySelector('button').click()` and
// DOM-mutating expressions slip through any blocklist that doesn't AST-parse,
// letting the model perform writes without the approval gate that browser_click
// and browser_type require. We now expose a fixed taxonomy of READ operations
// instead. Every payload is constructed server-side from the chosen `kind`
// plus a JSON-stringified `selector` / `attr` — the model never controls the
// JS source that hits `executeJavaScript`.

export type BrowserReadKind =
  | 'text'      // textContent of the matched element(s)
  | 'html'      // outerHTML of the matched element(s)
  | 'attr'      // attribute value of the matched element(s) — requires attr
  | 'value'     // form-field value (input/textarea/select)
  | 'count'     // number of elements matching the selector
  | 'exists'    // boolean — does at least one element match
  | 'title'     // document.title (no selector)
  | 'url'       // location.href (no selector)
  | 'meta'      // value of <meta name="X" content="..."> — requires attr=name
  | 'links'     // list of {text, href} for anchors matching selector (default 'a')

export interface BrowserEvaluateArgs {
  kind: BrowserReadKind
  selector?: string
  attr?: string
  // When the selector matches multiple elements, return up to `limit` items
  // for `text` / `html` / `links` / `attr`. Defaults to 1 (first match).
  limit?: number
}

const READ_KINDS: ReadonlySet<BrowserReadKind> = new Set([
  'text',
  'html',
  'attr',
  'value',
  'count',
  'exists',
  'title',
  'url',
  'meta',
  'links'
])

const MAX_LIMIT = 50
const RESULT_CAP = 30_000

// Build the read-only payload. `JSON.stringify` is used to embed all
// user-provided strings as literals; the only model-controlled values that
// reach the page are bare strings, never code.
function buildReadPayload(
  kind: BrowserReadKind,
  selector: string,
  attr: string,
  limit: number
): string {
  const sel = JSON.stringify(selector)
  const at = JSON.stringify(attr)
  const lim = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || 1))

  switch (kind) {
    case 'title':
      return `JSON.stringify(document.title)`
    case 'url':
      return `JSON.stringify(location.href)`
    case 'count':
      return `JSON.stringify(document.querySelectorAll(${sel}).length)`
    case 'exists':
      return `JSON.stringify(document.querySelector(${sel}) !== null)`
    case 'text':
      return `JSON.stringify(Array.from(document.querySelectorAll(${sel})).slice(0, ${lim}).map(el => (el.textContent || '').trim()))`
    case 'html':
      return `JSON.stringify(Array.from(document.querySelectorAll(${sel})).slice(0, ${lim}).map(el => el.outerHTML))`
    case 'attr':
      return `JSON.stringify(Array.from(document.querySelectorAll(${sel})).slice(0, ${lim}).map(el => el.getAttribute(${at})))`
    case 'value':
      return `JSON.stringify(Array.from(document.querySelectorAll(${sel})).slice(0, ${lim}).map(el => {
        const v = (el && typeof el.value !== 'undefined') ? el.value : null;
        return v;
      }))`
    case 'meta':
      // meta lookup by name attribute (the typical case) — `attr` is the
      // meta name. Falls back to property attribute when present.
      return `JSON.stringify((function(){
        const el = document.querySelector('meta[name=' + JSON.stringify(${at}) + ']') ||
                   document.querySelector('meta[property=' + JSON.stringify(${at}) + ']');
        return el ? el.getAttribute('content') : null;
      })())`
    case 'links': {
      const linkSel = selector || 'a'
      const linkSelJson = JSON.stringify(linkSel)
      return `JSON.stringify(Array.from(document.querySelectorAll(${linkSelJson})).slice(0, ${lim}).map(a => ({
        text: (a.textContent || '').trim(),
        href: a.href || a.getAttribute('href') || ''
      })))`
    }
  }
}

export async function executeBrowserEvaluateReadonly(
  args: BrowserEvaluateArgs
): Promise<string> {
  const kind = args?.kind as BrowserReadKind
  if (!kind || !READ_KINDS.has(kind)) {
    return `Error: kind must be one of ${[...READ_KINDS].join(', ')}.`
  }

  // Per-kind validation. `selector` is required for everything except title /
  // url / meta; `attr` is required for attr / meta.
  const selector = typeof args?.selector === 'string' ? args.selector.trim() : ''
  const attr = typeof args?.attr === 'string' ? args.attr.trim() : ''
  const limit = typeof args?.limit === 'number' ? args.limit : 1

  if (kind !== 'title' && kind !== 'url' && kind !== 'meta' && kind !== 'links') {
    if (!selector) return `Error: selector is required for kind="${kind}".`
  }
  if (kind === 'attr' && !attr) {
    return 'Error: attr is required when kind="attr".'
  }
  if (kind === 'meta' && !attr) {
    return 'Error: attr (meta name) is required when kind="meta".'
  }

  const tab = getActiveTab()
  if (!tab) return NO_TAB

  const payload = buildReadPayload(kind, selector, attr, limit)
  // Outer wrapper traps page-side throws (selector parser errors, e.g.) and
  // returns a string the executor can surface. Whole expression is built
  // server-side; nothing from `args` reaches as code.
  const wrapped =
    `(() => { try { return ${payload}; } catch (e) { return 'eval-error: ' + (e && e.message ? e.message : String(e)); } })()`

  try {
    const result = await tab.view.webContents.executeJavaScript(wrapped, true)
    let out: string
    if (typeof result === 'string') out = result
    else if (result === undefined) out = 'undefined'
    else out = String(result)
    if (out.length > RESULT_CAP) {
      out = out.slice(0, RESULT_CAP) + `\n[truncated at ${RESULT_CAP} chars]`
    }
    return out
  } catch (err: any) {
    return `Error: executeJavaScript failed — ${err?.message ?? 'unknown'}`
  }
}
