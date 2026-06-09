import { ipcMain, shell, clipboard } from 'electron'
import * as projects from '../services/projects-store'
import { setConversationProject } from '../services/conversation-store'

export function registerProjectsHandlers(): void {
  ipcMain.handle('projects:list', async (_e, args?: { includeArchived?: boolean }) => {
    try {
      return { success: true, data: projects.listProjects(args?.includeArchived ?? false) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'list failed' }
    }
  })

  ipcMain.handle('projects:get', async (_e, id: string) => {
    try {
      const p = projects.getProject(id)
      if (!p) return { success: false, error: 'Project not found' }
      return { success: true, data: p }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'get failed' }
    }
  })

  ipcMain.handle(
    'projects:create',
    async (_e, input: { name: string; path?: string | null; description?: string | null }) => {
      try {
        if (!input?.name?.trim()) return { success: false, error: 'name required' }
        return { success: true, data: projects.createProject(input) }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'create failed' }
      }
    }
  )

  ipcMain.handle('projects:rename', async (_e, id: string, name: string) => {
    try {
      if (!name?.trim()) return { success: false, error: 'name required' }
      projects.renameProject(id, name.trim())
      return { success: true, data: true }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'rename failed' }
    }
  })

  ipcMain.handle('projects:setPinned', async (_e, id: string, pinned: boolean) => {
    try {
      projects.setProjectPinned(id, pinned)
      return { success: true, data: true }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'pin failed' }
    }
  })

  ipcMain.handle('projects:setArchived', async (_e, id: string, archived: boolean) => {
    try {
      projects.setProjectArchived(id, archived)
      return { success: true, data: true }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'archive failed' }
    }
  })

  ipcMain.handle('projects:delete', async (_e, id: string) => {
    try {
      projects.deleteProject(id)
      return { success: true, data: true }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'delete failed' }
    }
  })

  ipcMain.handle('projects:openFolder', async (_e, id: string) => {
    try {
      const p = projects.getProject(id)
      if (!p?.path) return { success: false, error: 'project has no path' }
      const err = await shell.openPath(p.path)
      if (err) return { success: false, error: err }
      return { success: true, data: true }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'open failed' }
    }
  })

  ipcMain.handle('projects:copyPath', async (_e, id: string) => {
    try {
      const p = projects.getProject(id)
      if (!p?.path) return { success: false, error: 'project has no path' }
      clipboard.writeText(p.path)
      return { success: true, data: true }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'copy failed' }
    }
  })

  ipcMain.handle(
    'projects:assignConversation',
    async (_e, conversationId: string, projectId: string | null) => {
      try {
        setConversationProject(conversationId, projectId)
        return { success: true, data: true }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'assign failed' }
      }
    }
  )

  ipcMain.handle(
    'projects:ensureForPath',
    async (_e, path: string, fallbackName?: string) => {
      try {
        if (!path) return { success: false, error: 'path required' }
        return { success: true, data: projects.ensureProjectForPath(path, fallbackName) }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'ensure failed' }
      }
    }
  )

  ipcMain.handle('projects:select', async (_e, id: string) => {
    try {
      const p = projects.selectProject(id)
      if (!p) return { success: false, error: 'Project not found' }
      return { success: true, data: p }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'select failed' }
    }
  })

  ipcMain.handle(
    'projects:update',
    async (_e, id: string, patch: projects.UpdateProjectInput) => {
      try {
        const p = projects.updateProject(id, patch)
        if (!p) return { success: false, error: 'Project not found' }
        return { success: true, data: p }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'update failed' }
      }
    }
  )
}
