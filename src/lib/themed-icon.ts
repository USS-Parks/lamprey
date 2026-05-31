import { useSettingsStore } from '@/stores/settings-store'

/** Pick the right asset URL based on the active light/dark theme mode.
 *  Pass the regular (light-mode) URL first, the dark-view URL second.
 *  Both variants are expected to be transparent-background PNGs. */
export function useThemedIcon(lightUrl: string, darkUrl: string): string {
  const mode = useSettingsStore((s) => s.settings.themeMode)
  return mode === 'dark' ? darkUrl : lightUrl
}
