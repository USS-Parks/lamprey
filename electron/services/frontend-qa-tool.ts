export interface FrontendQaArgs {
  url: string
  expected_text?: string[]
  selectors?: string[]
  case_sensitive?: boolean
  new_tab?: boolean
}

export interface FrontendQaBrowser {
  open(args: { url: string; new_tab?: boolean }): Promise<string>
  screenshot(args: { full_page?: boolean }): Promise<string>
  getCurrentTab(): Promise<string>
  read(args: {
    kind: 'text' | 'count' | 'exists' | 'title' | 'url'
    selector?: string
    limit?: number
  }): Promise<string>
}

export interface FrontendQaCheck {
  kind: 'expected_text' | 'selector_exists'
  target: string
  ok: boolean
  details?: string
}

export interface FrontendQaReport {
  status: 'passed' | 'failed' | 'needs_review'
  requestedUrl: string
  finalUrl?: string
  title?: string
  screenshotPath?: string
  bodyTextLength: number
  bodyTextPreview: string
  elementCount?: number
  checks: FrontendQaCheck[]
  openResult: string
  screenshotResult: string
  notes: string[]
}

const MAX_EXPECTED_TEXT = 20
const MAX_SELECTORS = 20
const BODY_PREVIEW_CAP = 2_000

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .slice(0, limit)
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function parseReadText(raw: string): string {
  const parsed = parseJson<unknown>(raw)
  if (Array.isArray(parsed)) {
    return parsed.map((v) => (typeof v === 'string' ? v : String(v ?? ''))).join('\n')
  }
  if (typeof parsed === 'string') return parsed
  if (raw.startsWith('Error:') || raw.startsWith('eval-error:')) return ''
  return raw
}

function parseReadNumber(raw: string): number | undefined {
  const parsed = parseJson<unknown>(raw)
  if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function parseReadBoolean(raw: string): boolean | undefined {
  const parsed = parseJson<unknown>(raw)
  if (typeof parsed === 'boolean') return parsed
  if (raw === 'true') return true
  if (raw === 'false') return false
  return undefined
}

function parseTabInfo(raw: string): { title?: string; url?: string } {
  const parsed = parseJson<{ title?: unknown; url?: unknown }>(raw)
  if (!parsed) return {}
  return {
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    url: typeof parsed.url === 'string' ? parsed.url : undefined
  }
}

function screenshotPathFrom(result: string): string | undefined {
  const match = /^Screenshot saved to (.+)$/m.exec(result)
  return match?.[1]?.trim()
}

function tabLooksFailed(tab: { title?: string; url?: string }, requestedUrl: string): boolean {
  const title = tab.title ?? ''
  const url = tab.url ?? ''
  return (
    /^Failed to load\b/i.test(title) ||
    url === '' ||
    (url === 'about:blank' && requestedUrl !== 'about:blank')
  )
}

export function normalizeFrontendQaArgs(args: FrontendQaArgs | undefined): Required<
  Pick<FrontendQaArgs, 'url' | 'expected_text' | 'selectors' | 'case_sensitive' | 'new_tab'>
> {
  const url = typeof args?.url === 'string' ? args.url.trim() : ''
  if (!url) throw new Error('frontend_qa: url is required.')
  return {
    url,
    expected_text: stringList(args?.expected_text, MAX_EXPECTED_TEXT),
    selectors: stringList(args?.selectors, MAX_SELECTORS),
    case_sensitive: args?.case_sensitive === true,
    new_tab: args?.new_tab === true
  }
}

export async function executeFrontendQa(
  args: FrontendQaArgs | undefined,
  browser: FrontendQaBrowser
): Promise<{ result: string; status: 'done' | 'error' }> {
  const normalized = normalizeFrontendQaArgs(args)
  const notes: string[] = []
  const checks: FrontendQaCheck[] = []

  const openResult = await browser.open({
    url: normalized.url,
    new_tab: normalized.new_tab
  })

  let screenshotResult: string
  let title: string | undefined
  let finalUrl: string | undefined
  let bodyText = ''
  let elementCount: number | undefined

  if (!openResult.startsWith('Error:')) {
    const tab = parseTabInfo(await browser.getCurrentTab())
    title = tab.title
    finalUrl = tab.url

    if (tabLooksFailed(tab, normalized.url)) {
      screenshotResult = 'Skipped: page did not load.'
      notes.push(
        `Navigation failed after browser_open: ${title || finalUrl || 'unknown failure'}`
      )
    } else {
      bodyText = parseReadText(
        await browser.read({ kind: 'text', selector: 'body', limit: 1 })
      )
      elementCount = parseReadNumber(
        await browser.read({ kind: 'count', selector: '*' })
      )
      screenshotResult = await browser.screenshot({ full_page: false })
    }
  } else {
    screenshotResult = 'Skipped: page did not open.'
    notes.push('Navigation failed before DOM reads or screenshot capture.')
  }

  const haystack = normalized.case_sensitive ? bodyText : bodyText.toLowerCase()
  for (const text of normalized.expected_text) {
    const needle = normalized.case_sensitive ? text : text.toLowerCase()
    const ok = haystack.includes(needle)
    checks.push({
      kind: 'expected_text',
      target: text,
      ok,
      details: ok ? undefined : 'Text was not found in document.body.'
    })
  }

  for (const selector of normalized.selectors) {
    let ok = false
    let details: string | undefined
    if (!openResult.startsWith('Error:') && !screenshotResult.startsWith('Skipped:')) {
      const raw = await browser.read({ kind: 'exists', selector })
      const exists = parseReadBoolean(raw)
      ok = exists === true
      details = exists === undefined ? `Could not evaluate selector: ${raw}` : undefined
    } else {
      details = 'Selector was not checked because navigation failed.'
    }
    checks.push({ kind: 'selector_exists', target: selector, ok, details })
  }

  if (bodyText.trim().length === 0 && !openResult.startsWith('Error:')) {
    notes.push('The page body has no visible text; inspect the screenshot for canvas-only or blank UI.')
  }
  if (elementCount !== undefined && elementCount <= 3 && !openResult.startsWith('Error:')) {
    notes.push('The DOM has very few elements; this can indicate a blank or failed render.')
  }
  if (screenshotResult.startsWith('Error:')) {
    notes.push('Screenshot capture failed.')
  }

  const requestedChecksFailed = checks.some((c) => !c.ok)
  const hardFailure =
    openResult.startsWith('Error:') ||
    screenshotResult.startsWith('Error:') ||
    screenshotResult.startsWith('Skipped:') ||
    requestedChecksFailed
  const needsReview =
    !hardFailure &&
    (notes.length > 0 ||
      (normalized.expected_text.length === 0 && normalized.selectors.length === 0))

  const report: FrontendQaReport = {
    status: hardFailure ? 'failed' : needsReview ? 'needs_review' : 'passed',
    requestedUrl: normalized.url,
    finalUrl,
    title,
    screenshotPath: screenshotPathFrom(screenshotResult),
    bodyTextLength: bodyText.length,
    bodyTextPreview:
      bodyText.length > BODY_PREVIEW_CAP
        ? bodyText.slice(0, BODY_PREVIEW_CAP) + '\n... (truncated)'
        : bodyText,
    elementCount,
    checks,
    openResult,
    screenshotResult,
    notes
  }

  return {
    result: JSON.stringify(report, null, 2),
    status: report.status === 'failed' ? 'error' : 'done'
  }
}
