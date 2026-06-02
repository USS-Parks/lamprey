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

export interface ChatEventMap {
  'chat:chunk': ChatChunkPayload
  'chat:done': ChatDonePayload
  'chat:error': ChatErrorPayload
  'chat:phase': ChatPhasePayload
  'chat:tool-call': ChatToolCallPayload
  'chat:tool-call-result': ChatToolCallResultPayload
  'plan:updated': PlanUpdatedPayload
  'memory:added': MemoryAddedPayload
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
