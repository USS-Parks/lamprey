import type { ThemePreset, ThemePresetTokens } from '@/lib/types'

const TOKEN_TO_VAR: Record<keyof ThemePresetTokens, string> = {
  bgPrimary: '--bg-primary',
  bgSecondary: '--bg-secondary',
  bgTertiary: '--bg-tertiary',
  border: '--border',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  textMuted: '--text-muted',
  accent: '--accent',
  accentDim: '--accent-dim',
  success: '--success',
  warning: '--warning',
  error: '--error',
  codeBg: '--code-bg'
}

export function applyThemePreset(preset: ThemePreset): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const [key, varName] of Object.entries(TOKEN_TO_VAR) as [
    keyof ThemePresetTokens,
    string
  ][]) {
    const value = preset.tokens[key]
    if (value) root.style.setProperty(varName, value)
  }
  root.dataset.themePreset = preset.id
}
