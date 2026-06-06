import { useSettingsStore } from '@/stores/settings-store'
import { THEME_PRESETS } from '@/styles/theme-presets'
import type { ThemePreset } from '@/lib/types'

export function AppearanceSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const handleSelect = async (preset: ThemePreset) => {
    if (settings.themePreset === preset.id) return
    await updateSettings({ themePreset: preset.id })
  }

  const isDark = settings.themeMode === 'dark'

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">Appearance</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Color presets affect interface tokens only. Layout and accessibility structure remain
          unchanged.
        </p>
      </div>

      <div>
        <div className="mb-2 text-[13px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Mode
        </div>
        <div className="inline-flex overflow-hidden rounded-md border border-[var(--panel-border)]">
          <button
            onClick={() => updateSettings({ themeMode: 'light' })}
            aria-pressed={!isDark}
            className={`px-3 py-1.5 text-xs transition-colors ${
              !isDark
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            Light
          </button>
          <button
            onClick={() => updateSettings({ themeMode: 'dark' })}
            aria-pressed={isDark}
            className={`px-3 py-1.5 text-xs transition-colors ${
              isDark
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            Dark
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {THEME_PRESETS.map((preset) => {
          const active = settings.themePreset === preset.id
          return (
            <button
              key={preset.id}
              onClick={() => handleSelect(preset)}
              aria-pressed={active}
              className={`flex flex-col items-stretch gap-2 rounded border bg-[var(--bg-primary)] p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                active
                  ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]'
                  : 'border-[var(--panel-border)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-xs font-medium text-[var(--text-primary)]">
                  {preset.name}
                </span>
                {active && (
                  <span className="rounded bg-[var(--accent-dim)] px-1.5 py-0.5 text-[12px] uppercase tracking-wider text-[var(--accent)]">
                    Active
                  </span>
                )}
              </div>
              <span className="text-[12px] text-[var(--text-muted)]">{preset.source}</span>
              <div className="flex items-center gap-1">
                {preset.swatch.map((color, idx) => (
                  <span
                    key={`${preset.id}-${idx}`}
                    title={color}
                    className="block h-4 w-4 rounded-full border border-black/40"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
