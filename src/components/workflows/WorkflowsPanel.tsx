import { useEffect, type ReactElement } from 'react'
import { useWorkflowsStore } from '@/stores/workflows-store'
import { WorkflowRunCard } from './WorkflowRunCard'

export function WorkflowsPanel(): ReactElement {
  const runs = useWorkflowsStore((s) => s.runs)
  const applyProgress = useWorkflowsStore((s) => s.applyProgress)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.api?.workflows) return
    const unsubscribe = window.api.workflows.onProgress((event) =>
      applyProgress(event as Parameters<typeof applyProgress>[0])
    )
    return () => unsubscribe()
  }, [applyProgress])

  return (
    <div data-testid="workflows-panel" className="flex flex-col gap-3 p-3">
      <div className="text-[12px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
        Workflows
      </div>
      {runs.length === 0 ? (
        <div className="text-[12px] italic text-[var(--text-muted)]">
          No workflow runs yet. Launch one from the chat or `workflows:runInline` IPC.
        </div>
      ) : (
        runs.map((r) => <WorkflowRunCard key={r.runId} run={r} />)
      )}
    </div>
  )
}
