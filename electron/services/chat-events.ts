import { BrowserWindow } from 'electron'
import type { AgentRunPhase } from './agent-run-phase'
import type { ToolProviderKind, ToolRisk } from './tool-registry'

// Typed event surface for the chat tool loop.
//
// chat.ts used to call a stringly-typed `send(channel, data)` for every
// IPC event it emitted. That made schema drift invisible — the missing
// `conversationId` on `chat:tool-call` was a silent regression because no
// compile check caught the gap between what the emitter sent and what the
// renderer filter expected.
//
// `emitChatEvent(channel, payload)` is the single typed seam main-side.
// Adding or removing a field requires updating the matching payload type
// here, which surfaces every caller. The renderer mirrors these shapes in
// src/lib/types.ts the same way LampreyToolDescriptor is mirrored.

export interface ChatChunkPayload {
  conversationId: string
  content: string
}

export interface ChatDonePayload {
  conversationId: string
  // The persisted assistant Message. Shape lives in conversation-store /
  // src/lib/types.ts; left as unknown here so this module does not have
  // to take a dependency on the message-row type.
  message: unknown
}

export interface ChatErrorPayload {
  conversationId: string
  error: string
}

export interface ChatPhasePayload {
  conversationId: string
  phase: AgentRunPhase
}

export interface ChatToolCallPayload {
  callId: string
  conversationId: string
  serverId: string
  toolName: string
  title: string
  risks: ToolRisk[]
  providerKind: ToolProviderKind
  startedAt: number
  args: Record<string, unknown>
  // Mirrors LampreyToolDescriptor.transcriptHidden so MessageList can skip
  // rendering a tool-card row for UX-shim tools (request_permissions,
  // ask_user_question, mark_chapter, enter/exit_plan_mode) whose side effect
  // already shows up elsewhere in the UI. Optional because MCP/legacy tools
  // never set it.
  transcriptHidden?: boolean
}

export type ChatToolCallResultStatus = 'success' | 'error' | 'denied'

export interface ChatToolCallResultPayload {
  callId: string
  conversationId: string
  result: string
  duration: number
  status: ChatToolCallResultStatus
}

export interface PlanUpdatedPayload {
  conversationId: string
  // The JSON-decoded plan snapshot. PlanSnapshot lives in
  // plan-goal-store.ts; left as unknown to avoid a cyclical-feeling import.
  snapshot: unknown
}

export interface MemoryAddedPayload {
  id: number
  content: string
  createdAt: number
  updatedAt: number
  sourceConversationId?: string
}

// Prompt 11: agent pipeline status. One emit per stage transition during a
// multi-agent run (planner / coder / reviewer). The renderer's agent-store
// records these into `activeRun`; AgentRunBanner renders them.
//
// Single-mode chat does NOT emit on this channel — agent:status is the
// exclusive signal that the model is being driven by the Planner→Coder→
// Reviewer pipeline rather than the single-pass loop. Treat the absence of
// agent:status events as proof that pipeline orchestration did not run.
export type AgentPipelineRole = 'planner' | 'coder' | 'reviewer' | 'coworker'
export type AgentPipelineState = 'running' | 'done' | 'error'

export interface AgentStatusPayload {
  conversationId: string
  role: AgentPipelineRole
  model: string
  state: AgentPipelineState
  output?: string
}

/** Track 2 / C3 — plan-mode toggle event. Fires whenever the per-conversation
 *  plan_mode_active flag flips via the `enter_plan_mode` / `exit_plan_mode`
 *  tools or the `plan:enterMode` / `plan:exitMode` IPC channels. */
export interface PlanModeChangedPayload {
  conversationId: string
  active: boolean
}

/** Track 2 / E1 — chapter marker. Fires when the model invokes `mark_chapter`
 *  or the renderer writes via the `session:markChapter` IPC. The chapter
 *  payload mirrors the Chapter shape from chapters-store. */
export interface ChapterMarkedPayload {
  conversationId: string
  chapter: {
    id: string
    conversationId: string
    title: string
    summary: string | null
    anchorMessageId: string
    createdAt: number
  }
}

/** Track 2 / E5 — context compression. Fires when the compressor folds the
 *  oldest messages into a `<conversation_summary>` system message. The
 *  renderer reloads the conversation's messages on receipt so the
 *  CompressedRegionPill replaces the original turn cards. */
export interface ChatCompressedPayload {
  conversationId: string
  summaryMessageId: string
  compressedCount: number
  reductionPct: number
}

/** Track 2 / E6 — async event bridge toast. The durable row lives in
 *  async_events; this live event is just a user-visible nudge that the
 *  model will see the same item on the next turn. */
export interface AsyncEventReceivedPayload {
  id: string
  conversationId: string
  kind: string
  title: string
  message: string
  createdAt: number
}

/** Track 2 / E4 — spawned task chip. Fires when a source conversation
 *  creates a child task conversation. */
export interface TaskSpawnedPayload {
  taskId: string
  sourceConversationId: string
  conversationId: string
  title: string
  tldr: string | null
  worktreePath: string | null
  branch: string | null
}

export interface ChatEventMap {
  'chat:chunk': ChatChunkPayload
  'chat:done': ChatDonePayload
  'chat:error': ChatErrorPayload
  'chat:phase': ChatPhasePayload
  'chat:tool-call': ChatToolCallPayload
  'chat:tool-call-result': ChatToolCallResultPayload
  'plan:updated': PlanUpdatedPayload
  'plan:mode-changed': PlanModeChangedPayload
  'chat:chapter-marked': ChapterMarkedPayload
  'chat:compressed': ChatCompressedPayload
  'async-event:received': AsyncEventReceivedPayload
  'tasks:spawned': TaskSpawnedPayload
  'memory:added': MemoryAddedPayload
  'agent:status': AgentStatusPayload
}

export type ChatEventName = keyof ChatEventMap

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows[0] ?? null
}

export function emitChatEvent<K extends ChatEventName>(
  channel: K,
  payload: ChatEventMap[K]
): void {
  getMainWindow()?.webContents.send(channel, payload)
}
