// SP-9 (Sweet Spot Phase, 2026-06-10) — D7 regression lock. verify:proof must
// surface the better-sqlite3 ABI-skip cohort explicitly so a silent test loss
// is visible at gate time (the v0.9.2 lesson). Exercises the script's
// `--list-native-skips` mode end-to-end.

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const repoRoot = join(__dirname, '..', '..')

describe('SP-9 verify:proof native-skip accounting (D7)', () => {
  const run = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'verify-proof.cjs'), '--list-native-skips'],
    { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 }
  )
  const output = `${run.stdout}\n${run.stderr}`

  it('exits 0 in accounting-only mode', () => {
    expect(run.status).toBe(0)
  })

  it('names the ABI-guarded cohort either way (loads or skips)', () => {
    expect(output).toMatch(
      /ABI-guarded test file\(s\) run their native-DB suites|test file\(s\) silently\s+skip their native-DB suites/
    )
  })

  it('counts a non-zero guarded cohort (schema-init et al. exist)', () => {
    const match = output.match(/(\d+)\s+(?:ABI-guarded )?test file\(s\)/)
    expect(match).not.toBeNull()
    expect(Number(match![1])).toBeGreaterThan(0)
  })

  it('when the binding does not load, the cohort is listed file-by-file', () => {
    if (/does NOT load/.test(output)) {
      expect(output).toContain('schema-init.test.ts')
    } else {
      // Binding loads under this Node — nothing to list; the positive line
      // already asserted above is the contract.
      expect(output).toContain('native binding loads')
    }
  })
})
