import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The loader imports `app` + `BrowserWindow` at module-load time for the
// init/shutdown paths; we never call those here, but the imports still
// need to resolve. Mock electron the same way `event-log.test.ts` does.
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('electron app not available in test environment')
    }
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

// `is.dev` is read inside `resolveSlashDir`; default-true in tests is
// fine — we never invoke it without a tmp dir override.
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

import {
  __slashLoaderTest,
  type SlashCommand
} from './slash-commands'

// Track 2 / C4 — slash-command loader tests. Exercises the parse +
// interpolation surface without booting Electron or chokidar. The
// initialize/shutdown paths use `app.getPath` which requires the
// Electron runtime, so we test those at integration time only.

const { interpolateSlashBody, fileNameToSlug, isMarkdownFile, parseSlashFile } =
  __slashLoaderTest

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'slash-test-'))
})

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

function writeMd(name: string, content: string): string {
  const p = join(tmp, name)
  writeFileSync(p, content, 'utf-8')
  return p
}

function buildCmd(overrides: Partial<SlashCommand> = {}): SlashCommand {
  return {
    name: 'demo',
    description: 'd',
    args: [],
    hidden: false,
    body: 'hello {{args}}',
    filePath: '',
    source: 'builtin',
    ...overrides
  }
}

describe('fileNameToSlug', () => {
  it('strips .md and lowercases', () => {
    expect(fileNameToSlug('/tmp/Init.MD')).toBe('init')
  })
})

describe('isMarkdownFile', () => {
  it('only matches .md', () => {
    expect(isMarkdownFile('/tmp/x.md')).toBe(true)
    expect(isMarkdownFile('/tmp/x.txt')).toBe(false)
  })
})

describe('parseSlashFile', () => {
  it('parses frontmatter + body', () => {
    const p = writeMd(
      'review.md',
      `---\nname: review\ndescription: Review the diff.\nargs: [scope]\n---\nReview {{scope}} now.\n`
    )
    const c = parseSlashFile(p)
    expect(c).not.toBeNull()
    expect(c!.name).toBe('review')
    expect(c!.description).toBe('Review the diff.')
    expect(c!.args).toEqual(['scope'])
    expect(c!.hidden).toBe(false)
    expect(c!.body).toBe('Review {{scope}} now.')
  })

  it('falls back to filename when frontmatter omits name', () => {
    const p = writeMd(
      'simplify.md',
      `---\ndescription: Simplify.\n---\nBody here.\n`
    )
    const c = parseSlashFile(p)
    expect(c?.name).toBe('simplify')
  })

  it('respects hidden: true', () => {
    const p = writeMd(
      'h.md',
      `---\nname: h\ndescription: x\nhidden: true\n---\nbody\n`
    )
    expect(parseSlashFile(p)?.hidden).toBe(true)
  })

  it('returns null when body is empty', () => {
    const p = writeMd(
      'empty.md',
      `---\nname: empty\ndescription: x\n---\n`
    )
    expect(parseSlashFile(p)).toBeNull()
  })

  it('returns null on unreadable input', () => {
    expect(parseSlashFile(join(tmp, 'does-not-exist.md'))).toBeNull()
  })
})

describe('interpolateSlashBody', () => {
  it('replaces {{args}} with the entire rest', () => {
    const out = interpolateSlashBody(buildCmd(), 'v1.2.3 staging')
    expect(out).toBe('hello v1.2.3 staging')
  })

  it('replaces positional {{arg1}}, {{arg2}}', () => {
    const out = interpolateSlashBody(
      buildCmd({ body: 'first={{arg1}} second={{arg2}}' }),
      'a b c'
    )
    expect(out).toBe('first=a second=b')
  })

  it('replaces named args when frontmatter declares them', () => {
    const out = interpolateSlashBody(
      buildCmd({ args: ['version', 'env'], body: '{{version}} -> {{env}}' }),
      '1.2.3 staging'
    )
    expect(out).toBe('1.2.3 -> staging')
  })

  it('leaves unknown tokens intact', () => {
    const out = interpolateSlashBody(
      buildCmd({ body: 'known={{args}} unknown={{nope}}' }),
      'hi'
    )
    expect(out).toBe('known=hi unknown={{nope}}')
  })

  it('handles empty rest gracefully', () => {
    const out = interpolateSlashBody(
      buildCmd({ body: 'a={{args}} b={{arg1}}' }),
      ''
    )
    expect(out).toBe('a= b=')
  })

  it('tolerates whitespace around the token key', () => {
    const out = interpolateSlashBody(
      buildCmd({ body: 'x={{   args   }}' }),
      'val'
    )
    expect(out).toBe('x=val')
  })

  it('named arg empty when not enough tokens', () => {
    const out = interpolateSlashBody(
      buildCmd({ args: ['version'], body: '[{{version}}]' }),
      ''
    )
    expect(out).toBe('[]')
  })
})
