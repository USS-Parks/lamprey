import { toolRegistry } from './tool-registry'
import { executeApplyPatch, type ApplyPatchArgs } from './apply-patch-tool'

toolRegistry.registerNative(
  {
    id: 'apply_patch',
    name: 'apply_patch',
    title: 'Apply patch',
    description:
      'Apply a Codex-style patch envelope to the workspace. Supports add, update, and delete file directives. The patch payload must start with "*** Begin Patch" and end with "*** End Patch"; each file block is "*** Add File: <path>" (body lines start with "+"), "*** Update File: <path>" (optional "@@ <context>", then "+"/"-"/" " body lines per hunk), or "*** Delete File: <path>" (no body). All paths must resolve inside the workspace root. Returns a per-file summary or an error explaining why the patch was rejected.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        patch: {
          type: 'string',
          description:
            'The full patch envelope including "*** Begin Patch" header and "*** End Patch" footer.'
        }
      },
      required: ['patch']
    },
    risks: ['write', 'destructive'],
    requiresApproval: true,
    enabled: true
  },
  async (args) => {
    const workspaceRoot = process.cwd()
    const { result } = await executeApplyPatch(
      args as unknown as ApplyPatchArgs,
      workspaceRoot
    )
    return result
  }
)
