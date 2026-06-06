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
  activeSource?: boolean
  onOpen: (task: SpawnedTask) => void
  onOpenSource: (sourceConversationId: string) => void
  onDismiss: (taskId: string) => void
}

export function SpawnTaskChip({
  task,
  activeSource = false,
  onOpen,
  onOpenSource,
  onDismiss
}: SpawnTaskChipProps) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-2 text-xs shadow-sm">
      <button
        type="button"
        onClick={() => onOpen(task)}
        title={task.tldr ?? task.title}
        className="min-w-0 flex-1 text-left text-[var(--text-primary)] hover:text-[var(--accent)]"
      >
        <span className="block truncate font-medium">{task.title}</span>
        <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">
          {task.tldr ?? task.taskId}
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          {task.worktreePath && (
            <span className="rounded border border-[var(--panel-border)] px-1 py-0.5 text-[9px] uppercase text-[var(--text-muted)]">
              worktree
            </span>
          )}
          {task.branch && (
            <span className="rounded border border-[var(--panel-border)] px-1 py-0.5 text-[9px] text-[var(--text-muted)]">
              {task.branch}
            </span>
          )}
        </span>
      </button>
      <div className="flex shrink-0 flex-col gap-1">
        <button
          type="button"
          onClick={() => onOpenSource(task.sourceConversationId)}
          title="Open source session"
          aria-label="Open source session"
          className={
            'rounded border px-1.5 py-0.5 text-[10px] transition-colors ' +
            (activeSource
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-[var(--panel-border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]')
          }
        >
          source
        </button>
        <button
          type="button"
          onClick={() => onDismiss(task.taskId)}
          title="Dismiss"
          aria-label="Dismiss spawned task"
          className="rounded p-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
