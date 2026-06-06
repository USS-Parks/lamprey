interface WakeupPillProps {
  reason?: string
}

export function WakeupPill({ reason }: WakeupPillProps) {
  return (
    <span className="mb-2 inline-flex max-w-full items-center gap-1 rounded border border-[var(--panel-border)] bg-[var(--bg-tertiary)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
      <span className="truncate">Scheduled wake-up{reason ? `: ${reason}` : ''}</span>
    </span>
  )
}
