import { useState, useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings-store'

// T5 — single-pane control surface for every time-budget knob in the
// turn-execution stack. Numbers here are stored in settings.json and read
// by the matching back-end services (provider/registry.ts, mcp-manager.ts,
// agent-pipeline.ts) — no IPC patch required: each service reads fresh on
// every call. The labels deliberately surface ms-stored seconds so the user
// doesn't have to do arithmetic.

const DEFAULTS = {
  streamInactivitySec: 60,
  mcpCallTimeoutSec: 120,
  plannerSec: 120,
  coderSec: 600,
  reviewerSec: 120
}

function secondsToMsOrZero(sec: number): number {
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return Math.round(sec * 1000)
}

function msToSeconds(ms: number | undefined, fallback: number): number {
  if (ms == null) return fallback
  if (ms <= 0) return 0
  return Math.max(0, Math.round(ms / 1000))
}

interface RowProps {
  id: string
  label: string
  hint: string
  value: number
  onCommit: (sec: number) => void
  defaultSec: number
  /** Lowest non-zero value the back-end accepts. 0 always allowed (disables). */
  minSec: number
}

function NumberRow({ id, label, hint, value, onCommit, defaultSec, minSec }: RowProps) {
  // Local draft so the user can clear-and-retype without the store committing
  // on every keystroke. Commit on blur or Enter.
  const [draft, setDraft] = useState<string>(String(value))
  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = (): void => {
    const raw = Number(draft)
    if (!Number.isFinite(raw)) {
      setDraft(String(value))
      return
    }
    if (raw === 0) {
      onCommit(0)
      return
    }
    const clamped = Math.max(minSec, Math.round(raw))
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
            setDraft(String(defaultSec))
            onCommit(defaultSec)
          }}
          className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] underline-offset-2 hover:underline"
        >
          reset · {defaultSec}s
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
            if (e.key === 'Enter') {
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          className="w-24 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
        />
        <span className="font-mono text-[11px] text-[var(--text-muted)]">seconds (0 = disable)</span>
      </div>
      <span className="mt-1 block text-[12px] leading-relaxed text-[var(--text-muted)]">{hint}</span>
    </label>
  )
}

export function StreamingTimeoutsSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const streamInactivitySec = msToSeconds(
    settings.streamInactivityMs,
    DEFAULTS.streamInactivitySec
  )
  const mcpCallTimeoutSec = msToSeconds(settings.mcpCallTimeoutMs, DEFAULTS.mcpCallTimeoutSec)
  const plannerSec = msToSeconds(settings.stageBudgetMs?.planner, DEFAULTS.plannerSec)
  const coderSec = msToSeconds(settings.stageBudgetMs?.coder, DEFAULTS.coderSec)
  const reviewerSec = msToSeconds(settings.stageBudgetMs?.reviewer, DEFAULTS.reviewerSec)

  const setStreamInactivity = (sec: number): void => {
    void updateSettings({ streamInactivityMs: secondsToMsOrZero(sec) })
  }
  const setMcpCallTimeout = (sec: number): void => {
    void updateSettings({ mcpCallTimeoutMs: secondsToMsOrZero(sec) })
  }
  const setStageBudget = (
    role: 'planner' | 'coder' | 'reviewer',
    sec: number
  ): void => {
    const next = {
      planner: secondsToMsOrZero(plannerSec),
      coder: secondsToMsOrZero(coderSec),
      reviewer: secondsToMsOrZero(reviewerSec),
      ...(settings.stageBudgetMs ?? {}),
      [role]: secondsToMsOrZero(sec)
    }
    void updateSettings({ stageBudgetMs: next })
  }

  return (
    <div className="space-y-5">
      <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">
        Streaming & Timeouts
      </h3>
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        These caps prevent a long research session from grinding indefinitely
        when a provider stalls or an MCP server hangs. 0 disables a specific
        cap; non-zero values are clamped to a safe floor.
      </p>

      <section className="space-y-3">
        <h4 className="font-mono text-[13px] uppercase tracking-wider text-[var(--text-muted)]">
          Provider stream
        </h4>
        <NumberRow
          id="streamInactivity"
          label="SSE inactivity watchdog"
          hint="How long the chat stream may sit without receiving a chunk before being aborted and retried. Catches half-open provider sockets where tokens stop flowing but the connection never closes."
          value={streamInactivitySec}
          onCommit={setStreamInactivity}
          defaultSec={DEFAULTS.streamInactivitySec}
          minSec={5}
        />
      </section>

      <section className="space-y-3">
        <h4 className="font-mono text-[13px] uppercase tracking-wider text-[var(--text-muted)]">
          MCP tools
        </h4>
        <NumberRow
          id="mcpCallTimeout"
          label="Per-call MCP timeout"
          hint="Maximum wait for any single MCP tool call. Long-running tools that send progress notifications reset this timer; truly silent stalls trip it. 0 falls back to the MCP SDK default."
          value={mcpCallTimeoutSec}
          onCommit={setMcpCallTimeout}
          defaultSec={DEFAULTS.mcpCallTimeoutSec}
          minSec={5}
        />
      </section>

      <section className="space-y-3">
        <h4 className="font-mono text-[13px] uppercase tracking-wider text-[var(--text-muted)]">
          Pipeline stage budgets
        </h4>
        <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
          Wall-clock cap per role in the Planner → Coder → Reviewer pipeline.
          Budget-exhausted planner falls through with a stub plan; coder and
          reviewer surface a clear "budget exceeded" message so you can re-prompt
          with "continue" or raise the cap.
        </p>
        <NumberRow
          id="plannerBudget"
          label="Planner stage"
          hint="Planner should produce a tight numbered plan quickly — 2 minutes is generous."
          value={plannerSec}
          onCommit={(sec) => setStageBudget('planner', sec)}
          defaultSec={DEFAULTS.plannerSec}
          minSec={10}
        />
        <NumberRow
          id="coderBudget"
          label="Coder stage"
          hint="Coder does the real work — reading files, calling tools, writing replies. The default 10 minutes covers most multi-tool turns; raise for deep refactors."
          value={coderSec}
          onCommit={(sec) => setStageBudget('coder', sec)}
          defaultSec={DEFAULTS.coderSec}
          minSec={10}
        />
        <NumberRow
          id="reviewerBudget"
          label="Reviewer stage"
          hint="Reviewer operates on a summarized context — 2 minutes is plenty for a SHIP/CHANGES verdict."
          value={reviewerSec}
          onCommit={(sec) => setStageBudget('reviewer', sec)}
          defaultSec={DEFAULTS.reviewerSec}
          minSec={10}
        />
      </section>
    </div>
  )
}
