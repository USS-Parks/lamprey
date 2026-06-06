import { create } from 'zustand'
import type { AppSettings } from '@/lib/types'
import { DEFAULT_PRESET_ID, DEFAULT_THEME_MODE, getPreset } from '@/styles/theme-presets'
import { applyThemePreset } from '@/styles/apply-theme'

const defaultSettings: AppSettings = {
  theme: 'dark',
  themePreset: DEFAULT_PRESET_ID,
  themeMode: DEFAULT_THEME_MODE,
  fontSize: 14,
  defaultModel: 'deepseek-v4-pro',
  sidebarCollapsed: false,
  artifactPanelWidth: 420,
  minimizeToTray: false,
  autoCheckUpdates: true,
  aiGeneratedTitles: false,
  modelConfig: {},
  customModels: [],
  agentMode: 'single',
  agentRoster: {
    planner: 'deepseek-v4-pro',
    coder: 'deepseek-v4-flash',
    reviewer: 'deepseek-v4-pro',
    coworker: 'qwen3-coder-plus'
  },
  agenticCodingMode: false,
  agenticCodingSkills: ['plan', 'context', 'verify'],
  agenticCodingComposer: 'auto',
  snipEnabled: true,
  snipVerbose: false,
  // R8 default — ON per user direction (2026-06-06). Closes the audit
  // gap where the model couldn't see its own past chain-of-thought on
  // follow-up turns. User-toggle lands in R9's Settings → Reasoning
  // Audit panel; flipping off is a power-user opt-out to save context
  // tokens on long conversations.
  includePastReasoningInContext: true
}

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  loadSettings: () => Promise<void>
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>
  toggleThemeMode: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  loaded: false,

  loadSettings: async () => {
    const result = await window.api.settings.get()
    if (result.success) {
      const merged: AppSettings = { ...defaultSettings, ...(result.data as Partial<AppSettings>) }
      set({ settings: merged, loaded: true })
      applyThemePreset(getPreset(merged.themePreset), merged.themeMode)
    }
  },

  updateSettings: async (partial: Partial<AppSettings>) => {
    const current = get().settings
    const updated = { ...current, ...partial }
    set({ settings: updated })
    const presetChanged = partial.themePreset && partial.themePreset !== current.themePreset
    const modeChanged = partial.themeMode && partial.themeMode !== current.themeMode
    if (presetChanged || modeChanged) {
      applyThemePreset(getPreset(updated.themePreset), updated.themeMode)
    }
    await window.api.settings.set(partial as Record<string, unknown>)
  },

  toggleThemeMode: async () => {
    const current = get().settings.themeMode
    const next = current === 'dark' ? 'light' : 'dark'
    await get().updateSettings({ themeMode: next })
  }
}))
