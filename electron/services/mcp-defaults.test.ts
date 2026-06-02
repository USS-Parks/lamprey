import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// Static packaging check. The Node REPL default server depends on three
// things being true at the project root:
//
//   1. The bundled server.js exists at resources/mcp/node-repl/server.js.
//      This is the file mcp-defaults.ts resolves in dev mode and the file
//      electron-builder.yml ships into process.resourcesPath/mcp/ in prod.
//   2. The bundled package.json is type:module so the server.js can use
//      ES module syntax against Node 22.
//   3. electron-builder.yml declares the extraResources mapping that copies
//      resources/mcp into the packaged app. Without this entry the prod
//      path resolves to a missing file and the default server never
//      registers — a silent regression that is hard to spot post-release.

const REPO_ROOT = join(__dirname, '..', '..')

describe('node-repl default server packaging', () => {
  it('ships server.js at resources/mcp/node-repl/server.js', () => {
    const serverJs = join(REPO_ROOT, 'resources', 'mcp', 'node-repl', 'server.js')
    expect(existsSync(serverJs)).toBe(true)
  })

  it('ships a type:module package.json next to server.js', () => {
    const pkgPath = join(REPO_ROOT, 'resources', 'mcp', 'node-repl', 'package.json')
    expect(existsSync(pkgPath)).toBe(true)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    expect(pkg.type).toBe('module')
  })

  it('electron-builder.yml maps resources/mcp into the packaged app', () => {
    const yml = readFileSync(join(REPO_ROOT, 'electron-builder.yml'), 'utf8')
    // Loose match — we are not parsing YAML, just confirming the from/to
    // pair is present so the production resolver finds the file.
    expect(yml).toMatch(/from:\s*resources\/mcp\s*\n\s*to:\s*mcp/)
  })
})
