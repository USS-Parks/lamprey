import {
  isParallelizableDescriptor,
  type LampreyToolDescriptor
} from './tool-registry'

// Window-builder for the chat dispatcher: groups contiguous parallelizable
// tool calls into a single window while keeping non-parallel calls in their
// own serial windows so order-sensitive side effects stay in place.
// Pure module — accepts a descriptor lookup function so tests don't need a
// real registry.

export type ProviderToolCall = { id: string; function: { name: string; arguments: string } }

export type ToolCallWindow =
  | { kind: 'parallel'; indices: number[] }
  | { kind: 'serial'; index: number }

export type DescriptorLookup = (
  toolId: string
) => LampreyToolDescriptor | undefined

export function partitionToolCallWindows(
  toolCalls: ProviderToolCall[],
  lookup: DescriptorLookup
): ToolCallWindow[] {
  const windows: ToolCallWindow[] = []
  let current: { kind: 'parallel'; indices: number[] } | null = null
  for (let i = 0; i < toolCalls.length; i++) {
    const descriptor = lookup(toolCalls[i].function.name)
    if (isParallelizableDescriptor(descriptor)) {
      if (!current) {
        current = { kind: 'parallel', indices: [] }
        windows.push(current)
      }
      current.indices.push(i)
    } else {
      windows.push({ kind: 'serial', index: i })
      current = null
    }
  }
  // Collapse single-entry parallel windows to plain serial — the dispatcher
  // only pays the Promise.all overhead when real fan-out is on the table.
  return windows.map((w) =>
    w.kind === 'parallel' && w.indices.length === 1
      ? { kind: 'serial', index: w.indices[0] }
      : w
  )
}
