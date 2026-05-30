import { useSettingsStore } from '@/stores/settings-store'
import { THEME_PRESETS, getPreset } from '@/styles/theme-presets'
import { ModelSwitcher } from '@/components/model/ModelSwitcher'
import logoUrl from '@assets/Lamprey Logo Transparent.png'
import settingsIconUrl from '@assets/Lamprey Settings Icon.png'

interface TitlebarProps {
  onSettingsClick: () => void
}

export function Titlebar({ onSettingsClick }: TitlebarProps) {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const activePreset = getPreset(settings.themePreset)

  return (
    <div
      className="flex h-12 items-center justify-between border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="flex items-center gap-2 font-mono text-sm font-semibold tracking-wide text-[var(--text-primary)]">
        <img src={logoUrl} alt="" aria-hidden className="h-7 w-7 object-contain" />
        Lamprey
      </span>

      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="flex items-center gap-2"
      >
        <ModelSwitcher />
      </div>

      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <label
          className="relative flex cursor-pointer items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          title="Switch theme preset"
        >
          <span
            aria-hidden
            className="block h-2.5 w-2.5 rounded-full border border-black/40"
            style={{ backgroundColor: activePreset.tokens.accent }}
          />
          <span className="max-w-[110px] truncate">{activePreset.name}</span>
          <select
            value={settings.themePreset}
            onChange={(e) => updateSettings({ themePreset: e.target.value as typeof settings.themePreset })}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Theme preset"
          >
            {THEME_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={onSettingsClick}
          className="rounded p-1 transition-colors hover:bg-[var(--bg-tertiary)]"
          title="Settings (Ctrl+,)"
        >
          <img src={settingsIconUrl} alt="Settings" className="h-6 w-6 object-contain" />
        </button>
      </div>
    </div>
  )
}
