import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('electron app not available in test environment')
    }
  }
}))

import {
  __forceChangeContractMemoryFallback,
  __resetChangeContractStore,
  closeChangeContract,
  createChangeContract,
  createChangeContractFromGoal,
  getActiveChangeContract,
  getChangeContract,
  listChangeContracts,
  synthesizeImplicitChangeContract,
  updateChangeContract,
  waiveChangeContract
} from './change-contract-store'

beforeEach(() => {
  __resetChangeContractStore()
  __forceChangeContractMemoryFallback()
})

describe('change contract store', () => {
  it('creates, gets, and lists scoped contracts', () => {
    const contract = createChangeContract({
      id: 'ctr_test',
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      goal: 'Add proof receipts',
      acceptanceCriteria: ['receipts are durable'],
      expectedFiles: ['electron/services/proof-receipts.ts'],
      nonGoals: ['UI panel'],
      verificationCommands: ['npm run lint'],
      requiredReceiptKinds: ['verify'],
      source: 'user'
    })

    expect(contract).toMatchObject({
      id: 'ctr_test',
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      status: 'active',
      implicit: false,
      source: 'user'
    })

    expect(getChangeContract('ctr_test')).toEqual(contract)
    expect(listChangeContracts({ conversationId: 'conv-1' }).map((c) => c.id)).toEqual([
      'ctr_test'
    ])
    expect(getActiveChangeContract('conv-1')?.id).toBe('ctr_test')
  })

  it('returns defensive array copies', () => {
    const contract = createChangeContract({
      conversationId: 'conv-1',
      goal: 'Protect arrays',
      acceptanceCriteria: ['first']
    })
    contract.acceptanceCriteria.push('mutated')

    expect(getChangeContract(contract.id)?.acceptanceCriteria).toEqual(['first'])
  })

  it('rejects invalid scope JSON shapes', () => {
    expect(() =>
      createChangeContract({
        conversationId: 'conv-1',
        goal: 'bad',
        expectedFiles: ['ok.ts', 42]
      })
    ).toThrow(/expectedFiles\[1\] must be a string/)

    expect(() =>
      createChangeContract({
        conversationId: 'conv-1',
        goal: 'bad',
        verificationCommands: 'npm test'
      })
    ).toThrow(/verificationCommands must be an array/)
  })

  it('updates only active contracts', () => {
    const contract = createChangeContract({
      conversationId: 'conv-1',
      goal: 'Initial',
      verificationCommands: ['npm test']
    })
    const updated = updateChangeContract(contract.id, {
      goal: 'Updated',
      expectedFiles: ['src/app.ts'],
      correlationId: 'corr-2'
    })
    expect(updated.goal).toBe('Updated')
    expect(updated.expectedFiles).toEqual(['src/app.ts'])
    expect(updated.verificationCommands).toEqual(['npm test'])
    expect(updated.correlationId).toBe('corr-2')

    closeChangeContract(contract.id)
    expect(() => updateChangeContract(contract.id, { goal: 'too late' })).toThrow(
      /only active/
    )
  })

  it('closes contracts and removes them from active lookup', () => {
    const contract = createChangeContract({
      conversationId: 'conv-1',
      goal: 'Close me'
    })
    const closed = closeChangeContract(contract.id)
    expect(closed.status).toBe('closed')
    expect(closed.closedAt).toBeGreaterThan(0)
    expect(getActiveChangeContract('conv-1')).toBeNull()
  })

  it('requires an explicit waiver reason and actor', () => {
    const contract = createChangeContract({
      conversationId: 'conv-1',
      goal: 'Waive me'
    })
    expect(() =>
      waiveChangeContract({ id: contract.id, reason: '   ', waivedBy: 'user' })
    ).toThrow(/reason is required/)
    expect(() =>
      waiveChangeContract({ id: contract.id, reason: 'manual check', waivedBy: '' })
    ).toThrow(/waivedBy is required/)

    const waived = waiveChangeContract({
      id: contract.id,
      reason: 'manual Electron smoke covered this',
      waivedBy: 'user'
    })
    expect(waived.status).toBe('waived')
    expect(waived.waiverReason).toBe('manual Electron smoke covered this')
    expect(waived.waivedBy).toBe('user')
    expect(waived.waivedAt).toBeGreaterThan(0)
  })

  it('creates contracts from plan goals without a model call', () => {
    const contract = createChangeContractFromGoal(
      'conv-1',
      { title: 'Ship proof gate', description: 'Require receipts before done' },
      { verificationCommands: ['npm run lint'], requiredReceiptKinds: ['verify'] }
    )

    expect(contract.source).toBe('plan_goal')
    expect(contract.goal).toContain('Ship proof gate')
    expect(contract.goal).toContain('Require receipts before done')
    expect(contract.verificationCommands).toEqual(['npm run lint'])
  })

  it('synthesizes implicit contracts from a request and first observed file', () => {
    const contract = synthesizeImplicitChangeContract({
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      userRequest: 'Fix the failing test',
      firstObservedFile: 'electron/services/workflow-runner.test.ts',
      verificationCommands: ['npm test']
    })

    expect(contract.implicit).toBe(true)
    expect(contract.source).toBe('implicit')
    expect(contract.expectedFiles).toEqual(['electron/services/workflow-runner.test.ts'])
    expect(contract.requiredReceiptKinds).toEqual(['verify'])
  })
})
