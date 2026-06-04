import { useSettingsStore } from '@/stores/settings-store'
import { CONTEXT_ROUTING_PRESETS, type ContextRoutingSettings } from '@/lib/types'

// Settings panel for H4/H5 — per-type inline thresholds. Lets users tune
// the file-router decisions without editing settings.json by hand. Three
// presets (DeepSeek = default, Claude = conservative, Local = very
// conservative) plus per-field numeric overrides.

interface Row {
  field: keyof ContextRoutingSettings
  label: string
  hint: string
}

const ROWS: Row[] = [
  {
    field: 'proseInlineMaxBytes',
    label: 'Prose inline cap (.md, .txt, .rst)',
    hint: 'At/below this size, the file goes inline as text. Above → RAG.'
  },
  {
    field: 'structuredInlineMaxBytes',
    label: 'Structured-data inline cap (.json, .csv, .yaml, .xml)',
    hint: 'At/below this size, inline silently. Above → inline with warning.'
  },
  {
    field: 'structuredInlineWarnMaxBytes',
    label: 'Structured-data warning cap',
    hint: 'Above this size, structured-data attachments are rejected; use read_file with offset/limit.'
  },
  {
    field: 'codeInlineMaxBytes',
    label: 'Source-code inline cap',
    hint: 'At/below this size, inline silently. Above → suggest using agentic tools.'
  },
  {
    field: 'codeInlineWarnMaxBytes',
    label: 'Source-code reject cap',
    hint: 'Above this size, code attachments are rejected; the model uses grep_workspace + read_file.'
  }
]

function bytesToHuman(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function parseHuman(input: string): number | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null
  const m = trimmed.match(/^([\d.]+)\s*(b|kb|k|mb|m)?$/)
  if (!m) return null
  const n = Number.parseFloat(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2] ?? 'b'
  switch (unit) {
    case 'kb':
    case 'k':
      return Math.round(n * 1024)
    case 'mb':
    case 'm':
      return Math.round(n * 1024 * 1024)
    case 'b':
    default:
      return Math.round(n)
  }
}

export function ContextRoutingSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const current = settings.contextRouting ?? {}
  // For the inputs we always show the effective value (override if set,
  // else the deepseek default). This makes "what will actually happen"
  // visible without forcing the user to remember the defaults.
  const effective: Required<ContextRoutingSettings> = {
    proseInlineMaxBytes:
      current.proseInlineMaxBytes ?? CONTEXT_ROUTING_PRESETS.deepseek.proseInlineMaxBytes,
    structuredInlineMaxBytes:
      current.structuredInlineMaxBytes ?? CONTEXT_ROUTING_PRESETS.deepseek.structuredInlineMaxBytes,
    structuredInlineWarnMaxBytes:
      current.structuredInlineWarnMaxBytes ??
      CONTEXT_ROUTING_PRESETS.deepseek.structuredInlineWarnMaxBytes,
    codeInlineMaxBytes:
      current.codeInlineMaxBytes ?? CONTEXT_ROUTING_PRESETS.deepseek.codeInlineMaxBytes,
    codeInlineWarnMaxBytes:
      current.codeInlineWarnMaxBytes ?? CONTEXT_ROUTING_PRESETS.deepseek.codeInlineWarnMaxBytes
  }

  function applyPreset(preset: keyof typeof CONTEXT_ROUTING_PRESETS): void {
    updateSettings({ contextRouting: { ...CONTEXT_ROUTING_PRESETS[preset] } })
  }

  function resetToDefaults(): void {
    updateSettings({ contextRouting: undefined })
  }

  function setField(field: keyof ContextRoutingSettings, raw: string): void {
    const parsed = parseHuman(raw)
    if (parsed === null) return
    updateSettings({ contextRouting: { ...current, [field]: parsed } })
  }

  return (
    <div className="space-y-5">
      <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">
        Context routing
      </h3>
      <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
        Per file-type thresholds the router uses to decide between inline, RAG, or "use
        the agentic tools." Documents (.pdf, .docx) always RAG; images always inline.
        Defaults are tuned for cheap-token providers (DeepSeek, Gemma, Qwen).
      </p>

      <section className="space-y-2">
        <h4 className="font-mono text-[13px] uppercase tracking-wider text-[var(--text-muted)]">
          Presets
        </h4>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => applyPreset('deepseek')}
            className="rounded-full border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            DeepSeek (default)
          </button>
          <button
            type="button"
            onClick={() => applyPreset('claude')}
            className="rounded-full border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            Claude (conservative)
          </button>
          <button
            type="button"
            onClick={() => applyPreset('local')}
            className="rounded-full border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            Local model (very conservative)
          </button>
          <button
            type="button"
            onClick={resetToDefaults}
            className="rounded-full border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]"
          >
            Reset overrides
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="font-mono text-[13px] uppercase tracking-wider text-[var(--text-muted)]">
          Thresholds
        </h4>
        <p className="text-[12px] text-[var(--text-muted)]">
          Values accept B, KB, MB suffixes (e.g. <code>50 KB</code>, <code>2 MB</code>).
        </p>
        <div className="space-y-3">
          {ROWS.map((row) => (
            <div
              key={row.field}
              className="rounded-2xl border border-[var(--border)] bg-[var(--bg-primary)] p-3"
            >
              <label className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[13px] text-[var(--text-primary)]">{row.label}</div>
                  <div className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-muted)]">{row.hint}</div>
                </div>
                <input
                  type="text"
                  defaultValue={bytesToHuman(effective[row.field])}
                  onBlur={(e) => setField(row.field, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                  className="w-24 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-right font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                />
              </label>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
