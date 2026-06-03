import { safeStorage } from 'electron'
import { app } from 'electron'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { recordEvent } from './event-log'

// Local credential store. Keys live in JSON at userData/keys.json, each value
// either base64-encoded electron safeStorage ciphertext or a `plain:`-prefixed
// fallback when safeStorage is unavailable (Linux without libsecret).
//
// SEC-10: the plaintext fallback is gated on EXPLICIT consent — either a
// per-call `{ allowPlaintext: true }` flag or a session-level consent flag
// the renderer flips after surfacing a confirm dialog. `setKey` THROWS
// `PlaintextConsentRequiredError` when encryption is off and neither
// signal is present, so an IPC handler that quietly calls setKey can't
// silently land a plaintext key. The error is surfaced back through the
// IPC as a clean reason string the renderer can show.
//
// Background paths (e.g. mcp-manager OAuth token refresh) get implicit
// consent via the `getKey` re-grant below: if a `plain:` row already exists
// on disk it means the user consented to plaintext at some earlier point
// on this device, so the session-consent flag flips on the first such read
// and subsequent in-session writes succeed without re-prompting.

const getKeysPath = (): string => join(app.getPath('userData'), 'keys.json')

// File mode for the on-disk keystore. 0o600 = read/write owner only.
// On Windows the POSIX mode bit is best-effort; the OS-level ACL still
// inherits from the userData directory, which is per-user. The chmod call
// is a no-op on Windows but does not throw.
const KEYS_FILE_MODE = 0o600

// Session-scoped consent. Reset on app restart. The renderer must flip
// this through `grantPlaintextConsent()` after surfacing a confirm dialog
// to the user; `getKey` flips it implicitly when an existing `plain:` row
// is observed on disk (the user must have consented at some prior point
// for that row to exist).
let sessionPlaintextConsent = false

export class PlaintextConsentRequiredError extends Error {
  readonly provider: string
  constructor(provider: string) {
    super(
      `Refusing to write '${provider}' key as plaintext: encryption is ` +
        'unavailable on this system and the caller has not recorded ' +
        'explicit plaintext-storage consent. Surface a confirm dialog and ' +
        'call settings.grantPlaintextConsent() first.'
    )
    this.name = 'PlaintextConsentRequiredError'
    this.provider = provider
  }
}

export interface SetKeyOptions {
  /**
   * When safeStorage is unavailable, allow writing this single key as
   * `plain:`. The caller is responsible for having obtained explicit
   * user consent (typically via `window.confirm`). Has no effect when
   * encryption IS available — the key is still encrypted.
   */
  allowPlaintext?: boolean
}

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
  const path = getKeysPath()
  // SEC-3: persist with 0o600. `writeFileSync` only honors `mode` on FILE
  // CREATION; existing files keep their old mode. For the upgrade path
  // (older builds wrote with the default 0o644) we chmod opportunistically
  // after the write so subsequent reads come from a hardened file.
  writeFileSync(path, JSON.stringify(keys, null, 2), {
    encoding: 'utf-8',
    mode: KEYS_FILE_MODE
  })
  try {
    chmodSync(path, KEYS_FILE_MODE)
  } catch {
    // Windows can reject chmod for ACL-controlled paths; the mode bit is
    // advisory there. We've already done what we can.
  }
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/**
 * Record that the user has explicitly consented to plaintext-on-disk
 * storage for this session. The flag survives until the app restarts;
 * subsequent `setKey` calls succeed without `allowPlaintext`.
 *
 * The renderer must call this only AFTER surfacing a `window.confirm`
 * dialog the user has accepted.
 */
export function grantPlaintextConsent(): void {
  const alreadyGranted = sessionPlaintextConsent
  sessionPlaintextConsent = true
  if (!alreadyGranted) {
    emitKeychainEvent({
      action: 'plaintext-consent-granted',
      outcome: 'granted'
    })
  }
}

/** Whether this session has plaintext-storage consent recorded. */
export function hasPlaintextConsent(): boolean {
  return sessionPlaintextConsent
}

/** Test-only: clear the session consent flag between cases. */
export function __resetPlaintextConsentForTest(): void {
  sessionPlaintextConsent = false
}

export function setKey(provider: string, key: string, opts: SetKeyOptions = {}): void {
  const keys = readKeys()
  const wasNewProvider = !(provider in keys)
  let storageMode: 'encrypted' | 'plaintext'
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(key)
    keys[provider] = encrypted.toString('base64')
    storageMode = 'encrypted'
  } else if (opts.allowPlaintext || sessionPlaintextConsent) {
    // The renderer is expected to have confirmed plaintext storage before
    // reaching this code path (either via the per-call flag or via the
    // session-consent IPC). The warning log remains as a backstop for
    // callers that bypass that flow.
    console.warn('[keychain] safeStorage unavailable — storing key as plaintext (consent recorded)')
    keys[provider] = `plain:${key}`
    storageMode = 'plaintext'
  } else {
    emitKeychainEvent({
      action: 'key-set-refused',
      provider,
      outcome: 'refused-no-consent',
      severity: 'warning'
    })
    throw new PlaintextConsentRequiredError(provider)
  }
  writeKeys(keys)
  emitKeychainEvent({
    action: wasNewProvider ? 'key-created' : 'key-updated',
    provider,
    outcome: 'persisted',
    storageMode
  })
}

export function getKey(provider: string): string | null {
  const keys = readKeys()
  const stored = keys[provider]
  if (!stored) return null

  if (stored.startsWith('plain:')) {
    // Implicit consent re-grant: an existing `plain:` row could only have
    // been written if the user previously consented (the `setKey` gate
    // rejects unauthorized plaintext writes). Treating that as session
    // consent lets background callers — most importantly the mcp-manager
    // OAuth token refresh — re-save refreshed tokens without forcing the
    // user to re-confirm at every relaunch.
    sessionPlaintextConsent = true
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
  const existed = provider in keys
  delete keys[provider]
  writeKeys(keys)
  if (existed) {
    emitKeychainEvent({
      action: 'key-deleted',
      provider,
      outcome: 'deleted'
    })
  }
}

export function hasKey(provider: string): boolean {
  const keys = readKeys()
  return provider in keys
}

// Test-only: re-export the file-mode constant so the test suite can assert
// the value without re-deriving it. The mode is documented in the source
// comment above; this export is the contract.
export const __KEYS_FILE_MODE_FOR_TEST = KEYS_FILE_MODE

interface KeychainEventDetail {
  /** What the caller attempted. Discrete strings so the timeline UI can
   *  group "set" vs "delete" vs "consent" without parsing free-form copy. */
  action:
    | 'key-created'
    | 'key-updated'
    | 'key-deleted'
    | 'key-set-refused'
    | 'plaintext-consent-granted'
  /** Which provider's key moved. Optional for consent events that aren't
   *  tied to a single provider. NEVER a value. */
  provider?: string
  /** Outcome flag — a short status string. NEVER includes the key value. */
  outcome:
    | 'persisted'
    | 'deleted'
    | 'refused-no-consent'
    | 'granted'
  /** Distinguishes safeStorage-encrypted writes from plaintext-fallback
   *  writes. Refused / consent events leave this undefined. */
  storageMode?: 'encrypted' | 'plaintext'
  severity?: 'info' | 'warning'
}

/**
 * Mirror a keychain mutation into the event spine. CRITICAL: this helper
 * never receives the key VALUE — only the provider id and an outcome flag.
 * That contract is enforced at the call sites: callers pass discrete
 * metadata, not the key string. A future refactor that adds a `key?: string`
 * field to KeychainEventDetail breaks the audit contract and must be
 * caught in review.
 *
 * Failures here are swallowed: the keychain write itself is the load-bearing
 * side-effect, and the event-log already owns its memory fallback.
 */
function emitKeychainEvent(detail: KeychainEventDetail): void {
  try {
    recordEvent({
      type: 'security.decision',
      actorKind: 'user',
      severity: detail.severity ?? 'info',
      entityKind: 'keychain',
      entityId: detail.provider,
      payload: {
        action: detail.action,
        provider: detail.provider,
        outcome: detail.outcome,
        storageMode: detail.storageMode
      }
    })
  } catch (err) {
    console.error('[keychain] security.decision event failed:', err)
  }
}
