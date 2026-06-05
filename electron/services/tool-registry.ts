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
import {
  executeShellList,
  executeShellMonitor,
  executeShellOutput,
  executeShellStop,
  type ShellMonitorArgs,
  type ShellOutputArgs,
  type ShellStopArgs
} from './native-aux-tools'
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

export type ToolRisk =
  | 'read'
  | 'write'
  | 'network'
  | 'destructive'
  | 'secret'
  /**
   * S12 — a call carrying `'sandboxBypass'` is one that's running outside
   * the platform sandbox wrapper (`dangerously_disable_sandbox: true`).
   * It always re-prompts: no persisted "always allow" policy applies.
   * The permissions service treats this risk as a hard gate.
   */
  | 'sandboxBypass'

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
   * When true, the renderer must NOT render a ToolUseCard for invocations of
   * this tool. The tool's side effect IS its visible UI: `request_permissions`
   * pops the approval modal, `ask_user_question` pops the AskUser modal,
   * `mark_chapter` drops a chapter divider, and `enter_plan_mode` /
   * `exit_plan_mode` flip the plan-mode banner. Leaving a leftover tool-card
   * for each of these reads as transcript noise — every Codex / Claude Code
   * equivalent surfaces only the side effect. The IPC event still fires
   * (audit log, event timeline, telemetry stay intact); the renderer just
   * skips the card row in MessageList.
   */
  transcriptHidden?: boolean
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
 *   'modal' / 'policy:*' / 'no-window'  → gate emitted; skip.
 *   undefined / 'none' / 'self'         → self-deny; emit.
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
    //            values 'modal' / 'policy:*' / 'no-window' mean the gate
    //            already emitted; 'none' / 'self' / undefined mean the tool
    //            denied itself and we should record it here.
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
// cannot escape the tree (defense in depth). S3-S7 added platform sandbox
// wrapping (sandbox-exec / bwrap), a shell selector, persistent cwd, and
// an explicit bypass flag.
toolRegistry.registerNative(
  {
    id: 'shell_command',
    name: 'shell_command',
    title: 'Shell command',
    description: [
      'Run a one-shot shell command inside the Lamprey workspace.',
      '',
      'PLATFORM SHELL:',
      ' - Windows → PowerShell (powershell.exe) by default. Set `shell: "bash"` to use Git Bash / WSL when complex POSIX scripts are needed.',
      ' - macOS / Linux → $SHELL (or /bin/bash). Set `shell: "powershell"` to use `pwsh` (PowerShell Core) when installed.',
      '',
      'SANDBOXING (automatic, per-platform):',
      ' - macOS → sandbox-exec profile (deny default, workspace + tmpdir writable, network policy honoured).',
      ' - Linux → bubblewrap when available (read-only system mounts, workspace + tmpdir rw, --unshare-net for `deny`).',
      ' - Windows → no kernel sandbox; the call runs on the host. The result reports `Sandbox: none (windows host)`.',
      '',
      'PERSISTENT CWD: when this conversation is the caller, `cd <path>` / `Set-Location <path>` carries forward to the next shell_command call. Workspace boundary still applies — escapes are rejected and do not update the session cwd.',
      '',
      'BACKGROUND PROCESSES: this tool is one-shot. To start a long-running process, use the background variant — wired via `shell_list` / `shell_monitor` / `shell_output` / `shell_stop` for visibility.',
      '',
      'POWERSHELL 5.1 QUIRKS (Windows default shell):',
      ' - `&&` / `||` are NOT pipeline operators here. Chain with `; if ($?) { B }` for "B only if A succeeded", or just `;` for unconditional.',
      ' - Ternary (`?:`), null-coalescing (`??`), null-conditional (`?.`) are not available — use if/else and explicit `$null -eq` checks.',
      ' - Default file encoding is UTF-16 LE with BOM; pass `-Encoding utf8` to `Out-File`/`Set-Content` for tools that read the file later.',
      ' - Do NOT pipe a native exe through `2>&1` inside PowerShell — it wraps stderr in NativeCommandError and reports `$?` = false even when the exe returned 0.',
      '',
      'NEVER USE INTERACTIVE COMMANDS:',
      ' - `Read-Host`, `Get-Credential`, `pause`, `git rebase -i`, `git add -i`, any prompt that waits on a TTY — they hang forever (this tool runs `-NonInteractive`).',
      ' - Destructive cmdlets that auto-prompt (`Remove-Item`, `Stop-Process`, `Clear-Content`) need `-Confirm:$false` to proceed without a prompt.',
      '',
      'PREFER DEDICATED TOOLS when one fits:',
      ' - File search → `tools:search`, native file_glob (NOT `find` / `Get-ChildItem -Recurse`).',
      ' - Content search → native grep (NOT shell `grep` / `Select-String`).',
      ' - Read files → `view_image` or `read_thread_terminal` (NOT `Get-Content` / `cat`).',
      ' - Edit files → `apply_patch` (NOT `sed` / `Set-Content` / inline rewrites).',
      ' - GitHub work → `gh` CLI (clones, PRs, issues, releases).',
      '',
      'HEREDOC PATTERN (multi-line strings to native exes):',
      ' - PowerShell: use single-quoted here-strings — `@\'\\n…content…\\n\'@`. The closing `\'@` MUST be at column 0. Single-quoted prevents `$` interpolation.',
      ' - bash: `git commit -m "$(cat <<\'EOF\' \\n…\\nEOF\\n)"`.',
      '',
      'DEFAULTS: timeout 120s (raise via `timeout_ms`, ceiling 600s). stdout/stderr capped at 30 KB each. cwd defaults to the persisted session cwd (workspace root if none).',
      '',
      'SANDBOX BYPASS: pass `dangerously_disable_sandbox: true` to skip the platform wrapper for one call. The approval modal will re-prompt every time and the result will report `Sandbox: bypassed`. Use sparingly — only when the sandbox demonstrably blocks legitimate work.'
    ].join('\n'),
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
            'Optional working directory. Absolute paths must resolve inside the workspace root; relative paths resolve against it. When omitted, defaults to the persisted session cwd (or the workspace root).'
        },
        timeout_ms: {
          type: 'number',
          description: 'Optional timeout in milliseconds. Default 120000, ceiling 600000.'
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Optional environment-variable overlay merged on top of the inherited process env.'
        },
        shell: {
          type: 'string',
          enum: ['auto', 'bash', 'powershell'],
          description:
            'Pick an explicit shell flavour. `"auto"` (default) → PowerShell on Windows, $SHELL elsewhere. `"bash"` on Windows resolves to Git Bash → WSL → clean error. `"powershell"` on POSIX resolves to `pwsh` if installed, else clean error.'
        },
        dangerously_disable_sandbox: {
          type: 'boolean',
          description:
            'Opt out of the platform sandbox wrapper for this single call. When true, any persisted "always allow" policy is bypassed and the modal re-prompts; the result reports `Sandbox: bypassed`. Use only when the sandbox blocks legitimate work (rare).'
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
    const r = await executeShellCommand(
      args as unknown as ShellArgs,
      workspaceRoot,
      ctx.conversationId
    )
    const result = formatShellResultForModel(r)
    // A spawn-time failure (no exit code) and any non-zero exit are
    // failures even though the body still renders normally — return the
    // explicit status so the audit log and the UI badge match reality.
    const failed = r.error !== undefined || (r.exitCode !== null && r.exitCode !== 0) || r.timedOut
    return { result, status: failed ? 'error' : 'done' }
  }
)

// ────────────────────────────────────────────────────────────────────────
// S8 — shell_monitor / shell_list / shell_stop / shell_output
//
// Thin native wrappers around monitor-service.ts + the background-shell
// registry inside shell-tool.ts. They pair with `shell_command` once a
// future call adds `run_in_background: true`; today they manage background
// shells already started by the dev-server, monitor service, verify-
// workspace, or workspace-bootstrap subsystems. Executors live in
// native-aux-tools.ts; descriptors stay here next to shell_command for
// discoverability.
// ────────────────────────────────────────────────────────────────────────

toolRegistry.registerNative(
  {
    id: 'shell_monitor',
    name: 'shell_monitor',
    title: 'Shell: monitor background process',
    description:
      'Start a line-by-line monitor on a running background shell and (optionally) auto-stop when a regex pattern matches a stdout/stderr line. Pairs with shell_command once it grows a run_in_background flag; today it watches any background shell started by the dev-server / monitor / verify-workspace subsystems. Returns the monitor handle (id, status, line count, bytes captured, matched line, timestamps).',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        processId: {
          type: 'string',
          description:
            'Background shell id (returned by shell_list or by the background-shell launcher). Required.'
        },
        untilPattern: {
          type: 'string',
          description:
            'Optional JavaScript regex source. When a buffered line matches, the monitor auto-stops and emits monitor:matched. Omit to tail until the process exits.'
        }
      },
      required: ['processId'],
      additionalProperties: false
    },
    risks: [],
    requiresApproval: false,
    enabled: true,
    parallelizable: true,
    mutates: false
  },
  async (args) => executeShellMonitor(args as unknown as ShellMonitorArgs)
)

toolRegistry.registerNative(
  {
    id: 'shell_list',
    name: 'shell_list',
    title: 'Shell: list background processes',
    description:
      'List every background shell (running or recently exited) plus every active monitor. Use before shell_monitor / shell_stop / shell_output to discover process ids. Pairs with shell_command once it grows a run_in_background flag.',
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
    parallelizable: true,
    mutates: false
  },
  async () => executeShellList()
)

toolRegistry.registerNative(
  {
    id: 'shell_stop',
    name: 'shell_stop',
    title: 'Shell: stop background process',
    description:
      'Stop a running background shell. Sends SIGTERM by default (SIGKILL on request). Returns a JSON envelope { stopped, processId, signal } so the model can branch. Pairs with shell_command once it grows a run_in_background flag.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        processId: {
          type: 'string',
          description: 'Background shell id to terminate. Required.'
        },
        signal: {
          type: 'string',
          enum: ['SIGTERM', 'SIGKILL'],
          description:
            'POSIX signal to deliver. SIGTERM gives the process a chance to clean up; SIGKILL is unconditional. Default SIGTERM.'
        }
      },
      required: ['processId'],
      additionalProperties: false
    },
    risks: ['write'],
    requiresApproval: true,
    enabled: true
  },
  async (args) => executeShellStop(args as unknown as ShellStopArgs)
)

toolRegistry.registerNative(
  {
    id: 'shell_output',
    name: 'shell_output',
    title: 'Shell: read background output',
    description:
      'Read the captured stdout/stderr of a background shell. When `since` is supplied AND an active monitor exists for the same processId, returns only lines after that seq cursor (incremental tail); otherwise returns the full bounded buffer (capped at 30 KB per stream). Pairs with shell_command once it grows a run_in_background flag.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        processId: {
          type: 'string',
          description: 'Background shell id whose output to return. Required.'
        },
        since: {
          type: 'number',
          description:
            'Optional monitor cursor (returned by shell_monitor / previous shell_output). When set, returns only lines with seq > since via the most-recent monitor on this processId. Omit for the full bounded buffer.'
        }
      },
      required: ['processId'],
      additionalProperties: false
    },
    risks: [],
    requiresApproval: false,
    enabled: true,
    parallelizable: true,
    mutates: false
  },
  async (args) => executeShellOutput(args as unknown as ShellOutputArgs)
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
  mutates: false,
  transcriptHidden: true
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
  mutates: false,
  transcriptHidden: true
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
  mutates: false,
  transcriptHidden: true
})

// Integration / H6 — ask_user_question. Pauses the calling agent / workflow
// until the user picks one of 2-4 chip options in the renderer modal. The
// handler is wired in chat.ts because it has to route through the singleton
// ask-user-runtime (which only the main-process side can broadcast through).
// Mutates is false: the question is session-scoped UX, not workspace state.
toolRegistry.registerNative({
  id: 'ask_user_question',
  name: 'ask_user_question',
  title: 'Ask the user a question',
  description:
    'Pause the current run and ask the user a structured question. Returns the label of the option they pick (or `null` on timeout). Use this only when blocked on a decision genuinely the user\'s to make — one you cannot resolve from the request, the code, or sensible defaults. Provide 2-4 mutually-exclusive options; "Other" is added automatically.',
  providerKind: 'native',
  providerId: 'internal',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The complete question to ask. Clear, specific, ends with a question mark.'
      },
      header: {
        type: 'string',
        description: 'Short chip label (max 12 chars). Examples: "Auth method", "Library", "Approach".'
      },
      options: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Display text (1-5 words).' },
            description: { type: 'string', description: 'Brief explanation of this choice.' },
            preview: { type: 'string', description: 'Optional markdown preview when focused.' }
          },
          required: ['label']
        }
      },
      multiSelect: {
        type: 'boolean',
        description: 'When true, the user can pick more than one option.'
      },
      timeoutMs: {
        type: 'number',
        description: 'Timeout in milliseconds. Defaults to 30000.'
      }
    },
    required: ['question', 'header', 'options']
  },
  risks: [],
  requiresApproval: false,
  enabled: true,
  mutates: false,
  transcriptHidden: true
})

// create_document — produces a standalone deliverable (plan, draft, code
// file, report) that renders as a card below the assistant message. The
// handler lives inline in chat.ts because it has to stash the attachment on
// the in-flight assistant turn and broadcast `chat:document-created` to the
// renderer, the same way memory_add emits `memory:added`. transcriptHidden:
// the card row IS the visible side effect — leaving a tool-call card would
// double-render. mutates: false because the deliverable is session-scoped
// (lives on the message row), not a workspace write.
toolRegistry.registerNative({
  id: 'create_document',
  name: 'create_document',
  title: 'Create document',
  description:
    "Emit a standalone document for the user — a plan, draft, report, code file, or any deliverable they may want to keep, open, copy, or save. The document renders as a card below your message with an \"Open in\" action; do NOT also paste the body into your reply. Use only for content the user is meant to take away as a discrete file. Do not use for casual prose, short answers, or transient explanations — write those inline. One call per discrete deliverable; for a multi-file change, call once per file. mimeType drives the icon and \"Open in\" routing (text/markdown → Artifact panel, text/* → file panel / VS Code, anything else → save dialog). Content is capped at 256 KB.",
  providerKind: 'native',
  providerId: 'internal',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          'Filename-style label shown on the card (e.g. "plan.md", "auth.ts", "report.txt"). Include the extension that matches mimeType. No path component.'
      },
      mimeType: {
        type: 'string',
        description:
          'IANA MIME type. Common values: text/markdown, text/plain, text/x-typescript, text/x-python, application/json, text/html, text/csv.'
      },
      content: {
        type: 'string',
        description: 'Full document body, verbatim. Max 256 KB.'
      }
    },
    required: ['name', 'mimeType', 'content'],
    additionalProperties: false
  },
  risks: [],
  requiresApproval: false,
  enabled: true,
  mutates: false,
  transcriptHidden: true
})

// Tool packs are loaded by electron/services/tool-packs.ts (imported from
// electron/ipc/index.ts), not from this file. Side-effect imports at the
// bottom of a module are not safe — bundlers can hoist them above
// `new ToolRegistry()` and trip a TDZ ReferenceError at startup.
