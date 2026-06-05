import { describe, expect, it, vi } from 'vitest'
import type { CuratedSource } from './collector'

vi.mock('../settings-helper', () => ({
  readSettings: () => ({})
}))

import { extractAll, extractPage } from './extractor'

function mkSource(url: string, title = 'fixture'): CuratedSource {
  return {
    n: 1,
    url,
    canonicalUrl: url,
    title,
    snippet: '',
    registrableDomain: 'example.com',
    trustScore: 1,
    sourceQuery: 'q',
    sourceAngle: 'a',
    provider: 'duckduckgo'
  }
}

function mockFetch(
  body: string,
  contentType = 'text/html; charset=utf-8',
  ok = true,
  status = 200
): (url: string) => Promise<{ ok: boolean; status: number; body: string; contentType: string | null }> {
  return async () => ({ ok, status, body, contentType })
}

describe('extractPage — basic shapes', () => {
  it('extracts text from an article element', async () => {
    const html = `<!DOCTYPE html><html><head><title>Page Title</title></head><body>
      <nav>SKIP THIS NAV</nav>
      <article>
        <h1>Fusion Energy in 2026</h1>
        <p>Fusion power is a proposed form of power generation that would generate electricity by using heat from nuclear fusion reactions. Multiple paragraphs of substantial content here describing the state of the art and recent commercial efforts.</p>
        <p>Investment in private fusion companies reached new highs in 2025, with several breakthroughs in plasma confinement and net energy gain demonstrations across multiple research facilities.</p>
      </article>
      <footer>SKIP THIS FOOTER</footer>
    </body></html>`
    const r = await extractPage(mkSource('https://example.com/article'), {
      fetchFn: mockFetch(html)
    })
    expect(r.status).toBe('ok')
    expect(r.title).toBe('Fusion Energy in 2026')
    expect(r.fullText).toContain('Fusion power is a proposed')
    expect(r.fullText).not.toContain('SKIP THIS NAV')
    expect(r.fullText).not.toContain('SKIP THIS FOOTER')
  })

  it('falls back to <main> when no <article>', async () => {
    const html = `<html><body>
      <main>
        <h1>About Us</h1>
        <p>This page is about us. We have lots and lots of text in this main element so that the main extraction strategy fires. Two sentences makes sure the nonTrivialText length check passes the threshold easily.</p>
      </main>
    </body></html>`
    const r = await extractPage(mkSource('https://example.com/about'), {
      fetchFn: mockFetch(html)
    })
    expect(r.status).toBe('ok')
    expect(r.title).toBe('About Us')
    expect(r.fullText).toContain('This page is about us')
  })

  it('falls back to the largest div when no article/main', async () => {
    const html = `<html><body>
      <div class="tiny">Tiny</div>
      <div id="main-content">
        <h1>Big Section</h1>
        <p>This is the largest text-bearing block on the page. It contains many words and represents the actual content that we want extracted, while the tiny div above is just a small label that should not win.</p>
      </div>
    </body></html>`
    const r = await extractPage(mkSource('https://example.com/x'), {
      fetchFn: mockFetch(html)
    })
    expect(r.status).toBe('ok')
    expect(r.fullText).toContain('largest text-bearing block')
  })

  it('strips <script> and <style> from extracted output', async () => {
    const html = `<html><body><article>
      <h1>Title</h1>
      <script>const secretInternals = "DO NOT LEAK";</script>
      <style>body { color: red; }</style>
      <p>Some legitimate content goes here. Enough words to pass the nontrivial threshold of two hundred characters easily so the article strategy fires successfully.</p>
    </article></body></html>`
    const r = await extractPage(mkSource('https://example.com/x'), {
      fetchFn: mockFetch(html)
    })
    expect(r.fullText).not.toContain('secretInternals')
    expect(r.fullText).not.toContain('color: red')
  })

  it('prefers <h1> over <title> when both are present', async () => {
    const html = `<html><head><title>Generic Site Name</title></head><body>
      <article>
        <h1>The Actual Headline</h1>
        <p>Page content here, enough words to pass the nontrivial threshold of two hundred characters easily so the article strategy actually fires for this fixture.</p>
      </article>
    </body></html>`
    const r = await extractPage(mkSource('https://example.com/x'), {
      fetchFn: mockFetch(html)
    })
    expect(r.title).toBe('The Actual Headline')
  })

  it('extracts published_at from <time datetime>', async () => {
    const html = `<html><body><article>
      <h1>Article</h1>
      <time datetime="2026-06-05T12:00:00Z">June 5, 2026</time>
      <p>Substantial article content goes here to easily pass the two hundred character nonTrivialText threshold check for this fixture page test.</p>
    </article></body></html>`
    const r = await extractPage(mkSource('https://example.com/x'), {
      fetchFn: mockFetch(html)
    })
    expect(r.publishedAt).toBe('2026-06-05T12:00:00Z')
  })

  it('extracts byline from <meta name="author">', async () => {
    const html = `<html><head><meta name="author" content="Jane Doe"></head><body><article>
      <h1>Article</h1>
      <p>Substantial article content goes here to easily pass the two hundred character nonTrivialText threshold check for this fixture page test.</p>
    </article></body></html>`
    const r = await extractPage(mkSource('https://example.com/x'), {
      fetchFn: mockFetch(html)
    })
    expect(r.byline).toBe('Jane Doe')
  })

  it('caps fullText length at MAX_RETURN_BYTES', async () => {
    const huge = 'sentence of text. '.repeat(5000) // ~90KB
    const html = `<html><body><article>${huge}</article></body></html>`
    const r = await extractPage(mkSource('https://example.com/x'), {
      fetchFn: mockFetch(html)
    })
    expect(r.fullText.length).toBeLessThanOrEqual(30_002) // 30KB + ellipsis
  })
})

describe('extractPage — failure paths', () => {
  it('returns status=failed on HTTP non-2xx', async () => {
    const r = await extractPage(mkSource('https://example.com/x'), {
      fetchFn: mockFetch('', 'text/html', false, 404)
    })
    expect(r.status).toBe('failed')
    expect(r.error).toContain('HTTP 404')
    expect(r.fullText).toBe('')
  })

  it('returns status=failed on non-HTML content-type (PDF, etc.)', async () => {
    const r = await extractPage(mkSource('https://example.com/file.pdf'), {
      fetchFn: mockFetch('%PDF-1.4 binary', 'application/pdf')
    })
    expect(r.status).toBe('failed')
    expect(r.error).toContain('unsupported content-type')
  })

  it('returns status=failed when there is no readable text', async () => {
    const html = '<html><body><script>nothing</script></body></html>'
    const r = await extractPage(mkSource('https://example.com/x'), {
      fetchFn: mockFetch(html)
    })
    expect(r.status).toBe('failed')
  })

  it('returns status=aborted when the signal aborts before fetch', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const r = await extractPage(mkSource('https://example.com/x'), {
      signal: ctrl.signal,
      fetchFn: mockFetch('<html><body><article><p>x</p></article></body></html>')
    })
    expect(r.status).toBe('aborted')
  })

  it('never throws — fetchFn rejection lands as status=failed', async () => {
    const r = await extractPage(mkSource('https://example.com/x'), {
      fetchFn: async () => {
        throw new Error('network')
      }
    })
    expect(r.status).toBe('failed')
    expect(r.error).toContain('network')
  })
})

describe('extractAll — batch', () => {
  it('extracts a batch in parallel and returns one entry per source', async () => {
    const sources = Array.from({ length: 6 }, (_, i) => mkSource(`https://example.com/${i}`, `T${i}`))
    const r = await extractAll(
      sources,
      3,
      undefined,
      mockFetch(
        '<html><body><article><h1>Title</h1><p>Article content here, enough words to pass the two hundred character nonTrivialText threshold check easily for this fixture page test scenario.</p></article></body></html>'
      )
    )
    expect(r.length).toBe(6)
    expect(r.every((p) => p.status === 'ok')).toBe(true)
    // Preserves source numbering.
    expect(r.map((p) => p.n)).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('respects the abort signal', async () => {
    const sources = Array.from({ length: 4 }, (_, i) => mkSource(`https://example.com/${i}`, `T${i}`))
    const ctrl = new AbortController()
    ctrl.abort()
    const r = await extractAll(
      sources,
      3,
      ctrl.signal,
      mockFetch('<html><body><article>x</article></body></html>')
    )
    // Aborted before any run, so the runner pool returns nothing.
    expect(r.length).toBe(0)
  })
})
