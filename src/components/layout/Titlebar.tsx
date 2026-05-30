import { useChatStore } from '@/stores/chat-store'
import { useModelStore } from '@/stores/model-store'
import { useSettingsStore } from '@/stores/settings-store'
import { THEME_PRESETS, getPreset } from '@/styles/theme-presets'

interface TitlebarProps {
  onSettingsClick: () => void
}

export function Titlebar({ onSettingsClick }: TitlebarProps) {
  const { activeModel, setModel } = useChatStore()
  const { models } = useModelStore()
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const activePreset = getPreset(settings.themePreset)

  return (
    <div
      className="flex h-12 items-center justify-between border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="font-mono text-sm font-semibold tracking-wide text-[var(--text-primary)]">
        Lamprey
      </span>

      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="flex items-center gap-2"
      >
        <select
          value={activeModel}
          onChange={(e) => setModel(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-xs text-[var(--text-secondary)] outline-none focus:border-[var(--accent)]"
          title={activeModel === 'deepseek-reasoner' ? 'R1 does not support tool use. MCP tools unavailable while R1 is active.' : undefined}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          {models.length === 0 && (
            <>
              <option value="deepseek-chat">DeepSeek V3</option>
              <option value="deepseek-reasoner">DeepSeek R1</option>
            </>
          )}
        </select>
        {activeModel === 'deepseek-reasoner' && (
          <span className="font-mono text-[10px] text-[var(--warning)]" title="R1 does not support tool use. MCP tools unavailable while R1 is active.">
            No tools
          </span>
        )}
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
          className="rounded p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          title="Settings (Ctrl+,)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>
      </div>
    </div>
  )
}
