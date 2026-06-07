import { toolRegistry } from './tool-registry'
import {
  executeVerifyWorkspace,
  type VerifyWorkspaceArgs
} from './verify-workspace-tool'

toolRegistry.registerNative(
  {
    id: 'verify_workspace',
    name: 'verify_workspace',
    title: 'Verify workspace',
    description:
      'Run the workspace verification checks inferred from package scripts and tsconfig files. Defaults to non-mutating checks such as test, typecheck, lint, check, and verify; format scripts are skipped unless include_format=true. Use after code edits before final response. Persists proof receipts for passed, failed, and skipped commands. Returns a JSON report with per-command status, proof receipt ids, parsed metrics, output previews, and total duration.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description:
            'Optional working directory. Absolute paths must resolve inside the workspace root; relative paths resolve against it. Defaults to the workspace root.'
        },
        commands: {
          type: 'array',
          description:
            'Optional subset of inferred verification commands to run. Each command must exactly match one of workspace_context.verificationCommands.',
          items: { type: 'string' }
        },
        timeout_ms: {
          type: 'number',
          description: 'Optional per-command timeout in milliseconds. Default 120000, ceiling 600000.'
        },
        max_commands: {
          type: 'number',
          description: 'Maximum number of selected commands to run. Default 6, ceiling 8.'
        },
        include_format: {
          type: 'boolean',
          description:
            'When true, include inferred format scripts. Defaults to false because format commands can rewrite files.'
        }
      }
    },
    // Inferred package scripts are still arbitrary process execution. Even
    // when selected conservatively, tests/checks can mutate files or hit the
    // network, so policy matching mirrors shell_command rather than treating
    // this as a narrow write.
    risks: ['write', 'network'],
    requiresApproval: true,
    enabled: true
  },
  async (args, ctx) =>
    executeVerifyWorkspace(
      args as unknown as VerifyWorkspaceArgs,
      ctx.workspacePath ?? process.cwd(),
      undefined,
      {
        conversationId: ctx.conversationId,
        correlationId: ctx.correlationId,
        toolCallId: ctx.callId,
        createdBy: 'agent'
      }
    )
)
