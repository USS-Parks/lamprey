import { describe, expect, it, vi } from 'vitest'

// Snip Phase K9 wired the snip layer into tool-registry; the chain
// imports filter-loader which pulls in electron + @electron-toolkit.
vi.mock('electron', () => ({
  app: { getPath: () => '.tmp-tool-parallelism-test' },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

import { isParallelizableDescriptor, type LampreyToolDescriptor } from './tool-registry'
import {
  partitionToolCallWindows,
  type ProviderToolCall
} from './tool-call-windowing'

function makeDescriptor(
  overrides: Partial<LampreyToolDescriptor> = {}
): LampreyToolDescriptor {
  return {
    id: 't',
    name: 't',
    title: 'T',
    description: 'd',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: { type: 'object' },
    risks: [],
    requiresApproval: false,
    enabled: true,
    // C1 added derived fields. Tests don't need real tags here — they only
    // exercise the parallelism predicate, which ignores tags + lazy + mutates.
    tags: ['native'],
    lazy: false,
    mutates: false,
    ...overrides
  }
}

describe('isParallelizableDescriptor', () => {
  it('returns false for undefined descriptors (MCP-only call name, etc.)', () => {
    expect(isParallelizableDescriptor(undefined)).toBe(false)
  })

  it('returns false when the flag is not explicitly set', () => {
    expect(isParallelizableDescriptor(makeDescriptor({ risks: ['read'] }))).toBe(false)
  })

  it('returns true for an opted-in read-only descriptor', () => {
    expect(
      isParallelizableDescriptor(
        makeDescriptor({ risks: ['read'], parallelizable: true })
      )
    ).toBe(true)
  })

  it('refuses to parallelize descriptors that require approval, even when the flag is on', () => {
    expect(
      isParallelizableDescriptor(
        makeDescriptor({ risks: ['read'], parallelizable: true, requiresApproval: true })
      )
    ).toBe(false)
  })

  it.each([['write'], ['destructive'], ['secret']] as Array<['write' | 'destructive' | 'secret']>)(
    'refuses to parallelize when risks include %s',
    (risk) => {
      expect(
        isParallelizableDescriptor(
          makeDescriptor({ risks: [risk, 'read'], parallelizable: true })
        )
      ).toBe(false)
    }
  )

  it('allows the network + read pair (the main fan-out use case)', () => {
    expect(
      isParallelizableDescriptor(
        makeDescriptor({ risks: ['network', 'read'], parallelizable: true })
      )
    ).toBe(true)
  })
})

describe('partitionToolCallWindows', () => {
  const READ = makeDescriptor({ id: 'r', risks: ['read'], parallelizable: true })
  const WRITE = makeDescriptor({ id: 'w', risks: ['write'] })
  const APPROVE = makeDescriptor({
    id: 'a',
    risks: ['read'],
    parallelizable: true,
    requiresApproval: true
  })

  function lookup(map: Record<string, LampreyToolDescriptor>) {
    return (id: string) => map[id]
  }

  function call(name: string): ProviderToolCall {
    return { id: `${name}-${Math.random().toString(36).slice(2, 6)}`, function: { name, arguments: '{}' } }
  }

  it('returns an empty window list for an empty call list', () => {
    expect(partitionToolCallWindows([], () => undefined)).toEqual([])
  })

  it('groups a run of read-only calls into one parallel window', () => {
    const calls = [call('r'), call('r'), call('r')]
    const windows = partitionToolCallWindows(calls, lookup({ r: READ }))
    expect(windows).toHaveLength(1)
    expect(windows[0]).toEqual({ kind: 'parallel', indices: [0, 1, 2] })
  })

  it('keeps a lone parallelizable call as a serial window', () => {
    const calls = [call('r')]
    const windows = partitionToolCallWindows(calls, lookup({ r: READ }))
    expect(windows).toEqual([{ kind: 'serial', index: 0 }])
  })

  it('breaks the parallel window at a non-parallelizable call', () => {
    const calls = [call('r'), call('r'), call('w'), call('r'), call('r')]
    const windows = partitionToolCallWindows(calls, lookup({ r: READ, w: WRITE }))
    expect(windows).toEqual([
      { kind: 'parallel', indices: [0, 1] },
      { kind: 'serial', index: 2 },
      { kind: 'parallel', indices: [3, 4] }
    ])
  })

  it('treats approval-required calls as serial even when parallelizable: true is set', () => {
    const calls = [call('a'), call('a')]
    const windows = partitionToolCallWindows(calls, lookup({ a: APPROVE }))
    expect(windows).toEqual([
      { kind: 'serial', index: 0 },
      { kind: 'serial', index: 1 }
    ])
  })

  it('serializes unknown tools (no descriptor → MCP, plugin, or stale tool name)', () => {
    const calls = [call('r'), call('unknown'), call('r')]
    const windows = partitionToolCallWindows(calls, lookup({ r: READ }))
    expect(windows).toEqual([
      { kind: 'serial', index: 0 },
      { kind: 'serial', index: 1 },
      { kind: 'serial', index: 2 }
    ])
  })
})
