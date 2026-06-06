import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { formatCount, useSnipStore } from '@/stores/snip-store'
import { SnipDiscoverPanel } from './SnipDiscoverPanel'

// SnipSettings — gain dashboard + filter library + discover panel.
// All numbers come from the K10 IPC; toggles flip both settings.json
// (so the K9 shell handler picks up the change on next call) and the
// renderer's settings store (so the toggle reflects state without a
// reload).

export function SnipSettings() {
  const stats = useSnipStore((s) => s.stats)
  const recent = useSnipStore((s) => s.recent)
  const filters = useSnipStore((s) => s.filters)
  const loading = useSnipStore((s) => s.loading)
  const error = useSnipStore((s) => s.error)
  const loadAll = useSnipStore((s) => s.loadAll)
  const setEnabledIpc = useSnipStore((s) => s.setEnabled)
  const setVerboseIpc = useSnipStore((s) => s.setVerbose)
  const reloadFilters = useSnipStore((s) => s.reloadFilters)
  const clearHistory = useSnipStore((s) => s.clearHistory)
  const openFilterDir = useSnipStore((s) => s.openFilterDir)

  const enabled = useSettingsStore((s) => s.settings.snipEnabled)
  const verbose = useSettingsStore((s) => s.settings.snipVerbose)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const [confirmClear, setConfirmClear] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  // Hot-reload when chokidar reports a YAML change in userData.
  useEffect(() => {
    if (!window.api?.snip?.onFiltersChanged) return
    return window.api.snip.onFiltersChanged(() => void loadAll())
  }, [loadAll])

  const onToggleEnabled = async (next: boolean): Promise<void> => {
    await updateSettings({ snipEnabled: next })
    await setEnabledIpc(next)
  }
  const onToggleVerbose = async (next: boolean): Promise<void> => {
    await updateSettings({ snipVerbose: next })
    await setVerboseIpc(next)
  }
  const onClearHistory = async (): Promise<void> => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    await clearHistory()
    setConfirmClear(false)
  }

  const tokensSaved = stats ? stats.totalTokensBefore - stats.totalTokensAfter : 0
  const savingsPct = stats ? Math.round(stats.avgSavings * 100) : 0

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[14px] font-medium text-[var(--text-primary)]">Snip</h2>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          Shell-output token filter. Every successful tool call runs through
          a declarative YAML pipeline before reaching the model.
        </p>
      </div>

      {error && (
        <div className="rounded border border-[var(--error)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-[11px] text-[var(--error)]">
          {error}
        </div>
      )}

      {/* Header card */}
      <div className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-2">
            <Toggle
              label="Enabled"
              hint="Master switch. Off = raw shell output reaches the model."
              value={enabled}
              onChange={(v) => void onToggleEnabled(v)}
            />
            <Toggle
              label="Verbose mode"
              hint="Render per-match activity in this panel. Does NOT decorate model-facing output."
              value={verbose}
              onChange={(v) => void onToggleVerbose(v)}
            />
          </div>
          <div className="grid grid-cols-3 gap-3 text-right font-mono text-[11px]">
            <Stat label="Tokens saved" value={formatCount(tokensSaved)} />
            <Stat label="Avg savings" value={`${savingsPct}%`} />
            <Stat label="Commands" value={formatCount(stats?.totalEvents ?? 0)} />
          </div>
        </div>
        <div className="mt-3">
          <Sparkline values={stats?.sparkline ?? new Array(14).fill(0)} />
        </div>
      </div>

      {/* Top filters */}
      <Section title="Top filters (by tokens saved)">
        {stats && stats.topByTokens.length > 0 ? (
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="text-left text-[var(--text-muted)]">
                <th className="py-1">filter</th>
                <th className="py-1 text-right">runs</th>
                <th className="py-1 text-right">saved</th>
                <th className="py-1">ratio</th>
              </tr>
            </thead>
            <tbody>
              {stats.topByTokens.map((row) => (
                <tr key={row.filter} className="border-t border-[var(--panel-border)]">
                  <td className="py-1 text-[var(--text-primary)]">{row.filter}</td>
                  <td className="py-1 text-right text-[var(--text-secondary)]">{row.runs}</td>
                  <td className="py-1 text-right text-[var(--text-secondary)]">
                    {formatCount(row.tokensSaved)}
                  </td>
                  <td className="py-1">
                    <Bar ratio={row.savingsRatio} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState>{loading ? 'Loading…' : 'No events yet. Run a few shell commands.'}</EmptyState>
        )}
      </Section>

      {/* Recent activity */}
      <Section title="Recent activity">
        {recent.length > 0 ? (
          <ul className="space-y-1 font-mono text-[11px]">
            {recent.map((row, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[var(--text-primary)]">
                  <span className="text-[var(--text-muted)]">[{row.filter}]</span> {row.command}
                </span>
                <span className="shrink-0 text-[var(--text-secondary)]">
                  {formatCount(row.tokensBefore - row.tokensAfter)} saved
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No recent activity.</EmptyState>
        )}
      </Section>

      {/* Discover panel — K12 */}
      <SnipDiscoverPanel />

      {/* Filter library */}
      <Section
        title={`Filter library (${filters.length})`}
        action={
          <div className="flex gap-2">
            <button
              onClick={() => void openFilterDir()}
              className="rounded border border-[var(--panel-border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            >
              Open user filter dir
            </button>
            <button
              onClick={() => void reloadFilters()}
              className="rounded border border-[var(--panel-border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            >
              Reload
            </button>
            <button
              onClick={() => setShowFilters((s) => !s)}
              className="rounded border border-[var(--panel-border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            >
              {showFilters ? 'Hide' : 'Show'}
            </button>
          </div>
        }
      >
        {showFilters &&
          (filters.length > 0 ? (
            <ul className="max-h-64 space-y-0.5 overflow-y-auto font-mono text-[11px]">
              {filters.map((f) => (
                <li
                  key={`${f.source}-${f.name}-${f.path}`}
                  className="flex items-baseline justify-between gap-2"
                >
                  <span className="truncate">
                    <span
                      className={
                        f.source === 'user'
                          ? 'rounded bg-[var(--accent)] px-1 text-[10px] text-[var(--bg-primary)]'
                          : 'rounded border border-[var(--panel-border)] px-1 text-[10px] text-[var(--text-muted)]'
                      }
                    >
                      {f.source}
                    </span>{' '}
                    <span className="text-[var(--text-primary)]">{f.name}</span>{' '}
                    <span className="text-[var(--text-muted)]">— {f.description}</span>
                    {f.overriddenByUser && (
                      <span className="ml-1 text-[10px] text-[var(--text-muted)]">
                        (overridden by user file)
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Loading…</EmptyState>
          ))}
      </Section>

      {/* Reset history */}
      <div className="flex items-center justify-end gap-2 border-t border-[var(--panel-border)] pt-2">
        <button
          onClick={() => void onClearHistory()}
          className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
            confirmClear
              ? 'border-[var(--error)] bg-[var(--error)] text-white hover:opacity-90'
              : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
          }`}
        >
          {confirmClear ? 'Click again to confirm clear' : 'Reset history'}
        </button>
      </div>
    </div>
  )
}

function Section({
  title,
  children,
  action
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          {title}
        </h3>
        {action}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[var(--text-muted)]">{label}</div>
      <div className="text-[13px] text-[var(--text-primary)]">{value}</div>
    </div>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  return (
    <div className="flex h-8 items-end gap-0.5">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-t bg-[var(--accent)]"
          style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? '2px' : '1px', opacity: v > 0 ? 0.9 : 0.2 }}
          title={`${v} tokens saved (day ${i - 13 || 'today'})`}
        />
      ))}
    </div>
  )
}

function Bar({ ratio }: { ratio: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-[var(--bg-tertiary)]">
      <div
        className="h-full bg-[var(--accent)]"
        style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
      />
    </div>
  )
}

function Toggle({
  label,
  hint,
  value,
  onChange
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 font-mono text-[11px]">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <div className="flex flex-col">
        <span className="text-[var(--text-primary)]">{label}</span>
        {hint && <span className="text-[var(--text-muted)]">{hint}</span>}
      </div>
    </label>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-dashed border-[var(--panel-border)] px-3 py-4 text-center font-mono text-[11px] text-[var(--text-muted)]">
      {children}
    </div>
  )
}
