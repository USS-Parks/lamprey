import { create } from 'zustand'
import type { AppSettings } from '@/lib/types'

const defaultSettings: AppSettings = {
  theme: 'dark',
  fontSize: 14,
  defaultModel: 'deepseek-chat',
  sidebarCollapsed: false,
  artifactPanelWidth: 420,
  minimizeToTray: false,
  autoCheckUpdates: true
}

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  loadSettings: () => Promise<void>
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  loaded: false,

  loadSettings: async () => {
    const result = await window.api.settings.get()
    if (result.success) {
      set({ settings: { ...defaultSettings, ...result.data }, loaded: true })
    }
  },

  updateSettings: async (partial: Partial<AppSettings>) => {
    const current = get().settings
    const updated = { ...current, ...partial }
    set({ settings: updated })
    await window.api.settings.set(partial as Record<string, unknown>)
  }
}))
