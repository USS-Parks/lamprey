import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => join(process.cwd(), '.tmp-snip-user-data') },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true }
}))

import { __filterLoaderTest } from './filter-loader'
import { validateFilter } from './filter-schema'

const SAMPLE_GIT_STATUS_YAML = `
name: git-status
description: Condense git status to summary
match:
  command: git
  subcommand: status
pipeline:
  - action: strip_ansi
  - action: keep_lines
    pattern: "^(\\\\?\\\\?|M |A |D |R |C |U |\\\\s+modified:|\\\\s+new file:|\\\\s+deleted:)"
  - action: format_template
    template: "{{.count}} changed files:\\n{{.lines}}"
`

const SAMPLE_BAD_YAML = `
name: bad
description: missing pipeline
match:
  command: foo
`

const SAMPLE_BAD_ACTION = `
name: bad-action
description: unknown action tag
match:
  command: foo
pipeline:
  - action: explode_universe
`

describe('snip filter-schema — validateFilter', () => {
  it('accepts a well-formed filter', () => {
    const parsed = {
      name: 'x',
      description: 'y',
      match: { command: 'git', subcommand: 'log' },
      pipeline: [
        { action: 'head', n: 10 },
        { action: 'format_template', template: '{{.lines}}' }
      ]
    }
    const r = validateFilter(parsed)
    expect(r.ok).toBe(true)
    expect(r.filter?.name).toBe('x')
    expect(r.filter?.pipeline).toHaveLength(2)
  })

  it('rejects missing name', () => {
    const r = validateFilter({ description: 'y', match: { command: 'x' }, pipeline: [] })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/name/)
  })

  it('rejects empty name', () => {
    const r = validateFilter({ name: '   ', description: 'y', match: { command: 'x' }, pipeline: [] })
    expect(r.ok).toBe(false)
  })

  it('rejects missing match.command', () => {
    const r = validateFilter({ name: 'x', description: 'y', match: {}, pipeline: [] })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/match\.command/)
  })

  it('rejects unknown pipeline action tag', () => {
    const r = validateFilter({
      name: 'x',
      description: 'y',
      match: { command: 'foo' },
      pipeline: [{ action: 'EXPLODE' }]
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/action/)
  })

  it('rejects keep_lines without pattern', () => {
    const r = validateFilter({
      name: 'x',
      description: 'y',
      match: { command: 'foo' },
      pipeline: [{ action: 'keep_lines' }]
    })
    expect(r.ok).toBe(false)
  })

  it('rejects truncate_lines without max', () => {
    const r = validateFilter({
      name: 'x',
      description: 'y',
      match: { command: 'foo' },
      pipeline: [{ action: 'truncate_lines' }]
    })
    expect(r.ok).toBe(false)
  })

  it('rejects replace without replacement', () => {
    const r = validateFilter({
      name: 'x',
      description: 'y',
      match: { command: 'foo' },
      pipeline: [{ action: 'replace', pattern: 'a' }]
    })
    expect(r.ok).toBe(false)
  })

  it('accepts aggregate with totalAs', () => {
    const r = validateFilter({
      name: 'x',
      description: 'y',
      match: { command: 'foo' },
      pipeline: [
        {
          action: 'aggregate',
          counters: [{ name: 'p', pattern: '^P' }],
          totalAs: 'total'
        }
      ]
    })
    expect(r.ok).toBe(true)
  })

  it('rejects aggregate with malformed counter', () => {
    const r = validateFilter({
      name: 'x',
      description: 'y',
      match: { command: 'foo' },
      pipeline: [
        { action: 'aggregate', counters: [{ name: 'p' }] }
      ]
    })
    expect(r.ok).toBe(false)
  })

  it('accepts onError variants', () => {
    const r1 = validateFilter({
      name: 'x',
      description: 'y',
      match: { command: 'foo' },
      pipeline: [],
      onError: 'passthrough'
    })
    expect(r1.ok).toBe(true)
    const r2 = validateFilter({
      name: 'x',
      description: 'y',
      match: { command: 'foo' },
      pipeline: [],
      onError: 'invalid'
    })
    expect(r2.ok).toBe(false)
  })

  it('accepts stderrPipeline', () => {
    const r = validateFilter({
      name: 'x',
      description: 'y',
      match: { command: 'tsc' },
      pipeline: [],
      stderrPipeline: [{ action: 'strip_ansi' }]
    })
    expect(r.ok).toBe(true)
    expect(r.filter?.stderrPipeline).toHaveLength(1)
  })
})

describe('snip filter-loader — YAML parsing (no Electron)', () => {
  it('parses a real-world YAML body into a valid Filter', () => {
    const r = __filterLoaderTest.loadOneFromString('/fake/git-status.yaml', SAMPLE_GIT_STATUS_YAML)
    expect(r.error).toBeUndefined()
    expect(r.filter?.name).toBe('git-status')
    expect(r.filter?.match.command).toBe('git')
    expect(r.filter?.match.subcommand).toBe('status')
    expect(r.filter?.pipeline).toHaveLength(3)
  })

  it('reports a structured error for missing fields', () => {
    const r = __filterLoaderTest.loadOneFromString('/fake/bad.yaml', SAMPLE_BAD_YAML)
    expect(r.filter).toBeUndefined()
    expect(r.error).toMatch(/pipeline/)
  })

  it('reports a structured error for unknown action tags', () => {
    const r = __filterLoaderTest.loadOneFromString('/fake/bad-action.yaml', SAMPLE_BAD_ACTION)
    expect(r.filter).toBeUndefined()
    expect(r.error).toMatch(/action/)
  })

  it('reports a parse error for malformed YAML', () => {
    const r = __filterLoaderTest.loadOneFromString('/fake/broken.yaml', 'not: valid: yaml: ::::')
    expect(r.filter).toBeUndefined()
    expect(r.error).toBeTypeOf('string')
  })

  it('classifyPath: built-in subtree → built-in, root → user', () => {
    const userRoot = '/tmp/userdata/snip/filters'
    expect(__filterLoaderTest.classifyPath(`${userRoot}/built-in/git/log.yaml`, userRoot)).toBe(
      'built-in'
    )
    expect(__filterLoaderTest.classifyPath(`${userRoot}/my-custom.yaml`, userRoot)).toBe('user')
  })

  it('isYamlFile accepts .yaml and .yml, rejects .draft.yaml and other', () => {
    expect(__filterLoaderTest.isYamlFile('/x/git-log.yaml')).toBe(true)
    expect(__filterLoaderTest.isYamlFile('/x/git-log.yml')).toBe(true)
    expect(__filterLoaderTest.isYamlFile('/x/draft-of.draft.yaml')).toBe(false)
    expect(__filterLoaderTest.isYamlFile('/x/README.md')).toBe(false)
    expect(__filterLoaderTest.isYamlFile('/x/config.json')).toBe(false)
  })
})

describe('snip filter-loader — fs round-trip', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'snip-loader-test-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('round-trips a YAML file through the on-disk parser', async () => {
    const path = join(tmp, 'git-status.yaml')
    writeFileSync(path, SAMPLE_GIT_STATUS_YAML, 'utf-8')
    // Use the test helper to avoid pulling Electron — just verify the
    // string-→-Filter contract holds for content read off disk.
    const { readFileSync } = await import('fs')
    const raw = readFileSync(path, 'utf-8')
    const r = __filterLoaderTest.loadOneFromString(path, raw)
    expect(r.error).toBeUndefined()
    expect(r.filter?.name).toBe('git-status')
  })

  it('supports nested directory layout', () => {
    const sub = join(tmp, 'git')
    mkdirSync(sub, { recursive: true })
    const path = join(sub, 'log.yaml')
    writeFileSync(
      path,
      `
name: git-log
description: head 10 commits
match:
  command: git
  subcommand: log
  excludeFlags: ["--oneline", "--pretty"]
pipeline:
  - action: head
    n: 10
`,
      'utf-8'
    )
    const { readFileSync } = require('fs') as typeof import('fs')
    const raw = readFileSync(path, 'utf-8')
    const r = __filterLoaderTest.loadOneFromString(path, raw)
    expect(r.error).toBeUndefined()
    expect(r.filter?.match.excludeFlags).toEqual(['--oneline', '--pretty'])
  })
})
