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
}
