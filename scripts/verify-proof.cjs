#!/usr/bin/env node
//
// WC-7 — Repo-local proof policy gate.
//
// Flags:
//   --require-smokes   force-run the bundle / renderer smokes; fail if
//                      the build output is not present.
//   --no-tests         skip the vitest pass. Intended for CI's static
//                      gate job, where a sibling `test` job already runs
//                      the full suite under coverage. Skipping here
//                      avoids duplicate work without losing the lint /
//                      tsc / script-composition check.
//
const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const root = process.cwd()
const requireSmokes = process.argv.includes('--require-smokes')
const skipTests = process.argv.includes('--no-tests')
const listNativeSkipsOnly = process.argv.includes('--list-native-skips')

// ---------------------------------------------------------------------------
// SP-9 (Sweet Spot Phase, 2026-06-10) — native-skip accounting (D7).
//
// The better-sqlite3 native binding is built for Electron's ABI; when vitest
// runs under a mismatched Node ABI, every `describe.skipIf(!HAS_NATIVE_SQLITE)`
// / `it.skipIf(!nativeOk())` suite silently skips. That silence already cost
// a P0 once (v0.9.2: schema-init regression shipped because its test was
// skipping on every CI and local run). This block makes the loss visible at
// gate time: probe whether the binding loads under the CURRENT node, list the
// guarded test files, and print an explicit accounting line either way.
// Exit codes are unchanged — this is transparency, not a new gate.
// ---------------------------------------------------------------------------

function nativeSqliteLoads() {
  const probe = spawnSync(process.execPath, ['-e', "require('better-sqlite3')"], {
    cwd: root,
    encoding: 'utf8'
  })
  return probe.status === 0
}

function listNativeGuardedTestFiles() {
  const guards = ['HAS_NATIVE_SQLITE', 'nativeOk()']
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full)
      } else if (/\.test\.tsx?$/.test(name)) {
        try {
          const text = readFileSync(full, 'utf8')
          if (guards.some((g) => text.includes(g))) {
            out.push(full.slice(root.length + 1).replace(/\\/g, '/'))
          }
        } catch {
          /* unreadable file — skip */
        }
      }
    }
  }
  walk(join(root, 'electron'))
  walk(join(root, 'src'))
  return out.sort()
}

function printNativeSkipAccounting() {
  const guarded = listNativeGuardedTestFiles()
  const loads = nativeSqliteLoads()
  if (loads) {
    console.log(
      `\n[verify:proof] better-sqlite3 native binding loads under this Node — ` +
        `${guarded.length} ABI-guarded test file(s) run their native-DB suites.`
    )
  } else {
    console.warn(
      `\n[verify:proof] SKIPPED: better-sqlite3 native binding does NOT load under this ` +
        `Node (NODE_MODULE_VERSION mismatch). ${guarded.length} test file(s) silently ` +
        `skip their native-DB suites:`
    )
    for (const file of guarded) console.warn(`[verify:proof]   - ${file}`)
    console.warn(
      `[verify:proof] These suites only execute under a Node whose ABI matches the ` +
        `built binding (Electron's). Treat green runs as NOT covering native-DB paths.`
    )
  }
  return { loads, guardedCount: guarded.length }
}

if (listNativeSkipsOnly) {
  printNativeSkipAccounting()
  process.exit(0)
}

const steps = [
  ['lint', ['npm', ['run', 'lint']]],
  ['tsc:node', ['npx', ['tsc', '--noEmit', '-p', 'tsconfig.node.json']]],
  ['tsc:web', ['npx', ['tsc', '--noEmit', '-p', 'tsconfig.web.json']]]
]
if (!skipTests) {
  steps.push(['test', ['npm', ['test']]])
}

const hasBuildOutput =
  existsSync(join(root, 'out', 'main', 'index.js')) &&
  existsSync(join(root, 'out', 'renderer', 'index.html'))

if (hasBuildOutput || requireSmokes) {
  steps.push(['smoke:bundle', ['npm', ['run', 'smoke:bundle']]])
  steps.push(['smoke:renderer', ['npm', ['run', 'smoke:renderer']]])
}

let failed = false
for (const [label, [cmd, args]] of steps) {
  console.log(`\n[verify:proof] ${label}`)
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) {
    failed = true
    console.error(`[verify:proof] ${label} failed with exit ${result.status ?? 'unknown'}`)
    break
  }
}

if (!hasBuildOutput && !requireSmokes) {
  console.log('\n[verify:proof] smoke checks skipped: build output not present')
}

if (skipTests) {
  console.log('\n[verify:proof] vitest skipped: --no-tests flag set (CI static gate mode)')
}

// SP-9 — always print the native-skip accounting so an ABI mismatch is
// visible at gate time instead of user runtime (the v0.9.2 lesson).
printNativeSkipAccounting()

if (requireSmokes && !hasBuildOutput) {
  console.error('[verify:proof] build output missing but --require-smokes was requested')
  failed = true
}

process.exit(failed ? 1 : 0)
