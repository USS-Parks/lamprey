import { registerChatHandlers } from './chat'
import { registerConversationHandlers } from './conversation'
import { registerSettingsHandlers } from './settings'
import { registerModelHandlers } from './model'
import { registerSkillsHandlers } from './skills'
import { registerMemoryHandlers } from './memory'
import { registerMcpHandlers } from './mcp'
import { registerArtifactHandlers } from './artifact'
import { registerFilesHandlers } from './files'

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
}
