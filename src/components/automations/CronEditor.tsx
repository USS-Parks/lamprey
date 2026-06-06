import { useEffect, useState } from 'react'
import { useAutomationsStore } from '@/stores/automations-store'
import type { CronValidation } from '@/stores/automations-store'

// G1 — Cron expression editor with live validation + human preview +
// next-fire timestamp. Backend `automations:validateCron` does the
// parse so a malformed expression doesn't ship to disk.

interface Props {
  value: string
  onChange: (value: string) => void
  onValidityChange?: (valid: boolean) => void
}

const PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Every 5 min', cron: '*/5 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Daily 09:00', cron: '0 9 * * *' },
  { label: 'Weekdays 09:00', cron: '0 9 * * 1-5' },
  { label: 'Midnight', cron: '0 0 * * *' }
]

export function CronEditor({ value, onChange, onValidityChange }: Props) {
  const validate = useAutomationsStore((s) => s.validateCron)
  const [validation, setValidation] = useState<CronValidation>({ valid: false })

  useEffect(() => {
    let cancelled = false
    const id = window.setTimeout(() => {
      void validate(value).then((res) => {
        if (cancelled) return
        setValidation(res)
        onValidityChange?.(res.valid)
      })
    }, 150)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [value, validate, onValidityChange])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="*/5 * * * *"
          className="flex-1 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value)
          }}
          className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-1.5 py-1 text-[11px] text-[var(--text-secondary)]"
        >
          <option value="">Presets…</option>
          {PRESETS.map((p) => (
            <option key={p.cron} value={p.cron}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {validation.valid ? (
        <p className="text-[11px] text-[var(--text-secondary)]">
          {validation.description ?? 'Valid cron expression'}
          {validation.nextFireAt && (
            <span className="text-[var(--text-muted)]">
              {' · next fire '}
              {new Date(validation.nextFireAt).toLocaleString()}
            </span>
          )}
        </p>
      ) : (
        <p className="text-[11px] text-[var(--error)]">
          {validation.error ?? 'Type a cron expression'}
        </p>
      )}
    </div>
  )
}
