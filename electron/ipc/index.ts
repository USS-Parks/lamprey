// Load the native tool packs once, before any IPC handler can dispatch a
// tool call. Must precede the chat handler import: chat.ts pulls in
// tool-registry, and the registry must already exist when each pack's
// top-level `toolRegistry.registerNative(...)` runs. See
// electron/services/tool-packs.ts for why this is its own module.
import '../services/tool-packs'

import { registerChatHandlers } from './chat'
import { registerConversationHandlers } from './conversation'
import { registerSettingsHandlers } from './settings'
import { registerModelHandlers } from './model'
import { registerSkillsHandlers } from './skills'
import { registerMemoryHandlers } from './memory'
import { registerMcpHandlers } from './mcp'
import { registerArtifactHandlers } from './artifact'
import { registerFilesHandlers } from './files'
import { registerTerminalHandlers } from './terminal'
import { registerBrowserHandlers } from './browser'
import { registerReviewHandlers } from './review'
import { registerWorktreeHandlers } from './worktree'
import { registerHooksHandlers } from './hooks'
import { registerAutomationsHandlers } from './automations'
import { registerProjectsHandlers } from './projects'
import { registerToolsHandlers } from './tools'
import { registerPermissionsHandlers } from './permissions'
import { registerWebToolsHandlers } from './web-tools'
import { registerCurrentInfoHandlers } from './current-info'
import { registerImageToolsHandlers } from './image-tools'
import { registerPlanHandlers } from './plan'
import { registerGitHubHandlers } from './github'
import { registerEventsHandlers } from './events'
import { registerRagHandlers } from './rag'
import { registerSlashHandlers } from './slash'
import { registerChaptersHandlers } from './chapters'
import { registerTasksHandlers } from './tasks'
import { registerWorkflowsHandlers } from './workflows'
import { registerMonitorHandlers } from './monitor'
import { registerAsyncEventHandlers } from './async-events'
import { registerLoopsHandlers } from './loops'
import { registerNotificationsHandlers } from './notifications'
import { registerSessionsMessagingHandlers } from './sessions-messaging'
import { registerAskUserHandlers } from './ask-user'
import { registerStatusLineHandlers } from './statusline'
import { registerResearchHandlers } from './research'

export function registerAllIpcHandlers(): void {
  registerChatHandlers()
  registerConversationHandlers()
  registerSettingsHandlers()
  registerModelHandlers()
  registerSkillsHandlers()
  registerMemoryHandlers()
  registerMcpHandlers()
  registerArtifactHandlers()
  registerFilesHandlers()
  registerTerminalHandlers()
  registerBrowserHandlers()
  registerReviewHandlers()
  registerWorktreeHandlers()
  registerHooksHandlers()
  registerAutomationsHandlers()
  registerProjectsHandlers()
  registerToolsHandlers()
  // permissions must register after chat so its mcp:approveToolCall override
  // wins (chat.ts no longer claims that channel; see permissions.ts).
  registerPermissionsHandlers()
  registerWebToolsHandlers()
  registerCurrentInfoHandlers()
  registerImageToolsHandlers()
  registerPlanHandlers()
  registerGitHubHandlers()
  registerEventsHandlers()
  registerRagHandlers()
  registerSlashHandlers()
  registerChaptersHandlers()
  registerTasksHandlers()
  registerWorkflowsHandlers()
  registerMonitorHandlers()
  registerAsyncEventHandlers()
  registerLoopsHandlers()
  registerNotificationsHandlers()
  registerSessionsMessagingHandlers()
  registerAskUserHandlers()
  registerStatusLineHandlers()
  registerResearchHandlers()
}
