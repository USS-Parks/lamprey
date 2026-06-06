import type { ReactElement } from 'react'

export interface DryRunCall {
  kind: 'agent' | 'workflow'
  index: number
  preview: string
}

export interface DryRunResult {
  calls: DryRunCall[]
  warnings: string[]
}

function previewAround(source: string, index: number): string {
  const start = Math.max(0, index - 40)
  const end = Math.min(source.length, index + 140)
  return source.slice(start, end).replace(/\s+/g, ' ').trim()
}

export function dryRunWorkflowSource(source: string): DryRunResult {
  const calls: DryRunCall[] = []
  for (const match of source.matchAll(/\bagent\s*\(/g)) {
    calls.push({ kind: 'agent', index: match.index ?? 0, preview: previewAround(source, match.index ?? 0) })
  }
  for (const match of source.matchAll(/\bworkflow\s*\(/g)) {
    calls.push({ kind: 'workflow', index: match.index ?? 0, preview: previewAround(source, match.index ?? 0) })
  }
  calls.sort((a, b) => a.index - b.index)
  const warnings: string[] = []
  if (/\bMath\.random\s*\(/.test(source)) warnings.push('Math.random() will be stubbed in dry-run mode.')
  if (/\bDate\.now\s*\(/.test(source)) warnings.push('Date.now() will be fixed in dry-run mode.')
  return { calls, warnings }
}

interface DryRunPanelProps {
  result: DryRunResult | null
}

export function DryRunPanel({ result }: DryRunPanelProps): ReactElement {
  return (
    <div className="rounded-md border border-[var(--panel-border)] bg-[var(--bg-secondary)] p-2" data-testid="workflow-dry-run">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          Dry Run
        </span>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">
          {result ? `${result.calls.length} call${result.calls.length === 1 ? '' : 's'}` : 'ready'}
        </span>
      </div>
      {!result ? (
        <p className="font-mono text-[11px] text-[var(--text-muted)]">No dry-run yet.</p>
      ) : (
        <div className="space-y-1">
          {result.calls.length === 0 && (
            <p className="font-mono text-[11px] text-[var(--text-muted)]">No agent or workflow calls found.</p>
          )}
          {result.calls.map((call, i) => (
            <div key={`${call.kind}:${call.index}:${i}`} className="rounded bg-[var(--bg-primary)] px-2 py-1">
              <div className="font-mono text-[10px] uppercase text-[var(--text-muted)]">{call.kind}</div>
              <div className="truncate font-mono text-[11px] text-[var(--text-secondary)]">{call.preview}</div>
            </div>
          ))}
          {result.warnings.map((warning) => (
            <div key={warning} className="rounded bg-amber-500/10 px-2 py-1 font-mono text-[11px] text-amber-700 dark:text-amber-300">
              {warning}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
