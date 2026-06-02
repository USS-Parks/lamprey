import { readFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import matter from 'gray-matter'

vi.mock('electron', () => ({
  app: { getPath: () => join(process.cwd(), '.tmp-test-user-data') },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true }
}))

import { __skillLoaderTest } from './skill-loader'

describe('bundled codex skills', () => {
  const bundledDir = join(process.cwd(), 'resources', 'skills')

  it('discovers all codex directory skills through the skill-loader scanner', () => {
    const files = __skillLoaderTest
      .discoverSkillFiles(bundledDir)
      .filter((file) => basename(dirname(file)).startsWith('codex-'))

    expect(files.map((file) => basename(dirname(file))).sort()).toEqual([
      'codex-context',
      'codex-debug',
      'codex-fan-out',
      'codex-frontend-qa',
      'codex-plan',
      'codex-review',
      'codex-verify'
    ])

    for (const file of files) {
      expect(basename(file)).toBe('SKILL.md')
      const parsed = __skillLoaderTest.parseSkillFile(file)
      expect(parsed?.id).toBe(basename(dirname(file)))
      expect(parsed?.name).toMatch(/^Codex /)
      expect(parsed?.description.length).toBeGreaterThan(20)
      expect(parsed?.content).toContain('Stop when')
    }
  })

  it('parses required frontmatter including non-empty triggers', () => {
    const files = __skillLoaderTest
      .discoverSkillFiles(bundledDir)
      .filter((file) => basename(dirname(file)).startsWith('codex-'))

    for (const file of files) {
      const parsed = matter(readFileSync(file, 'utf-8'))
      expect(parsed.data.name).toMatch(/^Codex /)
      expect(parsed.data.description).toEqual(expect.any(String))
      expect(parsed.data.triggers).toEqual(expect.any(Array))
      expect(parsed.data.triggers.length).toBeGreaterThan(0)
    }
  })
})
