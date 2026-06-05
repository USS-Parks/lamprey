import { create } from 'zustand'
import type { LoadedPlugin } from '@/lib/types'
import { toast } from '@/stores/toast-store'

interface PluginsState {
  plugins: LoadedPlugin[]
  loaded: boolean
  loadPlugins: () => Promise<void>
  setPluginsFromEvent: (entries: LoadedPlugin[]) => void
  enable: (id: string) => Promise<void>
  disable: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  installFromDirectory: (srcPath: string) => Promise<{ ok: boolean; id?: string; error?: string }>
  pickDirectoryAndInstall: () => Promise<{ ok: boolean; id?: string; error?: string }>
}

export const usePluginsStore = create<PluginsState>((set, get) => ({
  plugins: [],
  loaded: false,

  loadPlugins: async () => {
    if (!window.api?.plugins) return
    const result = await window.api.plugins.list()
    if (result.success) {
      set({ plugins: (result.data as LoadedPlugin[]) ?? [], loaded: true })
    }
  },

  setPluginsFromEvent: (entries: LoadedPlugin[]) => {
    set({ plugins: entries, loaded: true })
  },

  enable: async (id: string) => {
    if (!window.api?.plugins) return
    const result = await window.api.plugins.enable(id)
    if (!result.success) {
      toast.error(`Failed to enable plugin: ${result.error}`)
      return
    }
    await get().loadPlugins()
  },

  disable: async (id: string) => {
    if (!window.api?.plugins) return
    const result = await window.api.plugins.disable(id)
    if (!result.success) {
      toast.error(`Failed to disable plugin: ${result.error}`)
      return
    }
    await get().loadPlugins()
  },

  remove: async (id: string) => {
    if (!window.api?.plugins) return
    const result = await window.api.plugins.remove(id)
    if (result.success) {
      toast.success('Plugin removed')
    } else {
      toast.error(`Failed to remove plugin: ${result.error}`)
    }
    await get().loadPlugins()
  },

  installFromDirectory: async (srcPath: string) => {
    if (!window.api?.plugins) return { ok: false, error: 'plugins API missing' }
    const result = await window.api.plugins.installFromDirectory(srcPath)
    if (result.success) {
      const id = (result.data as { id?: string } | null)?.id
      toast.success(id ? `Installed plugin "${id}"` : 'Plugin installed')
      await get().loadPlugins()
      return { ok: true, id }
    }
    return { ok: false, error: result.error }
  },

  pickDirectoryAndInstall: async () => {
    if (!window.api?.plugins) return { ok: false, error: 'plugins API missing' }
    const picked = await window.api.plugins.pickDirectory()
    if (!picked.success) return { ok: false, error: picked.error }
    const srcPath = picked.data as string | null
    if (!srcPath) return { ok: false, error: 'No directory selected' }
    return get().installFromDirectory(srcPath)
  }
}))
