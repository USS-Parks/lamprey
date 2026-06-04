import type { ReactElement } from 'react'
import type { AgentChip as AgentChipModel } from '@/stores/workflows-store'

interface Props {
  chip: AgentChipModel
}

const STATUS_TINT: Record<AgentChipModel['status'], string> = {
  running: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  done: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  error: 'bg-red-500/15 text-red-600 dark:text-red-300',
  aborted: 'bg-gray-500/15 text-gray-600 dark:text-gray-300'
}

function durationLabel(ms?: number): string {
  if (ms === undefined || ms < 0) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function AgentChip({ chip }: Props): ReactElement {
  const tint = STATUS_TINT[chip.status] ?? STATUS_TINT.running
  return (
    <div
      data-testid="agent-chip"
      data-status={chip.status}
      data-agent-type={chip.agentType}
      data-cached={chip.cached ? 'true' : 'false'}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${tint}`}
      title={chip.error ?? chip.label}
    >
      <span className="font-medium">{chip.label}</span>
      <span className="opacity-60">{chip.agentType}</span>
      {chip.cached && <span className="text-[10px] opacity-70">[cached]</span>}
      {chip.durationMs !== undefined && (
        <span className="text-[10px] opacity-70">{durationLabel(chip.durationMs)}</span>
      )}
      {chip.tokensUsedEstimate !== undefined && chip.tokensUsedEstimate > 0 && (
        <span className="text-[10px] opacity-70">~{chip.tokensUsedEstimate}t</span>
      )}
    </div>
  )
}
