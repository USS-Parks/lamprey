import { create } from 'zustand'
import type { AppSettings } from '@/lib/types'
import { DEFAULT_PRESET_ID, getPreset } from '@/styles/theme-presets'
import { applyThemePreset } from '@/styles/apply-theme'

const defaultSettings: AppSettings = {
  theme: 'dark',
  themePreset: DEFAULT_PRESET_ID,
  fontSize: 14,
  defaultModel: 'deepseek-chat',
  sidebarCollapsed: false,
  artifactPanelWidth: 420,
  minimizeToTray: false,
  autoCheckUpdates: true,
  aiGeneratedTitles: false
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
      const merged: AppSettings = { ...defaultSettings, ...(result.data as Partial<AppSettings>) }
      set({ settings: merged, loaded: true })
      applyThemePreset(getPreset(merged.themePreset))
    }
  },

  updateSettings: async (partial: Partial<AppSettings>) => {
    const current = get().settings
    const updated = { ...current, ...partial }
    set({ settings: updated })
    if (partial.themePreset && partial.themePreset !== current.themePreset) {
      applyThemePreset(getPreset(updated.themePreset))
    }
    await window.api.settings.set(partial as Record<string, unknown>)
  }
}))
