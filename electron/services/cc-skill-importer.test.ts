import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import matter from 'gray-matter'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ejectCcSkill, importCcPlugin, __ccSkillImporterTest } from './cc-skill-importer'

interface SkillFx {
  slug: string
  name: string
  description?: string
  enabled?: boolean
  supportingFiles?: string[]
}

function writeBundle(
  inner: string,
  meta: { name: string; version: string; description: string },
  skills: SkillFx[]
): void {
  mkdirSync(join(inner, '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(inner, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: meta.name, version: meta.version, description: meta.description }),
    'utf-8'
  )
  const manifestSkills = skills
    .filter((s) => s.enabled !== undefined)
    .map((s) => ({ skillId: s.slug, name: s.name, enabled: s.enabled }))
  if (manifestSkills.length) {
    writeFileSync(
      join(inner, 'manifest.json'),
      JSON.stringify({ lastUpdated: 1, skills: manifestSkills }),
      'utf-8'
    )
  }
  for (const s of skills) {
    const skillDir = join(inner, 'skills', s.slug)
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${s.name}\ndescription: ${JSON.stringify(s.description ?? '')}\n---\n\n# body\n`,
      'utf-8'
    )
    for (const rel of s.supportingFiles ?? []) {
      const full = join(skillDir, rel)
      mkdirSync(join(full, '..'), { recursive: true })
      writeFileSync(full, '// fixture\n', 'utf-8')
    }
  }
}

describe('cc-skill-importer', () => {
  let tmp: string
  let source: string
  let installRoot: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cc-importer-'))
    source = join(tmp, 'source', 'outer', 'inner')
    installRoot = join(tmp, 'install')
    mkdirSync(installRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('imports a bundle into the install root and synthesises plugin.json', async () => {
    writeBundle(
      source,
      { name: 'anthropic-skills', version: '1.2.3', description: 'desc' },
      [
        { slug: 'docx', name: 'docx', description: 'Word docs', enabled: true },
        {
          slug: 'pdf',
          name: 'pdf',
          description: 'PDFs',
          enabled: true,
          supportingFiles: ['scripts/extract.py']
        }
      ]
    )

    const result = await importCcPlugin(source, { installRootOverride: installRoot })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pluginId).toBe('anthropic-skills')
    expect(result.installPath).toBe(join(installRoot, 'anthropic-skills'))
    expect(result.skillsImported.sort()).toEqual(['docx', 'pdf'])
    expect(result.skipped).toEqual([])

    const manifestRaw = readFileSync(join(result.installPath, 'plugin.json'), 'utf-8')
    const manifest = JSON.parse(manifestRaw)
    expect(manifest.id).toBe('anthropic-skills')
    expect(manifest.name).toBe('anthropic-skills')
    expect(manifest.version).toBe('1.2.3')
    expect(manifest.category).toBe('Imported from Claude Code')
    expect(manifest.enabled).toBe(true)

    // Lowercase skill.md is what Lamprey's loader reads for supporting-file
    // discovery; both casings should exist after import.
    expect(existsSync(join(result.installPath, 'skills', 'docx', 'skill.md'))).toBe(true)
    expect(existsSync(join(result.installPath, 'skills', 'docx', 'SKILL.md'))).toBe(true)
    // Supporting trees are copied verbatim.
    expect(existsSync(join(result.installPath, 'skills', 'pdf', 'scripts', 'extract.py'))).toBe(true)
    // Import metadata is recorded.
    const meta = JSON.parse(readFileSync(join(result.installPath, '.cc-import.json'), 'utf-8'))
    expect(meta.ccPluginName).toBe('anthropic-skills')
    expect(meta.skillCount).toBe(2)
  })

  it('rewrites disabled skills with autoInvoke:false in the emitted skill.md', async () => {
    writeBundle(
      source,
      { name: 'mixed', version: '1.0.0', description: '' },
      [
        { slug: 'on-skill', name: 'on-skill', enabled: true },
        { slug: 'off-skill', name: 'off-skill', enabled: false }
      ]
    )

    const result = await importCcPlugin(source, { installRootOverride: installRoot })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const onLower = readFileSync(join(result.installPath, 'skills', 'on-skill', 'skill.md'), 'utf-8')
    const onParsed = matter(onLower)
    expect(onParsed.data.autoInvoke).toBeUndefined()

    const offLower = readFileSync(
      join(result.installPath, 'skills', 'off-skill', 'skill.md'),
      'utf-8'
    )
    const offParsed = matter(offLower)
    expect(offParsed.data.autoInvoke).toBe(false)

    // On case-insensitive filesystems (Windows/macOS-default) skill.md and
    // SKILL.md collapse to one inode; on case-sensitive FS both exist and
    // the lowercase carries the override. We assert only the lowercase
    // file because that's what Lamprey's skill-loader reads.
  })

  it('refuses to overwrite an existing install by default', async () => {
    writeBundle(source, { name: 'p', version: '1.0.0', description: '' }, [
      { slug: 's', name: 's' }
    ])
    const first = await importCcPlugin(source, { installRootOverride: installRoot })
    expect(first.ok).toBe(true)

    const second = await importCcPlugin(source, { installRootOverride: installRoot })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.bundleSkippedReason).toBe('already-installed')
  })

  it('overwrites cleanly when opts.overwrite is true', async () => {
    writeBundle(source, { name: 'p', version: '1.0.0', description: 'first' }, [
      { slug: 's1', name: 's1' }
    ])
    const first = await importCcPlugin(source, { installRootOverride: installRoot })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(existsSync(join(first.installPath, 'skills', 's1'))).toBe(true)

    rmSync(source, { recursive: true, force: true })
    writeBundle(source, { name: 'p', version: '2.0.0', description: 'second' }, [
      { slug: 's2', name: 's2' }
    ])

    const second = await importCcPlugin(source, {
      installRootOverride: installRoot,
      overwrite: true
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const manifest = JSON.parse(readFileSync(join(second.installPath, 'plugin.json'), 'utf-8'))
    expect(manifest.version).toBe('2.0.0')
    // Old skill is gone.
    expect(existsSync(join(second.installPath, 'skills', 's1'))).toBe(false)
    expect(existsSync(join(second.installPath, 'skills', 's2'))).toBe(true)
  })

  it('errors gracefully on a missing source dir', async () => {
    const result = await importCcPlugin(join(tmp, 'nope'), { installRootOverride: installRoot })
    expect(result.ok).toBe(false)
  })

  it('errors gracefully when source has no plugin.json', async () => {
    mkdirSync(source, { recursive: true })
    const result = await importCcPlugin(source, { installRootOverride: installRoot })
    expect(result.ok).toBe(false)
  })

  it('slugifies plugin names with awkward casing/punctuation', () => {
    expect(__ccSkillImporterTest.slugifyPluginName('Anthropic Skills v2!')).toBe(
      'anthropic-skills-v2'
    )
    expect(__ccSkillImporterTest.slugifyPluginName('  -weird-  ')).toBe('weird')
    expect(__ccSkillImporterTest.slugifyPluginName('')).toBe('cc-plugin')
  })

  it('produces a Lamprey-loader-compatible plugin.json shape', async () => {
    writeBundle(
      source,
      { name: 'anthropic-skills', version: '1.0.0', description: 'd' },
      [{ slug: 'docx', name: 'docx', enabled: true }]
    )
    const result = await importCcPlugin(source, { installRootOverride: installRoot })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Mirror the validation rules in plugin-loader.ts:parseManifest():
    //   id is kebab-case, non-empty; name + version are non-empty strings.
    const manifest = JSON.parse(
      readFileSync(join(result.installPath, 'plugin.json'), 'utf-8')
    ) as { id: string; name: string; version: string }
    expect(typeof manifest.id).toBe('string')
    expect(/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)).toBe(true)
    expect(manifest.id).toBe('anthropic-skills')
    expect(manifest.name.length).toBeGreaterThan(0)
    expect(manifest.version.length).toBeGreaterThan(0)
  })

  it('ejects a plugin-sourced skill into the user skills root', async () => {
    writeBundle(
      source,
      { name: 'p', version: '1.0.0', description: '' },
      [{ slug: 'docx', name: 'docx', description: 'Word', enabled: true, supportingFiles: ['scripts/extract.py'] }]
    )
    const importResult = await importCcPlugin(source, { installRootOverride: installRoot })
    expect(importResult.ok).toBe(true)
    if (!importResult.ok) return

    const userSkillsRoot = join(tmp, 'user-skills')
    mkdirSync(userSkillsRoot, { recursive: true })

    const ejected = ejectCcSkill(importResult.installPath, 'docx', {
      skillsRootOverride: userSkillsRoot
    })
    expect(ejected.ok).toBe(true)
    if (!ejected.ok) return
    expect(ejected.userSkillSlug).toBe('docx')
    expect(existsSync(join(userSkillsRoot, 'docx', 'skill.md'))).toBe(true)
    // Supporting tree comes along.
    expect(existsSync(join(userSkillsRoot, 'docx', 'scripts', 'extract.py'))).toBe(true)
  })

  it('auto-renames the user skill when the target slug already exists', async () => {
    writeBundle(source, { name: 'p', version: '1.0.0', description: '' }, [
      { slug: 'helper', name: 'helper', enabled: true }
    ])
    const importResult = await importCcPlugin(source, { installRootOverride: installRoot })
    expect(importResult.ok).toBe(true)
    if (!importResult.ok) return

    const userSkillsRoot = join(tmp, 'user-skills')
    // Pre-occupy the slug.
    mkdirSync(join(userSkillsRoot, 'helper'), { recursive: true })
    writeFileSync(join(userSkillsRoot, 'helper', 'skill.md'), '---\nname: existing\n---', 'utf-8')

    const ejected = ejectCcSkill(importResult.installPath, 'helper', {
      skillsRootOverride: userSkillsRoot
    })
    expect(ejected.ok).toBe(true)
    if (!ejected.ok) return
    expect(ejected.userSkillSlug).toBe('helper-ejected')
    expect(existsSync(join(userSkillsRoot, 'helper-ejected', 'skill.md'))).toBe(true)
    // Pre-existing user skill is untouched.
    expect(existsSync(join(userSkillsRoot, 'helper', 'skill.md'))).toBe(true)
  })

  it('fires the onInstalled hook with id + install path', async () => {
    writeBundle(source, { name: 'p', version: '1.0.0', description: '' }, [
      { slug: 's', name: 's' }
    ])
    let captured: { id: string; path: string } | null = null
    const result = await importCcPlugin(source, {
      installRootOverride: installRoot,
      onInstalled: (id, path) => {
        captured = { id, path }
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(captured).not.toBeNull()
    expect(captured!.id).toBe('p')
    expect(captured!.path).toBe(result.installPath)
  })
})
