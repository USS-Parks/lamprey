import { describe, expect, it } from 'vitest'
import {
  computeToolTags,
  parseSelectQuery,
  scoreDescriptor,
  searchDescriptors,
  tokenizeQuery
} from './tool-search'

// Track 2 / C1 — pure-function tests for the search + tag derivation
// module. Exercises:
//   - tag taxonomy (provider kind, risks, meta flags)
//   - select:NAME[,NAME...] parser
//   - keyword tokenizer (lowercase, whitespace, commas, slashes)
//   - scoring weights (name 3x, tags 2x, description 1x)
//   - stable ordering on ties

const D = (
  name: string,
  description: string,
  tags: string[]
): { name: string; description: string; tags: string[] } => ({
  name,
  description,
  tags
})

describe('computeToolTags', () => {
  it('emits providerKind first, then every risk', () => {
    expect(
      computeToolTags({
        providerKind: 'native',
        risks: ['read', 'network'],
        requiresApproval: false
      })
    ).toEqual(['native', 'read', 'network'])
  })

  it('adds approval-required when the descriptor gates', () => {
    expect(
      computeToolTags({
        providerKind: 'native',
        risks: ['write'],
        requiresApproval: true
      })
    ).toContain('approval-required')
  })

  it('adds parallelizable when the flag is set', () => {
    expect(
      computeToolTags({
        providerKind: 'native',
        risks: ['read'],
        requiresApproval: false,
        parallelizable: true
      })
    ).toContain('parallelizable')
  })

  it('adds lazy for MCP tools and omits it for native', () => {
    const native = computeToolTags({
      providerKind: 'native',
      risks: ['read'],
      requiresApproval: false,
      lazy: false
    })
    const mcp = computeToolTags({
      providerKind: 'mcp',
      risks: ['network'],
      requiresApproval: false,
      lazy: true
    })
    expect(native).not.toContain('lazy')
    expect(mcp).toContain('lazy')
    expect(mcp).toContain('mcp')
  })
})

describe('parseSelectQuery', () => {
  it('returns null for non-select queries', () => {
    expect(parseSelectQuery('shell')).toBeNull()
    expect(parseSelectQuery('  ')).toBeNull()
  })

  it('parses comma-separated names', () => {
    expect(parseSelectQuery('select:foo,bar,baz')).toEqual(['foo', 'bar', 'baz'])
  })

  it('tolerates whitespace around commas', () => {
    expect(parseSelectQuery('select: foo , bar ')).toEqual(['foo', 'bar'])
  })

  it('drops empty entries', () => {
    expect(parseSelectQuery('select:foo,,bar,')).toEqual(['foo', 'bar'])
  })

  it('is case-insensitive on the prefix', () => {
    expect(parseSelectQuery('SELECT:foo')).toEqual(['foo'])
  })
})

describe('tokenizeQuery', () => {
  it('lowercases, splits on whitespace, comma, slash', () => {
    expect(tokenizeQuery('Shell Command/Run, Trace')).toEqual([
      'shell',
      'command',
      'run',
      'trace'
    ])
  })

  it('drops empties', () => {
    expect(tokenizeQuery('   ')).toEqual([])
  })
})

describe('scoreDescriptor', () => {
  it('exact name match outranks substring match', () => {
    const a = scoreDescriptor(D('shell', 'run shell commands', ['native']), ['shell'])
    const b = scoreDescriptor(
      D('shell_command', 'run shell commands', ['native']),
      ['shell']
    )
    expect(a).toBeGreaterThan(b)
  })

  it('tag match contributes', () => {
    const onlyTag = scoreDescriptor(D('x', 'unrelated', ['lazy']), ['lazy'])
    expect(onlyTag).toBe(2)
  })

  it('description match is the cheapest hit', () => {
    const onlyDesc = scoreDescriptor(D('x', 'a lazy tool', []), ['lazy'])
    expect(onlyDesc).toBe(1)
  })

  it('returns 0 with no overlap', () => {
    expect(scoreDescriptor(D('a', 'b', ['c']), ['nope'])).toBe(0)
  })
})

describe('searchDescriptors', () => {
  const sample = [
    D('shell_command', 'Run a one-shot shell command', ['native', 'write', 'network']),
    D('workspace_context', 'Codex-style workspace preflight', ['native', 'read', 'parallelizable']),
    D('memory_add', 'Save a fact about the user', ['native', 'write']),
    D('chrome__navigate', 'Navigate the browser tab', ['mcp', 'network', 'lazy']),
    D('chrome__click', 'Click a DOM node', [
      'mcp',
      'destructive',
      'write',
      'network',
      'lazy',
      'approval-required'
    ])
  ]

  it('keyword ranks by name then tags then description', () => {
    const r = searchDescriptors(sample, 'shell')
    expect(r[0]?.name).toBe('shell_command')
  })

  it('caps to maxResults', () => {
    expect(searchDescriptors(sample, 'lazy', 1)).toHaveLength(1)
  })

  it('returns empty array on no matches', () => {
    expect(searchDescriptors(sample, 'unknowntoken')).toEqual([])
  })

  it('keeps original order on score ties', () => {
    // Both have 'lazy' tag → identical score → original order preserved.
    const r = searchDescriptors(sample, 'lazy')
    expect(r.map((d) => d.name)).toEqual(['chrome__navigate', 'chrome__click'])
  })

  it('multi-token query sums per-token scores', () => {
    // 'click' hits chrome__click's name, 'destructive' hits its tags.
    const r = searchDescriptors(sample, 'click destructive')
    expect(r[0]?.name).toBe('chrome__click')
  })
})
