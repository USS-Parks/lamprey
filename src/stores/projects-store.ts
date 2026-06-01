import { create } from 'zustand'
import type { Project } from '@/lib/types'
import { toast } from '@/stores/toast-store'

interface ProjectsState {
  projects: Project[]
  loading: boolean
  loadProjects: () => Promise<void>
  createProject: (name: string, path?: string | null) => Promise<Project | null>
  renameProject: (id: string, name: string) => Promise<void>
  pinProject: (id: string, pinned: boolean) => Promise<void>
  archiveProject: (id: string, archived: boolean) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  openFolder: (id: string) => Promise<void>
  copyPath: (id: string) => Promise<void>
  assignConversation: (conversationId: string, projectId: string | null) => Promise<void>
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  loading: false,

  loadProjects: async () => {
    if (!window.api?.projects) return
    set({ loading: true })
    const res = await window.api.projects.list()
    if (res.success) set({ projects: res.data as Project[], loading: false })
    else {
      set({ loading: false })
      toast.error(res.error || 'Failed to load projects')
    }
  },

  createProject: async (name, path) => {
    if (!window.api?.projects) return null
    const res = await window.api.projects.create({ name, path: path ?? null })
    if (res.success) {
      const project = res.data as Project
      set({ projects: [project, ...get().projects] })
      return project
    }
    toast.error(res.error || 'Create project failed')
    return null
  },

  renameProject: async (id, name) => {
    if (!window.api?.projects) return
    const res = await window.api.projects.rename(id, name)
    if (res.success) {
      set({
        projects: get().projects.map((p) => (p.id === id ? { ...p, name } : p))
      })
    } else toast.error(res.error || 'Rename failed')
  },

  pinProject: async (id, pinned) => {
    if (!window.api?.projects) return
    const res = await window.api.projects.setPinned(id, pinned)
    if (res.success) {
      set({
        projects: get().projects.map((p) => (p.id === id ? { ...p, pinned } : p))
      })
    } else toast.error(res.error || 'Pin failed')
  },

  archiveProject: async (id, archived) => {
    if (!window.api?.projects) return
    const res = await window.api.projects.setArchived(id, archived)
    if (res.success) {
      set({
        projects: get().projects.filter((p) => (archived ? p.id !== id : true))
      })
    } else toast.error(res.error || 'Archive failed')
  },

  deleteProject: async (id) => {
    if (!window.api?.projects) return
    const res = await window.api.projects.delete(id)
    if (res.success) {
      set({ projects: get().projects.filter((p) => p.id !== id) })
    } else toast.error(res.error || 'Delete failed')
  },

  openFolder: async (id) => {
    if (!window.api?.projects) return
    const res = await window.api.projects.openFolder(id)
    if (!res.success) toast.error(res.error || 'Open folder failed')
  },

  copyPath: async (id) => {
    if (!window.api?.projects) return
    const res = await window.api.projects.copyPath(id)
    if (res.success) toast.success('Path copied')
    else toast.error(res.error || 'Copy failed')
  },

  assignConversation: async (conversationId, projectId) => {
    if (!window.api?.projects) return
    const res = await window.api.projects.assignConversation(conversationId, projectId)
    if (!res.success) toast.error(res.error || 'Assign failed')
  }
}))
