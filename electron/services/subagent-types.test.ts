import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => join(process.cwd(), '.tmp-test-user-data') },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true }
}))

import {
  BUILT_IN_SUBAGENT_TYPES,
  getSubagentType,
  listSubagentTypes,
  __subagentTypesTest,
  type SubagentTypeDef
} from './subagent-types'

const { parseSubagentTypeFile, parseAllowedTools, setUserType, clearUserTypes } =
  __subagentTypesTest

let workdir: string

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'lamprey-subagent-types-'))
  clearUserTypes()
})

afterEach(() => {
  try {
    rmSync(workdir, { recursive: true, force: true })
  } catch {
    // ignore — temp dir cleanup is best-effort
  }
  clearUserTypes()
})

describe('parseAllowedTools', () => {
  it('accepts the wildcard sentinels', () => {
    expect(parseAllowedTools('*')).toBe('*')
    expect(parseAllowedTools('all')).toBe('*')
  })
  it('accepts a string array, dropping empties and non-strings', () => {
    expect(parseAllowedTools(['grep_search', '', 'glob_search', 5 as unknown])).toEqual([
      'grep_search',
      'glob_search'
    ])
  })
  it('rejects everything else as null', () => {
    expect(parseAllowedTools(undefined)).toBeNull()
    expect(parseAllowedTools({})).toBeNull()
    expect(parseAllowedTools(7)).toBeNull()
  })
})

describe('parseSubagentTypeFile', () => {
  it('accepts a body-prompt file with required frontmatter', () => {
    const file = join(workdir, 'security-auditor.md')
    writeFileSync(
      file,
      [
        '---',
        'description: Adversarial security auditor for code reviews',
        'allowedTools: [read_file, grep_search]',
        '---',
        '',
        'You are the Security Auditor. Flag injection, authz bypass, and unsafe deserialization.'
      ].join('\n'),
      'utf-8'
    )
    const def = parseSubagentTypeFile(file)
    expect(def).not.toBeNull()
    expect(def!.name).toBe('security-auditor')
    expect(def!.description).toMatch(/Adversarial security auditor/)
    expect(def!.allowedTools).toEqual(['read_file', 'grep_search'])
    expect(def!.systemPrompt).toMatch(/Security Auditor/)
    expect(def!.source).toBe(file)
  })

  it('lets frontmatter systemPrompt override the body', () => {
    const file = join(workdir, 'override.md')
    writeFileSync(
      file,
      [
        '---',
        'description: x',
        "allowedTools: '*'",
        'systemPrompt: from-frontmatter',
        '---',
        '',
        'from-body'
      ].join('\n'),
      'utf-8'
    )
    const def = parseSubagentTypeFile(file)
    expect(def!.systemPrompt).toBe('from-frontmatter')
    expect(def!.allowedTools).toBe('*')
  })

  it('honours a frontmatter "name" that differs from the filename', () => {
    const file = join(workdir, 'whatever.md')
    writeFileSync(
      file,
      [
        '---',
        'name: My Auditor',
        'description: x',
        'allowedTools: []',
        '---',
        '',
        'You are.'
      ].join('\n'),
      'utf-8'
    )
    expect(parseSubagentTypeFile(file)!.name).toBe('My Auditor')
  })

  it('rejects files missing required fields', () => {
    const file = join(workdir, 'broken.md')
    writeFileSync(file, '---\ndescription: only-this\n---\n\nbody', 'utf-8')
    expect(parseSubagentTypeFile(file)).toBeNull()

    const file2 = join(workdir, 'broken2.md')
    writeFileSync(file2, '---\nallowedTools: []\n---\n\nbody', 'utf-8')
    expect(parseSubagentTypeFile(file2)).toBeNull()

    const file3 = join(workdir, 'broken3.md')
    writeFileSync(file3, '---\ndescription: x\nallowedTools: []\n---\n', 'utf-8')
    // No system prompt body or frontmatter → reject.
    expect(parseSubagentTypeFile(file3)).toBeNull()
  })
})

describe('BUILT_IN_SUBAGENT_TYPES', () => {
  it('ships Explore, Plan, code-reviewer, and general', () => {
    const names = Object.keys(BUILT_IN_SUBAGENT_TYPES).sort()
    expect(names).toEqual(['Explore', 'Plan', 'code-reviewer', 'general'].sort())
  })

  it('gives Explore read-only tools', () => {
    const explore = BUILT_IN_SUBAGENT_TYPES.Explore
    expect(explore.allowedTools).toEqual(
      expect.arrayContaining(['read_file', 'grep_search', 'glob_search'])
    )
    expect(explore.systemPrompt).toMatch(/Explore agent/i)
  })

  it('gives general the wildcard', () => {
    expect(BUILT_IN_SUBAGENT_TYPES.general.allowedTools).toBe('*')
  })
})

describe('getSubagentType + listSubagentTypes', () => {
  it('returns null for an unknown name', () => {
    expect(getSubagentType('does-not-exist')).toBeNull()
  })

  it('falls through to built-ins when no user type is registered', () => {
    expect(getSubagentType('Explore')).toBe(BUILT_IN_SUBAGENT_TYPES.Explore)
  })

  it('lets a user type shadow a built-in of the same name', () => {
    const custom: SubagentTypeDef = {
      name: 'Explore',
      description: 'user override',
      allowedTools: ['read_file'],
      systemPrompt: 'override',
      source: '/tmp/user-explore.md'
    }
    setUserType(custom)
    expect(getSubagentType('Explore')).toBe(custom)
    // Listed once — user wins.
    const listed = listSubagentTypes().filter((t) => t.name === 'Explore')
    expect(listed).toHaveLength(1)
    expect(listed[0]).toBe(custom)
  })

  it('lists user types alongside built-ins', () => {
    const custom: SubagentTypeDef = {
      name: 'security-auditor',
      description: 'x',
      allowedTools: ['read_file'],
      systemPrompt: 'x',
      source: '/tmp/x.md'
    }
    setUserType(custom)
    const names = listSubagentTypes().map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining(['Explore', 'Plan', 'code-reviewer', 'general', 'security-auditor'])
    )
  })
})
