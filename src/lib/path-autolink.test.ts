import { describe, expect, it } from 'vitest'
import { autolinkText } from './path-autolink'

function links(text: string) {
  return autolinkText(text).filter((s) => s.kind === 'link') as Array<{
    kind: 'link'
    path: string
    line?: number
    raw: string
  }>
}

describe('autolinkText — positive cases', () => {
  it('matches a plain repo-relative path', () => {
    const out = links('see src/foo.ts')
    expect(out).toHaveLength(1)
    expect(out[0].path).toBe('src/foo.ts')
    expect(out[0].line).toBeUndefined()
  })

  it('matches path:line', () => {
    const out = links('look at src/App.tsx:42 for the fix')
    expect(out).toHaveLength(1)
    expect(out[0].path).toBe('src/App.tsx')
    expect(out[0].line).toBe(42)
  })

  it('matches a relative path with leading ./', () => {
    const out = links('the file ./bar.tsx changed')
    expect(out).toHaveLength(1)
    expect(out[0].path).toBe('./bar.tsx')
  })

  it('matches a Windows-style backslash path', () => {
    const out = links('path\\to\\baz.json was edited')
    expect(out).toHaveLength(1)
    expect(out[0].path).toBe('path\\to\\baz.json')
  })

  it('matches a bare basename with a known extension', () => {
    const out = links('open ChatInput.tsx')
    expect(out).toHaveLength(1)
    expect(out[0].path).toBe('ChatInput.tsx')
  })

  it('matches multiple refs in one paragraph', () => {
    const out = links('compare src/foo.ts:10 against tests/foo.test.ts')
    expect(out.map((l) => l.path)).toEqual(['src/foo.ts', 'tests/foo.test.ts'])
    expect(out[0].line).toBe(10)
  })
})

describe('autolinkText — negative cases', () => {
  it('does NOT match a URL ending in a known extension', () => {
    const out = links('see https://example.com/docs/index.html for more')
    expect(out).toHaveLength(0)
  })

  it('does NOT match a word ending in .md.bak (extended dot)', () => {
    const out = links('the README.md.bak file')
    expect(out).toHaveLength(0)
  })

  it('does NOT match version-style triples like 1.2.3', () => {
    const out = links('version 1.2.3 of the lib')
    expect(out).toHaveLength(0)
  })

  it('does NOT match domain names with non-source extensions (.io, .com)', () => {
    const out = links('visit lamprey.io for docs')
    expect(out).toHaveLength(0)
  })
})

describe('autolinkText — segmentation', () => {
  it('returns mixed text/link segments preserving the prose between', () => {
    const out = autolinkText('look at src/App.tsx and then check tests/foo.ts:5')
    expect(out).toEqual([
      { kind: 'text', value: 'look at ' },
      { kind: 'link', path: 'src/App.tsx', line: undefined, raw: 'src/App.tsx' },
      { kind: 'text', value: ' and then check ' },
      { kind: 'link', path: 'tests/foo.ts', line: 5, raw: 'tests/foo.ts:5' }
    ])
  })

  it('returns a single text segment when there are no matches', () => {
    expect(autolinkText('no refs here')).toEqual([{ kind: 'text', value: 'no refs here' }])
  })

  it('returns an empty array for empty input', () => {
    expect(autolinkText('')).toEqual([])
  })
})
