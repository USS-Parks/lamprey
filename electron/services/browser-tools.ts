import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  coerceUrl,
  getActiveTab,
  getTab,
  newTab,
  type BrowserTabHandle
} from './browser-manager'

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
