#!/usr/bin/env node
import { spawnSync } from 'child_process'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import electronPath from 'electron'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..', '..')
const result = spawnSync(String(electronPath), [appRoot, '--lamprey-headless', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env
})

if (typeof result.status === 'number') {
  process.exit(result.status)
}
if (result.error) {
  console.error(result.error.message)
}
process.exit(1)
