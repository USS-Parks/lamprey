import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  discoverCcPlugins,
  defaultCcSkillPluginRoots,
  __ccSkillDiscoveryTest
} from './cc-skill-discovery'

interface SkillFixture {
  slug: string
  name: string
  description: string
  enabled?: boolean // if undefined, omitted from manifest
  supportingFiles?: string[] // relative paths inside the skill dir
}

function writeSkill(skillDir: string, fixture: SkillFixture): void {
  mkdirSync(skillDir, { recursive: true })
  const frontmatter = [
    '---',
    `name: ${fixture.name}`,
    `description: ${JSON.stringify(fixture.description)}`,
    '---',
    '',
    `# ${fixture.name}`,
    '',
    'Body content for the skill.'
  ].join('\n')
  writeFileSync(join(skillDir, 'SKILL.md'), frontmatter, 'utf-8')
  for (const rel of fixture.supportingFiles ?? []) {
    const full = join(skillDir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, '// fixture content\n', 'utf-8')
  }
}

function writeFixtureBundle(
  innerDir: string,
  meta: { name: string; version: string; description: string },
  skills: SkillFixture[]
): void {
  mkdirSync(join(innerDir, '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(innerDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: meta.name, version: meta.version, description: meta.description }, null, 2),
    'utf-8'
  )
  const manifestSkills = skills
    .filter((s) => s.enabled !== undefined)
    .map((s) => ({ skillId: s.slug, name: s.name, enabled: s.enabled }))
  if (manifestSkills.length) {
    writeFileSync(
      join(innerDir, 'manifest.json'),
      JSON.stringify({ lastUpdated: 1, skills: manifestSkills }, null, 2),
      'utf-8'
    )
  }
  for (const s of skills) {
    writeSkill(join(innerDir, 'skills', s.slug), s)
  }
}

describe('cc-skill-discovery', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cc-discovery-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns no plugins when the root is empty', async () => {
    const result = await discoverCcPlugins({ rootsOverride: [tmp] })
    expect(result).toEqual([])
  })

  it('returns no plugins when the root does not exist', async () => {
    const ghost = join(tmp, 'does-not-exist')
    const result = await discoverCcPlugins({ rootsOverride: [ghost] })
    expect(result).toEqual([])
  })

  it('discovers a single bundle nested two levels deep', async () => {
    const inner = join(tmp, 'outer-uuid', 'inner-uuid')
    writeFixtureBundle(
      inner,
      { name: 'anthropic-skills', version: '1.0.0', description: 'Anthropic-managed skills' },
      [
        { slug: 'docx', name: 'docx', description: 'Word docs', enabled: true },
        { slug: 'pdf', name: 'pdf', description: 'PDF handling', enabled: true },
        {
          slug: 'pptx',
          name: 'pptx',
          description: 'Slides',
          enabled: false,
          supportingFiles: ['scripts/office/unpack.py', 'references/notes.md']
        }
      ]
    )

    const result = await discoverCcPlugins({ rootsOverride: [tmp] })
    expect(result).toHaveLength(1)
    expect(result[0].pluginName).toBe('anthropic-skills')
    expect(result[0].version).toBe('1.0.0')
    expect(result[0].sourcePath).toBe(inner)
    expect(result[0].skills.map((s) => s.slug)).toEqual(['docx', 'pdf', 'pptx'])
    expect(result[0].skills.find((s) => s.slug === 'pptx')?.enabled).toBe(false)
    expect(result[0].skills.find((s) => s.slug === 'docx')?.enabled).toBe(true)
    expect(result[0].skills.find((s) => s.slug === 'pptx')?.supportingFileCount).toBe(2)
    expect(result[0].skills.find((s) => s.slug === 'docx')?.supportingFileCount).toBe(0)
  })

  it('discovers a bundle at the root itself (single-tenant)', async () => {
    writeFixtureBundle(tmp, { name: 'flat-bundle', version: '0.1.0', description: '' }, [
      { slug: 'a', name: 'a', description: 'one' }
    ])
    const result = await discoverCcPlugins({ rootsOverride: [tmp] })
    expect(result).toHaveLength(1)
    expect(result[0].pluginName).toBe('flat-bundle')
    expect(result[0].skills).toHaveLength(1)
  })

  it('defaults enabled=true for skills missing from manifest.json', async () => {
    const inner = join(tmp, 'o', 'i')
    writeFixtureBundle(
      inner,
      { name: 'mixed', version: '1.0.0', description: '' },
      [
        // No `enabled` field → not listed in manifest.json
        { slug: 'unlisted', name: 'unlisted', description: 'no manifest entry' }
      ]
    )
    const result = await discoverCcPlugins({ rootsOverride: [tmp] })
    expect(result[0].skills[0].enabled).toBe(true)
  })

  it('falls back to slug when SKILL.md frontmatter omits name', async () => {
    const inner = join(tmp, 'o', 'i')
    mkdirSync(join(inner, '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(inner, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'no-name', version: '0.0.1' }),
      'utf-8'
    )
    const skillDir = join(inner, 'skills', 'unnamed-slug')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\ndescription: just a description\n---\n\n# body',
      'utf-8'
    )
    const result = await discoverCcPlugins({ rootsOverride: [tmp] })
    expect(result[0].skills[0].name).toBe('unnamed-slug')
    expect(result[0].skills[0].description).toBe('just a description')
  })

  it('skips bundles without a plugin.json', async () => {
    const inner = join(tmp, 'o', 'i')
    mkdirSync(join(inner, 'skills', 'docx'), { recursive: true })
    writeFileSync(
      join(inner, 'skills', 'docx', 'SKILL.md'),
      '---\nname: docx\n---\n\n# body',
      'utf-8'
    )
    const result = await discoverCcPlugins({ rootsOverride: [tmp] })
    expect(result).toEqual([])
  })

  it('dedupes when the same path appears via multiple roots', async () => {
    const inner = join(tmp, 'o', 'i')
    writeFixtureBundle(inner, { name: 'dup', version: '0.1.0', description: '' }, [
      { slug: 'x', name: 'x', description: '' }
    ])
    const result = await discoverCcPlugins({ rootsOverride: [tmp, tmp] })
    expect(result).toHaveLength(1)
  })

  it('discovers multiple inner bundles under one outer dir', async () => {
    const inner1 = join(tmp, 'outer', 'inner-a')
    const inner2 = join(tmp, 'outer', 'inner-b')
    writeFixtureBundle(inner1, { name: 'plug-a', version: '1', description: '' }, [
      { slug: 's1', name: 's1', description: '' }
    ])
    writeFixtureBundle(inner2, { name: 'plug-b', version: '1', description: '' }, [
      { slug: 's2', name: 's2', description: '' }
    ])
    const result = await discoverCcPlugins({ rootsOverride: [tmp] })
    expect(result.map((p) => p.pluginName).sort()).toEqual(['plug-a', 'plug-b'])
  })

  it('exposes a non-empty default roots list', () => {
    const roots = defaultCcSkillPluginRoots()
    expect(roots.length).toBeGreaterThan(0)
    expect(roots[0]).toMatch(/skills-plugin/)
  })

  it('countSupportingFiles excludes the canonical SKILL.md at top level only', () => {
    const skillDir = join(tmp, 'skill')
    mkdirSync(join(skillDir, 'sub'), { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: x\n---\nbody', 'utf-8')
    writeFileSync(join(skillDir, 'LICENSE.txt'), 'mit', 'utf-8')
    writeFileSync(join(skillDir, 'sub', 'nested.md'), 'a', 'utf-8')
    expect(__ccSkillDiscoveryTest.countSupportingFiles(skillDir)).toBe(2)
  })
})
