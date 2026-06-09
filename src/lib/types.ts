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
  /** Track 2 / E5 — populated for messages that the auto context
   *  compressor folded into a summary. The value is the id of the
   *  summary message that replaced them in prompt assembly. Renderer
   *  shows a CompressedRegionPill at the boundary instead of the
   *  original message body. */
  compressedInto?: string
  /** DeepSeek reasoner / V4-Flash thinking-mode chain-of-thought captured
   *  off the streaming `delta.reasoning_content` channel and persisted
   *  alongside the visible body. Rendered by ReasoningBlock. */
  reasoning?: string
  /** Robustness Hotfix HX4 (v0.8.4) — verbatim pre-sanitization copy of
   *  the assistant row's body. `content` is the sanitized text (what every
   *  UI surface reads), `contentRaw` preserves what the model actually
   *  emitted so audit / export consumers can inspect it. Undefined on
   *  legacy pre-hotfix rows and non-assistant rows. */
  contentRaw?: string | null
  /** Standalone documents the model produced for this turn via the
   *  `create_document` native tool. Rendered as cards below the message
   *  body — separate from tool-call cards because these are deliverables,
   *  not transient transcript noise. */
  documents?: DocumentAttachment[]
  /** Per-assistant-row tool calls as stored in the messages.tool_calls
   *  column (JSON-encoded server-side, parsed by getMessages). Mirrors
   *  the OpenAI chat-completion tool_calls shape. Used to rehydrate the
   *  ToolActivityChip when a previously-completed conversation is
   *  reopened — without this the chip would render empty until the next
   *  live tool event arrives. */
  toolCalls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  /** Reasoning Audit Phase R1 — multi-agent pipeline stage discriminator.
   *  Undefined on legacy rows + single-agent runs + Coder rows (the
   *  default semantic = "the single assistant row of the turn"). Set to
   *  'planner' / 'reviewer' / 'composer' by agent-pipeline.ts + chat.ts
   *  composer save sites. MessageBubble (R7) reads this to decide:
   *    - stage === 'planner'    → row hidden in main thread; attached to
   *                               next Coder/Composer bubble behind a
   *                               "Show pipeline trace" toggle.
   *    - stage === 'reviewer'   → render with a small "Reviewer" chip.
   *    - stage === 'composer'   → render with a muted "Composer" chip.
   *    - stage undefined        → default render (Coder / single-agent). */
  stage?: 'planner' | 'reviewer' | 'composer'
}

/** Standalone deliverable a model produced inside a single assistant turn —
 *  a plan, a draft, a code file, a report. Distinct from RAG citations and
 *  from tool-call results: this is content the user is meant to keep, open,
 *  copy, or save. Persisted as JSON on the owning message row. */
export interface DocumentAttachment {
  id: string
  /** Filename-style label (e.g. "plan.md", "auth.ts"). Surfaced as the card
   *  title; no path component. */
  name: string
  /** MIME type the model declared. Drives the icon + "Open in" routing
   *  (markdown → Artifact panel, code → VS Code, everything else → Save). */
  mimeType: string
  /** Full document body. Capped at 256 KB at the handler. */
  content: string
  /** Byte length of `content` at create time. */
  sizeBytes: number
  /** Epoch ms when the model emitted the document. */
  createdAt: number
}

export type ConversationKind = 'local' | 'cloud' | 'worktree'
export type SeedSourceKind = 'none' | 'message' | 'block' | 'transcript-range' | 'custom'
export type ForkWorkspaceMode = 'inherit' | 'current' | 'none'

export interface ForkParams {
  sourceConversationId: string
  sourceMessageId?: string
  seedKind: SeedSourceKind
  seedContent?: string
  seedBlobJson?: string
  includeRagAttachments?: boolean
  workspaceMode?: ForkWorkspaceMode
  titleOverride?: string
}

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
  forkedFromId?: string | null
  forkedFromMessageId?: string | null
  seedBlob?: unknown
  seedSourceKind?: SeedSourceKind
}

export interface Project {
  id: string
  name: string
  slug: string
  path: string | null
  description?: string | null
  pinned: boolean
  archived: boolean
  createdAt: number
  updatedAt: number
  lastActivityAt: number
  lastOpenedAt?: number | null
}

export interface Skill {
  id: string
  name: string
  description: string
  content: string
  filePath: string
  enabled: boolean
  /** Customize C3: glob patterns the skill is allowed to call. */
  allowedTools?: string[]
  /** Customize C3: per-skill model override. */
  model?: string
  /** Customize C3: false = manual `/name` only. Defaults to true. */
  autoInvoke?: boolean
  /** Customize C3: directory-mode sibling files (relative names). */
  supportingFiles?: string[]
  /** Customize C11: when sourced from an enabled plugin, the plugin id. */
  pluginId?: string
}

// Customize C7/C8 — plugin manifest mirror, kept in `src/lib/types.ts`
// so the renderer + Zustand store + UI components share one definition
// with the main-process loader.
export interface PluginManifest {
  id: string
  name: string
  description: string
  version: string
  author?: string
  homepage?: string
  category?: string
  enabled?: boolean
}

export interface LoadedPlugin {
  manifest: PluginManifest
  enabled: boolean
  rootPath: string
  surfaceCounts: {
    skills: number
    slashCommands: number
    connectors: number
  }
}

// Skill Import Phase I4 — renderer mirrors of the discovery + importer
// shapes. Kept narrow on purpose: the renderer never instantiates these,
// it just receives them across IPC.

export interface DiscoveredCcSkill {
  slug: string
  name: string
  description: string
  enabled: boolean
  supportingFileCount: number
}

export interface DiscoveredCcPlugin {
  sourcePath: string
  pluginName: string
  version: string
  description: string
  skills: DiscoveredCcSkill[]
}

export interface CcImportResult {
  pluginId: string
  installPath: string
  skillsImported: string[]
  skipped: string[]
}

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

export interface MemoryEntry {
  id: number
  content: string
  createdAt: number
  updatedAt: number
  sourceConversationId?: string
  // D1 typed-shape additions. Optional so pre-D3 callers keep compiling.
  name?: string
  description?: string
  type?: MemoryType
  projectSlug?: string
  filePath?: string
}

export interface MemoryFile {
  name: string
  projectSlug: string
  description: string
  type: MemoryType
  body: string
  filePath: string
  sourceConversationId: string | null
  createdAt: number
  updatedAt: number
}

export interface BrokenMemoryLink {
  from: string
  fromFilePath: string
  target: string
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
  /** Customize C11: when set, this connector is registered transiently
   *  by an enabled plugin. Removing/disabling the plugin removes the
   *  entry; the user can't edit or persist it directly. */
  pluginId?: string
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
  | 'lamprey-mint'
  | 'lamprey-earth'
  | 'arcgis-magma'
  | 'arcgis-viridis'
  | 'lamprey-drab'

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
  // Panels Phase tokens — substrate + panel surface system.
  // appBg = outer shell substrate (sidebars float on this).
  // panelBg = sidebar panel surface (rounded card tone).
  appBg: string
  panelBg: string
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
  /**
   * Snip Phase K9: master kill-switch for the shell-output filter
   * layer. Default `true` — every foreground shell command runs
   * through the matched YAML filter before reaching the model.
   * Flipping `false` makes the layer a pure pass-through with no
   * DB write, no matcher run, no allocation.
   */
  snipEnabled: boolean
  /**
   * Snip Phase K9: verbose mode for the dashboard. When `true`, the
   * SnipSettings tab renders a per-filter activity log of recent
   * matches. NEVER decorates the text the model receives — that
   * would corrupt structured tool output (Invariant 13).
   */
  snipVerbose: boolean
  /**
   * T1 — SSE inactivity watchdog threshold (ms). 0 disables, min 5_000,
   * default 60_000. Caps how long a streaming attempt can sit without
   * receiving a chunk before being retried/aborted with a clear error.
   */
  streamInactivityMs?: number
  /**
   * T2 — Per-call MCP tool timeout (ms). 0 falls back to the MCP SDK's
   * default, min 5_000, default 120_000. Capping it here prevents one
   * stalled MCP server from blocking the whole turn.
   */
  mcpCallTimeoutMs?: number
  /**
   * T3 — Per-stage wall-clock budgets (ms) for the multi-agent pipeline.
   * 0 disables a stage's budget, min 10_000. Defaults: planner 120_000,
   * coder 600_000, reviewer 120_000.
   */
  stageBudgetMs?: {
    planner?: number
    coder?: number
    reviewer?: number
  }
  /**
   * Reasoning Audit Phase R8 — when on (default), past assistant rows
   * with persisted reasoning get re-fed into the next turn's API stack
   * as a leading `<think>…</think>` block so the model can see its own
   * prior chain-of-thought. Trade-off: each rehydrated `<think>` block
   * inflates context tokens; turn off if a long conversation hits the
   * model's context limit. Closes the "no session history tool exists"
   * gap surfaced by the Cascadian Shadow debug-session audit.
   */
  includePastReasoningInContext?: boolean
  /** PS20 seed budget: inline fork seeds above this character count are
   * represented by a compact attached-document marker instead of filling
   * the first user turn. */
  safeSeedLength?: number
}

export const DEFAULT_AGENTIC_CODING_SKILLS: string[] = [
  'plan',
  'context',
  'verify'
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

export type ChangeContractStatus = 'active' | 'closed' | 'waived'
export type ChangeContractSource = 'user' | 'plan_goal' | 'implicit' | 'system'

export interface ChangeContract {
  id: string
  conversationId: string
  correlationId?: string
  status: ChangeContractStatus
  implicit: boolean
  source: ChangeContractSource
  goal: string
  acceptanceCriteria: string[]
  expectedFiles: string[]
  nonGoals: string[]
  verificationCommands: string[]
  requiredReceiptKinds: string[]
  createdAt: number
  updatedAt: number
  closedAt?: number
  waiverReason?: string
  waivedBy?: string
  waivedAt?: number
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
  // True when MessageList must skip the ToolUseCard for this invocation —
  // UX-shim tools whose side effect already shows up elsewhere (approval
  // modal, chapter divider, plan-mode banner). The event still fires for
  // the audit log and event timeline.
  transcriptHidden?: boolean
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
  /** Track 2 / C1 — derived tag list. Includes providerKind, every risk
   *  class, and meta tags ('lazy', 'approval-required', 'parallelizable').
   *  Used for tools:search keyword ranking and renderer filter chips. */
  tags: string[]
  /** Track 2 / C1 — true when the schema came from an external provider
   *  (MCP server, plugin host). `tools:list` ships stubs without
   *  `inputSchema`; call `window.api.tools.resolve([name])` to expand. */
  lazy: boolean
  /** Track 2 / C3 — true when invoking this tool may mutate the workspace,
   *  external systems, or persistent state. The chat dispatcher refuses
   *  mutating tools while plan mode is on for the conversation; the
   *  PlanModeBanner exposes a one-click exit. */
  mutates: boolean
  /** When true, MessageList suppresses the ToolUseCard for invocations of
   *  this tool — the side effect (approval modal, chapter divider, plan
   *  banner) IS the user-facing surface. The IPC event still fires for
   *  the audit log. */
  transcriptHidden?: boolean
}

/** Track 2 / C1 — stub shape returned by `window.api.tools.list()`.
 *  No `inputSchema` — call `tools.resolve(names[])` or `tools.search({ query })`
 *  to get the full descriptor for any tool the renderer wants to inspect. */
export type LampreyToolStub = Omit<LampreyToolDescriptor, 'inputSchema'>

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

export type AttachmentKind = 'text' | 'image' | 'pdf' | 'binary' | 'rag-pending'

export type RagPendingPhase =
  | 'queued'      // waiting for auto-attach IPC to fire
  | 'loading'
  | 'chunking'
  | 'embedding'
  | 'ready'
  | 'error'

export interface ProcessedFile {
  name: string
  kind: AttachmentKind
  mimeType: string
  size: number
  content: string
  previewText: string
  error?: string
  /** Absolute path on disk. Set on `kind: 'rag-pending'` so the renderer
   *  can hand the path to window.api.rag.autoAttach. */
  sourcePath?: string
  /** Ingest tracking — populated after the auto-attach IPC returns. The
   *  renderer subscribes to rag.document.onProgress and matches by jobId. */
  ingestJobId?: string
  collectionId?: string
  documentId?: string
  ragPhase?: RagPendingPhase
  ragProgress?: number
  ragChunkCount?: number
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
export type SourceKind = 'file' | 'skill' | 'memory' | 'mcp' | 'github'

export interface SourceItem {
  id: string
  kind: SourceKind
  title: string
  subtitle?: string
  // Removal handler differs per kind; callers wire to the owning store.
  onRemove?: () => void
}

// ──────────────────── Event spine (Data Spine Prompt 5) ────────────────────
//
// Renderer-side mirror of `electron/services/event-log.EventRecord`. The
// renderer can't import from `electron/*` (the two tsconfig roots don't reach
// across), so the shape is duplicated here the same way LampreyToolCall is.
// Keep both definitions in lock-step: a drift between them is a bug.

export type EventSeverity = 'info' | 'warning' | 'error'

/** Provenance of the JSON payload column. See electron/services/event-log.ts. */
export type EventRedaction = 'metadata' | 'preview' | 'redacted'

export type EventActorKind = 'user' | 'system' | 'agent' | 'model' | 'tool'

export type EventType =
  | 'tool.call.started'
  | 'tool.call.approved'
  | 'tool.call.denied'
  | 'tool.call.completed'
  | 'tool.call.failed'
  | 'agent.stage.started'
  | 'agent.stage.completed'
  | 'agent.stage.failed'
  | 'model.request.started'
  | 'model.request.completed'
  | 'model.request.failed'
  | 'chat.cancelled'
  | 'chat.error'
  | 'chat.chapter.marked'
  | 'chat.compressed'
  | 'workspace.changed'
  | 'worktree.created'
  | 'worktree.removed'
  | 'automation.started'
  | 'automation.completed'
  | 'automation.failed'
  | 'loop.wakeup.scheduled'
  | 'loop.wakeup.fired'
  | 'security.decision'
  | 'permission.policy.created'
  | 'permission.policy.updated'
  | 'permission.policy.deleted'
  | 'settings.updated'
  | 'project.created'
  | 'project.archived'
  | 'project.pinned'
  | 'project.deleted'
  | 'rag.collection.created'
  | 'rag.collection.updated'
  | 'rag.collection.deleted'
  | 'rag.model.download.started'
  | 'rag.model.download.completed'
  | 'rag.model.download.failed'
  | 'rag.ingest.started'
  | 'rag.ingest.completed'
  | 'rag.ingest.failed'
  | 'rag.query.completed'
  | 'rag.query.failed'
  | 'rag.rerank.completed'
  | 'persistence.checkpoint'
  | 'persistence.integrity'
  | 'persistence.backup'
  | 'persistence.recovery'
  | 'conversation.forked'
  | 'conversation.seed.attached'
  | 'conversation.seed.truncated'
  | 'proof.receipt.created'
  | 'proof.receipt.failed'
  | 'proof.gate.passed'
  | 'proof.gate.failed'
  | 'proof.gate.waived'

export interface EventRecord {
  id: string
  type: EventType
  createdAt: number
  severity: EventSeverity
  conversationId?: string
  projectId?: string
  workspacePath?: string
  automationId?: string
  toolCallId?: string
  parentEventId?: string
  correlationId?: string
  actorKind: EventActorKind
  actorId?: string
  entityKind?: string
  entityId?: string
  payload: Record<string, unknown>
  redaction: EventRedaction
}

/** Filter shape for `window.api.events.list`. */
export interface EventListFilter {
  type?: EventType | EventType[]
  severity?: EventSeverity | EventSeverity[]
  conversationId?: string
  projectId?: string
  workspacePath?: string
  automationId?: string
  toolCallId?: string
  correlationId?: string
  sinceMs?: number
  untilMs?: number
  limit?: number
  order?: 'asc' | 'desc'
}

/** Scope shape for `window.api.events.timeline` (exactly one scope required). */
export interface EventTimelineFilter {
  conversationId?: string
  projectId?: string
  workspacePath?: string
  correlationId?: string
  automationId?: string
  limit?: number
}

// Read-only after-action report for one conversation. Built main-side from
// messages, tool_calls, and the append-only event spine.
export type AfterActionCauseSeverity = 'info' | 'warning' | 'error'

export interface AfterActionCause {
  severity: AfterActionCauseSeverity
  title: string
  detail: string
}

export interface AfterActionTimelineItem {
  id: string
  at: number
  type: string
  severity: AfterActionCauseSeverity
  summary: string
  correlationId?: string
}

export interface AfterActionToolItem {
  id: string
  name: string
  status: string
  startedAt: number
  durationMs?: number
  argsPreview: string
  resultPreview?: string
  errorPreview?: string
}

export interface AfterActionProofReceiptItem {
  id: string
  kind: string
  status: string
  command: string
  finishedAt: number
  durationMs: number
  exitCode?: number
  contractId?: string
  metrics: Record<string, unknown>
}

export interface AfterActionReport {
  conversationId: string
  title: string
  model: string
  generatedAt: number
  createdAt: number
  updatedAt: number
  counts: {
    messages: number
    userPrompts: number
    assistantTurns: number
    emptyAssistantTurns: number
    toolRequestTurns: number
    toolResults: number
    events: number
    toolCalls: number
    toolErrors: number
    toolDenied: number
    chatErrors: number
    modelRequestsStarted: number
    modelRequestsCompleted: number
    modelRequestsFailed: number
    approvals: number
  }
  latestUserPrompt?: string
  latestAssistantText?: string
  causes: AfterActionCause[]
  timeline: AfterActionTimelineItem[]
  recentTools: AfterActionToolItem[]
  proof: {
    activeContracts: ChangeContract[]
    gatePassed: number
    gateFailed: number
    gateWaived: number
    latestFailureReason?: string
    receipts: AfterActionProofReceiptItem[]
    failedCommands: string[]
    skippedCommands: string[]
    reviewerCheckedModes: string[]
  }
}

// ──────────────────── RAG (Local Retrieval) ────────────────────
//
// Renderer mirrors of the rag store + IPC payloads. The full schema lives in
// `electron/services/database.ts`; see PLANNING/LAMPREY_RAG_PLAN.md §2.2 for
// the design rationale. Most of the placeholders below get expanded in later
// R-prompts (R2 = EmbedderInfo, R5 = IngestProgressEvent, R7 = RetrievalResult).

/** One user-facing grouping of indexed documents (e.g. "Project docs"). */
export interface RagCollection {
  id: string
  name: string
  description?: string
  /** Which embeddings model produced the vectors in this collection. */
  embedderId: string
  chunkSize: number
  chunkOverlap: number
  workspacePath?: string
  projectId?: string
  createdAt: number
  updatedAt: number
}

export type RagDocumentStatus =
  | 'queued'
  | 'loading'
  | 'chunking'
  | 'embedding'
  | 'ready'
  | 'error'
  | 'stale'

export type RagDocumentSourceKind =
  | 'file'
  | 'paste'
  | 'workspace'
  | 'skill'
  | 'memory'
  | 'planning'

export interface RagDocument {
  id: string
  collectionId: string
  sourceKind: RagDocumentSourceKind
  sourcePath?: string
  displayName: string
  mime?: string
  bytes?: number
  hashSha256: string
  mtime?: number
  status: RagDocumentStatus
  statusDetail?: string
  chunkCount: number
  ingestedAt?: number
  updatedAt: number
}

/** Subset of rag_chunks columns useful for renderer-side rendering. */
export interface RagChunk {
  id: string
  documentId: string
  collectionId: string
  chunkIndex: number
  text: string
  headingPath?: string
  page?: number
  lineStart?: number
  lineEnd?: number
}

/** Placeholder — expanded in R7 (hybrid retrieval). */
export interface RetrievalResult {
  retrievalId: string
  chunks: RagChunk[]
}

/** Local embedder catalogue entry. Lockstep with
 *  `electron/services/rag/embeddings/catalog.ts`. */
export interface EmbedderInfo {
  id: string
  name: string
  dimensions: number
  approxBytes: number
  /** HF model id passed to transformers.js's `pipeline()`. */
  modelRef: string
  license?: string
  description?: string
}

/** Placeholder — expanded in R5 (ingest orchestrator). */
export interface IngestProgressEvent {
  jobId: string
  documentId: string
  displayName: string
  phase: RagDocumentStatus
  progress: number
  chunkCount?: number
  error?: string
}

export interface RagAttachment {
  conversationId: string
  collectionId?: string
  documentId?: string
  attachedAt: number
}

/** Per-message citation source map entry. Persisted on the message row's
 *  retrieval reference. Built by R10's context-builder. */
export interface CitationSource {
  id: number
  chunkId: string
  documentId: string
  displayName: string
  /** Compact locator string: "lines=X-Y" / "page=N" / "heading=..." */
  locator: string
}
