import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Shared state for the electron mock so the test can swap the userData dir
// per-test without re-hoisting.
const state = vi.hoisted(() => ({
  userDataDir: ''
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return state.userDataDir
      throw new Error(`unexpected app.getPath(${name})`)
    }
  }
}))

async function reloadModule() {
  vi.resetModules()
  return await import('./github-askpass')
}

const originalPlatform = process.platform

beforeEach(() => {
  state.userDataDir = mkdtempSync(join(tmpdir(), 'lamprey-askpass-'))
})

afterEach(() => {
  try { rmSync(state.userDataDir, { recursive: true, force: true }) } catch { /* noop */ }
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
})

function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

describe('ensureAskpassHelper', () => {
  it('writes a .sh helper on posix platforms', async () => {
    setPlatform('linux')
    const mod = await reloadModule()
    const path = mod.ensureAskpassHelper()
    expect(path.endsWith('askpass.sh')).toBe(true)
    expect(existsSync(path)).toBe(true)
    const body = readFileSync(path, 'utf8')
    expect(body).toMatch(/Username/i)
    expect(body).toMatch(/x-access-token/)
    // Crucially the helper carries NO secret in its body.
    expect(body).not.toMatch(/Bearer/)
    expect(body).not.toContain('SECRET-')
  })

  it('writes a .cmd helper on win32', async () => {
    setPlatform('win32')
    const mod = await reloadModule()
    const path = mod.ensureAskpassHelper()
    expect(path.endsWith('askpass.cmd')).toBe(true)
    const body = readFileSync(path, 'utf8')
    expect(body).toMatch(/@echo off/i)
    // Same property — secret is read from the env var, never the script.
    expect(body).not.toContain('SECRET-')
  })
})

describe('buildAuthenticatedEnv', () => {
  it('injects GIT_ASKPASS, blanks the terminal prompt, and exposes the token env var', async () => {
    setPlatform('linux')
    const mod = await reloadModule()
    const env = mod.buildAuthenticatedEnv('SECRET-TOKEN', { FOO: 'bar' })
    expect(env.GIT_ASKPASS).toMatch(/askpass\.sh$/)
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env[mod.__ASKPASS_TOKEN_ENV_NAME_FOR_TEST]).toBe('SECRET-TOKEN')
    expect(env.FOO).toBe('bar')
  })

  it('does not place the token anywhere except the dedicated env var', async () => {
    setPlatform('linux')
    const mod = await reloadModule()
    const env = mod.buildAuthenticatedEnv('SECRET-TOKEN')
    for (const [k, v] of Object.entries(env)) {
      if (k === mod.__ASKPASS_TOKEN_ENV_NAME_FOR_TEST) continue
      if (typeof v !== 'string') continue
      expect(v.includes('SECRET-TOKEN')).toBe(false)
    }
  })
})
