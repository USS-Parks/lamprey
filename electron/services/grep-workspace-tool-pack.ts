import { toolRegistry } from './tool-registry'
import { executeGrep, formatGrepResult, type GrepArgs } from './grep-workspace-tool'

toolRegistry.registerNative(
  {
    id: 'grep_workspace',
    name: 'grep_workspace',
    title: 'Grep workspace',
    description:
      "Search the workspace with a bundled ripgrep — fast, structured, no shell approval. Returns matches as `<path>:<line>:<text>` (content mode), one path per line (files_with_matches), or `<path>:<count>` (count). Filter by `glob` (e.g. \"*.ts\") or `type` (e.g. \"ts\", \"py\", \"rust\"). Respects .gitignore by default. Use `head_limit` to cap results (default 250). Prefer this over `shell_command grep` for any workspace search — same regex syntax, no approval prompt, structured output the model can parse directly.",
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description:
            'Regular expression. ripgrep regex flavor — literal braces need escaping (e.g. `interface\\{\\}` for `interface{}` in Go).'
        },
        path: {
          type: 'string',
          description:
            'Optional workspace-relative subdirectory to limit the search. Defaults to the workspace root.'
        },
        glob: {
          type: 'string',
          description:
            'Optional glob filter (e.g. "*.ts", "*.{ts,tsx}", "!*.test.ts"). Maps to rg --glob.'
        },
        type: {
          type: 'string',
          description:
            'Optional file-type filter using ripgrep\'s built-in registry (e.g. "ts", "py", "rust", "go"). More efficient than glob for standard languages.'
        },
        output_mode: {
          type: 'string',
          enum: ['content', 'files_with_matches', 'count'],
          description:
            'content → "<path>:<line>:<text>". files_with_matches → one path per line (default). count → "<path>:<n>".'
        },
        head_limit: {
          type: 'number',
          description:
            'Max results returned. Default 250, ceiling 5000. Output is also byte-capped at 250 KB regardless.'
        },
        case_insensitive: {
          type: 'boolean',
          description: 'Case-insensitive match. Maps to rg -i.'
        },
        line_numbers: {
          type: 'boolean',
          description:
            'Include line numbers in content mode (default true — the format already includes :<line>:).'
        },
        context_before: {
          type: 'number',
          description: 'Lines of context before each match. Content mode only.'
        },
        context_after: {
          type: 'number',
          description: 'Lines of context after each match. Content mode only.'
        },
        context: {
          type: 'number',
          description: 'Symmetric context (overrides before/after). Content mode only.'
        },
        multiline: {
          type: 'boolean',
          description:
            'Enable multiline mode where `.` matches newlines and patterns can span lines.'
        },
        include_hidden: {
          type: 'boolean',
          description: 'Search hidden files. Default false.'
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
      const result = await executeGrep(
        args as unknown as GrepArgs,
        ctx.workspacePath ?? process.cwd()
      )
      return { result: formatGrepResult(result), status: 'done' }
    } catch (err) {
      return {
        result: `grep_workspace error: ${(err as Error)?.message ?? String(err)}`,
        status: 'error'
      }
    }
  }
)
