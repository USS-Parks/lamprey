import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import { mcpManager } from './mcp-manager'
import {
  getToolCall,
  insertToolCall,
  listRecentToolCalls,
  listToolCallsForConversation,
  updateToolCall
} from './tool-calls-store'
import {
  executeShellCommand,
  formatShellResultForModel,
  type ShellArgs
} from './shell-tool'
import type { AuditStatus } from './tool-result-status'

// Types are duplicated between main and renderer the same way mcp-manager.ts
// keeps its own McpTool/McpServerConfig — the two tsconfig roots can't reach
// across the boundary, and the IPC payload is structurally typed anyway.
// Renderer-side mirror lives in src/lib/types.ts.

export type ToolProviderKind = 'native' | 'mcp' | 'plugin'

export type ToolRisk = 'read' | 'write' | 'network' | 'destructive' | 'secret'

export interface LampreyToolDescriptor {
  id: string
  name: string
  title: string
  description: string
  providerKind: ToolProviderKind
  providerId: string
  inputSchema: unknown
  risks: ToolRisk[]
  requiresApproval: boolean
  enabled: boolean
}

export type LampreyToolCallStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'running'
  | 'done'
  | 'error'

export interface LampreyToolCall {
  id: string
  toolId: string
  name: string
  conversationId?: string
  args: Record<string, unknown>
  startedAt: number
  finishedAt?: number
  status: LampreyToolCallStatus
  result?: string
  error?: string
  durationMs?: number
  /** Provenance of the approval gate: 'modal' | 'policy:<id>' | 'none'. */
  approvalSource?: string
}

export interface ToolExecutionContext {
  conversationId?: string
  /** Active workspace root for this call. Workspace-relative native tools
   *  (shell_command, apply_patch, workspace_context, view_image, image
   *  generation) anchor cwd to this path. Falls back to process.cwd()
   *  inside each handler when absent. */
  workspacePath?: string
}

/**
 * Native tool handler return shape. A handler may return either:
 *   - a plain string — the model-facing result. Status is inferred by the
 *     legacy classifier (typed errors get caught by chat.ts as 'error').
 *   - a `{ result, status }` envelope — the handler explicitly tags the
 *     outcome. Preferred for any handler where success/failure is not
 *     trivially decidable from the string body (shell exit codes, partial
 *     successes, user-denied operations the handler bubbles back).
 *
 * Validation failures should be thrown — chat.ts wraps the message in an
 * "Error:" prefix and records the call as 'error'.
 */
export type NativeToolHandlerResult =
  | string
  | { result: string; status: AuditStatus }

export type NativeToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
) => Promise<NativeToolHandlerResult>

// The unified tool registry has three sources: native Lamprey tools (added
// in code at startup), MCP server tools (live from mcpManager.getAllTools()),
// and plugin tools (not yet wired). chat.ts calls getOpenAITools() to build
// the tool list passed to the model, and dispatches results back through the
// registry so the call lifecycle is recorded by tool-calls-store.

// Chrome MCP destructive tools get requiresApproval marked at descriptor
// build time. A future generalised network/destructive policy will subsume
// this; for now the set is hard-coded.
const CHROME_DESTRUCTIVE = new Set([
  'click',
  'fill',
  'submit',
  'type',
  'press',
  'select_option'
])

class ToolRegistry {
  private natives = new Map<string, LampreyToolDescriptor>()
  private nativeHandlers = new Map<string, NativeToolHandler>()

  registerNative(descriptor: LampreyToolDescriptor, handler?: NativeToolHandler): void {
    if (descriptor.providerKind !== 'native') {
      throw new Error(
        `registerNative: refusing to register descriptor with providerKind="${descriptor.providerKind}"`
      )
    }
    this.natives.set(descriptor.id, descriptor)
    if (handler) this.nativeHandlers.set(descriptor.id, handler)
  }

  hasHandler(toolId: string): boolean {
    return this.nativeHandlers.has(toolId)
  }

  async executeNative(
    toolId: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext
  ): Promise<NativeToolHandlerResult> {
    const handler = this.nativeHandlers.get(toolId)
    if (!handler) throw new Error(`No handler registered for native tool: ${toolId}`)
    return await handler(args, ctx)
  }

  /**
   * Currently visible descriptors, in stable order:
   *   natives (insertion order) → MCP (server id, then tool name).
   */
  getDescriptors(): LampreyToolDescriptor[] {
    const list: LampreyToolDescriptor[] = []

    for (const d of this.natives.values()) {
      if (d.enabled) list.push(d)
    }

    const mcpGroups = mcpManager.getAllTools()
    for (const { serverId, tools } of mcpGroups) {
      for (const tool of tools) {
        const id = `${serverId}__${tool.name}`
        const isDestructive =
          serverId === 'chrome' && CHROME_DESTRUCTIVE.has(tool.name)
        const risks: ToolRisk[] = isDestructive
          ? ['destructive', 'write', 'network']
          : ['network']
        list.push({
          id,
          name: id,
          title: tool.name,
          description: tool.description || '',
          providerKind: 'mcp',
          providerId: serverId,
          inputSchema:
            (tool.inputSchema as unknown) || { type: 'object', properties: {} },
          risks,
          requiresApproval: isDestructive,
          enabled: true
        })
      }
    }

    return list
  }

  getById(id: string): LampreyToolDescriptor | undefined {
    const native = this.natives.get(id)
    if (native) return native
    return this.getDescriptors().find((d) => d.id === id)
  }

  /**
   * OpenAI Chat Completions-compatible tool array, built from the current
   * descriptor set. Tool names match descriptor ids so chat.ts can route
   * results by exact match.
   */
  getOpenAITools(): ChatCompletionTool[] {
    return this.getDescriptors().map((d) => ({
      type: 'function' as const,
      function: {
        name: d.name,
        description: d.description,
        parameters:
          (d.inputSchema as Record<string, unknown>) ||
          { type: 'object', properties: {} }
      }
    }))
  }

  recordCallStart(call: Omit<LampreyToolCall, 'finishedAt' | 'durationMs'>): void {
    try {
      insertToolCall({ ...call })
    } catch (err) {
      console.error('[tool-registry] recordCallStart persist failed:', err)
    }
  }

  recordCallEnd(
    callId: string,
    patch: {
      status: LampreyToolCallStatus
      result?: string
      error?: string
      finishedAt?: number
      approvalSource?: string
    }
  ): void {
    const finishedAt = patch.finishedAt ?? Date.now()
    try {
      const existing = getToolCall(callId)
      const startedAt = existing?.startedAt
      const durationMs =
        startedAt !== undefined ? Math.max(0, finishedAt - startedAt) : undefined
      updateToolCall(callId, {
        status: patch.status,
        result: patch.result,
        error: patch.error,
        finishedAt,
        durationMs,
        approvalSource: patch.approvalSource
      })
    } catch (err) {
      console.error('[tool-registry] recordCallEnd persist failed:', err)
    }
  }

  getRecentCalls(limit?: number): LampreyToolCall[] {
    try {
      return listRecentToolCalls(limit)
    } catch (err) {
      console.error('[tool-registry] getRecentCalls failed:', err)
      return []
    }
  }

  getCallsForConversation(conversationId: string, limit?: number): LampreyToolCall[] {
    try {
      return listToolCallsForConversation(conversationId, limit)
    } catch (err) {
      console.error('[tool-registry] getCallsForConversation failed:', err)
      return []
    }
  }
}

export const toolRegistry = new ToolRegistry()

// memory_add execution stays inline in chat.ts because the handler needs to
// broadcast `memory:added` to the renderer; only its descriptor lives here.
toolRegistry.registerNative({
  id: 'memory_add',
  name: 'memory_add',
  title: 'Memory: Add',
  description: 'Save a fact about the user to persistent memory.',
  providerKind: 'native',
  providerId: 'internal',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The fact to remember' }
    },
    required: ['content']
  },
  risks: ['write'],
  requiresApproval: false,
  enabled: true
})

// shell_command — PowerShell on Windows, bash elsewhere. The workspace
// boundary is also enforced inside the handler so a missing approval gate
// cannot escape the tree (defense in depth).
toolRegistry.registerNative(
  {
    id: 'shell_command',
    name: 'shell_command',
    title: 'Shell command',
    description:
      'Run a one-shot shell command inside the Lamprey workspace. PowerShell on Windows, bash on macOS/Linux. Returns exit code, stdout (≤30 KB), stderr (≤30 KB), and duration. Default timeout 30s (max 600s). cwd defaults to the workspace root and must stay within it.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command line to execute. Passed verbatim to the platform shell.'
        },
        cwd: {
          type: 'string',
          description:
            'Optional working directory. Absolute paths must resolve inside the workspace root; relative paths resolve against it.'
        },
        timeout_ms: {
          type: 'number',
          description: 'Optional timeout in milliseconds. Default 30000, ceiling 600000.'
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Optional environment-variable overlay merged on top of the inherited process env.'
        }
      },
      required: ['command']
    },
    risks: ['write', 'network', 'destructive'],
    requiresApproval: true,
    enabled: true
  },
  async (args, ctx) => {
    const workspaceRoot = ctx.workspacePath ?? process.cwd()
    const r = await executeShellCommand(args as unknown as ShellArgs, workspaceRoot)
    const result = formatShellResultForModel(r)
    // A spawn-time failure (no exit code) and any non-zero exit are
    // failures even though the body still renders normally — return the
    // explicit status so the audit log and the UI badge match reality.
    const failed = r.error !== undefined || (r.exitCode !== null && r.exitCode !== 0) || r.timedOut
    return { result, status: failed ? 'error' : 'done' }
  }
)

// Tool packs are loaded by electron/services/tool-packs.ts (imported from
// electron/ipc/index.ts), not from this file. Side-effect imports at the
// bottom of a module are not safe — bundlers can hoist them above
// `new ToolRegistry()` and trip a TDZ ReferenceError at startup.
