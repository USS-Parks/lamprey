import type { ReactElement } from 'react'

export function workflowScaffold(name = 'new-workflow'): string {
  return `export const meta = {
  name: '${name}',
  description: 'Describe what this workflow does.',
  phases: [
    { title: 'Plan', detail: 'Choose the agents and inputs' },
    { title: 'Run', detail: 'Collect agent outputs' }
  ]
}

phase('Plan')
log('Preparing workflow')

phase('Run')
const result = await agent('Summarize the current task and return the next concrete step.', {
  label: 'first-pass',
  agentType: 'general',
  model: 'cheap'
})

return { result }
`
}

interface MetaScaffolderProps {
  onInsert: (source: string) => void
}

export function MetaScaffolder({ onInsert }: MetaScaffolderProps): ReactElement {
  return (
    <button
      type="button"
      onClick={() => onInsert(workflowScaffold())}
      className="rounded border border-[var(--border)] px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
    >
      Scaffold meta
    </button>
  )
}
