import { useSettingsStore } from '@/stores/settings-store'

export function GeneralSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  return (
    <div className="space-y-5">
      <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">General</h3>

      <section className="space-y-3">
        <h4 className="font-mono text-[13px] uppercase tracking-wider text-[var(--text-muted)]">
          Conversation titles
        </h4>
        <label className="flex cursor-pointer items-start gap-3 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)]">
          <input
            type="checkbox"
            checked={settings.aiGeneratedTitles}
            onChange={(e) => updateSettings({ aiGeneratedTitles: e.target.checked })}
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
          />
          <span className="flex-1">
            <span className="block font-medium text-[var(--text-primary)]">AI-generated titles</span>
            <span className="mt-1 block text-[13px] leading-relaxed text-[var(--text-muted)]">
              After the first response, ask DeepSeek for a 3-5 word title. Defaults off - without it
              we use the first 40 characters of your opening message.
            </span>
          </span>
        </label>
      </section>
    </div>
  )
}
