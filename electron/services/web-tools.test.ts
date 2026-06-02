import { describe, expect, it } from 'vitest'
import {
  executeTimeLookup,
  executeWebFind,
  stripHtmlToText
} from './web-tools'

// Pure-helper tests. The network paths (web_search, web_open, image_search)
// are covered by adapter-level mocking in later sessions; this file pins
// the input-validation surface and the HTML→text helper so refactors don't
// silently regress them.

describe('stripHtmlToText', () => {
  it('strips script and style blocks', () => {
    const html = '<html><body>Hello<script>alert(1)</script> there<style>p{color:red}</style></body></html>'
    const text = stripHtmlToText(html)
    expect(text).not.toContain('alert')
    expect(text).not.toContain('color:red')
    expect(text).toContain('Hello')
    expect(text).toContain('there')
  })

  it('decodes common entities', () => {
    const text = stripHtmlToText('<p>Tom &amp; Jerry &lt;3 &quot;love&quot;</p>')
    expect(text).toContain('Tom & Jerry')
    expect(text).toContain('<3')
    expect(text).toContain('"love"')
  })

  it('decodes numeric entities', () => {
    const text = stripHtmlToText('<p>caf&#233; &#x263A;</p>')
    expect(text).toContain('café')
    expect(text).toContain('☺')
  })

  it('preserves paragraph boundaries as newlines', () => {
    const html = '<p>one</p><p>two</p><p>three</p>'
    const text = stripHtmlToText(html)
    const lines = text.split('\n').filter((l) => l.trim() !== '')
    expect(lines).toEqual(['one', 'two', 'three'])
  })

  it('collapses runs of whitespace', () => {
    const text = stripHtmlToText('<p>a    b\t\tc</p>')
    expect(text).toBe('a b c')
  })
})

describe('executeTimeLookup', () => {
  it('returns a UTC string by default', async () => {
    const out = await executeTimeLookup({})
    expect(out).toMatch(/\(UTC\)$/)
  })

  it('honors a known timezone', async () => {
    const out = await executeTimeLookup({ timezone: 'America/Los_Angeles' })
    expect(out).toMatch(/\(America\/Los_Angeles\)$/)
  })

  it('returns a clean error for invalid timezones', async () => {
    const out = await executeTimeLookup({ timezone: 'Not/A_Zone' })
    expect(out.startsWith('Error:')).toBe(true)
  })
})

describe('executeWebFind argument validation', () => {
  it('rejects missing url', async () => {
    const out = await executeWebFind({ url: '', text: 'foo' })
    expect(out.startsWith('Error:')).toBe(true)
  })

  it('rejects missing text', async () => {
    const out = await executeWebFind({ url: 'https://example.com', text: '' })
    expect(out.startsWith('Error:')).toBe(true)
  })
})
