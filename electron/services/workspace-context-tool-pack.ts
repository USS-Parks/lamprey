import { toolRegistry } from './tool-registry'
import {
  executeWorkspaceContext,
  type WorkspaceContextArgs
} from './workspace-context-tool'

toolRegistry.registerNative(
  {
    id: 'workspace_context',
    name: 'workspace_context',
    title: 'Workspace context',
    description:
      'Codex-style workspace preflight. Returns a JSON summary of the active workspace: cwd, git branch + ahead/behind + a capped list of changed files, package.json name/version/scripts (when present), detected frameworks, key instruction files (AGENTS.md, CLAUDE.md, README.md, CONTRIBUTING.md), and likely verification commands inferred from scripts and root tsconfigs. Prefer calling this once at the start of a coding task instead of running four separate reads. Output is read-only, size-capped (default 8 KB, max 32 KB via cap_bytes).',
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
        cap_bytes: {
          type: 'number',
          description: 'Optional output size cap in bytes. Default 8192, max 32768.'
        }
      }
    },
    risks: ['read'],
    requiresApproval: false,
    enabled: true
  },
  async (args, ctx) =>
    executeWorkspaceContext(
      args as unknown as WorkspaceContextArgs,
      ctx.workspacePath ?? process.cwd()
    )
)
