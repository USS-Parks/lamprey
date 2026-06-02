export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  conversationId: string
  model?: string
  toolCallId?: string
  // Internal replay/inspection field. For tool-using turns the visible
  // assistant body may be composer-generated while draft preserves the
  // model's raw post-tool reply.
  draft?: string
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

export type AgenticCodingComposerMode = 'auto' | 'always' | 'never'

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
  // End-to-end agentic coding mode (Prompt 14). When `agenticCodingMode` is
  // on, every turn uses the coding contract role, auto-activates the listed
  // skill ids, and runs the final-response composer per the composer mode.
  // Off by default so existing chats are unchanged.
  agenticCodingMode: boolean
  agenticCodingSkills: string[]
  agenticCodingComposer: AgenticCodingComposerMode
}

export const DEFAULT_AGENTIC_CODING_SKILLS: string[] = [
  'codex-plan',
  'codex-context',
  'codex-verify'
]

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

// Codex-style run phase. Mirrored from electron/services/agent-run-phase.ts —
// the two tsconfig roots cannot share types directly, so this is the
// renderer-visible source of truth. Keep the two in sync.
export type AgentRunPhase =
  | 'understanding'
  | 'gathering_context'
  | 'planning'
  | 'acting'
  | 'verifying'
  | 'summarizing'
  | 'done'
  | 'error'

export interface ChatPhaseEvent {
  conversationId: string
  phase: AgentRunPhase
}

// Plan checklist mirrors. Source of truth is electron/services/plan-goal-store.ts;
// duplicated here because the two tsconfig roots cannot share types directly.
// Keep in sync if the plan shape changes.
export type PlanStepStatus = 'pending' | 'in_progress' | 'done'

export interface PlanStep {
  id: string
  text: string
  status: PlanStepStatus
}

export interface PlanSnapshot {
  conversationId: string
  steps: PlanStep[]
  totals: { pending: number; in_progress: number; done: number; total: number }
}

export interface PlanUpdatedEvent {
  conversationId: string
  snapshot: PlanSnapshot
}

export type GoalStatus = 'open' | 'in_progress' | 'done' | 'abandoned'

export interface Goal {
  id: string
  title: string
  description?: string
  dueDate?: string
  status: GoalStatus
  createdAt: number
  updatedAt: number
}

// One conversation's persisted plan + goal state, for the inspect/clear panel.
export interface ConversationPlanGoalState {
  conversationId: string
  planSteps: PlanStep[]
  goals: Goal[]
}

export interface ToolCallEvent {
  callId: string
  // Required so the renderer's per-conversation filter (useChat
  // matchesActive) routes the event to the right chat. Without it every
  // tool card is dropped because the equality check fails on undefined.
  conversationId: string
  serverId: string
  toolName: string
  args: Record<string, unknown>
  // Descriptor metadata mirrored onto the event so the UI does not have to
  // round-trip back to the registry for label + risks. Optional because
  // unknown tools still flow through.
  title?: string
  risks?: ToolRisk[]
  providerKind?: ToolProviderKind
  startedAt?: number
}

export type ToolCallResultStatus = 'success' | 'error' | 'denied'

export interface ToolCallResultEvent {
  callId: string
  conversationId: string
  result: string
  duration: number
  // Explicit audit status from the backend so the card distinguishes
  // 'Action denied by user.' from a real tool failure without string-
  // sniffing the result body. Optional because not every emitter on the
  // main side fills it yet.
  status?: ToolCallResultStatus
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
  parallelizable?: boolean
  /** Tool self-gates (its handler is the approval call); never routed through
   * the dispatch-time approval modal. Only `request_permissions` sets this. */
  selfApproves?: boolean
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
  parentCallId?: string
}

// Permission and approval types. Risk metadata already lives on tool
// descriptors; this layer turns it into a runtime gate. Policies are scoped:
// "once" (this call only), "conversation" (sticky for this thread until app
// restart), "always" (sticky globally until app restart). The renderer never
// persists policy itself — it just reflects the user's choice back via
// tools:respondToApproval.

export type ApprovalScope = 'once' | 'conversation' | 'workspace' | 'always'
export type ApprovalDecision = 'allow' | 'deny'

// Persisted policy shape — mirrored from electron/services/permission-policies-store.ts.
// Settings UI reads these via window.api.permissions.listPolicies(); the
// renderer never mutates rows directly, only via addPolicy / deletePolicy /
// clearScope IPC calls.
export type PolicyScope = 'conversation' | 'workspace' | 'global'
export type PolicySubjectKind = 'tool' | 'risk'

export interface PermissionPolicy {
  id: string
  scope: PolicyScope
  subjectKind: PolicySubjectKind
  subject: string
  decision: ApprovalDecision
  conversationId?: string
  workspacePath?: string
  createdAt: number
  updatedAt: number
}

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
