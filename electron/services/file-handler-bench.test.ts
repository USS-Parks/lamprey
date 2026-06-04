import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'fs'
import { decideRoute } from './file-handler'

// H10 — structural benchmark for the routing matrix on a synthetic corpus.
// Pins the matrix against a realistic spread of file sizes and extensions.
// A regression where, say, a 6 MB .tsx starts going to RAG again would fail.
//
// Set LAMPREY_BENCH_CSV=<path> to emit a CSV report alongside the assertions.
// Otherwise this is a pure correctness check the regular test sweep runs.

const KB = 1024
const MB = 1024 * 1024

interface BenchCase {
  name: string
  size: number
  expected: string
}

const FIXTURES: BenchCase[] = [
  // Documents — always RAG
  { name: 'spec.pdf', size: 50 * KB, expected: 'rag' },
  { name: 'spec.pdf', size: 10 * MB, expected: 'rag' },
  { name: 'spec.pdf', size: 80 * MB, expected: 'rag' },
  { name: 'memo.docx', size: 30 * KB, expected: 'rag' },
  { name: 'memo.docx', size: 5 * MB, expected: 'rag' },

  // Prose — inline if ≤50 KB, RAG above
  { name: 'README.md', size: 5 * KB, expected: 'inline' },
  { name: 'README.md', size: 50 * KB, expected: 'inline' },
  { name: 'long-notes.md', size: 200 * KB, expected: 'rag' },
  { name: 'doc.txt', size: 10 * KB, expected: 'inline' },
  { name: 'paper.rst', size: 100 * KB, expected: 'rag' },

  // Structured data — inline / inline-warn / reject
  { name: 'data.csv', size: 100 * KB, expected: 'inline' },
  { name: 'data.csv', size: 10 * MB, expected: 'inline' },
  { name: 'data.csv', size: 25 * MB, expected: 'inline-warn' },
  { name: 'data.csv', size: 75 * MB, expected: 'reject' },
  { name: 'config.json', size: 50 * KB, expected: 'inline' },
  { name: 'config.json', size: 12 * MB, expected: 'inline-warn' },
  { name: 'manifest.yaml', size: 5 * KB, expected: 'inline' },
  { name: 'feed.xml', size: 1 * MB, expected: 'inline' },

  // Source code — inline / inline-warn / reject. The 6 MB .tsx case is
  // the regression check from the v0.1.43 mis-route.
  { name: 'main.ts', size: 50 * KB, expected: 'inline' },
  { name: 'main.ts', size: 2 * MB, expected: 'inline' },
  { name: 'main.tsx', size: 3 * MB, expected: 'inline-warn' },
  { name: 'main.tsx', size: 6 * MB, expected: 'reject' },
  { name: 'huge.py', size: 8 * MB, expected: 'reject' },
  { name: 'small.go', size: 10 * KB, expected: 'inline' },
  { name: 'index.html', size: 30 * KB, expected: 'inline' },
  { name: 'styles.css', size: 80 * KB, expected: 'inline' },

  // Images — always inline regardless of size, until the global hard cap
  { name: 'logo.png', size: 200 * KB, expected: 'image' },
  { name: 'photo.jpg', size: 20 * MB, expected: 'image' },
  { name: 'icon.gif', size: 50 * KB, expected: 'image' },

  // Global hard cap + unsupported types → reject
  { name: 'big.json', size: 110 * MB, expected: 'reject' },
  { name: 'huge.zip', size: 50 * KB, expected: 'reject' }
]

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

describe('H10 hybrid-routing structural bench', () => {
  it('every fixture routes as expected', () => {
    const rows: string[] = ['file,size_bytes,expected,actual,pass']
    const failures: string[] = []
    const counts: Record<string, number> = {}

    for (const fx of FIXTURES) {
      const decision = decideRoute(extOf(fx.name), fx.size)
      const ok = decision.action === fx.expected
      const passLabel = ok ? 'PASS' : 'FAIL'
      rows.push([fx.name, fx.size, fx.expected, decision.action, passLabel].join(','))
      counts[decision.action] = (counts[decision.action] ?? 0) + 1
      if (!ok) {
        failures.push(
          `${fx.name} (${fx.size}b): expected ${fx.expected}, got ${decision.action}`
        )
      }
    }

    const csvPath = process.env.LAMPREY_BENCH_CSV
    if (csvPath) {
      writeFileSync(csvPath, rows.join('\n') + '\n', 'utf8')
      // Append the aggregate summary at the end so the CSV stays valid
      // (parsers stop at the first short row, but this is for humans).
      const summary =
        '\n# Aggregate action counts:\n' +
        Object.entries(counts)
          .sort()
          .map(([a, n]) => `# ${a},${n}`)
          .join('\n') +
        '\n'
      writeFileSync(csvPath, rows.join('\n') + summary, 'utf8')
    }

    if (failures.length) {
      throw new Error(`Routing regressions:\n${failures.join('\n')}`)
    }
    expect(failures.length).toBe(0)
  })

  it('produces a non-trivial spread across actions', () => {
    const counts: Record<string, number> = {}
    for (const fx of FIXTURES) {
      const d = decideRoute(extOf(fx.name), fx.size)
      counts[d.action] = (counts[d.action] ?? 0) + 1
    }
    // The corpus should exercise EVERY action class at least once, so a
    // future routing change can't silently collapse the matrix into one
    // bucket without the bench noticing.
    expect(counts.inline).toBeGreaterThan(0)
    expect(counts.rag).toBeGreaterThan(0)
    expect(counts.image).toBeGreaterThan(0)
    expect(counts.reject).toBeGreaterThan(0)
    expect(counts['inline-warn']).toBeGreaterThan(0)
  })
})
