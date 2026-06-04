import { toolRegistry } from './tool-registry'
import { executeReadFile, type ReadFileArgs } from './read-file-tool'

toolRegistry.registerNative(
  {
    id: 'read_file',
    name: 'read_file',
    title: 'Read file',
    description:
      "Read a file from the workspace by path. Returns content prefixed with 1-based line numbers (cat -n format). Default returns the first 2000 lines; pass `offset` (1-based start line) and `limit` to paginate. For PDFs, pass `pages` (e.g. \"1\", \"1-5\", \"1,3,5\") — up to 20 pages per call. Soft cap 256 KB per returned window, hard cap 2 MB file size; large files should be discovered via grep_workspace first, then read with a tight offset/limit. Faster and structured-output than shell_command cat/Get-Content, and skips the shell approval prompt.",
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Workspace-relative or absolute path. Must resolve inside the active workspace root; ".." traversal is rejected.'
        },
        offset: {
          type: 'number',
          description:
            'Optional 1-based starting line for text files. Default 1.'
        },
        limit: {
          type: 'number',
          description:
            'Optional max lines for text files. Default 2000. Tighten if the returned window would exceed the 256 KB soft cap.'
        },
        pages: {
          type: 'string',
          description:
            'PDF only. Page range or list: "1", "1-5", "1,3,5", "2,4-7". Max 20 pages per call. Omit to get the first 20 pages.'
        }
      },
      required: ['path']
    },
    risks: ['read'],
    requiresApproval: false,
    enabled: true,
    parallelizable: true
  },
  async (args, ctx) => {
    try {
      const result = await executeReadFile(
        args as unknown as ReadFileArgs,
        ctx.workspacePath ?? process.cwd()
      )
      return { result: result.content, status: 'done' }
    } catch (err) {
      return {
        result: `read_file error: ${(err as Error)?.message ?? String(err)}`,
        status: 'error'
      }
    }
  }
)
