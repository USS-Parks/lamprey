export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  conversationId: string
  model?: string
  toolCallId?: string
}

export type ConversationKind = 'local' | 'cloud' | 'worktree'

export interface Conversation {
  id: string
  title: string
  model: string
  createdAt: number
  updatedAt: number
  messageCount: number
  kind?: ConversationKind
  worktreePath?: string | null
  projectId?: string | null
}

export interface Project {
  id: string
  name: string
  path: string | null
  pinned: boolean
  archived: boolean
  createdAt: number
  lastActivityAt: number
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

export type ProviderId = 'deepseek' | 'google' | 'dashscope' | 'openrouter'

export interface ProviderInfo {
  id: ProviderId
  label: string
  docsUrl: string
  hasKey?: boolean
}

export type ModelTier = 'pro' | 'flash' | 'open' | 'coder' | 'reasoner'

export interface ModelInfo {
  id: string
  name: string
  provider?: ProviderId
  contextWindow: number
  supportsTools: boolean
  supportsVision: boolean
  isReasoner?: boolean
  tier?: ModelTier
  description?: string
}

export type AgentRole = 'planner' | 'coder' | 'reviewer' | 'coworker'
export type AgentMode = 'single' | 'multi'

export interface AgentRoster {
  planner: string
  coder: string
  reviewer: string
  coworker: string
}

export interface AgentStatusEvent {
  conversationId: string
  role: AgentRole
  model: string
  state: 'running' | 'done' | 'error'
  output?: string
}

export type ThemePresetId =
  | 'lamprey-default'
  | 'arcgis-blue'
  | 'arcgis-ember'
  | 'arcgis-violet'
  | 'arcgis-inferno'
  | 'arcgis-magma'
  | 'arcgis-viridis'

export interface ThemePresetTokens {
  bgPrimary: string
  bgSecondary: string
  bgTertiary: string
  border: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  accent: string
  accentDim: string
  success: string
  warning: string
  error: string
  codeBg: string
}

export interface ThemePreset {
  id: ThemePresetId
  name: string
  source: string
  swatch: string[]
  tokens: ThemePresetTokens
  lightTokens?: ThemePresetTokens
}

export type ThemeMode = 'light' | 'dark'

export interface ModelConfig {
  temperature: number
  maxTokens: number | null
  topP: number
  systemPromptOverride: string
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface AppSettings {
  theme: 'dark'
  themePreset: ThemePresetId
  themeMode: ThemeMode
  fontSize: number
  defaultModel: string
  sidebarCollapsed: boolean
  artifactPanelWidth: number
  minimizeToTray: boolean
  autoCheckUpdates: boolean
  aiGeneratedTitles: boolean
  modelConfig: Record<string, ModelConfig>
  customModels: ModelInfo[]
  windowBounds?: WindowBounds
  agentMode: AgentMode
  agentRoster: AgentRoster
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  temperature: 1,
  maxTokens: null,
  topP: 1,
  systemPromptOverride: ''
}

export type IpcResponse<T> = { success: true; data: T } | { success: false; error: string }

export interface ChatRequest {
  conversationId: string
  model: string
  content: string
  activeSkillIds: string[]
  agentMode?: AgentMode
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

// Unified tool registry. Descriptors are produced by tool-registry.ts from
// three sources — native Lamprey tools, connected MCP servers, and (not yet
// wired) installed plugins. The descriptor is the renderer-visible surface;
// the chat layer converts the same descriptors into OpenAI-compatible
// function tools.
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
}

// Permission and approval types. Risk metadata already lives on tool
// descriptors; this layer turns it into a runtime gate. Policies are scoped:
// "once" (this call only), "conversation" (sticky for this thread until app
// restart), "always" (sticky globally until app restart). The renderer never
// persists policy itself — it just reflects the user's choice back via
// tools:respondToApproval.

export type ApprovalScope = 'once' | 'conversation' | 'always'
export type ApprovalDecision = 'allow' | 'deny'

export interface ToolApprovalRequest {
  callId: string
  toolId: string
  name: string
  serverId: string
  providerKind: ToolProviderKind
  risks: ToolRisk[]
  args: Record<string, unknown>
  conversationId?: string
}

export interface ToolApprovalResponse {
  callId: string
  decision: ApprovalDecision
  scope: ApprovalScope
}

export interface ToolPolicyEntry {
  toolId: string
  decision: ApprovalDecision
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

export type AttachmentKind = 'text' | 'image' | 'pdf' | 'binary'

export interface ProcessedFile {
  name: string
  kind: AttachmentKind
  mimeType: string
  size: number
  content: string
  previewText: string
  error?: string
}

// Right-side workspace system. `home` shows the 4 rounded pill subpanels;
// every other mode replaces them with a full-bleed tool.
export type RightPanelMode =
  | 'home'
  | 'environment'
  | 'terminal'
  | 'files'
  | 'review'
  | 'sources'
  | 'artifacts'
  | 'sidechat'
  | 'browser'

export interface BranchItem {
  name: string
  current: boolean
  upstream?: string
  ahead?: number
  behind?: number
}

export interface EnvironmentSnapshot {
  branch: string | null
  additions: number
  deletions: number
  hasChanges: boolean
  ahead: number
  behind: number
  cwd: string
}

// Unified entry in the Environment card's Sources section, aggregated from
// chat attachments, active skills, pinned memory, and connected MCP servers.
export type SourceKind = 'file' | 'skill' | 'memory' | 'mcp'

export interface SourceItem {
  id: string
  kind: SourceKind
  title: string
  subtitle?: string
  // Removal handler differs per kind; callers wire to the owning store.
  onRemove?: () => void
}
