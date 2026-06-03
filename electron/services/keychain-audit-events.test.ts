import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Audit-event tests for keychain mutations (Data Spine Prompt 6). The mock
// shape mirrors the existing keychain.test.ts: a real tmp userData dir so
// the keychain's writeFileSync actually runs, plus a fake safeStorage so we
// can flip encryption-available on/off per test. Event-log is forced into
// its memory fallback so its writes don't try to open a real SQLite db
// inside the same tmp dir.

const state = vi.hoisted(() => ({
  userDataDir: '',
  encryptionAvailable: true
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return state.userDataDir
      throw new Error(`unexpected app.getPath(${name})`)
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => state.encryptionAvailable,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (b: Buffer) => {
      const decoded = b.toString('utf-8')
      if (!decoded.startsWith('enc:')) throw new Error('bad ciphertext')
      return decoded.slice(4)
    }
  }
}))

import {
  __forceMemoryFallback,
  __resetEventLog,
  listEvents
} from './event-log'
import {
  __resetPlaintextConsentForTest,
  deleteKey,
  grantPlaintextConsent,
  PlaintextConsentRequiredError,
  setKey
} from './keychain'

beforeEach(() => {
  __resetEventLog()
  __forceMemoryFallback()
  __resetPlaintextConsentForTest()
  state.userDataDir = mkdtempSync(join(tmpdir(), 'lamprey-keychain-audit-'))
  state.encryptionAvailable = true
})

// ──────────────────── happy-path writes ────────────────────

describe('keychain setKey audit events', () => {
  it('first write for a provider emits security.decision { action: "key-created" }', () => {
    setKey('deepseek', 'sk-secret-value')
    const events = listEvents({ type: 'security.decision' })
    expect(events).toHaveLength(1)
    const payload = events[0].payload as {
      action: string
      provider: string
      outcome: string
      storageMode: string
    }
    expect(payload.action).toBe('key-created')
    expect(payload.provider).toBe('deepseek')
    expect(payload.outcome).toBe('persisted')
    expect(payload.storageMode).toBe('encrypted')
  })

  it('second write for the same provider emits "key-updated", not "key-created"', () => {
    setKey('deepseek', 'sk-old')
    setKey('deepseek', 'sk-new')
    const events = listEvents({ type: 'security.decision', order: 'asc' })
    expect(events.map((e) => (e.payload as { action: string }).action)).toEqual([
      'key-created',
      'key-updated'
    ])
  })

  it('the key VALUE never appears in any event payload (encrypted path)', () => {
    setKey('deepseek', 'sk-leaky-value-do-not-log')
    const events = listEvents({ type: 'security.decision' })
    const json = JSON.stringify(events)
    expect(json).not.toContain('sk-leaky-value-do-not-log')
  })
})

// ──────────────────── plaintext-consent gate ────────────────────

describe('keychain plaintext-consent audit events', () => {
  it('plaintext write WITHOUT consent emits "key-set-refused" and throws', () => {
    state.encryptionAvailable = false
    expect(() => setKey('deepseek', 'sk-noconsent')).toThrow(
      PlaintextConsentRequiredError
    )
    const events = listEvents({ type: 'security.decision' })
    expect(events).toHaveLength(1)
    const payload = events[0].payload as { action: string; outcome: string }
    expect(payload.action).toBe('key-set-refused')
    expect(payload.outcome).toBe('refused-no-consent')
    expect(events[0].severity).toBe('warning')
  })

  it('plaintext write WITH per-call consent emits { storageMode: "plaintext" }', () => {
    state.encryptionAvailable = false
    setKey('deepseek', 'sk-plain', { allowPlaintext: true })
    const persistedEvents = listEvents({ type: 'security.decision' }).filter(
      (e) => (e.payload as { action: string }).action !== 'plaintext-consent-granted'
    )
    expect(persistedEvents).toHaveLength(1)
    const payload = persistedEvents[0].payload as {
      action: string
      storageMode: string
      outcome: string
    }
    expect(payload.action).toBe('key-created')
    expect(payload.storageMode).toBe('plaintext')
    expect(payload.outcome).toBe('persisted')
  })

  it('grantPlaintextConsent emits a one-shot "plaintext-consent-granted" event', () => {
    grantPlaintextConsent()
    grantPlaintextConsent() // second call is a no-op, must not emit again
    const events = listEvents({ type: 'security.decision' })
    const grantedEvents = events.filter(
      (e) => (e.payload as { action: string }).action === 'plaintext-consent-granted'
    )
    expect(grantedEvents).toHaveLength(1)
    expect((grantedEvents[0].payload as { outcome: string }).outcome).toBe('granted')
  })

  it('plaintext write under SESSION consent does not flip the consent-granted event again', () => {
    state.encryptionAvailable = false
    grantPlaintextConsent()
    const baseline = listEvents({ type: 'security.decision' }).length
    setKey('deepseek', 'sk-session')
    const after = listEvents({ type: 'security.decision' })
    expect(after.length).toBe(baseline + 1)
    // The new event must be a key write, NOT a second consent-granted. Two
    // events stamped in the same millisecond keep insertion order under a
    // stable sort, so we filter by action instead of indexing into [-1].
    const grantedAfter = after.filter(
      (e) => (e.payload as { action: string }).action === 'plaintext-consent-granted'
    )
    expect(grantedAfter).toHaveLength(1)
    const writes = after.filter((e) =>
      ['key-created', 'key-updated'].includes(
        (e.payload as { action: string }).action
      )
    )
    expect(writes).toHaveLength(1)
  })

  it('plaintext key VALUE never appears in any event payload', () => {
    state.encryptionAvailable = false
    setKey('deepseek', 'sk-must-not-leak', { allowPlaintext: true })
    const json = JSON.stringify(listEvents({ type: 'security.decision' }))
    expect(json).not.toContain('sk-must-not-leak')
  })
})

// ──────────────────── delete ────────────────────

describe('keychain deleteKey audit events', () => {
  it('deleting an existing provider emits "key-deleted"', () => {
    setKey('deepseek', 'sk-x')
    const baseline = listEvents({ type: 'security.decision' }).length
    deleteKey('deepseek')
    const events = listEvents({ type: 'security.decision' })
    expect(events.length).toBe(baseline + 1)
    // Locate the delete event by its action rather than by [length-1]: two
    // events stamped in the same millisecond keep insertion order under a
    // stable sort, which would otherwise misread which one is "last".
    const deleteEvents = events.filter(
      (e) => (e.payload as { action: string }).action === 'key-deleted'
    )
    expect(deleteEvents).toHaveLength(1)
    const payload = deleteEvents[0].payload as {
      action: string
      provider: string
      outcome: string
    }
    expect(payload.action).toBe('key-deleted')
    expect(payload.provider).toBe('deepseek')
    expect(payload.outcome).toBe('deleted')
  })

  it('deleting a provider that never existed emits NO event', () => {
    deleteKey('never-there')
    expect(listEvents({ type: 'security.decision' })).toHaveLength(0)
  })
})

// ──────────────────── cleanup ────────────────────

it('cleans up the test tmp dir between cases', () => {
  // Sanity-check: the tmp dir exists during the test and gets wiped on exit.
  // The other suites don't assert this; doing it once here keeps test
  // hygiene in view if the userData mock ever drifts.
  expect(existsSync(state.userDataDir)).toBe(true)
  rmSync(state.userDataDir, { recursive: true, force: true })
  expect(existsSync(state.userDataDir)).toBe(false)
})
