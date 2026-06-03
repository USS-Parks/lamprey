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
  boundedJsonPreview,
  recordEvent,
  type EventActorKind,
  type EventType
} from './event-log'
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
  /**
   * When true, the chat dispatcher may run this call concurrently with other
   * parallelizable calls in the same model turn. Default false. Even when
   * true, the dispatcher refuses to parallelize if the descriptor also
   * requires approval or carries any of `write` / `destructive` / `secret`
   * risks — see `isParallelizableDescriptor` below for the authoritative
   * predicate. Set this on read-only tools (workspace_context, view_image,
   * web_search, etc.); leave it off for state-mutating tools even when they
   * don't gate (memory_add, update_plan).
   */
  parallelizable?: boolean
  /**
   * When true, the chat dispatcher never routes this call through the approval
   * service — the tool's own handler IS the approval gate. Only `request_permissions`
   * sets this: its handler prompts the user for a scope, so gating it again at
   * dispatch time would double-prompt (and a global "deny secret" policy would
   * otherwise lock the user out of ever requesting a permission). The descriptor
   * keeps its `risks` (e.g. `secret`) so the UI still surfaces the escalation
   * badge; this flag only suppresses the dispatch-time modal.
   */
  selfApproves?: boolean
}

/**
 * Returns true when a tool call may run concurrently with other tool calls
 * in the same model turn. Conservative — every condition must hold:
 *   1. Descriptor has opted in via `parallelizable: true`.
 *   2. Descriptor does not require an approval modal (modal races between
 *      sibling calls would let the user accidentally co-sign two prompts).
 *   3. None of the call's risks include `write`, `destructive`, or `secret`
 *      (state-mutating or escalation-class calls keep linear ordering).
 *
 * `network` and `read` risks are fine — fan-out web searches and parallel
 * reads are the primary motivating cases.
 */
export function isParallelizableDescriptor(
  descriptor: LampreyToolDescriptor | undefined
): boolean {
  if (!descriptor) return false
  if (descriptor.parallelizable !== true) return false
  if (descriptor.requiresApproval) return false
  for (const r of descriptor.risks) {
    if (r === 'write' || r === 'destructive' || r === 'secret') return false
  }
  return true
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
  /** Parent call id when this row was spawned from another tool (e.g. a
   *  sub-agent call inside `multi_agent_run`). Null/undefined for top-level
   *  model-initiated calls. */
  parentCallId?: string
}

/**
 * Did this tool-call deny come from the tool itself rather than from the
 * permissions gate? When true, recordCallEnd emits a `tool.call.denied` event
 * (no other producer covered it); when false, the permissions service already
 * recorded the decision and we skip the event to avoid duplicates.
 *
 *   'modal' / 'policy:*' / 'auto-deny-timeout' / 'no-window' → gate emitted; skip.
 *   undefined / 'none' / 'self'                              → self-deny; emit.
 */
export function isSelfDenialSource(source: string | undefined): boolean {
  if (!source) return true
  if (source === 'none' || source === 'self') return true
  return false
}

export interface ToolExecutionContext {
  conversationId?: string
  /** Active workspace root for this call. Workspace-relative native tools
   *  (shell_command, apply_patch, workspace_context, view_image, image
   *  generation) anchor cwd to this path. Falls back to process.cwd()
   *  inside each handler when absent. */
  workspacePath?: string
  /** Currently-active chat model id. The single-model sub-agent primitive
   *  (`multi_agent_run`) fans this model into role-prompted sub-tasks; the
   *  rest of the native tools can ignore it. */
  model?: string
  /** Abort signal for cancellation. Handlers that spawn LLM sub-calls or
   *  long-running work must propagate it so chat:cancel reaches them. */
  signal?: AbortSignal
  /** The tool_call id of the in-flight invocation. Native handlers that
   *  spawn synthetic child audit rows (e.g. `multi_agent_run` writing one
   *  row per sub-agent) use this as the children's `parentCallId`. Empty
   *  for inline calls that don't carry one. */
  callId?: string
  /** Chat-turn correlation id (from chat:send). Native handlers that emit
   *  their own audit/event rows (multi_agent_run, future retrieval) pass
   *  it through so the timeline groups everything from one run. */
  correlationId?: string
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

  recordCallStart(
    call: Omit<LampreyToolCall, 'finishedAt' | 'durationMs'>,
    correlationId?: string
  ): void {
    try {
      insertToolCall({ ...call })
    } catch (err) {
      console.error('[tool-registry] recordCallStart persist failed:', err)
    }
    // Mirror the lifecycle into the event spine. The structured tool_calls row
    // is the authoritative record; the event row is the cross-system timeline
    // entry so chat/approval/automation context can be reconstructed in order.
    // Failures here must never fail the call — event-log has its own fallback.
    try {
      const descriptor = this.getById(call.toolId)
      recordEvent({
        type: 'tool.call.started',
        actorKind: 'model',
        conversationId: call.conversationId,
        correlationId,
        toolCallId: call.id,
        entityKind: 'tool',
        entityId: call.toolId,
        payload: {
          toolId: call.toolId,
          name: call.name,
          providerKind: descriptor?.providerKind,
          providerId: descriptor?.providerId,
          risks: descriptor?.risks,
          requiresApproval: descriptor?.requiresApproval,
          startedAt: call.startedAt,
          argsPreview: boundedJsonPreview(call.args),
          parentCallId: call.parentCallId
        }
      })
    } catch (err) {
      console.error('[tool-registry] tool.call.started event failed:', err)
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
      parentCallId?: string
      /**
       * Audit-only: chat-turn correlation id threaded through from chat:send.
       * Not persisted to `tool_calls` — it just rides into the terminal event
       * row so the timeline reader can group everything from one run.
       */
      correlationId?: string
    }
  ): void {
    const finishedAt = patch.finishedAt ?? Date.now()
    let durationMs: number | undefined
    let conversationId: string | undefined
    let toolId: string | undefined
    try {
      const existing = getToolCall(callId)
      const startedAt = existing?.startedAt
      durationMs = startedAt !== undefined ? Math.max(0, finishedAt - startedAt) : undefined
      conversationId = existing?.conversationId
      toolId = existing?.toolId
      updateToolCall(callId, {
        status: patch.status,
        result: patch.result,
        error: patch.error,
        finishedAt,
        durationMs,
        approvalSource: patch.approvalSource,
        parentCallId: patch.parentCallId
      })
    } catch (err) {
      console.error('[tool-registry] recordCallEnd persist failed:', err)
    }
    // Lifecycle terminal event. Map status → event type:
    //   done   → tool.call.completed
    //   error  → tool.call.failed
    //   denied → tool.call.denied, but ONLY when the deny did NOT come from
    //            the permissions gate (it owns those events). approvalSource
    //            values 'modal' / 'policy:*' / 'auto-deny-timeout' / 'no-window'
    //            mean the gate already emitted; 'none' / 'self' / undefined
    //            mean the tool denied itself and we should record it here.
    // pending / approved / running are intermediate transitions — no event.
    try {
      const lifecycleType: EventType | null =
        patch.status === 'done'
          ? 'tool.call.completed'
          : patch.status === 'error'
          ? 'tool.call.failed'
          : patch.status === 'denied' && isSelfDenialSource(patch.approvalSource)
          ? 'tool.call.denied'
          : null
      if (lifecycleType) {
        const actorKind: EventActorKind =
          lifecycleType === 'tool.call.failed' ? 'tool' : 'tool'
        recordEvent({
          type: lifecycleType,
          actorKind,
          severity:
            lifecycleType === 'tool.call.failed'
              ? 'error'
              : lifecycleType === 'tool.call.denied'
              ? 'warning'
              : 'info',
          conversationId,
          correlationId: patch.correlationId,
          toolCallId: callId,
          entityKind: 'tool',
          entityId: toolId,
          payload: {
            status: patch.status,
            durationMs,
            finishedAt,
            approvalSource: patch.approvalSource ?? 'none',
            resultPreview: boundedJsonPreview(patch.result),
            errorPreview: boundedJsonPreview(patch.error)
          }
        })
      }
    } catch (err) {
      console.error('[tool-registry] tool.call lifecycle event failed:', err)
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
    risks: ['write', 'network'],
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
