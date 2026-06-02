import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory fs + a reversible stand-in for OS encryption, so the round-trip is
// exercised without touching the real disk or Electron safeStorage.
const h = vi.hoisted(() => ({ store: {} as Record<string, string>, available: true }))

vi.mock('fs', () => ({
  existsSync: (p: string) => p in h.store,
  readFileSync: (p: string) => h.store[p],
  writeFileSync: (p: string, data: string) => {
    h.store[p] = data
  }
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/virtual' },
  safeStorage: {
    isEncryptionAvailable: () => h.available,
    encryptString: (s: string) => Buffer.from('ENC:' + s, 'utf-8'),
    decryptString: (buf: Buffer) => {
      const t = buf.toString('utf-8')
      if (!t.startsWith('ENC:')) throw new Error('bad ciphertext')
      return t.slice(4)
    }
  }
}))

import { setKey, getKey, hasKey, deleteKey, isEncryptionAvailable } from './keychain'

const KEYS = '/virtual/keys.json'
const raw = () => JSON.parse(h.store[KEYS] ?? '{}')

beforeEach(() => {
  h.available = true
  h.store[KEYS] = '{}'
})

describe('keychain — encrypted round-trip', () => {
  it('stores ciphertext (not plaintext) and reads back the original', () => {
    setKey('deepseek', 'sk-secret')
    expect(raw().deepseek).not.toContain('sk-secret')
    expect(raw().deepseek.startsWith('plain:')).toBe(false)
    expect(getKey('deepseek')).toBe('sk-secret')
    expect(hasKey('deepseek')).toBe(true)
  })

  it('returns null / false for a missing key', () => {
    expect(getKey('nope')).toBeNull()
    expect(hasKey('nope')).toBe(false)
  })

  it('deleteKey removes the entry', () => {
    setKey('google', 'g')
    deleteKey('google')
    expect(hasKey('google')).toBe(false)
    expect(getKey('google')).toBeNull()
  })
})

describe('keychain — plaintext fallback (safeStorage unavailable)', () => {
  beforeEach(() => {
    h.available = false
  })

  it('isEncryptionAvailable reflects the platform', () => {
    expect(isEncryptionAvailable()).toBe(false)
  })

  it('stores with a plain: prefix and still round-trips', () => {
    setKey('dashscope', 'sk-plain')
    expect(raw().dashscope).toBe('plain:sk-plain')
    expect(getKey('dashscope')).toBe('sk-plain')
  })
})

describe('keychain — encrypted value but decryption later unavailable', () => {
  it('returns null rather than garbage', () => {
    h.available = true
    setKey('openrouter', 'sk-x')
    h.available = false // keyring went away after the key was written
    expect(getKey('openrouter')).toBeNull()
  })
})
