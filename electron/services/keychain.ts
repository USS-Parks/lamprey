import { safeStorage } from 'electron'
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const getKeysPath = () => join(app.getPath('userData'), 'keys.json')

function readKeys(): Record<string, string> {
  const keysPath = getKeysPath()
  if (!existsSync(keysPath)) return {}
  try {
    return JSON.parse(readFileSync(keysPath, 'utf-8'))
  } catch {
    return {}
  }
}

function writeKeys(keys: Record<string, string>): void {
  writeFileSync(getKeysPath(), JSON.stringify(keys, null, 2), 'utf-8')
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function setKey(provider: string, key: string): void {
  const keys = readKeys()
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(key)
    keys[provider] = encrypted.toString('base64')
  } else {
    console.warn('[keychain] safeStorage unavailable — storing key as plaintext')
    keys[provider] = `plain:${key}`
  }
  writeKeys(keys)
}

export function getKey(provider: string): string | null {
  const keys = readKeys()
  const stored = keys[provider]
  if (!stored) return null

  if (stored.startsWith('plain:')) {
    return stored.slice(6)
  }

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[keychain] safeStorage unavailable — cannot decrypt key')
    return null
  }

  try {
    const buffer = Buffer.from(stored, 'base64')
    return safeStorage.decryptString(buffer)
  } catch {
    console.error('[keychain] Failed to decrypt key for', provider)
    return null
  }
}

export function deleteKey(provider: string): void {
  const keys = readKeys()
  delete keys[provider]
  writeKeys(keys)
}

export function hasKey(provider: string): boolean {
  const keys = readKeys()
  return provider in keys
}
