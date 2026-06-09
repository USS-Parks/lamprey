// HY3 — `read_tool_result` native tool. Reads a character range of a large
// tool result that was spilled to disk and elided from the model's context.
// Side-effect registration, loaded by tool-packs.ts.

import { toolRegistry } from './tool-registry'
import { readSpilledResult } from './tool-result-spill'

toolRegistry.registerNative(
  {
    id: 'read_tool_result',
    name: 'read_tool_result',
    title: 'Read elided tool result',
    description:
      'Read a character range of a large tool result that was elided from context. When a ' +
      'tool result is too big it is replaced with a head+tail preview plus a "[… elided … ' +
      'read_tool_result(ref=…) …]" marker; pass that ref here to page through the full text. ' +
      'Omit start/end to read from the beginning.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: 'The ref id from the elision marker in a spilled tool result.'
        },
        start: {
          type: 'number',
          description: 'Start character offset (default 0).'
        },
        end: {
          type: 'number',
          description: 'End character offset (default start + 8192).'
        }
      },
      required: ['ref'],
      additionalProperties: false
    },
    risks: ['read'],
    requiresApproval: false,
    enabled: true,
    parallelizable: true
  },
  async (args) =>
    readSpilledResult(
      String((args as { ref?: unknown }).ref ?? ''),
      (args as { start?: number }).start ?? 0,
      (args as { end?: number }).end
    )
)
