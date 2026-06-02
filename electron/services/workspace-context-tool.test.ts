import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'

import {
  detectFrameworks,
  executeWorkspaceContext,
  findInstructionFiles,
  inferVerificationCommands,
  parseGitStatusOutput,
  readPackageManifest,
  resolveInsideWorkspace,
  type PackageManifest
} from './workspace-context-tool'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lamprey-wsctx-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveInsideWorkspace', () => {
  it('returns the workspace root when candidate is empty/undefined', () => {
    expect(resolveInsideWorkspace(root, undefined)).toBe(root)
    expect(resolveInsideWorkspace(root, '')).toBe(root)
    expect(resolveInsideWorkspace(root, '   ')).toBe(root)
  })

  it('resolves a relative subdirectory against the root', () => {
    expect(resolveInsideWorkspace(root, 'sub')).toBe(join(root, 'sub'))
  })

  it('returns null when candidate escapes the root', () => {
    expect(resolveInsideWorkspace(root, '..')).toBeNull()
    expect(resolveInsideWorkspace(root, `..${sep}..`)).toBeNull()
  })

  it('returns null for an absolute path outside the root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'lamprey-wsctx-outside-'))
    try {
      expect(resolveInsideWorkspace(root, outside)).toBeNull()
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('readPackageManifest', () => {
  it('returns null when no package.json exists', () => {
    expect(readPackageManifest(root)).toBeNull()
  })

  it('parses a valid package.json', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'thing', version: '0.0.1', scripts: { test: 'vitest' } })
    )
    const pkg = readPackageManifest(root)
    expect(pkg?.name).toBe('thing')
    expect(pkg?.scripts?.test).toBe('vitest')
  })

  it('returns null when package.json is malformed', () => {
    writeFileSync(join(root, 'package.json'), '{ not json')
    expect(readPackageManifest(root)).toBeNull()
  })
})

describe('detectFrameworks', () => {
  it('returns empty for null / no deps', () => {
    expect(detectFrameworks(null)).toEqual([])
    expect(detectFrameworks({})).toEqual([])
  })

  it('detects across dependencies, devDependencies, peerDependencies', () => {
    const pkg: PackageManifest = {
      dependencies: { react: '^19.0.0', electron: '^35.0.0' },
      devDependencies: { vite: '^7.0.0', typescript: '^5.0.0' },
      peerDependencies: { tailwindcss: '^4.0.0' }
    }
    const fws = detectFrameworks(pkg)
    expect(fws).toEqual(expect.arrayContaining(['react', 'electron', 'vite', 'typescript', 'tailwindcss']))
  })

  it('keeps stable order matching the known list', () => {
    const pkg: PackageManifest = {
      dependencies: { vite: '*', react: '*', electron: '*' }
    }
    // KNOWN_FRAMEWORKS order: react, vue, svelte, next, nuxt, electron, vite, ...
    const fws = detectFrameworks(pkg)
    expect(fws).toEqual(['react', 'electron', 'vite'])
  })

  it('does not match arbitrary substrings', () => {
    const pkg: PackageManifest = {
      dependencies: { 'react-router-dom': '*', 'vite-plugin-svgr': '*' }
    }
    expect(detectFrameworks(pkg)).toEqual([])
  })
})

describe('findInstructionFiles', () => {
  it('finds canonical instruction files', () => {
    writeFileSync(join(root, 'AGENTS.md'), 'a')
    writeFileSync(join(root, 'CLAUDE.md'), 'c')
    writeFileSync(join(root, 'README.md'), 'r')
    const found = findInstructionFiles(root)
    expect(found).toEqual(expect.arrayContaining(['AGENTS.md', 'CLAUDE.md', 'README.md']))
  })

  it('normalizes capitalization variants', () => {
    writeFileSync(join(root, 'agents.md'), 'a')
    const found = findInstructionFiles(root)
    expect(found).toContain('AGENTS.md')
  })

  it('returns an empty list when no instruction files exist', () => {
    expect(findInstructionFiles(root)).toEqual([])
  })
})

describe('inferVerificationCommands', () => {
  it('emits npm test for a "test" script', () => {
    const pkg: PackageManifest = { scripts: { test: 'vitest run' } }
    expect(inferVerificationCommands(root, pkg)).toEqual(['npm test'])
  })

  it('emits npm run <name> for typecheck/lint/check/verify/format', () => {
    const pkg: PackageManifest = {
      scripts: {
        typecheck: 'tsc --noEmit',
        lint: 'eslint .',
        check: 'svelte-check',
        verify: 'echo ok',
        format: 'prettier --check .'
      }
    }
    const cmds = inferVerificationCommands(root, pkg)
    expect(cmds).toEqual(
      expect.arrayContaining([
        'npm run typecheck',
        'npm run lint',
        'npm run check',
        'npm run verify',
        'npm run format'
      ])
    )
  })

  it('supports colon-suffixed variants', () => {
    const pkg: PackageManifest = {
      scripts: { 'test:e2e': 'playwright test', 'typecheck:web': 'tsc -p web' }
    }
    const cmds = inferVerificationCommands(root, pkg)
    expect(cmds).toEqual(expect.arrayContaining(['npm run test:e2e', 'npm run typecheck:web']))
  })

  it('adds npx tsc commands when no typecheck script exists', () => {
    writeFileSync(join(root, 'tsconfig.node.json'), '{}')
    writeFileSync(join(root, 'tsconfig.web.json'), '{}')
    const cmds = inferVerificationCommands(root, null)
    expect(cmds).toEqual(
      expect.arrayContaining([
        'npx tsc --noEmit -p tsconfig.node.json',
        'npx tsc --noEmit -p tsconfig.web.json'
      ])
    )
  })

  it('omits npx tsc commands when a typecheck script already exists', () => {
    writeFileSync(join(root, 'tsconfig.json'), '{}')
    const pkg: PackageManifest = { scripts: { typecheck: 'tsc --noEmit' } }
    const cmds = inferVerificationCommands(root, pkg)
    expect(cmds).toEqual(['npm run typecheck'])
  })

  it('caps the output at 8 entries', () => {
    const scripts: Record<string, string> = {}
    for (let i = 0; i < 20; i++) scripts[`test:${i}`] = 'echo'
    const cmds = inferVerificationCommands(root, { scripts })
    expect(cmds.length).toBeLessThanOrEqual(8)
  })
})

describe('parseGitStatusOutput', () => {
  it('handles a clean repo (branch only)', () => {
    const out = parseGitStatusOutput('## main...origin/main\n')
    expect(out.branch).toBe('main')
    expect(out.ahead).toBe(0)
    expect(out.behind).toBe(0)
    expect(out.isDirty).toBe(false)
    expect(out.totalChanged).toBe(0)
  })

  it('parses ahead/behind from the branch line', () => {
    const out = parseGitStatusOutput('## feature...origin/feature [ahead 2, behind 1]\n')
    expect(out.branch).toBe('feature')
    expect(out.ahead).toBe(2)
    expect(out.behind).toBe(1)
  })

  it('handles a no-upstream branch', () => {
    const out = parseGitStatusOutput('## detached HEAD\n')
    expect(out.branch).toBe('detached')
  })

  it('parses changed files with various XY codes', () => {
    const out = parseGitStatusOutput(
      '## main\n' +
        ' M src/foo.ts\n' +
        'M  src/bar.ts\n' +
        'A  src/new.ts\n' +
        '?? untracked.txt\n'
    )
    expect(out.isDirty).toBe(true)
    expect(out.totalChanged).toBe(4)
    expect(out.changedFiles.map((f) => f.path)).toEqual([
      'src/foo.ts',
      'src/bar.ts',
      'src/new.ts',
      'untracked.txt'
    ])
    expect(out.changedFiles.find((f) => f.path === 'untracked.txt')?.status).toBe('??')
  })

  it('truncates at the changed-files cap', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ` M file${i}.ts`).join('\n')
    const out = parseGitStatusOutput('## main\n' + rows + '\n')
    expect(out.totalChanged).toBe(25)
    expect(out.changedFiles).toHaveLength(20)
    expect(out.truncated).toBe(true)
  })
})

describe('executeWorkspaceContext (integration, no git)', () => {
  it('returns JSON with cwd, frameworks, instruction files, and verification commands', async () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'demo',
        version: '0.0.1',
        scripts: { test: 'vitest run', lint: 'eslint .' },
        dependencies: { react: '^19', electron: '^35' }
      })
    )
    writeFileSync(join(root, 'AGENTS.md'), '# Agents')
    const out = await executeWorkspaceContext({}, root)
    const data = JSON.parse(out)
    expect(data.cwd).toBe(root)
    expect(data.package.name).toBe('demo')
    expect(data.frameworks).toEqual(expect.arrayContaining(['react', 'electron']))
    expect(data.instructionFiles).toContain('AGENTS.md')
    expect(data.verificationCommands).toEqual(expect.arrayContaining(['npm test', 'npm run lint']))
  })

  it('throws when cwd escapes the workspace', async () => {
    // Throwing (rather than returning JSON with an `error` field) is what
    // lets the chat tool loop record the call as an error audit row. A
    // returned-string error would slip through the legacy classifier as a
    // green success.
    await expect(executeWorkspaceContext({ cwd: '..' }, root)).rejects.toThrow(
      /resolves outside/i
    )
  })

  it('caps the output to roughly the requested size', async () => {
    // Make the package.json scripts list dense so the body is large.
    const scripts: Record<string, string> = {}
    for (let i = 0; i < 50; i++) scripts[`script_${i}`] = 'echo something long enough to bloat the json blob'
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'big', scripts }))
    const out = await executeWorkspaceContext({ cap_bytes: 512 }, root)
    expect(out.length).toBeLessThanOrEqual(512 + 32) // small slop for the truncation marker
    expect(out).toContain('truncated')
  })

  it('returns a null package field when there is no package.json', async () => {
    const out = await executeWorkspaceContext({}, root)
    const data = JSON.parse(out)
    expect(data.package).toBeNull()
    expect(data.frameworks).toEqual([])
  })

  it('runs against a nested cwd inside the workspace', async () => {
    const sub = join(root, 'sub')
    mkdirSync(sub)
    writeFileSync(join(sub, 'package.json'), JSON.stringify({ name: 'nested' }))
    const out = await executeWorkspaceContext({ cwd: 'sub' }, root)
    const data = JSON.parse(out)
    expect(data.cwd).toBe(sub)
    expect(data.package.name).toBe('nested')
  })
})
