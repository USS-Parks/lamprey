interface PanelEmptyStateProps {
  icon?: React.ReactNode
  title: string
  body?: React.ReactNode
  action?: React.ReactNode
}

export function PanelEmptyState({
  icon,
  title,
  body,
  action
}: PanelEmptyStateProps): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      {icon && (
        <span className="flex h-10 w-10 items-center justify-center text-[var(--text-muted)] opacity-80">
          {icon}
        </span>
      )}
      <span className="text-[14px] font-medium text-[var(--text-secondary)]">{title}</span>
      {body && (
        <span className="max-w-[280px] text-[12px] leading-relaxed text-[var(--text-muted)]">
          {body}
        </span>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
