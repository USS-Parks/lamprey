import { describe, expect, it } from 'vitest'
import {
  executeFrontendQa,
  normalizeFrontendQaArgs,
  type FrontendQaBrowser,
  type FrontendQaReport
} from './frontend-qa-tool'

function browser(overrides: Partial<FrontendQaBrowser> = {}): FrontendQaBrowser {
  return {
    open: async () => 'Opened http://localhost:5173/ (tab tab-1, title "Lamprey")',
    screenshot: async () => 'Screenshot saved to C:\\Users\\test\\shot.png',
    getCurrentTab: async () =>
      JSON.stringify({
        id: 'tab-1',
        title: 'Lamprey',
        url: 'http://localhost:5173/',
        loading: false
      }),
    read: async (args) => {
      if (args.kind === 'text') return JSON.stringify(['Save changes\nReady'])
      if (args.kind === 'count') return JSON.stringify(42)
      if (args.kind === 'exists') return JSON.stringify(args.selector === '#save')
      if (args.kind === 'title') return JSON.stringify('Lamprey')
      if (args.kind === 'url') return JSON.stringify('http://localhost:5173/')
      return 'null'
    },
    ...overrides
  }
}

async function report(
  args: Parameters<typeof executeFrontendQa>[0],
  b: FrontendQaBrowser = browser()
): Promise<{ report: FrontendQaReport; status: 'done' | 'error' }> {
  const out = await executeFrontendQa(args, b)
  return { report: JSON.parse(out.result) as FrontendQaReport, status: out.status }
}

describe('normalizeFrontendQaArgs', () => {
  it('requires a URL', () => {
    expect(() => normalizeFrontendQaArgs(undefined)).toThrow(/url is required/)
    expect(() => normalizeFrontendQaArgs({ url: '   ' })).toThrow(/url is required/)
  })

  it('trims and caps optional checks', () => {
    const normalized = normalizeFrontendQaArgs({
      url: ' http://localhost:5173 ',
      expected_text: [' Ready ', '', 'Save'],
      selectors: Array.from({ length: 30 }, (_, i) => `#item-${i}`),
      case_sensitive: true,
      new_tab: true
    })
    expect(normalized.url).toBe('http://localhost:5173')
    expect(normalized.expected_text).toEqual(['Ready', 'Save'])
    expect(normalized.selectors).toHaveLength(20)
    expect(normalized.case_sensitive).toBe(true)
    expect(normalized.new_tab).toBe(true)
  })
})

describe('executeFrontendQa', () => {
  it('passes when expected text and selectors are present', async () => {
    const out = await report({
      url: 'http://localhost:5173',
      expected_text: ['save changes'],
      selectors: ['#save']
    })
    expect(out.status).toBe('done')
    expect(out.report.status).toBe('passed')
    expect(out.report.screenshotPath).toBe('C:\\Users\\test\\shot.png')
    expect(out.report.checks.every((c) => c.ok)).toBe(true)
  })

  it('passes when a single explicit assertion category is present', async () => {
    const out = await report({
      url: 'http://localhost:5173',
      expected_text: ['ready']
    })
    expect(out.status).toBe('done')
    expect(out.report.status).toBe('passed')
  })

  it('fails when expected text is missing', async () => {
    const out = await report({
      url: 'http://localhost:5173',
      expected_text: ['danger zone']
    })
    expect(out.status).toBe('error')
    expect(out.report.status).toBe('failed')
    expect(out.report.checks[0]).toMatchObject({
      kind: 'expected_text',
      target: 'danger zone',
      ok: false
    })
  })

  it('fails when a requested selector is missing', async () => {
    const out = await report({
      url: 'http://localhost:5173',
      selectors: ['#missing']
    })
    expect(out.status).toBe('error')
    expect(out.report.status).toBe('failed')
    expect(out.report.checks[0]).toMatchObject({
      kind: 'selector_exists',
      target: '#missing',
      ok: false
    })
  })

  it('marks navigation failure as an error report', async () => {
    const out = await report(
      { url: 'http://localhost:9' },
      browser({ open: async () => 'Error: failed to load http://localhost:9' })
    )
    expect(out.status).toBe('error')
    expect(out.report.status).toBe('failed')
    expect(out.report.screenshotResult).toContain('Skipped')
    expect(out.report.notes.join('\n')).toContain('Navigation failed')
  })

  it('fails when browser_open reports opened but the active tab failed to load', async () => {
    let readCount = 0
    const out = await report(
      { url: 'http://localhost:5173' },
      browser({
        open: async () =>
          'Opened http://localhost:5173/ (tab tab-1, title "Failed to load")',
        getCurrentTab: async () =>
          JSON.stringify({
            id: 'tab-1',
            title: 'Failed to load - ERR_CONNECTION_REFUSED',
            url: 'http://localhost:5173/',
            loading: false
          }),
        read: async () => {
          readCount++
          return JSON.stringify(['should not be read'])
        }
      })
    )
    expect(out.status).toBe('error')
    expect(out.report.status).toBe('failed')
    expect(out.report.screenshotResult).toContain('Skipped')
    expect(out.report.notes.join('\n')).toContain('Navigation failed after browser_open')
    expect(readCount).toBe(0)
  })

  it('returns needs_review when the page loads but no assertions were supplied', async () => {
    const out = await report({ url: 'http://localhost:5173' })
    expect(out.status).toBe('done')
    expect(out.report.status).toBe('needs_review')
    expect(out.report.bodyTextPreview).toContain('Save changes')
  })
})
