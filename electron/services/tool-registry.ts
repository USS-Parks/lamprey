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
import {
  computeToolTags,
  parseSelectQuery,
  searchDescriptors as searchDescriptorsByQuery
} from './tool-search'

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
  /**
   * Derived tag list computed from `providerKind`, `risks`, `requiresApproval`,
   * `parallelizable`, `lazy`, and `mutates`. Used by `tools:search` for
   * keyword ranking and by the renderer for filter chips. See
   * `tool-search.ts` for the taxonomy. Always populated on the registry's
   * output (`getDescriptors`, `getStubs`, `getById`) — registration sites
   * may omit it via `LampreyToolRegistration`.
   */
  tags: string[]
  /**
   * True when the input schema is sourced from an external provider (MCP
   * server, future plugin host) rather than statically defined in code.
   * The schema is still embedded on this descriptor in main; `lazy` is a
   * hint that `tools:list` may omit the schema from its IPC payload and
   * clients should call `tools:resolve` / `tools:search` to get the full
   * `inputSchema`. Native tools default to `false`; MCP tools default to
   * `true`.
   */
  lazy: boolean
  /**
   * Track 2 / C3 — true when invoking this tool may mutate the workspace,
   * external systems, or persistent state. The chat dispatcher refuses
   * mutating tools when a conversation is in plan mode (the model can
   * still read freely). Defaults to `risks.includes('write') ||
   * risks.includes('destructive')` when not set explicitly. The
   * `enter_plan_mode` / `exit_plan_mode` tools opt out (`mutates: false`)
   * so the model can always flip the gate; they mutate session state but
   * not the workspace.
   */
  mutates: boolean
}

/**
 * Stub shape returned by `tools:list`. Identical to `LampreyToolDescriptor`
 * minus `inputSchema`. The renderer holds stubs by default and pulls full
 * descriptors via `tools:resolve(names[])` or `tools:search({ query })` —
 * a 100-tool MCP catalog shrinks its IPC payload from ~50KB to ~5KB this way.
 */
export type LampreyToolStub = Omit<LampreyToolDescriptor, 'inputSchema'>

/**
 * Registration input shape. `tags`, `lazy`, and `mutates` are optional here
 * so existing registration sites do not need to repeat the derived fields;
 * the registry normalizes them on insert. Every other field stays required
 * as before.
 */
export type LampreyToolRegistration =
  Omit<LampreyToolDescriptor, 'tags' | 'lazy' | 'mutates'> & {
    tags?: string[]
    lazy?: boolean
    mutates?: boolean
  }

/**
 * Track 2 / C3 — true when invoking the tool may mutate the workspace,
 * external systems, or persistent state. Honoured by the chat dispatcher's
 * plan-mode gate. The `mutates` field is the authoritative answer; the
 * function exists for callers that want to derive intent from an arbitrary
 * descriptor shape (e.g. tests, future plugin scaffolds).
 */
export function isMutatingDescriptor(
  descriptor: LampreyToolDescriptor | undefined
): boolean {
  if (!descriptor) return false
  return descriptor.mutates === true
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

  registerNative(
    input: LampreyToolRegistration,
    handler?: NativeToolHandler
  ): void {
    if (input.providerKind !== 'native') {
      throw new Error(
        `registerNative: refusing to register descriptor with providerKind="${input.providerKind}"`
      )
    }
    // Normalize derived fields (tags, lazy, mutates) at insert time so
    // reads never need to recompute them. Native tools default to
    // lazy: false — their schemas are inlined at registration. `mutates`
    // defaults to risks-includes-write-or-destructive; callers can
    // override (e.g. enter_plan_mode mutates session state but not the
    // workspace, so it ships mutates: false).
    const lazy = input.lazy ?? false
    const mutates =
      input.mutates ??
      input.risks.some((r) => r === 'write' || r === 'destructive')
    const tags =
      input.tags ??
      computeToolTags({
        providerKind: input.providerKind,
        risks: input.risks,
        requiresApproval: input.requiresApproval,
        parallelizable: input.parallelizable,
        lazy,
        mutates
      })
    const descriptor: LampreyToolDescriptor = { ...input, tags, lazy, mutates }
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
   *
   * Each descriptor carries the full `inputSchema`. For the renderer-facing
   * stub list (no schemas), see `getStubs()`. Chat dispatch always uses
   * `getDescriptors()` / `getOpenAITools()` so the model still receives
   * every tool's schema.
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
        const lazy = true
        // C3 — MCP tools opt in to plan-mode gating by default when their
        // risks include write/destructive. Chrome's destructive set
        // (click/fill/submit/type/press/select_option) thus mutates: true;
        // every other MCP read tool stays unmuted.
        const mutates =
          risks.some((r) => r === 'write' || r === 'destructive')
        const tags = computeToolTags({
          providerKind: 'mcp',
          risks,
          requiresApproval: isDestructive,
          parallelizable: false,
          lazy,
          mutates
        })
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
          enabled: true,
          tags,
          lazy,
          mutates
        })
      }
    }

    return list
  }

  /**
   * Renderer-facing stub list. Identical to `getDescriptors()` minus the
   * `inputSchema` field. Backs `tools:list`. Use `resolveByName()` or
   * `search()` to expand stubs to full descriptors.
   */
  getStubs(): LampreyToolStub[] {
    return this.getDescriptors().map((d) => {
      // Strip inputSchema cleanly so renderer-side JSON.stringify doesn't
      // accidentally include `undefined` properties.
      const {
        inputSchema: _omit,
        ...stub
      } = d
      void _omit
      return stub
    })
  }

  /**
   * Resolve one or more tool names to their full descriptors. Names that
   * don't match are silently dropped — the renderer should compare the
   * returned list against its request to detect missing tools. Order
   * follows the input.
   */
  resolveByName(names: string[]): LampreyToolDescriptor[] {
    if (!Array.isArray(names) || names.length === 0) return []
    const all = this.getDescriptors()
    const byName = new Map(all.map((d) => [d.name, d]))
    const out: LampreyToolDescriptor[] = []
    for (const n of names) {
      const d = byName.get(n)
      if (d) out.push(d)
    }
    return out
  }

  /**
   * Two-mode search backing `tools:search`. `select:<names>` returns the
   * named tools in order (alias for `resolveByName`). Anything else is
   * keyword-scored across name / tags / description with weights 3 / 2 / 1.
   * See `tool-search.ts` for the scoring details.
   */
  search(query: string, maxResults = 10): LampreyToolDescriptor[] {
    const select = parseSelectQuery(query)
    if (select) return this.resolveByName(select)
    return searchDescriptorsByQuery(this.getDescriptors(), query, maxResults)
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

// Track 2 / C3 — plan-mode toggles. These tools flip a per-conversation
// boolean (conversations.plan_mode_active) that the chat dispatcher
// consults before approving any mutating tool. Their handlers live inline
// because they need to emit a `plan:mode-changed` event to the renderer —
// the same pattern memory_add uses for `memory:added`. Mutates is
// explicitly false: the flag belongs to session state, not workspace
// state, and the model must always be able to flip it off.
toolRegistry.registerNative({
  id: 'enter_plan_mode',
  name: 'enter_plan_mode',
  title: 'Plan mode: enter',
  description:
    'Enter plan mode for the current conversation. While plan mode is active, the dispatcher refuses any tool that mutates the workspace, external systems, or persistent state — only read-only tools run. Use this when the user wants you to think and plan before any changes. The model or the user can exit via `exit_plan_mode` or the banner button.',
  providerKind: 'native',
  providerId: 'internal',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  },
  risks: [],
  requiresApproval: false,
  enabled: true,
  mutates: false
})

toolRegistry.registerNative({
  id: 'exit_plan_mode',
  name: 'exit_plan_mode',
  title: 'Plan mode: exit',
  description:
    'Exit plan mode for the current conversation. Mutating tools (apply_patch, shell_command, destructive MCP tools) are once again allowed. Use after agreement is reached on the plan and you are ready to execute.',
  providerKind: 'native',
  providerId: 'internal',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  },
  risks: [],
  requiresApproval: false,
  enabled: true,
  mutates: false
})

// Track 2 / E1 — mark_chapter. Anchors a chapter title (and optional
// short summary) to the message the model has just produced or the user
// has just submitted. The renderer's chapter sidebar (E2) uses these to
// build a TOC; long sessions get navigable without scrolling. Mutates
// is false: the row is purely organizational, no workspace effect.
toolRegistry.registerNative({
  id: 'mark_chapter',
  name: 'mark_chapter',
  title: 'Mark a session chapter',
  description:
    "Mark the start of a new chapter in this session. Use when the work shifts to a meaningfully different phase — e.g. after finishing exploration and starting implementation, after a fix lands and you move to verification, or when the user pivots to an unrelated request. The user sees a divider in the transcript and a floating table of contents for jumping between chapters. Use sparingly: a chapter should cover a coherent stretch of work, not every tool call.",
  providerKind: 'native',
  providerId: 'internal',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description:
          'Short noun-phrase title for the chapter (under 40 chars). Shown in the table of contents. e.g. "Codebase exploration", "Auth bug fix", "Test verification".'
      },
      summary: {
        type: 'string',
        description:
          'Optional one-line summary of what this chapter covers. Shown on hover in the table of contents.'
      }
    },
    required: ['title'],
    additionalProperties: false
  },
  risks: [],
  requiresApproval: false,
  enabled: true,
  mutates: false
})

// Tool packs are loaded by electron/services/tool-packs.ts (imported from
// electron/ipc/index.ts), not from this file. Side-effect imports at the
// bottom of a module are not safe — bundlers can hoist them above
// `new ToolRegistry()` and trip a TDZ ReferenceError at startup.
