export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  conversationId: string
  model?: string
  toolCallId?: string
}

export interface Conversation {
  id: string
  title: string
  model: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface Skill {
  id: string
  name: string
  description: string
  content: string
  filePath: string
  enabled: boolean
}

export interface MemoryEntry {
  id: number
  content: string
  createdAt: number
  updatedAt: number
  sourceConversationId?: string
}

export interface McpServerConfig {
  id: string
  name: string
  transport: 'sse' | 'stdio'
  url?: string
  command?: string
  args?: string[]
  auth: 'google-oauth' | 'none'
  enabled: boolean
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
}

export interface ModelInfo {
  id: string
  name: string
  contextWindow: number
  supportsTools: boolean
  supportsVision: boolean
}

export interface AppSettings {
  theme: 'dark'
  fontSize: number
  defaultModel: string
  sidebarCollapsed: boolean
  artifactPanelWidth: number
  minimizeToTray: boolean
  autoCheckUpdates: boolean
}

export type IpcResponse<T> = { success: true; data: T } | { success: false; error: string }

export interface ChatRequest {
  conversationId: string
  model: string
  content: string
  activeSkillIds: string[]
}

export interface ChatChunkEvent {
  conversationId: string
  content: string
}

export interface ChatDoneEvent {
  conversationId: string
  message: Message
}

export interface ChatErrorEvent {
  conversationId: string
  error: string
}

export interface ToolCallEvent {
  callId: string
  serverId: string
  toolName: string
  args: Record<string, unknown>
}

export interface ToolCallResultEvent {
  callId: string
  result: string
  duration: number
}

export interface McpStatusEvent {
  serverId: string
  status: McpServerConfig['status']
  error?: string
}

export interface McpConfirmationEvent {
  callId: string
  serverId: string
  toolName: string
  args: Record<string, unknown>
}

export interface ArtifactBounds {
  x: number
  y: number
  width: number
  height: number
}

export type ArtifactType = 'html' | 'svg' | 'mermaid' | 'jsx' | 'react' | 'markdown'
