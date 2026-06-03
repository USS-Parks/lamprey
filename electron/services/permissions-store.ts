import { BrowserWindow } from 'electron'
import type { LampreyToolDescriptor, ToolRisk } from './tool-registry'
import {
  clearPoliciesForConversation,
  deletePolicy,
  listPolicies,
  resolveDecision as resolvePersistedDecision,
  upsertPolicy,
  type PolicyDecision
} from './permission-policies-store'
import {
  recordEvent,
  type EventActorKind,
  type EventType
} from './event-log'
import { getActiveWorkspace } from './workspace-state'

// Permission and approval service. Driven by descriptor risk metadata; works
// for any tool the registry flags as requiresApproval (and additionally any
// tool with one of the GATING_RISKS below).
//
// Decision sources, in resolution order:
//   1. Persisted policies (permission-policies-store) — conversation/workspace
//      /global scope at tool or risk subject, deny precedence within a level.
//   2. The user, via the approval modal — answer can persist as a policy when
//      the user picks "This conversation" / "This workspace" / "Always".
//
// "Just this once" answers do not persist; they answer the single call.

export type ApprovalScope = 'once' | 'conversation' | 'workspace' | 'always'
export type ApprovalDecision = PolicyDecision

export interface ToolApprovalRequest {
  callId: string
  toolId: string
  name: string
  serverId: string
  providerKind: 'native' | 'mcp' | 'plugin'
  risks: ToolRisk[]
  args: Record<string, unknown>
  conversationId?: string
  /**
   * Chat-turn correlation id from `chat:send`. Threaded into the approval
   * event so a single run can be reconstructed across approval / model /
   * tool / agent rows.
   */
  correlationId?: string
}

export interface ToolApprovalResponse {
  callId: string
  decision: ApprovalDecision
  scope: ApprovalScope
}

/**
 * Outcome of resolving a tool-call approval. `source` tells the audit layer
 * how the decision was reached — `'policy:<id>'` references a persisted policy
 * row, `'modal'` is a user answer through the approval dialog, and
 * `'auto-deny-timeout'` is the 30s safety bail when the user never answers.
 */
export interface ApprovalOutcome {
  decision: ApprovalDecision
  source: string
}

const APPROVAL_TIMEOUT_MS = 30_000

// Risks that, even without descriptor.requiresApproval, cause chat.ts to route
// through this service. Pure 'read' and 'write' alone do NOT gate (memory_add,
// update_plan are local writes); 'network', 'destructive', and 'secret' do.
export const GATING_RISKS: ReadonlySet<ToolRisk> = new Set([
  'network',
  'destructive',
  'secret'
])

/** True if a descriptor with these risks should pass through requestApproval. */
export function shouldGateOnRisks(risks: ToolRisk[]): boolean {
  return risks.some((r) => GATING_RISKS.has(r))
}

/**
 * Authoritative dispatch-time predicate: should this tool call be routed
 * through the approval service? A tool gates when it declares
 * `requiresApproval` or carries a gating risk — UNLESS it self-approves
 * (its handler is the gate; see `LampreyToolDescriptor.selfApproves`).
 * Centralized here so the rule has one definition shared by chat.ts and tests.
 */
export function descriptorNeedsApproval(
  descriptor:
    | Pick<LampreyToolDescriptor, 'requiresApproval' | 'risks' | 'selfApproves'>
    | undefined
): boolean {
  if (!descriptor) return false
  if (descriptor.selfApproves) return false
  return descriptor.requiresApproval || shouldGateOnRisks(descriptor.risks)
}

class PermissionsService {
  private pending = new Map<string, (response: ToolApprovalResponse) => void>()

  /**
   * Resolve approval for a tool call. Consults persisted policies first; if
   * none match, dispatches a request to the UI and persists the answer
   * according to the user's chosen scope. Auto-denies after
   * APPROVAL_TIMEOUT_MS — the user has 30 s to answer.
   *
   * Returns the decision only. Use {@link requestApprovalDetailed} when the
   * caller wants the audit `source` string alongside the decision.
   */
  async requestApproval(req: ToolApprovalRequest): Promise<ApprovalDecision> {
    const outcome = await this.requestApprovalDetailed(req)
    return outcome.decision
  }

  async requestApprovalDetailed(req: ToolApprovalRequest): Promise<ApprovalOutcome> {
    const workspacePath = (() => {
      try {
        return getActiveWorkspace()
      } catch {
        return undefined
      }
    })()
    const persisted = resolvePersistedDecision({
      toolId: req.toolId,
      risks: req.risks,
      conversationId: req.conversationId,
      workspacePath
    })
    if (persisted) {
      const outcome: ApprovalOutcome = {
        decision: persisted.decision,
        source: `policy:${persisted.policyId}`
      }
      emitApprovalEvent(req, outcome, workspacePath, persisted.policyId)
      return outcome
    }

    const userOutcome = await this.askUser(req, workspacePath)
    emitApprovalEvent(req, userOutcome, workspacePath)
    return userOutcome
  }

  /**
   * Set a sticky policy for a single risk category. Used by
   * request_permissions after the user grants a scope. Writes through to the
   * persisted policies table so the grant survives a restart.
   *
   * Passing `null` removes the existing policy for that risk at the given
   * scope.
   */
  setRiskPolicy(
    risk: ToolRisk,
    scope: 'conversation' | 'always',
    decision: ApprovalDecision | null,
    conversationId?: string
  ): void {
    const policyScope = scope === 'always' ? 'global' : 'conversation'
    if (decision === null) {
      const matches = listPolicies().filter(
        (p) =>
          p.scope === policyScope &&
          p.subjectKind === 'risk' &&
          p.subject === risk &&
          (policyScope === 'global' ? true : p.conversationId === conversationId)
      )
      for (const m of matches) deletePolicy(m.id)
      return
    }
    if (policyScope === 'conversation' && !conversationId) return
    upsertPolicy({
      scope: policyScope,
      subjectKind: 'risk',
      subject: risk,
      decision,
      conversationId: policyScope === 'conversation' ? conversationId : undefined
    })
  }

  /**
   * Read-back for a single risk's current decision. Returns the matched policy
   * folded into the legacy "scope" shape so existing callers (settings UI,
   * native tools) don't need to know about the wider policy model.
   */
  getRiskPolicy(
    risk: ToolRisk,
    conversationId?: string
  ): { scope: 'conversation' | 'always'; decision: ApprovalDecision } | null {
    const all = listPolicies()
    const conv = conversationId
      ? all.find(
          (p) =>
            p.scope === 'conversation' &&
            p.subjectKind === 'risk' &&
            p.subject === risk &&
            p.conversationId === conversationId
        )
      : undefined
    const glob = all.find(
      (p) => p.scope === 'global' && p.subjectKind === 'risk' && p.subject === risk
    )
    if (conv?.decision === 'deny') return { scope: 'conversation', decision: 'deny' }
    if (glob?.decision === 'deny') return { scope: 'always', decision: 'deny' }
    if (conv) return { scope: 'conversation', decision: conv.decision }
    if (glob) return { scope: 'always', decision: glob.decision }
    return null
  }

  private async askUser(
    req: ToolApprovalRequest,
    workspacePath: string | undefined
  ): Promise<ApprovalOutcome> {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    // No active window → default deny (headless test runs, app shutdown
    // mid-request). Source labeled distinctly so the audit row reads
    // 'no-window' rather than 'modal' for a non-event.
    if (!mainWindow) return { decision: 'deny', source: 'no-window' }

    return new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(req.callId)) {
          this.pending.delete(req.callId)
          resolve({ decision: 'deny', source: 'auto-deny-timeout' })
        }
      }, APPROVAL_TIMEOUT_MS)

      this.pending.set(req.callId, (response) => {
        clearTimeout(timer)
        const persistedId = this.persistAnswer(response, req, workspacePath)
        resolve({
          decision: response.decision,
          source: persistedId ? `policy:${persistedId}` : 'modal'
        })
      })

      mainWindow.webContents.send('tools:approvalRequired', req)

      // Backwards-compat shim — the prior modal listened to this event; any
      // external code that subscribed to mcp:confirmationRequired before the
      // refactor still sees the request. New modal uses tools:approvalRequired.
      const legacyToolName = req.name.includes('__')
        ? req.name.split('__').slice(1).join('__')
        : req.name
      mainWindow.webContents.send('mcp:confirmationRequired', {
        callId: req.callId,
        serverId: req.serverId,
        toolName: legacyToolName,
        args: req.args
      })
    })
  }

  /**
   * Persist the user's answer when their chosen scope is anything other than
   * 'once'. Returns the persisted policy id so the audit row can reference
   * it as the decision source for the next run that hits the same policy.
   */
  private persistAnswer(
    response: ToolApprovalResponse,
    req: ToolApprovalRequest,
    workspacePath: string | undefined
  ): string | null {
    if (response.scope === 'once') return null
    if (response.scope === 'conversation' && !req.conversationId) return null
    if (response.scope === 'workspace' && !workspacePath) return null
    try {
      const policy = upsertPolicy({
        scope:
          response.scope === 'always'
            ? 'global'
            : response.scope === 'workspace'
            ? 'workspace'
            : 'conversation',
        subjectKind: 'tool',
        subject: req.toolId,
        decision: response.decision,
        conversationId: response.scope === 'conversation' ? req.conversationId : undefined,
        workspacePath: response.scope === 'workspace' ? workspacePath : undefined
      })
      return policy.id
    } catch (err) {
      console.error('[permissions-store] failed to persist policy:', err)
      return null
    }
  }

  /** Renderer response to a pending approval request. */
  respond(response: ToolApprovalResponse): void {
    const resolver = this.pending.get(response.callId)
    if (resolver) {
      this.pending.delete(response.callId)
      resolver(response)
    }
  }

  /** Backwards-compat for the legacy mcp.approveToolCall(callId, boolean) IPC. */
  respondLegacy(callId: string, approved: boolean): void {
    this.respond({
      callId,
      decision: approved ? 'allow' : 'deny',
      scope: 'once'
    })
  }

  /**
   * Legacy per-tool global API — kept as a thin wrapper over the policy store
   * so the existing IPC channels (permissions:listGlobalPolicies /
   * :setGlobalPolicy / :clearConversationPolicies) continue to work while the
   * UI migrates to the wider policy CRUD surface.
   */
  listGlobalPolicies(): Array<{ toolId: string; decision: ApprovalDecision }> {
    return listPolicies()
      .filter((p) => p.scope === 'global' && p.subjectKind === 'tool')
      .map((p) => ({ toolId: p.subject, decision: p.decision }))
  }

  setGlobalPolicy(toolId: string, decision: ApprovalDecision | null): void {
    if (decision === null) {
      const matches = listPolicies().filter(
        (p) => p.scope === 'global' && p.subjectKind === 'tool' && p.subject === toolId
      )
      for (const m of matches) deletePolicy(m.id)
      return
    }
    upsertPolicy({
      scope: 'global',
      subjectKind: 'tool',
      subject: toolId,
      decision
    })
  }

  clearConversationPolicies(conversationId: string): void {
    clearPoliciesForConversation(conversationId)
  }

  /** Cancel a pending request — used when a chat round is aborted. */
  cancelPending(callId: string): void {
    const resolver = this.pending.get(callId)
    if (resolver) {
      this.pending.delete(callId)
      resolver({ callId, decision: 'deny', scope: 'once' })
    }
  }
}

export const permissionsService = new PermissionsService()

/**
 * Mirror an approval outcome into the event spine. Every decision path is
 * recorded — policy match, modal answer, no-window default-deny, and the 30s
 * auto-deny timeout — so the audit timeline shows why a tool ran or didn't.
 *
 * Actor mapping:
 *   - modal           → `user`   (a human pressed the button)
 *   - policy:<id>     → `system` (a persisted policy was the deciding voice)
 *   - auto-deny-timeout, no-window → `system`
 *
 * Failures here are swallowed: the approval decision itself is the
 * load-bearing side-effect, and event-log already owns its memory fallback.
 */
function emitApprovalEvent(
  req: ToolApprovalRequest,
  outcome: ApprovalOutcome,
  workspacePath: string | undefined,
  policyId?: string
): void {
  try {
    const type: EventType =
      outcome.decision === 'allow' ? 'tool.call.approved' : 'tool.call.denied'
    const actorKind: EventActorKind = outcome.source === 'modal' ? 'user' : 'system'
    recordEvent({
      type,
      actorKind,
      severity: type === 'tool.call.denied' ? 'warning' : 'info',
      conversationId: req.conversationId,
      correlationId: req.correlationId,
      workspacePath,
      toolCallId: req.callId,
      entityKind: 'tool',
      entityId: req.toolId,
      payload: {
        toolId: req.toolId,
        name: req.name,
        providerKind: req.providerKind,
        serverId: req.serverId,
        risks: req.risks,
        source: outcome.source,
        policyId
      }
    })
  } catch (err) {
    console.error('[permissions-store] approval event failed:', err)
  }
}
