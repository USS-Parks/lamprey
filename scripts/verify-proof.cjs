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
const { existsSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const root = process.cwd()
const requireSmokes = process.argv.includes('--require-smokes')
const skipTests = process.argv.includes('--no-tests')

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

if (requireSmokes && !hasBuildOutput) {
  console.error('[verify:proof] build output missing but --require-smokes was requested')
  failed = true
}

process.exit(failed ? 1 : 0)
