import type {
  IpcResponse,
  ChatRequest,
  ChatChunkEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ToolCallEvent,
  ToolCallResultEvent,
  Conversation,
  Message,
  Skill,
  MemoryEntry,
  McpServerConfig,
  McpStatusEvent,
  McpConfirmationEvent,
  ModelInfo,
  AppSettings,
  ArtifactBounds,
  ArtifactType
} from './types'

const api = window.api

export const chat = {
  send: (request: ChatRequest): Promise<IpcResponse<{ conversationId: string }>> =>
    api.chat.send(request),
  cancel: (conversationId: string): Promise<IpcResponse<void>> =>
    api.chat.cancel(conversationId),
  onChunk: (cb: (e: ChatChunkEvent) => void) => api.chat.onChunk(cb),
  onDone: (cb: (e: ChatDoneEvent) => void) => api.chat.onDone(cb as any),
  onError: (cb: (e: ChatErrorEvent) => void) => api.chat.onError(cb),
  onToolCall: (cb: (e: ToolCallEvent) => void) => api.chat.onToolCall(cb as any),
  onToolCallResult: (cb: (e: ToolCallResultEvent) => void) =>
    api.chat.onToolCallResult(cb as any),
  offAll: () => api.chat.offAll()
}

export const conversation = {
  list: (): Promise<IpcResponse<Conversation[]>> => api.conversation.list(),
  get: (id: string): Promise<IpcResponse<Conversation>> => api.conversation.get(id),
  create: (model: string): Promise<IpcResponse<Conversation>> => api.conversation.create(model),
  delete: (id: string): Promise<IpcResponse<void>> => api.conversation.delete(id),
  updateTitle: (id: string, title: string): Promise<IpcResponse<void>> =>
    api.conversation.updateTitle(id, title),
  getMessages: (id: string): Promise<IpcResponse<Message[]>> => api.conversation.getMessages(id)
}

export const settings = {
  get: (): Promise<IpcResponse<AppSettings>> => api.settings.get(),
  set: (partial: Partial<AppSettings>): Promise<IpcResponse<void>> =>
    api.settings.set(partial as Record<string, unknown>),
  saveApiKey: (key: string): Promise<IpcResponse<void>> => api.settings.saveApiKey(key),
  hasApiKey: (): Promise<IpcResponse<boolean>> => api.settings.hasApiKey(),
  testApiKey: (): Promise<IpcResponse<boolean>> => api.settings.testApiKey(),
  saveGoogleCredentials: (
    clientId: string,
    clientSecret: string
  ): Promise<IpcResponse<void>> => api.settings.saveGoogleCredentials(clientId, clientSecret)
}

export const model = {
  list: (): Promise<IpcResponse<ModelInfo[]>> => api.model.list(),
  getActive: (): Promise<IpcResponse<string>> => api.model.getActive(),
  setActive: (id: string): Promise<IpcResponse<void>> => api.model.setActive(id)
}

export const skills = {
  list: (): Promise<IpcResponse<Skill[]>> => api.skills.list(),
  create: (skill: {
    name: string
    description: string
    content: string
  }): Promise<IpcResponse<Skill>> => api.skills.create(skill),
  update: (
    id: string,
    skill: { name: string; description: string; content: string }
  ): Promise<IpcResponse<Skill>> => api.skills.update(id, skill),
  delete: (id: string): Promise<IpcResponse<void>> => api.skills.delete(id),
  onChanged: (cb: (skills: Skill[]) => void) => api.skills.onChanged(cb as any)
}

export const memory = {
  list: (): Promise<IpcResponse<MemoryEntry[]>> => api.memory.list(),
  add: (content: string): Promise<IpcResponse<MemoryEntry>> => api.memory.add(content),
  update: (id: number, content: string): Promise<IpcResponse<MemoryEntry>> =>
    api.memory.update(id, content),
  delete: (id: number): Promise<IpcResponse<void>> => api.memory.delete(id),
  clear: (): Promise<IpcResponse<void>> => api.memory.clear(),
  export: (): Promise<IpcResponse<string>> => api.memory.export(),
  import: (entries: MemoryEntry[]): Promise<IpcResponse<void>> => api.memory.import(entries),
  onAdded: (cb: (entry: MemoryEntry) => void) => api.memory.onAdded(cb as any)
}

export const mcp = {
  list: (): Promise<IpcResponse<McpServerConfig[]>> => api.mcp.list(),
  getStatus: (id: string): Promise<IpcResponse<McpServerConfig['status']>> =>
    api.mcp.getStatus(id),
  reconnect: (id: string): Promise<IpcResponse<void>> => api.mcp.reconnect(id),
  setupGoogleOAuth: (): Promise<IpcResponse<void>> => api.mcp.setupGoogleOAuth(),
  approveToolCall: (callId: string, approved: boolean): Promise<IpcResponse<void>> =>
    api.mcp.approveToolCall(callId, approved),
  onStatusChanged: (cb: (e: McpStatusEvent) => void) => api.mcp.onStatusChanged(cb as any),
  onConfirmationRequired: (cb: (e: McpConfirmationEvent) => void) =>
    api.mcp.onConfirmationRequired(cb as any)
}

// GitHub façade. The main side owns tokens; the renderer only sees these
// typed responses (never the bearer).
import type {
  GitHubConnectionStatus,
  GitHubViewer,
  GitHubRepository,
  GitHubPullRequest,
  GitHubCompareSummary,
  GitHubProjectRepoLink,
  ConversationPullRequestLink,
  PushBranchResult,
  OAuthLoginResult
} from './github-types'

export const github = {
  status: (): Promise<IpcResponse<GitHubConnectionStatus>> => api.github.status(),
  hasOAuthClient: (): Promise<IpcResponse<boolean>> => api.github.hasOAuthClient(),
  hasBundledClient: (): Promise<IpcResponse<boolean>> => api.github.hasBundledClient(),
  saveOAuthClient: (clientId: string, clientSecret: string): Promise<IpcResponse<null>> =>
    api.github.saveOAuthClient({ clientId, clientSecret }),
  setMode: (mode: 'oauth' | 'github_app' | 'gh-cli' | 'none'): Promise<IpcResponse<null>> =>
    api.github.setMode(mode),
  connect: (): Promise<IpcResponse<OAuthLoginResult>> => api.github.connect(),
  disconnect: (): Promise<IpcResponse<null>> => api.github.disconnect(),
  viewer: (): Promise<IpcResponse<GitHubViewer>> => api.github.viewer(),
  repositories: (args?: { page?: number; perPage?: number }): Promise<IpcResponse<GitHubRepository[]>> =>
    api.github.repositories(args),
  getRepository: (owner: string, repo: string): Promise<IpcResponse<GitHubRepository>> =>
    api.github.getRepository({ owner, repo }),
  pickCloneDir: (): Promise<IpcResponse<string | null>> => api.github.pickCloneDir(),
  clone: (owner: string, repo: string, targetDir: string): Promise<IpcResponse<{ localPath: string }>> =>
    api.github.clone({ owner, repo, targetDir }),
  resolveCloneTarget: (
    baseDir: string,
    repoName: string
  ): Promise<IpcResponse<{ targetPath: string }>> =>
    api.github.resolveCloneTarget({ baseDir, repoName }),
  getProjectRepo: (projectId: string): Promise<IpcResponse<GitHubProjectRepoLink | null>> =>
    api.github.getProjectRepo({ projectId }),
  assignRepoToProject: (
    projectId: string,
    owner: string,
    repo: string,
    localPath?: string | null
  ): Promise<IpcResponse<GitHubProjectRepoLink>> =>
    api.github.assignRepoToProject({ projectId, owner, repo, localPath }),
  unlinkRepo: (projectId: string): Promise<IpcResponse<null>> =>
    api.github.unlinkRepo({ projectId }),
  compare: (
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<IpcResponse<GitHubCompareSummary>> =>
    api.github.compare({ owner, repo, base, head }),
  createPullRequest: (args: {
    owner: string
    repo: string
    title: string
    body?: string
    head: string
    base: string
    draft?: boolean
    headLabel?: string
    conversationId?: string
  }): Promise<IpcResponse<GitHubPullRequest>> => api.github.createPullRequest(args),
  pullRequests: (
    owner: string,
    repo: string,
    opts?: { state?: 'open' | 'closed' | 'all'; per_page?: number }
  ): Promise<IpcResponse<GitHubPullRequest[]>> =>
    api.github.pullRequests({ owner, repo, ...(opts ?? {}) }),
  getPullRequest: (owner: string, repo: string, number: number): Promise<IpcResponse<GitHubPullRequest>> =>
    api.github.getPullRequest({ owner, repo, number }),
  listConversationPullRequests: (conversationId: string): Promise<IpcResponse<ConversationPullRequestLink[]>> =>
    api.github.listConversationPullRequests({ conversationId }),
  pushBranch: (args: {
    cwd: string
    branch: string
    owner: string
    repo: string
    setUpstream?: boolean
  }): Promise<IpcResponse<PushBranchResult>> => api.github.pushBranch(args),
  openInBrowser: (url: string): Promise<IpcResponse<null>> => api.github.openInBrowser(url)
}

export const artifact = {
  render: (type: ArtifactType, content: string): Promise<IpcResponse<void>> =>
    api.artifact.render(type, content),
  hide: (): Promise<IpcResponse<void>> => api.artifact.hide(),
  resize: (bounds: ArtifactBounds): Promise<IpcResponse<void>> => api.artifact.resize(bounds),
  openInWindow: (type: ArtifactType, content: string): Promise<IpcResponse<void>> =>
    api.artifact.openInWindow(type, content)
}
