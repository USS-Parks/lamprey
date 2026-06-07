import { describe, expect, it, vi } from 'vitest'
import { evaluateProofGate, proofGateNotice } from './proof-gate'
import type { ChangeContract } from './change-contract-store'
import type { ProofReceiptRecord } from './proof-receipts'
import type { LampreyToolCall } from './tool-registry'

const contract: ChangeContract = {
  id: 'ctr_1',
  conversationId: 'conv-1',
  status: 'active',
  implicit: false,
  source: 'user',
  goal: 'Change code',
  acceptanceCriteria: ['verified'],
  expectedFiles: ['src/a.ts'],
  nonGoals: [],
  verificationCommands: ['npm test'],
  requiredReceiptKinds: ['verify'],
  createdAt: 1,
  updatedAt: 1
}

function call(input: Partial<LampreyToolCall>): LampreyToolCall {
  return {
    id: 'tool-1',
    toolId: 'apply_patch',
    name: 'apply_patch',
    conversationId: 'conv-1',
    args: {},
    startedAt: 100,
    finishedAt: 110,
    status: 'done',
    ...input
  }
}

function receipt(input: Partial<ProofReceiptRecord>): ProofReceiptRecord {
  return {
    id: 'prf_1',
    kind: 'verify',
    status: 'passed',
    conversationId: 'conv-1',
    contractId: 'ctr_1',
    workspacePath: 'C:/repo',
    cwd: 'C:/repo',
    gitDirty: true,
    command: 'npm test',
    commandHash: 'cmd',
    startedAt: 120,
    finishedAt: 150,
    durationMs: 30,
    exitCode: 0,
    timedOut: false,
    stdoutHash: 'stdout',
    stderrHash: 'stderr',
    stdoutPreview: '',
    stderrPreview: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutBytes: 0,
    stderrBytes: 0,
    parsedMetrics: {},
    createdBy: 'agent',
    createdAt: 151,
    ...input
  }
}

const getDescriptor = (toolId: string): { mutates: boolean } | undefined => {
  if (toolId === 'workspace_context') return { mutates: false }
  if (toolId === 'verify_workspace') return { mutates: true }
  return { mutates: true }
}

describe('evaluateProofGate', () => {
  it('does not gate read-only turns', () => {
    const record = vi.fn()
    const result = evaluateProofGate({
      conversationId: 'conv-1',
      toolCalls: [call({ toolId: 'workspace_context', name: 'workspace_context' })],
      getDescriptor,
      deps: { record }
    })

    expect(result.status).toBe('not_required')
    expect(result.trusted).toBe(true)
    expect(record).not.toHaveBeenCalled()
  })

  it('fails a mutating turn without an active contract', () => {
    const record = vi.fn()
    const result = evaluateProofGate({
      conversationId: 'conv-1',
      workspacePath: 'C:/repo',
      toolCalls: [call({})],
      getDescriptor,
      deps: {
        getActiveContract: () => null,
        record
      }
    })

    expect(result.status).toBe('failed')
    expect(result.trusted).toBe(false)
    expect(result.reason).toContain('no active change contract')
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ type: 'proof.gate.failed' }))
  })

  it('passes a mutating turn with a fresh passing receipt after the last write', () => {
    const record = vi.fn()
    const fresh = receipt({ id: 'prf_fresh', finishedAt: 130 })
    const result = evaluateProofGate({
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      workspacePath: 'C:/repo',
      toolCalls: [call({ finishedAt: 110 })],
      getDescriptor,
      deps: {
        getActiveContract: () => contract,
        listReceipts: () => [fresh],
        findFreshProof: () => fresh,
        record
      }
    })

    expect(result.status).toBe('passed')
    expect(result.trusted).toBe(true)
    expect(result.receiptId).toBe('prf_fresh')
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ type: 'proof.gate.passed' }))
  })

  it('does not count verify_workspace itself as the last mutation', () => {
    const fresh = receipt({ id: 'prf_after_verify', finishedAt: 130 })
    const result = evaluateProofGate({
      conversationId: 'conv-1',
      workspacePath: 'C:/repo',
      toolCalls: [
        call({ id: 'patch', toolId: 'apply_patch', finishedAt: 110 }),
        call({ id: 'verify', toolId: 'verify_workspace', name: 'verify_workspace', finishedAt: 150 })
      ],
      getDescriptor,
      deps: {
        getActiveContract: () => contract,
        listReceipts: () => [fresh],
        findFreshProof: () => fresh,
        record: vi.fn()
      }
    })

    expect(result.status).toBe('passed')
    expect(result.lastMutationAt).toBe(110)
  })

  it('fails when only skipped proof exists after mutation', () => {
    const skipped = receipt({ id: 'prf_skip', status: 'skipped', finishedAt: 130 })
    const result = evaluateProofGate({
      conversationId: 'conv-1',
      workspacePath: 'C:/repo',
      toolCalls: [call({ finishedAt: 110 })],
      getDescriptor,
      deps: {
        getActiveContract: () => contract,
        listReceipts: () => [skipped],
        findFreshProof: () => null,
        record: vi.fn()
      }
    })

    expect(result.status).toBe('failed')
    expect(result.trusted).toBe(false)
    expect(result.skippedReceiptIds).toEqual(['prf_skip'])
    expect(proofGateNotice(result)).toContain('untrusted completion')
  })
})
