import { describe, expect, it } from 'vitest'
import {
  detectAtMention,
  isInsideCodeContext,
  rankFiles,
  scoreFile
} from './file-rank'

describe('file-rank.scoreFile', () => {
  it('returns -Infinity when query is not a subsequence', () => {
    expect(scoreFile('xyz', 'src/foo.ts')).toBe(-Infinity)
  })

  it('ranks basename exact matches above subsequence matches', () => {
    const exact = scoreFile('foo.ts', 'src/foo.ts')
    const sub = scoreFile('foo.ts', 'src/lib/seven-foo-helpers.ts')
    expect(exact).toBeGreaterThan(sub)
  })

  it('ranks basename prefix above basename-include', () => {
    const prefix = scoreFile('chat', 'src/components/chat/ChatInput.tsx')
    const include = scoreFile('chat', 'src/foo/never-chat-bar.ts')
    expect(prefix).toBeGreaterThan(include)
  })

  it('an extension-only query (".ts") prefers files of that extension', () => {
    const ts = scoreFile('.ts', 'src/util.ts')
    const tsx = scoreFile('.ts', 'src/util.tsx')
    expect(ts).toBeGreaterThan(tsx)
  })

  it('shorter paths win on tie', () => {
    const short = scoreFile('foo', 'foo.ts')
    const deep = scoreFile('foo', 'a/very/deep/folder/structure/foo.ts')
    expect(short).toBeGreaterThan(deep)
  })
})

describe('file-rank.rankFiles', () => {
  it('returns the shortest files first on empty query', () => {
    const files = ['src/long/path/here.ts', 'foo.ts', 'src/util.ts']
    expect(rankFiles('', files, 3)).toEqual(['foo.ts', 'src/util.ts', 'src/long/path/here.ts'])
  })

  it('returns the best basename matches first', () => {
    const files = [
      'src/foo/bar.ts',
      'src/components/chat/ChatInput.tsx',
      'src/lib/ChatUtils.ts'
    ]
    // Both Chat* files share the basename-prefix bonus; shorter path wins.
    const out = rankFiles('chat', files)
    expect(out[0]).toBe('src/lib/ChatUtils.ts')
    expect(out[1]).toBe('src/components/chat/ChatInput.tsx')
    // bar.ts is a subsequence (c→nothing? actually 'c-h-a-t' not present in 'bar') → excluded.
    expect(out).not.toContain('src/foo/bar.ts')
  })

  it('a more specific prefix wins over a shorter looser match', () => {
    const files = ['src/lib/ChatUtils.ts', 'src/components/chat/ChatInput.tsx']
    expect(rankFiles('ChatI', files)[0]).toBe('src/components/chat/ChatInput.tsx')
  })

  it('honors the limit', () => {
    const files = Array.from({ length: 50 }, (_, i) => `f${i}.ts`)
    expect(rankFiles('f', files, 5).length).toBe(5)
  })
})

describe('file-rank.detectAtMention', () => {
  it('returns the token when caret is right after @word', () => {
    const text = 'look at @foo'
    const out = detectAtMention(text, text.length)
    expect(out).toEqual({ token: 'foo', start: text.indexOf('@'), end: text.length })
  })

  it('returns an empty token for a bare @ (just typed)', () => {
    const text = 'hey @'
    const out = detectAtMention(text, text.length)
    expect(out).not.toBeNull()
    expect(out!.token).toBe('')
  })

  it('returns null for an email-like `someone@addr`', () => {
    const text = 'mailto:someone@addr.com'
    // Caret right after the `@` would normally trigger; but the char before
    // `@` is `e`, not whitespace — so we suppress.
    const at = text.indexOf('@')
    const out = detectAtMention(text, at + 4)
    expect(out).toBeNull()
  })

  it('returns null inside a triple-backtick fence', () => {
    const text = 'before\n```ts\nconst x = @foo'
    const out = detectAtMention(text, text.length)
    expect(out).toBeNull()
  })

  it('returns null inside an inline backtick span', () => {
    const text = 'see `@foo.ts'
    const out = detectAtMention(text, text.length)
    expect(out).toBeNull()
  })

  it('matches at the very start of the input', () => {
    const text = '@bar'
    const out = detectAtMention(text, text.length)
    expect(out).toEqual({ token: 'bar', start: 0, end: text.length })
  })

  it('returns null when the @ is followed by no word chars and the caret is past whitespace', () => {
    const text = '@ hello'
    const out = detectAtMention(text, text.length)
    expect(out).toBeNull()
  })
})

describe('file-rank.isInsideCodeContext', () => {
  it('detects an open ``` fence', () => {
    const text = '```ts\nlet x ='
    expect(isInsideCodeContext(text, text.length)).toBe(true)
  })

  it('returns false when the fence has been closed', () => {
    const text = '```ts\nlet x = 1\n```\nafter '
    expect(isInsideCodeContext(text, text.length)).toBe(false)
  })

  it('detects an open inline ` span', () => {
    const text = 'foo `bar'
    expect(isInsideCodeContext(text, text.length)).toBe(true)
  })

  it('returns false when the inline span has closed', () => {
    const text = 'foo `bar` baz '
    expect(isInsideCodeContext(text, text.length)).toBe(false)
  })

  it('a `?` after `code` is not treated as inside (different line)', () => {
    const text = '`code`\nnow @'
    expect(isInsideCodeContext(text, text.length)).toBe(false)
  })
})
