import { useState, useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings-store'

// Loop Phase gap-closure — the Settings UI for autonomous loops. Previously the
// loop keys were settings.json-only. These values are read fresh by the loop
// controller + IPC (loop-config.ts) on every tick / create, so no IPC patch is
// needed beyond settings:set. Loops are a deliberate extension past the Opus
// 4.5 era-lock and ship OFF by default.

const DEFAULTS = {
  loopMaxIterations: 25,
  loopMaxWallclockMin: 30, // 1_800_000 ms
  loopTokenBudget: 500000,
  loopMaxConcurrent: 1,
  loopMinIntervalSeconds: 30
}

interface NumberRowProps {
  id: string
  label: string
  hint: string
  value: number
  onCommit: (n: number) => void
  defaultValue: number
  min: number
  unit: string
}

function NumberRow({ id, label, hint, value, onCommit, defaultValue, min, unit }: NumberRowProps) {
  const [draft, setDraft] = useState<string>(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const commit = (): void => {
    const raw = Number(draft)
    if (!Number.isFinite(raw)) {
      setDraft(String(value))
      return
    }
    if (raw === 0 && min > 0 && unit.includes('0 =')) {
      onCommit(0)
      return
    }
    const clamped = Math.max(min, Math.round(raw))
    setDraft(String(clamped))
    onCommit(clamped)
  }

  return (
    <label
      htmlFor={id}
      className="flex flex-col gap-1 rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-secondary)]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-[var(--text-primary)]">{label}</span>
        <button
          type="button"
          onClick={() => {
            setDraft(String(defaultValue))
            onCommit(defaultValue)
          }}
          className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] underline-offset-2 hover:underline"
        >
          reset · {defaultValue}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          min={0}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className="w-28 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
        />
        <span className="font-mono text-[11px] text-[var(--text-muted)]">{unit}</span>
      </div>
      <span className="mt-1 block text-[12px] leading-relaxed text-[var(--text-muted)]">{hint}</span>
    </label>
  )
}

export function LoopSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const enabled = settings.loopsEnabled ?? false
  const maxIterations = settings.loopMaxIterations ?? DEFAULTS.loopMaxIterations
  const maxWallclockMin = Math.round((settings.loopMaxWallclockMs ?? 1_800_000) / 60_000)
  const tokenBudget = settings.loopTokenBudget ?? DEFAULTS.loopTokenBudget
  const maxConcurrent = settings.loopMaxConcurrent ?? DEFAULTS.loopMaxConcurrent
  const minIntervalSeconds = settings.loopMinIntervalSeconds ?? DEFAULTS.loopMinIntervalSeconds

  return (
    <div className="space-y-5">
      <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">Loops</h3>
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        Recurring loops run a turn on a cadence — <span className="font-mono">interval</span>,{' '}
        <span className="font-mono">self-paced</span>, or autonomous{' '}
        <span className="font-mono">work-the-backlog</span> — and can keep going with the window
        closed. They are a deliberate extension past the Opus 4.5 era target and ship{' '}
        <span className="font-medium text-[var(--text-secondary)]">off by default</span>. Start one
        with <code className="rounded bg-[var(--bg-tertiary)] px-1">/loop &lt;task&gt;</code>,{' '}
        <code className="rounded bg-[var(--bg-tertiary)] px-1">/loop 5m &lt;task&gt;</code>, or{' '}
        <code className="rounded bg-[var(--bg-tertiary)] px-1">/loop --auto &lt;mission&gt;</code>;
        manage them in the right-panel Loops pill.
      </p>

      {/* Master toggle */}
      <button
        type="button"
        onClick={() => void updateSettings({ loopsEnabled: !enabled })}
        className="flex w-full items-center justify-between rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-left transition-colors hover:border-[var(--accent)]"
      >
        <span className="flex flex-col">
          <span className="text-xs font-medium text-[var(--text-primary)]">Enable loops</span>
          <span className="text-[11px] text-[var(--text-muted)]">
            {enabled ? 'On — loops can be created and will run.' : 'Off — /loop and loop creation are refused.'}
          </span>
        </span>
        <span
          aria-hidden
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${enabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`}
          />
        </span>
      </button>

      <section className={`space-y-3 ${enabled ? '' : 'opacity-60'}`}>
        <h4 className="font-mono text-[13px] uppercase tracking-wider text-[var(--text-muted)]">
          Ceilings (applied to every new loop)
        </h4>
        <NumberRow
          id="loopMaxIterations"
          label="Max iterations"
          hint="Hard stop: a loop ends after this many iterations regardless of backlog. The primary runaway guard."
          value={maxIterations}
          onCommit={(n) => void updateSettings({ loopMaxIterations: n })}
          defaultValue={DEFAULTS.loopMaxIterations}
          min={1}
          unit="iterations"
        />
        <NumberRow
          id="loopMaxWallclock"
          label="Max wall-clock"
          hint="Hard stop: a loop ends once this much real time has elapsed since it started."
          value={maxWallclockMin}
          onCommit={(n) => void updateSettings({ loopMaxWallclockMs: Math.max(1, n) * 60_000 })}
          defaultValue={DEFAULTS.loopMaxWallclockMin}
          min={1}
          unit="minutes"
        />
        <NumberRow
          id="loopTokenBudget"
          label="Token budget"
          hint="Soft guard: a loop stops once the estimated tokens spent crosses this. Estimated from the sent context + reply (iteration + wall-clock are the hard caps). 0 = iteration-bounded only."
          value={tokenBudget}
          onCommit={(n) => void updateSettings({ loopTokenBudget: n })}
          defaultValue={DEFAULTS.loopTokenBudget}
          min={0}
          unit="tokens (0 = off)"
        />
        <NumberRow
          id="loopMaxConcurrent"
          label="Max concurrent loops"
          hint="How many loops may advance per scheduler tick. 1 keeps providers from being hammered by parallel loops."
          value={maxConcurrent}
          onCommit={(n) => void updateSettings({ loopMaxConcurrent: n })}
          defaultValue={DEFAULTS.loopMaxConcurrent}
          min={1}
          unit="loops"
        />
        <NumberRow
          id="loopMinInterval"
          label="Runaway floor"
          hint="A loop (or the model via loop_control) cannot schedule its next iteration sooner than this. Prevents a tight self-scheduling spin."
          value={minIntervalSeconds}
          onCommit={(n) => void updateSettings({ loopMinIntervalSeconds: n })}
          defaultValue={DEFAULTS.loopMinIntervalSeconds}
          min={1}
          unit="seconds"
        />
      </section>
    </div>
  )
}
