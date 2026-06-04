import { ipcMain } from 'electron'
import {
  listSlashCommands,
  resolveSlashCommand
} from '../services/slash-commands'

// Track 2 / C4 — slash-command IPC. `slash:list` ships the discovered
// command set (built-ins + user overrides) for the palette/autocomplete;
// `slash:resolve` interpolates and returns the assembled prompt. The
// renderer dispatches the prompt as a normal user turn — slash commands
// are syntactic sugar over `chat:send`, not a separate transport.
//
// Hidden commands stay out of the listing but `slash:resolve` still
// resolves them when called by name, so a user can type the name
// verbatim and still get the template.

export function registerSlashHandlers(): void {
  ipcMain.handle('slash:list', async () => {
    try {
      const all = listSlashCommands()
      return { success: true, data: all.filter((c) => !c.hidden) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'slash:list failed' }
    }
  })

  ipcMain.handle('slash:listAll', async () => {
    try {
      return { success: true, data: listSlashCommands() }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'slash:listAll failed' }
    }
  })

  ipcMain.handle(
    'slash:resolve',
    async (_event, payload: { name: string; rest?: string }) => {
      try {
        if (!payload || typeof payload.name !== 'string') {
          return { success: false, error: 'name required' }
        }
        const r = resolveSlashCommand(payload.name, payload.rest ?? '')
        if (!r) {
          return { success: false, error: `Unknown slash command: ${payload.name}` }
        }
        return { success: true, data: r }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'slash:resolve failed' }
      }
    }
  )
}
