import { recordEvent } from './event-log'
import { getActiveChangeContract, type ChangeContract } from './change-contract-store'
import {
  findFreshProofForContract,
  listProofReceipts,
  type ProofReceiptRecord
} from './proof-receipts'
import type { LampreyToolCall, LampreyToolDescriptor } from './tool-registry'

export type ProofGateStatus = 'not_required' | 'passed' | 'failed'

export interface ProofGateResult {
  status: ProofGateStatus
  trusted: boolean
  reason: string
  lastMutationAt?: number
  contractId?: string
  receiptId?: string
  failedReceiptIds: string[]
  skippedReceiptIds: string[]
}

export interface ProofGateDeps {
  getActiveContract?: (conversationId: string) => ChangeContract | null
  findFreshProof?: (query: {
    contractId: string
    afterMs?: number
    workspacePath?: string
    correlationId?: string
  }) => ProofReceiptRecord | null
  listReceipts?: (filter: {
    conversationId?: string
    contractId?: string
    workspacePath?: string
    sinceMs?: number
    limit?: number
  }) => ProofReceiptRecord[]
  record?: typeof recordEvent
}

const VERIFICATION_TOOL_IDS = new Set(['verify_workspace', 'frontend_qa'])

export function isProofRelevantMutation(
  call: Pick<LampreyToolCall, 'toolId' | 'status'>,
  descriptor: Pick<LampreyToolDescriptor, 'mutates'> | undefined
): boolean {
  if (call.status === 'denied') return false
  if (VERIFICATION_TOOL_IDS.has(call.toolId)) return false
  return descriptor?.mutates === true
}

export function evaluateProofGate(input: {
  conversationId: string
  correlationId?: string
  workspacePath?: string
  sinceMs?: number
  toolCalls: LampreyToolCall[]
  getDescriptor: (toolId: string) => Pick<LampreyToolDescriptor, 'mutates'> | undefined
  deps?: ProofGateDeps
}): ProofGateResult {
  const mutations = input.toolCalls
    .filter((call) => input.sinceMs === undefined || call.startedAt >= input.sinceMs)
    .filter((call) => isProofRelevantMutation(call, input.getDescriptor(call.toolId)))
    .sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt))

  if (mutations.length === 0) {
    return {
      status: 'not_required',
      trusted: true,
      reason: 'No mutating tool calls in this turn.',
      failedReceiptIds: [],
      skippedReceiptIds: []
    }
  }

  const lastMutation = mutations.at(-1)!
  const lastMutationAt = lastMutation.finishedAt ?? lastMutation.startedAt
  const getActive = input.deps?.getActiveContract ?? getActiveChangeContract
  const contract = getActive(input.conversationId)
  if (!contract) {
    return fail(input, {
      reason: 'Mutating turn has no active change contract.',
      lastMutationAt,
      failedReceiptIds: [],
      skippedReceiptIds: []
    })
  }

  const listReceipts = input.deps?.listReceipts ?? listProofReceipts
  const receipts = listReceipts({
    conversationId: input.conversationId,
    contractId: contract.id,
    workspacePath: input.workspacePath,
    sinceMs: lastMutationAt,
    limit: 20
  })
  const failedReceiptIds = receipts
    .filter((receipt) => receipt.status === 'failed')
    .map((receipt) => receipt.id)
  const skippedReceiptIds = receipts
    .filter((receipt) => receipt.status === 'skipped')
    .map((receipt) => receipt.id)
  const findFresh = input.deps?.findFreshProof ?? findFreshProofForContract
  const proof = findFresh({
    contractId: contract.id,
    afterMs: lastMutationAt,
    workspacePath: input.workspacePath,
    correlationId: input.correlationId
  })
  if (!proof) {
    return fail(input, {
      reason: 'No fresh passing proof receipt after the last mutation.',
      lastMutationAt,
      contractId: contract.id,
      failedReceiptIds,
      skippedReceiptIds
    })
  }
  if (skippedReceiptIds.length > 0) {
    return fail(input, {
      reason: 'Fresh proof exists, but required verification has skipped gaps.',
      lastMutationAt,
      contractId: contract.id,
      receiptId: proof.id,
      failedReceiptIds,
      skippedReceiptIds
    })
  }
  const result: ProofGateResult = {
    status: 'passed',
    trusted: true,
    reason: 'Fresh passing proof receipt found after the last mutation.',
    lastMutationAt,
    contractId: contract.id,
    receiptId: proof.id,
    failedReceiptIds,
    skippedReceiptIds
  }
  emitGateEvent(input, result)
  return result
}

function fail(
  input: {
    conversationId: string
    correlationId?: string
    workspacePath?: string
    deps?: ProofGateDeps
  },
  patch: Omit<ProofGateResult, 'status' | 'trusted'>
): ProofGateResult {
  const result: ProofGateResult = {
    status: 'failed',
    trusted: false,
    ...patch
  }
  emitGateEvent(input, result)
  return result
}

function emitGateEvent(
  input: {
    conversationId: string
    correlationId?: string
    workspacePath?: string
    deps?: ProofGateDeps
  },
  result: ProofGateResult
): void {
  if (result.status === 'not_required') return
  const recorder = input.deps?.record ?? recordEvent
  recorder({
    type: result.status === 'passed' ? 'proof.gate.passed' : 'proof.gate.failed',
    severity: result.status === 'passed' ? 'info' : 'warning',
    actorKind: 'system',
    conversationId: input.conversationId,
    workspacePath: input.workspacePath,
    correlationId: input.correlationId,
    entityKind: result.contractId ? 'change_contract' : undefined,
    entityId: result.contractId,
    payload: {
      status: result.status,
      trusted: result.trusted,
      reason: result.reason,
      lastMutationAt: result.lastMutationAt,
      contractId: result.contractId,
      receiptId: result.receiptId,
      failedReceiptIds: result.failedReceiptIds,
      skippedReceiptIds: result.skippedReceiptIds
    },
    redaction: 'metadata'
  })
}

export function proofGateNotice(result: ProofGateResult): string {
  if (result.trusted) return ''
  const details = [
    result.reason,
    result.contractId ? `contract: ${result.contractId}` : null,
    result.failedReceiptIds.length > 0
      ? `failed receipts: ${result.failedReceiptIds.join(', ')}`
      : null,
    result.skippedReceiptIds.length > 0
      ? `skipped receipts: ${result.skippedReceiptIds.join(', ')}`
      : null
  ].filter((part): part is string => Boolean(part))
  return `\n\nProof gate: untrusted completion. ${details.join(' ')}`
}
