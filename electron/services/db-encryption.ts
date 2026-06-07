import { app, safeStorage } from 'electron'
import { join, dirname } from 'path'
import {
  existsSync,
  copyFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
  chmodSync
} from 'fs'

// Persistence Phase / PS9 — optional at-rest encryption via SQLCipher.
//
// SQLCipher is a SQLite fork with transparent page-level AES-256
// encryption. The drop-in better-sqlite3 binding for it is
// `better-sqlite3-multiple-ciphers`. We treat the binding as OPTIONAL:
//   1. At startup we try-require it. If missing or fails to load, the
//      app proceeds with plain better-sqlite3 unchanged and the Settings
//      panel surface (PS10) reads `isEncryptionAvailable() === false`
//      and hides the toggle.
//   2. When available + the user has opted in, the connection opens
//      with `PRAGMA key = '...'` and the database file is unreadable
//      without the passphrase. The passphrase is persisted to the
//      keychain under the `encryption` provider namespace so we can
//      reopen on next launch without re-prompting.
//   3. Enable / disable / change-passphrase are explicit one-shot
//      operations that use SQLCipher's `sqlcipher_export` mechanism +
//      file swap. The cached DB handle is closed for the duration so
//      there is no live writer competing with the rekey.
//
// This module deliberately does NOT touch the cached `db` in
// `database.ts` directly. Instead it returns success/failure and the
// caller (the IPC handler or the bootstrap path) coordinates the close
// + reopen lifecycle.
//
// The same `keys.json` keychain primitive used for provider API keys
// stores the passphrase, base64-wrapped through `safeStorage`. The
// `encryption` provider namespace is reserved here so the existing
// keychain audit story (security.decision events) applies uniformly.

const ENCRYPTION_PROVIDER = 'encryption' as const

interface CipherDatabase {
  pragma(s: string, opts?: { simple?: boolean }): unknown
  exec(s: string): void
  prepare(s: string): { run: (...args: unknown[]) => void }
  close(): void
}

interface CipherConstructor {
  new (path: string, opts?: { readonly?: boolean; fileMustExist?: boolean }): CipherDatabase
}

interface CipherModule {
  default?: CipherConstructor
  __esModule?: boolean
}

let cipherCtor: CipherConstructor | null = null
let cipherLoadError: string | null = null
let cipherLoadAttempted = false

/**
 * Lazy-load the SQLCipher binding. Idempotent — first call records the
 * outcome and subsequent calls return cached state.
 *
 * We deliberately try-require at use-time (not at module import) so an
 * absent binding doesn't crash the entire main process boot. The
 * vec-loader.ts pattern is the precedent.
 */
function loadCipherBinding(): CipherConstructor | null {
  if (cipherLoadAttempted) return cipherCtor
  cipherLoadAttempted = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('better-sqlite3-multiple-ciphers') as CipherModule | CipherConstructor
    // CommonJS default export shape: the module IS the constructor.
    if (typeof mod === 'function') {
      cipherCtor = mod as CipherConstructor
    } else if ((mod as CipherModule).default) {
      cipherCtor = (mod as CipherModule).default as CipherConstructor
    } else {
      cipherCtor = mod as unknown as CipherConstructor
    }
    cipherLoadError = null
  } catch (err) {
    cipherCtor = null
    cipherLoadError = err instanceof Error ? err.message : String(err)
  }
  return cipherCtor
}

export interface EncryptionStatus {
  /**
   * True iff the better-sqlite3-multiple-ciphers binding loaded.
   * If false, the UI should explain how to install it (npm install) and
   * the toggle stays hidden.
   */
  bindingAvailable: boolean
  /** Set when bindingAvailable=false; brief explanation. */
  bindingError: string | null
  /** True iff the live DB file appears encrypted (header bytes vary). */
  databaseEncrypted: boolean
  /** True iff a passphrase is stored in the keychain. */
  passphraseStored: boolean
}

const ENCRYPTION_FLAG_FILE = 'encryption.flag'

function flagPath(): string {
  return join(app.getPath('userData'), ENCRYPTION_FLAG_FILE)
}

function dbPath(): string {
  return join(app.getPath('userData'), 'lamprey.db')
}

/**
 * Read the on-disk marker that records "this DB is encrypted." Using a
 * file flag rather than probing the DB itself is deliberate — probing
 * requires opening the file, which fails noisily on an encrypted file
 * without the passphrase.
 */
export function isDatabaseEncrypted(): boolean {
  return existsSync(flagPath())
}

function stampEncryptionFlag(): void {
  writeFileSync(flagPath(), '1', { mode: 0o600 })
  try {
    chmodSync(flagPath(), 0o600)
  } catch {
    /* best-effort on Windows */
  }
}

function clearEncryptionFlag(): void {
  if (existsSync(flagPath())) {
    try {
      unlinkSync(flagPath())
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Read the encryption passphrase from the keychain, if stored. Returns
 * null when the keychain doesn't have one (encryption disabled OR the
 * passphrase was cleared manually). Throws only on a keychain read
 * error, never on a missing row.
 */
export function readStoredPassphrase(): string | null {
  // Inline minimal keychain read to avoid a circular import with
  // `keychain.ts` (which itself imports services that depend on this).
  // Same wire format: keys.json under userData; provider entry; base64
  // safeStorage ciphertext OR `plain:` prefix.
  const userData = app.getPath('userData')
  const keysPath = join(userData, 'keys.json')
  if (!existsSync(keysPath)) return null
  try {
    const json = JSON.parse(readFileSync(keysPath, 'utf8')) as Record<string, string>
    const entry = json[ENCRYPTION_PROVIDER]
    if (!entry) return null
    if (entry.startsWith('plain:')) return entry.slice('plain:'.length)
    if (!safeStorage.isEncryptionAvailable()) {
      // Encrypted-on-disk passphrase without OS keychain available is
      // a configuration error; surface honestly.
      throw new Error(
        'stored encryption passphrase requires OS keychain to decrypt'
      )
    }
    return safeStorage.decryptString(Buffer.from(entry, 'base64'))
  } catch (err) {
    throw err
  }
}

function writeStoredPassphrase(passphrase: string): void {
  const userData = app.getPath('userData')
  const keysPath = join(userData, 'keys.json')
  let json: Record<string, string> = {}
  if (existsSync(keysPath)) {
    try {
      json = JSON.parse(readFileSync(keysPath, 'utf8')) as Record<string, string>
    } catch {
      // Corrupt keys.json — refuse rather than clobber a good file.
      throw new Error('keys.json is unreadable; refusing to write passphrase')
    }
  }
  const wrapped = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(passphrase).toString('base64')
    : `plain:${passphrase}`
  json[ENCRYPTION_PROVIDER] = wrapped
  writeFileSync(keysPath, JSON.stringify(json, null, 2), { mode: 0o600 })
  try {
    chmodSync(keysPath, 0o600)
  } catch {
    /* best-effort */
  }
}

function clearStoredPassphrase(): void {
  const userData = app.getPath('userData')
  const keysPath = join(userData, 'keys.json')
  if (!existsSync(keysPath)) return
  try {
    const json = JSON.parse(readFileSync(keysPath, 'utf8')) as Record<string, string>
    delete json[ENCRYPTION_PROVIDER]
    writeFileSync(keysPath, JSON.stringify(json, null, 2), { mode: 0o600 })
  } catch {
    /* best-effort */
  }
}

/**
 * Public status helper. Read-only; safe to call before any encryption
 * action. PS10's Settings panel calls this to decide what to render.
 */
export function getEncryptionStatus(): EncryptionStatus {
  const binding = loadCipherBinding()
  let passphraseStored = false
  try {
    passphraseStored = readStoredPassphrase() !== null
  } catch {
    passphraseStored = false
  }
  return {
    bindingAvailable: binding !== null,
    bindingError: cipherLoadError,
    databaseEncrypted: isDatabaseEncrypted(),
    passphraseStored
  }
}

/**
 * Enable encryption on the existing plaintext database.
 *
 * Sequence (called with the live db handle already closed by the caller):
 *   1. Validate the binding is available.
 *   2. Validate passphrase shape (non-empty, reasonable bounds).
 *   3. Open the plaintext source via the cipher binding (without KEY).
 *   4. ATTACH a new file with the passphrase, sqlcipher_export, DETACH.
 *   5. Swap files atomically (move plain aside, rename encrypted into
 *      place).
 *   6. Store the passphrase in the keychain.
 *   7. Stamp the encryption flag file so subsequent boots know to use
 *      the passphrase.
 *
 * The caller (IPC handler or Settings action) is expected to relaunch
 * the app after this returns so the cached connection in `database.ts`
 * gets a fresh open against the encrypted file.
 */
export function enableEncryption(passphrase: string): { migratedFrom: string } {
  const binding = loadCipherBinding()
  if (!binding) {
    throw new Error(
      `SQLCipher binding unavailable: ${cipherLoadError ?? 'unknown'}. ` +
        `Install better-sqlite3-multiple-ciphers to enable encryption.`
    )
  }
  if (typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new Error('encryption passphrase must be at least 8 characters')
  }
  if (isDatabaseEncrypted()) {
    throw new Error('database is already encrypted; use changePassphrase()')
  }
  const sourcePath = dbPath()
  const encPath = join(dirname(sourcePath), 'lamprey-enc.db')
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const sourceBackupPath = `${sourcePath}.preencrypt-${ts}`
  if (!existsSync(sourcePath)) {
    throw new Error(`source database not found at ${sourcePath}`)
  }
  if (existsSync(encPath)) {
    // Half-finished previous attempt; remove so the rekey is fresh.
    try {
      unlinkSync(encPath)
    } catch {
      /* best-effort */
    }
  }
  // Step 1: open the plaintext source with the cipher binding (no key).
  const source = new binding(sourcePath, { fileMustExist: true })
  try {
    // Step 2: ATTACH the target with the passphrase, export, detach.
    // SQLCipher's `sqlcipher_export` clones the entire main schema +
    // data into the attached DB, applying the configured KEY at write
    // time so the destination ends up encrypted.
    const escapedPass = passphrase.replace(/'/g, "''")
    source.exec(`ATTACH DATABASE '${encPath}' AS enc KEY '${escapedPass}'`)
    source.exec(`SELECT sqlcipher_export('enc')`)
    source.exec(`DETACH DATABASE enc`)
  } finally {
    try {
      source.close()
    } catch {
      /* already closed */
    }
  }
  // Step 3: file swap.
  renameSync(sourcePath, sourceBackupPath)
  // WAL/SHM of the plaintext source are not needed by the encrypted
  // file; leave them next to the .preencrypt backup so a manual recover
  // is possible if the user changes their mind.
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${sourcePath}${suffix}`
    if (existsSync(sidecar)) {
      try {
        renameSync(sidecar, `${sourceBackupPath}${suffix}`)
      } catch {
        /* best-effort */
      }
    }
  }
  renameSync(encPath, sourcePath)
  // Step 4: persist passphrase + stamp the flag.
  writeStoredPassphrase(passphrase)
  stampEncryptionFlag()
  return { migratedFrom: sourceBackupPath }
}

/**
 * Decrypt an encrypted database back to plaintext. Caller must have
 * closed the live handle first; relaunch is required afterwards.
 */
export function disableEncryption(passphrase: string): { decryptedFrom: string } {
  const binding = loadCipherBinding()
  if (!binding) {
    throw new Error('SQLCipher binding unavailable')
  }
  if (!isDatabaseEncrypted()) {
    throw new Error('database is not encrypted')
  }
  const sourcePath = dbPath()
  const plainPath = join(dirname(sourcePath), 'lamprey-dec.db')
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const sourceBackupPath = `${sourcePath}.encrypted-${ts}`
  if (existsSync(plainPath)) {
    try {
      unlinkSync(plainPath)
    } catch {
      /* best-effort */
    }
  }
  const source = new binding(sourcePath, { fileMustExist: true })
  try {
    const escapedPass = passphrase.replace(/'/g, "''")
    source.pragma(`key = '${escapedPass}'`)
    // Probing a query verifies the passphrase before we touch files.
    source.pragma('cipher_version')
    source.exec(`ATTACH DATABASE '${plainPath}' AS plain KEY ''`)
    source.exec(`SELECT sqlcipher_export('plain')`)
    source.exec(`DETACH DATABASE plain`)
  } finally {
    try {
      source.close()
    } catch {
      /* already closed */
    }
  }
  renameSync(sourcePath, sourceBackupPath)
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${sourcePath}${suffix}`
    if (existsSync(sidecar)) {
      try {
        renameSync(sidecar, `${sourceBackupPath}${suffix}`)
      } catch {
        /* best-effort */
      }
    }
  }
  renameSync(plainPath, sourcePath)
  clearStoredPassphrase()
  clearEncryptionFlag()
  return { decryptedFrom: sourceBackupPath }
}

/**
 * Replace the passphrase on an already-encrypted database. The caller
 * is expected to have validated the old passphrase against the live
 * connection BEFORE calling this, since we cannot prompt from main.
 */
export function changePassphrase(oldPassphrase: string, newPassphrase: string): void {
  const binding = loadCipherBinding()
  if (!binding) {
    throw new Error('SQLCipher binding unavailable')
  }
  if (!isDatabaseEncrypted()) {
    throw new Error('database is not encrypted')
  }
  if (typeof newPassphrase !== 'string' || newPassphrase.length < 8) {
    throw new Error('new passphrase must be at least 8 characters')
  }
  const sourcePath = dbPath()
  const source = new binding(sourcePath, { fileMustExist: true })
  try {
    source.pragma(`key = '${oldPassphrase.replace(/'/g, "''")}'`)
    // Validate by reading a known pragma.
    source.pragma('cipher_version')
    source.pragma(`rekey = '${newPassphrase.replace(/'/g, "''")}'`)
  } finally {
    try {
      source.close()
    } catch {
      /* already closed */
    }
  }
  writeStoredPassphrase(newPassphrase)
}

/**
 * Open a SQLCipher-encrypted database. Used by getDb() in database.ts
 * when the encryption flag is set. Returns null if the binding is
 * unavailable or the passphrase is missing — the caller falls back to
 * plain better-sqlite3 with a warning.
 *
 * NOTE: the returned object is structurally compatible with the
 * better-sqlite3 API surface that database.ts uses (pragma, exec,
 * prepare, close). We deliberately do NOT widen the type into the
 * better-sqlite3 declaration namespace because the cipher binding is
 * a runtime detail; callers cast where they need to.
 */
export function openEncryptedDatabase(passphrase: string, dbFilePath: string): CipherDatabase | null {
  const binding = loadCipherBinding()
  if (!binding) return null
  const handle = new binding(dbFilePath)
  const escapedPass = passphrase.replace(/'/g, "''")
  handle.pragma(`key = '${escapedPass}'`)
  // Touch a pragma that requires the key to be correct; a mistyped
  // passphrase fails here rather than at first query.
  try {
    handle.pragma('cipher_version')
  } catch (err) {
    try {
      handle.close()
    } catch {
      /* already closed */
    }
    throw new Error(`encrypted database: passphrase rejected (${err instanceof Error ? err.message : String(err)})`)
  }
  return handle
}
