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

/** Reasoning-channel delta. DeepSeek's reasoner / V4-Flash thinking mode
 *  streams chain-of-thought on `delta.reasoning_content`; OpenRouter aliases
 *  it to `delta.reasoning`. The provider layer forwards either to the chat
 *  loop, which broadcasts it here as a separate channel from the visible body
 *  so the renderer can drive a live "thinking…" block alongside the answer. */
export interface ChatReasoningPayload {
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

/** Reasoning Audit Phase R4 — emitted by the multi-agent pipeline right
 *  after the Planner row is persisted (stage='planner'). Same payload
 *  shape as `chat:done` but on a separate channel so the renderer can
 *  treat the Planner row as an "audit row" (R7 hides it by default and
 *  attaches it to the next downstream Coder/Composer bubble via the
 *  "Show pipeline trace" toggle) without changing the chat:done
 *  semantics for the user-visible Coder reply. */
export interface ChatPlannerMessagePayload {
  conversationId: string
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

/** T4 — Streaming-vitals heartbeat. Fires ~every 2s while a stream is active
 *  so the renderer can show "last chunk Ns ago" alongside the running token
 *  count. Lets the user distinguish "model is thinking" from "the socket
 *  is dead" before resorting to manual cancel. `lastChunkAt` is 0 when no
 *  chunk has arrived yet; `chunkCount` aggregates both visible body deltas
 *  and reasoning-channel deltas; `tokenEstimate` is a cheap byte-divided
 *  approximation, NOT an exact tokenizer count. */
export interface ChatStreamingVitalsPayload {
  conversationId: string
  /** Epoch ms of the last chunk OR reasoning delta. 0 when none have arrived. */
  lastChunkAt: number
  /** ms since the last chunk (0 means we just received one). */
  msSinceLastChunk: number
  /** Total chunks (body + reasoning) received this attempt. */
  chunkCount: number
  /** Rough byte-divided token estimate for the running buffers. */
  tokenEstimate: number
  /** ms since the chatStream attempt started. */
  attemptElapsedMs: number
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

/** Standalone document the model produced via the `create_document` native
 *  tool. Fires as soon as the tool dispatch completes so the renderer can
 *  show the card during the same assistant turn (well before the turn's
 *  final message is persisted). The same attachment is also written to the
 *  owning message row at save time — replays read from there. */
export interface DocumentCreatedPayload {
  conversationId: string
  document: {
    id: string
    name: string
    mimeType: string
    content: string
    sizeBytes: number
    createdAt: number
  }
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

export interface ResearchProgressPayload {
  runId: string
  conversationId: string
  stage: string
  sourcesFound: number
  sourcesFetched: number
  claimsExtracted: number
  claimsAccepted: number
  claimsDisputed: number
  elapsedMs: number
  error?: string
}

export interface ResearchCompletedPayload {
  runId: string
  conversationId: string
  artifactPath: string
  filename: string
  summary: string
  markdown: string
  sourceCount: number
  acceptedCount: number
  singleSourceCount: number
  disputedCount: number
  providersUsed: string[]
  elapsedMs: number
}

export interface ResearchFailedPayload {
  runId: string
  conversationId: string
  error: string
}

export interface ChatEventMap {
  'chat:chunk': ChatChunkPayload
  'chat:reasoning': ChatReasoningPayload
  'chat:done': ChatDonePayload
  'chat:planner-message': ChatPlannerMessagePayload
  'chat:error': ChatErrorPayload
  'chat:phase': ChatPhasePayload
  'chat:streaming-vitals': ChatStreamingVitalsPayload
  'chat:tool-call': ChatToolCallPayload
  'chat:tool-call-result': ChatToolCallResultPayload
  'plan:updated': PlanUpdatedPayload
  'plan:mode-changed': PlanModeChangedPayload
  'chat:chapter-marked': ChapterMarkedPayload
  'chat:compressed': ChatCompressedPayload
  'async-event:received': AsyncEventReceivedPayload
  'tasks:spawned': TaskSpawnedPayload
  'memory:added': MemoryAddedPayload
  'chat:document-created': DocumentCreatedPayload
  'agent:status': AgentStatusPayload
  'research:progress': ResearchProgressPayload
  'research:completed': ResearchCompletedPayload
  'research:failed': ResearchFailedPayload
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
