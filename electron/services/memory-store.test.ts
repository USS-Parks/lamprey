import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import matter from 'gray-matter'

// Each test file gets its own tmpdir so parallel vitest workers don't
// step on each other's lamprey-memory directories. The SQLite mirror is
// optional in the test environment — the store falls back to its
// in-memory mirror when better-sqlite3's Electron-ABI binding can't
// load. Files remain canonical either way, so the FS-driven assertions
// stay meaningful regardless of which mirror is in use.
const TEST_USER_DATA = join(tmpdir(), `lamprey-memstore-test-${process.pid}-${Date.now()}`)

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
  if (existsSync(TEST_USER_DATA)) {
    rmSync(TEST_USER_DATA, { recursive: true, force: true })
  }
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
  if (existsSync(TEST_USER_DATA)) {
    rmSync(TEST_USER_DATA, { recursive: true, force: true })
  }
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
