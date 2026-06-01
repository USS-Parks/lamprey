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
}
