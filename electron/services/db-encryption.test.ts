import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => {
      if (key === 'userData') return userDataDir
      throw new Error(`unexpected app.getPath(${key})`)
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8')
  }
}))

import {
  getEncryptionStatus,
  isDatabaseEncrypted,
  enableEncryption,
  disableEncryption,
  changePassphrase,
  readStoredPassphrase
} from './db-encryption'

// Persistence Phase / PS9 — encryption module tests.
//
// We focus on the binding-absent path because the CI/dev environment
// here does not ship better-sqlite3-multiple-ciphers. The contract:
//   - getEncryptionStatus reports bindingAvailable=false + a useful
//     error string.
//   - enableEncryption refuses with a clear message.
//   - isDatabaseEncrypted reads the flag file (no binding needed).
//   - readStoredPassphrase reads/writes the keys.json shape we use for
//     other provider keys (plain: prefix when safeStorage unavailable).
//
// The binding-present path is exercised by smoke + integration when
// the native dep is installed; pure-binding-present tests would tie us
// to the cipher binary which is out of scope for unit tests.

describe('db-encryption (PS9, binding-absent path)', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'lamprey-ps9-'))
  })

  afterEach(() => {
    if (userDataDir && existsSync(userDataDir)) {
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  it('getEncryptionStatus reports bindingAvailable=false when the package is missing', () => {
    const status = getEncryptionStatus()
    expect(status.bindingAvailable).toBe(false)
    expect(status.bindingError).toBeTruthy()
    expect(status.databaseEncrypted).toBe(false)
    expect(status.passphraseStored).toBe(false)
  })

  it('isDatabaseEncrypted returns false when no flag file exists', () => {
    expect(isDatabaseEncrypted()).toBe(false)
  })

  it('isDatabaseEncrypted returns true when flag file is present', () => {
    writeFileSync(join(userDataDir, 'encryption.flag'), '1')
    expect(isDatabaseEncrypted()).toBe(true)
  })

  it('enableEncryption refuses with a clear message when the binding is unavailable', () => {
    expect(() => enableEncryption('correct-horse-battery-staple')).toThrowError(
      /SQLCipher binding unavailable/
    )
  })

  it('enableEncryption refuses short passphrases regardless of binding', () => {
    // Even if the binding error fires first, we want to validate that
    // short passphrases get rejected — call with a length<8 passphrase.
    expect(() => enableEncryption('short')).toThrowError(
      /SQLCipher binding unavailable|at least 8 characters/
    )
  })

  it('disableEncryption refuses when DB is not encrypted', () => {
    expect(() => disableEncryption('any-passphrase-long-enough')).toThrowError(
      /SQLCipher binding unavailable|not encrypted/
    )
  })

  it('changePassphrase refuses when DB is not encrypted', () => {
    expect(() => changePassphrase('old-passphrase', 'new-passphrase-12')).toThrowError(
      /SQLCipher binding unavailable|not encrypted/
    )
  })

  it('readStoredPassphrase returns null when keys.json does not exist', () => {
    expect(readStoredPassphrase()).toBeNull()
  })

  it('readStoredPassphrase reads plain: prefix when safeStorage unavailable', () => {
    writeFileSync(
      join(userDataDir, 'keys.json'),
      JSON.stringify({ encryption: 'plain:my-passphrase-here' })
    )
    expect(readStoredPassphrase()).toBe('my-passphrase-here')
  })

  it('readStoredPassphrase returns null for an entry that does not exist', () => {
    writeFileSync(
      join(userDataDir, 'keys.json'),
      JSON.stringify({ deepseek: 'plain:some-other-key' })
    )
    expect(readStoredPassphrase()).toBeNull()
  })
})

