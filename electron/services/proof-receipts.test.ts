import { createHash } from 'crypto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import BetterSqlite3, { type Database } from 'better-sqlite3'
import { applyProofReceiptSchema } from './proof-receipt-schema'
import type { RecordEventInput } from './event-log'
import { runMigrations, LATEST_VERSION } from './db-migrations'
import {
  createProofReceipt,
  findFreshProofForContract,
  getProofReceipt,
  listProofReceiptArtifacts,
  listProofReceipts,
  redactProofText
} from './proof-receipts'

const HAS_NATIVE_SQLITE: boolean = (() => {
  try {
    const probe = new BetterSqlite3(':memory:')
    probe.close()
    return true
  } catch {
    return false
  }
})()

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function makeDb(): Database {
  const db = new BetterSqlite3(':memory:')
  db.pragma('foreign_keys = ON')
  applyProofReceiptSchema(db)
  return db
}

function makeBaselineDb(): Database {
  const db = new BetterSqlite3(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE conversations (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
    CREATE TABLE events (id TEXT PRIMARY KEY);
  `)
  return db
}

describe.skipIf(!HAS_NATIVE_SQLITE)('proof receipts', () => {
  let db: Database
  let eventRecorder: (input: RecordEventInput) => unknown

  beforeEach(() => {
    db = makeDb()
    eventRecorder = vi.fn((input: RecordEventInput) => input)
  })

  afterEach(() => {
    db.close()
  })

  it('inserts, lists, and gets proof receipts', () => {
    const receipt = createProofReceipt(
      {
        id: 'prf_test',
        kind: 'verify',
        status: 'passed',
        conversationId: 'conv-1',
        correlationId: 'corr-1',
        contractId: 'contract-1',
        toolCallId: 'tool-1',
        workspacePath: 'C:/repo',
        cwd: 'C:/repo',
        gitHead: 'abc123',
        gitDirty: true,
        diffHash: 'diff-hash',
        command: 'npm test',
        startedAt: 100,
        finishedAt: 150,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        parsedMetrics: { tests: { passed: 3, failed: 0 } },
        createdBy: 'agent'
      },
      { db, eventRecorder }
    )

    expect(receipt.id).toBe('prf_test')
    expect(receipt.commandHash).toBe(sha256('npm test'))
    expect(receipt.stdoutHash).toBe(sha256('ok'))
    expect(receipt.durationMs).toBe(50)

    const fetched = getProofReceipt('prf_test', { db })
    expect(fetched).toMatchObject({
      id: 'prf_test',
      status: 'passed',
      conversationId: 'conv-1',
      contractId: 'contract-1',
      gitDirty: true,
      parsedMetrics: { tests: { passed: 3, failed: 0 } }
    })

    const listed = listProofReceipts({ conversationId: 'conv-1' }, { db })
    expect(listed.map((r) => r.id)).toEqual(['prf_test'])
    expect(eventRecorder).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'proof.receipt.created',
        entityId: 'prf_test',
        payload: expect.objectContaining({
          stdoutHash: sha256('ok'),
          artifactCount: 0
        })
      })
    )
  })

  it('redacts secret-looking values before storing previews', () => {
    const receipt = createProofReceipt(
      {
        kind: 'verify',
        status: 'failed',
        workspacePath: 'C:/repo',
        cwd: 'C:/repo',
        command: 'npm test',
        startedAt: 1,
        finishedAt: 2,
        exitCode: 1,
        stdout: 'api_key=sk-live password: hunter2 normal=value',
        stderr: 'Authorization: Bearer real-token',
        createdBy: 'agent'
      },
      { db, eventRecorder }
    )

    expect(receipt.stdoutPreview).toContain('api_key=[redacted]')
    expect(receipt.stdoutPreview).toContain('password: [redacted]')
    expect(receipt.stdoutPreview).not.toContain('sk-live')
    expect(receipt.stdoutPreview).not.toContain('hunter2')
    expect(receipt.stderrPreview).not.toContain('real-token')
    expect(eventRecorder).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'proof.receipt.failed',
        severity: 'error',
        payload: expect.not.objectContaining({
          stdoutPreview: expect.any(String),
          stderrPreview: expect.any(String)
        })
      })
    )
  })

  it('hashes and caps oversized output while retaining artifact previews', () => {
    const big = `prefix\n${'x'.repeat(8 * 1024)}\nsecret_token=abc123`
    const receipt = createProofReceipt(
      {
        kind: 'verify',
        status: 'passed',
        workspacePath: 'C:/repo',
        cwd: 'C:/repo',
        command: 'npm test',
        startedAt: 1,
        finishedAt: 2,
        stdout: big,
        stderr: '',
        createdBy: 'system'
      },
      { db, eventRecorder }
    )

    expect(receipt.stdoutHash).toBe(sha256(big))
    expect(receipt.stdoutBytes).toBe(Buffer.byteLength(big, 'utf8'))
    expect(receipt.stdoutTruncated).toBe(true)
    expect(Buffer.byteLength(receipt.stdoutPreview, 'utf8')).toBeLessThanOrEqual(4096)

    const artifacts = listProofReceiptArtifacts(receipt.id, { db })
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      receiptId: receipt.id,
      stream: 'stdout',
      byteCount: Buffer.byteLength(big, 'utf8'),
      hash: sha256(big)
    })
    expect(artifacts[0].contentPreview).not.toContain('abc123')
  })

  it('finds only fresh passing proof for a contract', () => {
    createProofReceipt(
      {
        kind: 'lint',
        status: 'failed',
        contractId: 'contract-1',
        workspacePath: 'C:/repo',
        cwd: 'C:/repo',
        command: 'npm run lint',
        startedAt: 10,
        finishedAt: 20,
        exitCode: 1,
        createdBy: 'agent'
      },
      { db, emitEvent: false }
    )
    createProofReceipt(
      {
        kind: 'lint',
        status: 'passed',
        contractId: 'contract-1',
        workspacePath: 'C:/repo',
        cwd: 'C:/repo',
        command: 'npm run lint',
        startedAt: 30,
        finishedAt: 40,
        exitCode: 0,
        createdBy: 'agent'
      },
      { db, emitEvent: false }
    )

    expect(
      findFreshProofForContract({ contractId: 'contract-1', afterMs: 25 }, { db })?.status
    ).toBe('passed')
    expect(
      findFreshProofForContract({ contractId: 'contract-1', afterMs: 45 }, { db })
    ).toBeNull()
  })

  it('keeps receipts append-only', () => {
    const receipt = createProofReceipt(
      {
        kind: 'verify',
        status: 'passed',
        workspacePath: 'C:/repo',
        cwd: 'C:/repo',
        command: 'npm test',
        startedAt: 1,
        finishedAt: 2,
        createdBy: 'agent'
      },
      { db, emitEvent: false }
    )

    expect(() =>
      db.prepare(`UPDATE proof_receipts SET status = 'failed' WHERE id = ?`).run(receipt.id)
    ).toThrow(/append-only/)
    expect(() =>
      db.prepare(`DELETE FROM proof_receipts WHERE id = ?`).run(receipt.id)
    ).toThrow(/append-only/)
  })

  it('applies the schema idempotently and through migrations', () => {
    applyProofReceiptSchema(db)
    createProofReceipt(
      {
        kind: 'verify',
        status: 'skipped',
        workspacePath: 'C:/repo',
        cwd: 'C:/repo',
        command: 'npm test',
        startedAt: 1,
        finishedAt: 1,
        createdBy: 'ci'
      },
      { db, eventRecorder }
    )

    const migrated = makeBaselineDb()
    try {
      const result = runMigrations(migrated)
      expect(result.endVersion).toBe(LATEST_VERSION)
      expect(
        migrated
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'proof_receipts'"
          )
          .get()
      ).toBeTruthy()
      const second = runMigrations(migrated)
      expect(second.applied).toEqual([])
    } finally {
      migrated.close()
    }
  })
})

describe('redactProofText', () => {
  it('redacts common assignment and header shapes', () => {
    expect(
      redactProofText('OPENAI_API_KEY=sk-test Authorization: Bearer-real cookie=session')
    ).toBe('OPENAI_API_KEY=[redacted] Authorization: [redacted] cookie=[redacted]')
  })
})
