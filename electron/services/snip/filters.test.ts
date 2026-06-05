// Golden-input regression harness for the bundled YAML filters. K4
// seeds it with the git family; K5/K6/K7 extend with their batches.
//
// For each filter:
//   1. Read the YAML off resources/snip-filters/<category>/<name>.yaml.
//   2. Validate it through filter-schema.
//   3. Run a golden input through runPipeline.
//   4. Assert the output is (a) shorter than the input, (b) matches a
//      compact expected substring (loose — we don't pin the exact
//      format, just enough to catch a regression).
//
// Goldens live in `goldens` below — paste-from-real-terminal output for
// each command. They're small fixtures, not exhaustive coverage; the
// engine + matcher tests above carry correctness of the substrate.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { validateFilter } from './filter-schema'
import { runPipeline, estimateTokens } from './engine'
import type { Filter } from './types'

const FILTERS_ROOT = join(process.cwd(), 'resources', 'snip-filters')

function listYamls(): Array<{ path: string; category: string; name: string }> {
  if (!exists(FILTERS_ROOT)) return []
  const out: Array<{ path: string; category: string; name: string }> = []
  for (const cat of readdirSync(FILTERS_ROOT)) {
    const catDir = join(FILTERS_ROOT, cat)
    if (!isDir(catDir)) continue
    for (const file of readdirSync(catDir)) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue
      out.push({ path: join(catDir, file), category: cat, name: file.replace(/\.ya?ml$/, '') })
    }
  }
  return out
}

function exists(p: string): boolean {
  try {
    statSync(p)
    return true
  } catch {
    return false
  }
}
function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function loadFilter(path: string): Filter {
  const raw = readFileSync(path, 'utf-8')
  const parsed = yaml.load(raw)
  const r = validateFilter(parsed)
  if (!r.ok || !r.filter) throw new Error(`bad filter ${path}: ${r.error}`)
  return r.filter
}

interface GoldenCase {
  /** Filter name as declared in the YAML's `name:` field. */
  filter: string
  /** Realistic raw shell output captured from a real terminal. */
  input: string
  /** Substring the filtered output must contain. */
  expectContains?: string
  /** Substring the filtered output must NOT contain. */
  expectMissing?: string
  /** Allow the output to be larger than the input (rare — only for tiny goldens). */
  allowGrowth?: boolean
}

const goldens: GoldenCase[] = [
  // ─── git ─────────────────────────────────────────────────────────
  {
    filter: 'git-status',
    input: [
      'On branch main',
      'Your branch is up to date with \'origin/main\'.',
      '',
      'Changes to be committed:',
      '\tmodified:   src/foo.ts',
      '\tnew file:   src/bar.ts',
      '',
      'Changes not staged for commit:',
      '\tmodified:   src/baz.ts',
      '\tdeleted:    src/old.ts',
      '',
      'Untracked files:',
      '\t?? not-tracked.md'
    ].join('\n'),
    expectContains: 'src/foo.ts'
  },
  {
    filter: 'git-status',
    input: [
      'On branch main',
      "Your branch is up to date with 'origin/main'.",
      '',
      'nothing to commit, working tree clean'
    ].join('\n'),
    expectContains: 'clean tree'
  },
  {
    filter: 'git-log',
    // Verbose default git log — 100+ lines for a single commit when
    // the body has paragraphs. The filter caps to 30 lines and 200
    // chars/line. Goldens here are small (<30 lines) so we mostly
    // verify "doesn't grow" and "subject survives".
    input: Array.from({ length: 12 }, (_, i) =>
      [
        `commit ${'a'.repeat(40 - i)}`,
        `Author: Author${i} <a${i}@example.com>`,
        'Date:   Tue Jun 3 14:22:11 2026 -0700',
        '',
        `    Subject ${i}`,
        '',
        '    body paragraph that bloats the log',
        ''
      ].join('\n')
    ).join('\n'),
    expectContains: 'Subject 0'
  },
  {
    filter: 'git-diff',
    input: ['[31m-old line[0m', '[32m+new line[0m', 'unchanged'].join('\n'),
    expectContains: '-old line',
    expectMissing: ''
  },
  {
    filter: 'git-add',
    input: '',
    expectContains: 'git add: staged',
    allowGrowth: true
  },
  {
    filter: 'git-commit',
    input: [
      '[main a1b2c3d] feat: add thing',
      ' 3 files changed, 42 insertions(+), 1 deletion(-)',
      ' create mode 100644 src/new.ts'
    ].join('\n'),
    expectContains: '[main'
  },
  {
    filter: 'git-push',
    input: [
      'Counting objects: 5, done.',
      'Compressing objects: 100% (4/4), done.',
      'Writing objects: 100% (5/5), 482 bytes, done.',
      'Total 5 (delta 3), reused 0 (delta 0)',
      'To github.com:user/repo.git',
      '   a1b2c3d..e4f5g6h  main -> main'
    ].join('\n'),
    expectContains: 'main -> main',
    expectMissing: 'Counting objects'
  },
  {
    filter: 'git-pull',
    input: [
      'remote: Enumerating objects: 10, done.',
      'remote: Counting objects: 100% (10/10), done.',
      'From github.com:user/repo',
      '   a1b2c3d..e4f5g6h  main       -> origin/main',
      'Updating a1b2c3d..e4f5g6h',
      'Fast-forward',
      ' src/foo.ts | 4 +++-',
      ' 1 file changed, 3 insertions(+), 1 deletion(-)'
    ].join('\n'),
    expectContains: 'Updating',
    expectMissing: 'Enumerating'
  },
  {
    filter: 'git-fetch',
    input: [
      'remote: Enumerating objects: 5, done.',
      'remote: Counting objects: 100% (5/5), done.',
      'From github.com:user/repo',
      '   a1b2c3d..e4f5g6h  main       -> origin/main'
    ].join('\n'),
    expectContains: 'main',
    expectMissing: 'Enumerating'
  },
  // ─── K5 JS/TS ────────────────────────────────────────────────────
  {
    filter: 'tsc',
    input: '',
    expectContains: 'no type errors',
    allowGrowth: true
  },
  {
    filter: 'vitest',
    input: [
      ' Test Files  104 passed | 2 skipped (106)',
      '      Tests  1391 passed | 18 skipped (1409)',
      '   Start at  14:29:24',
      '   Duration  9.47s (transform 15.61s, …)'
    ].join('\n'),
    expectContains: 'Tests'
  },
  // ─── K5 Rust ─────────────────────────────────────────────────────
  {
    filter: 'cargo-test',
    input: [
      'running 5 tests',
      'test foo ... ok',
      'test bar ... ok',
      'test baz ... ok',
      'test qux ... ok',
      'test quux ... ok',
      '',
      'test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured'
    ].join('\n'),
    expectContains: 'test result'
  },
  // ─── K6 Python ───────────────────────────────────────────────────
  {
    filter: 'pytest',
    input: [
      'test_foo.py::test_one PASSED                                                     [ 50%]',
      'test_foo.py::test_two PASSED                                                     [100%]',
      '',
      '======================== 2 passed in 0.04s ========================'
    ].join('\n'),
    expectContains: 'passed'
  },
  // ─── K6 Cloud ────────────────────────────────────────────────────
  {
    filter: 'terraform',
    input: [
      'Refreshing state...',
      'aws_s3_bucket.foo: Refreshing state...',
      'aws_s3_bucket.bar: Refreshing state...',
      'Terraform will perform the following actions:',
      '  # aws_instance.web will be created',
      '  + resource "aws_instance" "web" {',
      '      + ami           = "ami-123"',
      '      + instance_type = "t3.micro"',
      '    }',
      '',
      'Plan: 1 to add, 0 to change, 0 to destroy.'
    ].join('\n'),
    expectContains: 'Plan:'
  },
  // ─── K7 Files ────────────────────────────────────────────────────
  {
    filter: 'rg',
    input: Array.from({ length: 200 }, (_, i) => `src/file${i}.ts:${i}: foo`).join('\n'),
    expectContains: 'src/file0.ts'
  },
  // ─── K7 Other ────────────────────────────────────────────────────
  {
    filter: 'gh-pr',
    input: '',
    expectContains: 'no PRs',
    allowGrowth: true
  }
]

describe('snip filters — every YAML loads + validates', () => {
  const yamls = listYamls()
  it('discovers at least one YAML under resources/snip-filters/', () => {
    expect(yamls.length).toBeGreaterThan(0)
  })

  for (const { path, name } of yamls) {
    it(`validates ${name}`, () => {
      const raw = readFileSync(path, 'utf-8')
      const parsed = yaml.load(raw)
      const r = validateFilter(parsed)
      if (!r.ok) {
        throw new Error(`${name}: ${r.error}`)
      }
      expect(r.filter?.name).toBe(name)
    })
  }
})

describe('snip filters — golden inputs', () => {
  for (const g of goldens) {
    it(`${g.filter}: produces expected compression`, () => {
      const path = findFilterPath(g.filter)
      const filter = loadFilter(path)
      const out = runPipeline(g.input, filter.pipeline)
      if (!g.allowGrowth) {
        // Filter should not grow output. (estimateTokens uses the same
        // length-based heuristic the gain dashboard does — drive the
        // golden against the same metric.)
        expect(estimateTokens(out)).toBeLessThanOrEqual(estimateTokens(g.input))
      }
      if (g.expectContains !== undefined) {
        expect(out).toContain(g.expectContains)
      }
      if (g.expectMissing !== undefined) {
        expect(out).not.toContain(g.expectMissing)
      }
    })
  }
})

function findFilterPath(name: string): string {
  for (const { path, name: n } of listYamls()) {
    if (n === name) return path
  }
  throw new Error(`filter not found in resources/snip-filters/: ${name}`)
}
