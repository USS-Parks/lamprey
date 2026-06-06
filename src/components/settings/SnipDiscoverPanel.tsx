import { useEffect, useState } from 'react'
import { formatCount, useSnipStore } from '@/stores/snip-store'

// SnipDiscoverPanel — rtk discover analogue. Scans the snip_command_log
// table for shell calls in the last N days that did NOT match any
// filter, ranks them by total estimated tokens, and surfaces the top-K
// as suggestions for writing a custom YAML filter. Clicking "Write
// a filter" opens the user filter dir in the OS file explorer; a future
// extension would also drop a *.draft.yaml stub on the user's behalf
// (deferred for v2 to keep K12 scope tight).

const WINDOWS: Array<{ label: string; days: number }> = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 }
]

export function SnipDiscoverPanel() {
  const discover = useSnipStore((s) => s.discover)
  const loadDiscover = useSnipStore((s) => s.loadDiscover)
  const openFilterDir = useSnipStore((s) => s.openFilterDir)
  const [sinceDays, setSinceDays] = useState(7)

  useEffect(() => {
    void loadDiscover(sinceDays)
  }, [loadDiscover, sinceDays])

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Find missed savings
        </h3>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              onClick={() => setSinceDays(w.days)}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
                sinceDays === w.days
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-primary)]'
                  : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {discover && discover.suggestions.length > 0 ? (
        <table className="w-full font-mono text-[11px]">
          <thead>
            <tr className="text-left text-[var(--text-muted)]">
              <th className="py-1">command</th>
              <th className="py-1 text-right">runs</th>
              <th className="py-1 text-right">tokens</th>
              <th className="py-1">category</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {discover.suggestions.map((s) => (
              <tr key={s.commandPattern} className="border-t border-[var(--panel-border)]">
                <td className="py-1 text-[var(--text-primary)]" title={s.sampleCommand}>
                  {s.commandPattern}
                </td>
                <td className="py-1 text-right text-[var(--text-secondary)]">{s.runs}</td>
                <td className="py-1 text-right text-[var(--text-secondary)]">
                  {formatCount(s.estimatedTokens)}
                </td>
                <td className="py-1 text-[var(--text-muted)]">{s.suggestedCategory}</td>
                <td className="py-1 text-right">
                  <button
                    onClick={() => void openFilterDir()}
                    className="rounded border border-[var(--panel-border)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                    title={`Drop a YAML filter into the ${s.suggestedCategory}/ folder under userData/snip/filters/.`}
                  >
                    Write a filter
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="rounded border border-dashed border-[var(--panel-border)] px-3 py-4 text-center font-mono text-[11px] text-[var(--text-muted)]">
          No unfiltered commands in the last {sinceDays}d. Run some shell calls and check back.
        </div>
      )}
    </div>
  )
}
