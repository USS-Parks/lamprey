import { useRagStore } from '@/stores/rag-store'
import type { IngestProgressEvent } from '@/lib/types'

const PHASE_LABEL: Record<string, string> = {
  queued: 'Queued',
  loading: 'Loading…',
  chunking: 'Chunking…',
  embedding: 'Embedding…',
  ready: 'Ready',
  error: 'Error'
}

export function IngestProgressCard({ progress }: { progress: IngestProgressEvent }) {
  const cancel = useRagStore((s) => s.cancelIngest)
  const pct = Math.round(progress.progress * 100)
  const isTerminal = progress.phase === 'ready' || progress.phase === 'error'
  return (
    <div className="flex flex-col gap-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
        <span className="truncate text-[var(--text-primary)]" title={progress.displayName}>
          {progress.displayName}
        </span>
        <span className="shrink-0 text-[var(--text-muted)]">
          {PHASE_LABEL[progress.phase] ?? progress.phase}
        </span>
        {!isTerminal && (
          <button
            onClick={() => void cancel(progress.jobId)}
            className="shrink-0 text-[var(--text-muted)] hover:text-red-400"
            title="Cancel"
            aria-label="Cancel ingest"
          >
            ×
          </button>
        )}
      </div>
      <div className="h-1 w-full rounded bg-[var(--bg-primary)]">
        <div
          className={`h-1 rounded ${
            progress.phase === 'error'
              ? 'bg-red-500'
              : progress.phase === 'ready'
              ? 'bg-green-500'
              : 'bg-amber-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress.error && (
        <span className="truncate font-mono text-[10px] text-red-400" title={progress.error}>
          {progress.error}
        </span>
      )}
    </div>
  )
}
