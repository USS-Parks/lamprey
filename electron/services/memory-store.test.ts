import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import matter from 'gray-matter'

// Each test gets its own fresh tmpdir (via `mkdtempSync`) so we never
// race with better-sqlite3's file handles on Windows — `rmSync` of a
// directory holding an open SQLite WAL fails with EPERM on Windows even
// with `force: true`. Using a fresh directory per test sidesteps the
// race entirely and the cleanup at afterAll is best-effort.
let TEST_USER_DATA = join(tmpdir(), `lamprey-memstore-test-${process.pid}-${Date.now()}`)

vi.mock('electron', () => ({
  app: { getPath: () => TEST_USER_DATA },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('chokidar', () => ({
  default: {
    watch: () => ({
      on() {
        return this
      },
      close: async () => undefined
    })
  }
}))

import * as memStore from './memory-store'
import { memorySlug } from './memory-frontmatter'

function freshUserData(): void {
  // Allocate a brand-new directory for this test. We do NOT remove the
  // previous one — on Windows, better-sqlite3 keeps file handles around
  // briefly after close and `rmSync(force: true)` still throws EPERM.
  // Leaving the old dir behind costs a few KB in tmp; the afterAll +
  // OS reboot cleanup handles the long tail.
  TEST_USER_DATA = mkdtempSync(join(tmpdir(), `lamprey-memstore-test-${process.pid}-`))
  mkdirSync(TEST_USER_DATA, { recursive: true })
  memStore.__memoryStoreTest.resetForTests()
  // Force fallback so the suite stays portable across CI environments
  // that can't load the Electron-ABI binding from system Node.
  memStore.__memoryStoreTest.forceFallback()
}

beforeEach(() => {
  freshUserData()
})

afterAll(() => {
  // Best-effort cleanup. EPERM is expected on Windows; swallow it.
  try {
    if (existsSync(TEST_USER_DATA)) {
      rmSync(TEST_USER_DATA, { recursive: true, force: true })
    }
  } catch { /* Windows file-handle race; ignore */ }
})

describe('D1 — typed file-backed write/list/read/delete', () => {
  it('writeMemoryFile drops a markdown file with the right frontmatter', () => {
    memStore.initializeMemoryStore()
    const file = memStore.writeMemoryFile({
      name: 'feedback no coauthor trailer',
      type: 'feedback',
      description: 'No Co-Authored-By trailer in commits',
      body: 'Never add the Claude co-author trailer to commits in this project.'
    })

    expect(file.name).toBe('feedback_no_coauthor_trailer')
    expect(file.type).toBe('feedback')
    expect(file.projectSlug).toBe(memStore.__memoryStoreTest.DEFAULT_PROJECT_SLUG)
    expect(existsSync(file.filePath)).toBe(true)

    const raw = readFileSync(file.filePath, 'utf-8')
    const parsed = matter(raw)
    expect(parsed.data.name).toBe('feedback_no_coauthor_trailer')
    expect(parsed.data.description).toBe('No Co-Authored-By trailer in commits')
    expect((parsed.data as any).metadata?.type).toBe('feedback')
    expect(parsed.content.trim()).toBe(
      'Never add the Claude co-author trailer to commits in this project.'
    )
  })

  it('listMemoryFiles({ type }) returns only entries of that type', () => {
    memStore.initializeMemoryStore()
    memStore.writeMemoryFile({ name: 'fb1', type: 'feedback', body: 'foo' })
    memStore.writeMemoryFile({ name: 'fb2', type: 'feedback', body: 'bar' })
    memStore.writeMemoryFile({ name: 'ref1', type: 'reference', body: 'baz' })
    memStore.writeMemoryFile({ name: 'usr1', type: 'user', body: 'qux' })

    const feedback = memStore.listMemoryFiles({ type: 'feedback' })
    expect(feedback.map((f) => f.name).sort()).toEqual(['fb1', 'fb2'])

    const refs = memStore.listMemoryFiles({ type: 'reference' })
    expect(refs.map((f) => f.name)).toEqual(['ref1'])
  })

  it('readMemoryFile returns the stored frontmatter + body', () => {
    memStore.initializeMemoryStore()
    memStore.writeMemoryFile({
      name: 'project_compliance_rewrite',
      type: 'project',
      description: 'legal-driven rewrite',
      body: 'Auth middleware rewrite is driven by legal/compliance requirements.'
    })
    const file = memStore.readMemoryFile('project_compliance_rewrite')
    expect(file).not.toBeNull()
    expect(file?.type).toBe('project')
    expect(file?.description).toBe('legal-driven rewrite')
    expect(file?.body).toContain('legal/compliance requirements')
  })

  it('deleteMemoryFile removes the file and the mirror row', () => {
    memStore.initializeMemoryStore()
    const file = memStore.writeMemoryFile({ name: 'goner', type: 'user', body: 'will be removed' })
    expect(existsSync(file.filePath)).toBe(true)
    expect(memStore.deleteMemoryFile('goner')).toBe(true)
    expect(existsSync(file.filePath)).toBe(false)
    expect(memStore.readMemoryFile('goner')).toBeNull()
  })

  it('external file edits reflect on the next list', () => {
    memStore.initializeMemoryStore()
    const file = memStore.writeMemoryFile({
      name: 'ref_grafana_dashboard',
      type: 'reference',
      description: 'oncall latency dashboard',
      body: 'grafana.internal/d/api-latency'
    })

    // Simulate a user / external editor rewriting the file outside the
    // IPC path. The watcher is stubbed in this test environment, so the
    // next listMemoryFiles() must re-scan from disk.
    const rewritten = matter.stringify(
      'grafana.internal/d/api-latency-v2\n',
      {
        name: 'ref_grafana_dashboard',
        description: 'updated dashboard URL',
        metadata: { type: 'reference' }
      }
    )
    writeFileSync(file.filePath, rewritten, 'utf-8')

    const after = memStore.readMemoryFile('ref_grafana_dashboard')
    expect(after?.body).toContain('api-latency-v2')
    expect(after?.description).toBe('updated dashboard URL')
  })

  it('searchMemoryFiles surfaces hits across name/description/body', () => {
    memStore.initializeMemoryStore()
    memStore.writeMemoryFile({
      name: 'feedback_db_freeze',
      type: 'feedback',
      description: 'merge freeze',
      body: 'Mobile team is cutting a release branch'
    })
    memStore.writeMemoryFile({
      name: 'project_other',
      type: 'project',
      description: 'unrelated',
      body: 'Has nothing to do with the search target'
    })

    const hits = memStore.searchMemoryFiles('release')
    expect(hits.map((h) => h.name)).toContain('feedback_db_freeze')
    expect(hits.map((h) => h.name)).not.toContain('project_other')
  })
})

describe('D1 — legacy shim back-compat', () => {
  it('addMemory + listMemories still expose numeric ids', () => {
    memStore.initializeMemoryStore()
    const entry = memStore.addMemory('Build status — Track 3 underway')
    expect(typeof entry.id).toBe('number')
    expect(entry.content).toBe('Build status — Track 3 underway')

    const list = memStore.listMemories()
    expect(list.find((e) => e.id === entry.id)?.content).toBe(
      'Build status — Track 3 underway'
    )
  })

  it('updateMemory rewrites the file under the same name', () => {
    memStore.initializeMemoryStore()
    const entry = memStore.addMemory('Initial content')
    const updated = memStore.updateMemory(entry.id, 'Updated content')
    expect(updated?.id).toBe(entry.id)
    expect(updated?.content).toBe('Updated content')
    const onDisk = readFileSync(updated!.filePath!, 'utf-8')
    expect(onDisk).toContain('Updated content')
  })

  it('deleteMemory removes the file', () => {
    memStore.initializeMemoryStore()
    const entry = memStore.addMemory('To be deleted')
    const path = entry.filePath!
    expect(existsSync(path)).toBe(true)
    memStore.deleteMemory(entry.id)
    expect(existsSync(path)).toBe(false)
  })

  it('buildMemoryBlock still emits the <memory> tag for the chat path', () => {
    memStore.initializeMemoryStore()
    memStore.addMemory('Remember A')
    memStore.addMemory('Remember B')
    const block = memStore.buildMemoryBlock()
    expect(block).toContain('<memory>')
    expect(block).toContain('Remember A')
    expect(block).toContain('Remember B')
    expect(block.trim().endsWith('</memory>')).toBe(true)
  })
})

describe('D1 — migration from legacy memory_entries', () => {
  it('migrates legacy markdown stubs (pre-existing file_path) into project-typed files', () => {
    // The SQLite legacy table isn't reachable in the test env (binding
    // unavailable). Simulate the migration target by dropping plain-text
    // legacy stubs at the canonical __global__ directory the way the
    // SQLite migration would; then initializeMemoryStore() must scan
    // them, parse them as `type: project`, and surface them in the
    // typed list.
    const projectSlug = memStore.__memoryStoreTest.DEFAULT_PROJECT_SLUG
    const target = memStore.__memoryStoreTest.projectDir(projectSlug)
    mkdirSync(target, { recursive: true })

    const a = `${memorySlug('User prefers terse responses')}__1`
    const b = `${memorySlug('Integration tests must hit a real database')}__2`
    writeFileSync(
      join(target, `${a}.md`),
      matter.stringify('User prefers terse responses with no trailing summaries\n', {
        name: a,
        description: 'User prefers terse responses',
        metadata: { type: 'project' }
      }),
      'utf-8'
    )
    writeFileSync(
      join(target, `${b}.md`),
      matter.stringify('Integration tests must hit a real database, not mocks\n', {
        name: b,
        description: 'Integration tests must hit a real database',
        metadata: { type: 'project' }
      }),
      'utf-8'
    )

    memStore.initializeMemoryStore()

    const all = memStore.listMemoryFiles()
    expect(all.length).toBeGreaterThanOrEqual(2)
    for (const file of all) expect(file.type).toBe('project')
    const concatenated = all.map((f) => f.body).join('\n')
    expect(concatenated).toMatch(/terse responses/)
    expect(concatenated).toMatch(/real database/)
  })

  it('migration marker is written after the first init so re-init is a no-op', () => {
    memStore.initializeMemoryStore()
    const baseDir = memStore.__memoryStoreTest.memoryBaseDir()
    const markerPath = join(baseDir, '.migrated-from-sqlite')
    expect(existsSync(markerPath)).toBe(true)

    // Second init should not crash, regenerate the marker, or duplicate
    // any files in the typed mirror.
    const first = memStore.listMemoryFiles().length
    memStore.__memoryStoreTest.resetForTests()
    memStore.__memoryStoreTest.forceFallback()
    memStore.initializeMemoryStore()
    expect(memStore.listMemoryFiles().length).toBe(first)
  })
})

describe('D2 — MEMORY.md always-loaded index + broken-link graph', () => {
  it('regenerates MEMORY.md with one line per entry on every write', () => {
    memStore.initializeMemoryStore()
    for (let i = 1; i <= 5; i++) {
      memStore.writeMemoryFile({
        name: `m_${i}`,
        type: 'feedback',
        description: `Description ${i}`,
        body: `Body ${i}`
      })
    }
    const slug = memStore.__memoryStoreTest.DEFAULT_PROJECT_SLUG
    const indexPath = join(
      memStore.__memoryStoreTest.projectDir(slug),
      'MEMORY.md'
    )
    expect(existsSync(indexPath)).toBe(true)
    const raw = readFileSync(indexPath, 'utf-8')
    for (let i = 1; i <= 5; i++) {
      expect(raw).toContain(`m_${i}.md`)
      expect(raw).toContain(`Description ${i}`)
    }
  })

  it('buildMemoryIndexBlock wraps the index in <memory_index>', () => {
    memStore.initializeMemoryStore()
    memStore.writeMemoryFile({
      name: 'user_role',
      type: 'user',
      description: 'data scientist focused on observability',
      body: 'See [[ref_grafana_dashboard]] for the dashboard.'
    })
    const block = memStore.buildMemoryIndexBlock()
    expect(block).toContain('<memory_index>')
    expect(block).toContain('user_role.md')
    expect(block.trim().endsWith('</memory_index>')).toBe(true)
  })

  it('emits an empty string when no memories exist', () => {
    memStore.initializeMemoryStore()
    expect(memStore.buildMemoryIndexBlock()).toBe('')
  })

  it('deleting an entry removes its line from MEMORY.md on the next regen', () => {
    memStore.initializeMemoryStore()
    memStore.writeMemoryFile({ name: 'keeper', type: 'project', body: 'stays' })
    memStore.writeMemoryFile({ name: 'goner', type: 'project', body: 'leaves' })
    const slug = memStore.__memoryStoreTest.DEFAULT_PROJECT_SLUG
    const indexPath = join(
      memStore.__memoryStoreTest.projectDir(slug),
      'MEMORY.md'
    )
    expect(readFileSync(indexPath, 'utf-8')).toContain('goner.md')

    memStore.deleteMemoryFile('goner')
    expect(readFileSync(indexPath, 'utf-8')).not.toContain('goner.md')
    expect(readFileSync(indexPath, 'utf-8')).toContain('keeper.md')
  })

  it('flags [[unknown]] links as broken so the pip surface can show them', () => {
    memStore.initializeMemoryStore()
    memStore.writeMemoryFile({
      name: 'feedback_real_db',
      type: 'feedback',
      description: 'mocks vs real db',
      body: 'See [[user_role]] and the missing [[future_topic_to_write]] entry.'
    })
    memStore.writeMemoryFile({
      name: 'user_role',
      type: 'user',
      description: 'data scientist',
      body: 'no further links'
    })

    const broken = memStore.getBrokenMemoryLinks()
    const targets = broken.map((b) => b.target)
    expect(targets).toContain('future_topic_to_write')
    expect(targets).not.toContain('user_role') // resolved
    expect(broken.find((b) => b.target === 'future_topic_to_write')?.from).toBe(
      'feedback_real_db'
    )
  })

  it('truncates the injected block at 200 entries', () => {
    memStore.initializeMemoryStore()
    for (let i = 0; i < 210; i++) {
      memStore.writeMemoryFile({
        name: `e_${i.toString().padStart(3, '0')}`,
        type: 'project',
        description: `entry ${i}`,
        body: `body ${i}`
      })
    }
    const block = memStore.buildMemoryIndexBlock()
    const bullet = (block.match(/\n- \[/g) ?? []).length
    expect(bullet).toBeLessThanOrEqual(200)
    expect(block).toContain('more')
  })
})
