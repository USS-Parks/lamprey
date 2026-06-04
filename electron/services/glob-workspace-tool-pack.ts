import { toolRegistry } from './tool-registry'
import { executeGlob, formatGlobResult, type GlobArgs } from './glob-workspace-tool'

toolRegistry.registerNative(
  {
    id: 'glob_workspace',
    name: 'glob_workspace',
    title: 'Glob workspace',
    description:
      'List workspace files matching a glob pattern, sorted by modification time descending (most recently changed first). Supports `**` for recursive matching, `{a,b}` for alternation, `!` for negation. Respects .gitignore by default. Returns up to 1000 paths. Use this to discover files before reading them — much faster than walking the tree manually, and skips noise (node_modules, .git, dist) automatically.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description:
            'Glob pattern. Examples: "**/*.ts", "src/**/*.{ts,tsx}", "*.json", "tests/**/*.test.*".'
        },
        path: {
          type: 'string',
          description:
            'Optional workspace-relative subdirectory to scope the search. Defaults to the workspace root.'
        },
        case_sensitive: {
          type: 'boolean',
          description: 'Case-sensitive matching. Default false (ripgrep default for --files).'
        },
        include_hidden: {
          type: 'boolean',
          description: 'Include hidden files. Default false.'
        },
        no_ignore: {
          type: 'boolean',
          description:
            'Skip .gitignore / .rgignore filtering. Default false (respect ignore files).'
        }
      },
      required: ['pattern']
    },
    risks: ['read'],
    requiresApproval: false,
    enabled: true,
    parallelizable: true
  },
  async (args, ctx) => {
    try {
      const result = await executeGlob(
        args as unknown as GlobArgs,
        ctx.workspacePath ?? process.cwd()
      )
      return { result: formatGlobResult(result), status: 'done' }
    } catch (err) {
      return {
        result: `glob_workspace error: ${(err as Error)?.message ?? String(err)}`,
        status: 'error'
      }
    }
  }
)
