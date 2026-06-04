export interface SpawnedTask {
  taskId: string
  sourceConversationId: string
  conversationId: string
  title: string
  tldr: string | null
  worktreePath: string | null
  branch: string | null
}

interface SpawnTaskChipProps {
  task: SpawnedTask
  onOpen: (task: SpawnedTask) => void
  onDismiss: (taskId: string) => void
}

export function SpawnTaskChip({ task, onOpen, onDismiss }: SpawnTaskChipProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs shadow-sm">
      <button
        type="button"
        onClick={() => onOpen(task)}
        title={task.tldr ?? task.title}
        className="min-w-0 flex-1 truncate text-left text-[var(--text-primary)] hover:text-[var(--accent)]"
      >
        <span className="font-medium">{task.title}</span>
        {task.worktreePath && (
          <span className="ml-2 text-[10px] uppercase text-[var(--text-muted)]">worktree</span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onDismiss(task.taskId)}
        title="Dismiss"
        aria-label="Dismiss spawned task"
        className="rounded p-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
