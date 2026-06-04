import type { ReactElement } from 'react'
import { AgentChip } from './AgentChip'
import type { PhaseGroup as PhaseGroupModel } from '@/stores/workflows-store'

interface Props {
  group: PhaseGroupModel
}

export function PhaseGroup({ group }: Props): ReactElement {
  const title = group.title || '(unphased)'
  return (
    <div data-testid="phase-group" data-phase={title} className="mt-2">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
        {title}
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {group.agents.length === 0 ? (
          <span className="text-[11px] italic text-[var(--text-muted)]">no agents yet</span>
        ) : (
          group.agents.map((a) => <AgentChip key={a.id} chip={a} />)
        )}
      </div>
    </div>
  )
}
