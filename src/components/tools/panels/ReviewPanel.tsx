import { useCallback, useEffect, useState } from 'react'
import { useUiStore } from '@/stores/ui-store'
import { toast } from '@/stores/toast-store'

interface FileStatus {
  path: string
  indexStatus: string
  workStatus: string
  staged: boolean
  unstaged: boolean
}

interface Status {
  files: FileStatus[]
  branch: string | null
  ahead: number
  behind: number
  cwd: string
}

function statusLabel(s: FileStatus): { letter: string; tone: string } {
  if (s.indexStatus === '?' && s.workStatus === '?') return { letter: 'U', tone: 'text-[var(--accent)]' }
  if (s.indexStatus === 'M' || s.workStatus === 'M') return { letter: 'M', tone: 'text-yellow-500' }
  if (s.indexStatus === 'A' || s.workStatus === 'A') return { letter: 'A', tone: 'text-green-500' }
  if (s.indexStatus === 'D' || s.workStatus === 'D') return { letter: 'D', tone: 'text-red-500' }
  if (s.indexStatus === 'R' || s.workStatus === 'R') return { letter: 'R', tone: 'text-blue-400' }
  return { letter: '?', tone: 'text-[var(--text-muted)]' }
}

function lineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'bg-green-900/30 text-green-300'
  if (line.startsWith('-') && !line.startsWith('---')) return 'bg-red-900/30 text-red-300'
  if (line.startsWith('@@')) return 'bg-[var(--bg-tertiary)] text-[var(--accent)]'
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++') || line === 'new file')
    return 'text-[var(--text-muted)]'
  return 'text-[var(--text-secondary)]'
}

interface Hunk {
  header: string
  lines: string[]
}

function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = []
  let current: Hunk | null = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current)
      current = { header: line, lines: [] }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) hunks.push(current)
  return hunks
}

export function ReviewPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ path: string; staged: boolean } | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const seedComposeDraft = useUiStore((s) => s.seedComposeDraft)
  const closeActiveTool = useUiStore((s) => s.closeActiveTool)

  const refresh = useCallback(async () => {
    setError(null)
    if (!window.api?.review) {
      setError('Review API unavailable.')
      return
    }
    const res = await window.api.review.status({})
    if (!res.success) {
      setError(res.error ?? 'status failed')
      return
    }
    setStatus(res.data as Status)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshTick])

  useEffect(() => {
    if (!selected || !window.api?.review) return
    setDiffLoading(true)
    setDiff('')
    void (async () => {
      const res = await window.api.review.diff({ path: selected.path, staged: selected.staged })
      setDiffLoading(false)
      if (!res.success) {
        setDiff(`# error\n${res.error}`)
      } else {
        const data = res.data as { diff: string }
        setDiff(data.diff || '(no diff)')
      }
    })()
  }, [selected, refreshTick])

  const handleStage = async (path: string) => {
    const res = await window.api?.review?.stage({ path })
    if (res?.success) {
      toast.success(`Staged ${path}`)
      setRefreshTick((t) => t + 1)
    } else {
      toast.error(res?.error ?? 'stage failed')
    }
  }
  const handleUnstage = async (path: string) => {
    const res = await window.api?.review?.unstage({ path })
    if (res?.success) {
      toast.success(`Unstaged ${path}`)
      setRefreshTick((t) => t + 1)
    } else {
      toast.error(res?.error ?? 'unstage failed')
    }
  }
  const handleDiscard = async (path: string) => {
    if (!confirm(`Discard changes to ${path}? This is irreversible.`)) return
    const res = await window.api?.review?.discard({ path })
    if (res?.success) {
      toast.success(`Discarded ${path}`)
      setRefreshTick((t) => t + 1)
    } else {
      toast.error(res?.error ?? 'discard failed')
    }
  }

  const askFix = (hunk: Hunk) => {
    if (!selected) return
    const prompt =
      `In \`${selected.path}\`, the following hunk needs fixing:\n\n` +
      '```diff\n' +
      hunk.header +
      '\n' +
      hunk.lines.join('\n') +
      '\n```\n\n' +
      'Please review and propose a fix. Explain the change before writing the code.'
    seedComposeDraft(prompt)
    closeActiveTool()
    toast.success('Sent to chat input')
  }

  const hunks = parseHunks(diff)
  const files = status?.files ?? []
  const stagedFiles = files.filter((f) => f.staged)
  const unstagedFiles = files.filter((f) => f.unstaged || (!f.staged && !f.unstaged))

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Branch header */}
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)]">
        <div className="flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span className="font-mono text-[11px]">{status?.branch ?? '…'}</span>
          {status && status.ahead > 0 && (
            <span className="text-[10px] text-[var(--text-muted)]">↑{status.ahead}</span>
          )}
          {status && status.behind > 0 && (
            <span className="text-[10px] text-[var(--text-muted)]">↓{status.behind}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setRefreshTick((t) => t + 1)}
          className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          title="Refresh"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15A9 9 0 1 1 18 5.3L23 10" />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* File list */}
        <div className="w-1/3 min-w-[180px] overflow-auto border-r border-[var(--panel-border)] py-1 text-[12px]">
          {error && <p className="px-3 py-2 text-[var(--error)]">{error}</p>}
          {!error && files.length === 0 && (
            <p className="px-3 py-2 text-[var(--text-muted)]">No changes — clean working tree.</p>
          )}
          {stagedFiles.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                Staged ({stagedFiles.length})
              </div>
              {stagedFiles.map((f) => {
                const lbl = statusLabel(f)
                const isSel = selected?.path === f.path && selected.staged
                return (
                  <div
                    key={`s-${f.path}`}
                    className={`group flex items-center gap-1 px-2 py-0.5 ${
                      isSel ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    <span className={`w-3 shrink-0 text-center font-mono text-[10px] font-bold ${lbl.tone}`}>{lbl.letter}</span>
                    <button
                      type="button"
                      onClick={() => setSelected({ path: f.path, staged: true })}
                      className="min-w-0 flex-1 truncate text-left text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      title={f.path}
                    >
                      {f.path}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleUnstage(f.path)}
                      className="rounded px-1 text-[10px] text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover:opacity-100"
                      title="Unstage"
                    >
                      −
                    </button>
                  </div>
                )
              })}
            </>
          )}
          {unstagedFiles.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                Changes ({unstagedFiles.length})
              </div>
              {unstagedFiles.map((f) => {
                const lbl = statusLabel(f)
                const isSel = selected?.path === f.path && !selected.staged
                return (
                  <div
                    key={`u-${f.path}`}
                    className={`group flex items-center gap-1 px-2 py-0.5 ${
                      isSel ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    <span className={`w-3 shrink-0 text-center font-mono text-[10px] font-bold ${lbl.tone}`}>{lbl.letter}</span>
                    <button
                      type="button"
                      onClick={() => setSelected({ path: f.path, staged: false })}
                      className="min-w-0 flex-1 truncate text-left text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      title={f.path}
                    >
                      {f.path}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleStage(f.path)}
                      className="rounded px-1 text-[10px] text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover:opacity-100"
                      title="Stage"
                    >
                      +
                    </button>
                    {f.indexStatus !== '?' && (
                      <button
                        type="button"
                        onClick={() => void handleDiscard(f.path)}
                        className="rounded px-1 text-[10px] text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--error)] group-hover:opacity-100"
                        title="Discard changes"
                      >
                        ×
                      </button>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Diff viewer */}
        <div className="flex w-2/3 min-w-0 flex-col overflow-hidden">
          {!selected ? (
            <p className="m-auto text-[12px] text-[var(--text-muted)]">Select a file to view its diff.</p>
          ) : diffLoading ? (
            <p className="m-auto text-[12px] text-[var(--text-muted)]">Loading diff…</p>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-snug">
              {hunks.length === 0 && (
                <pre className="whitespace-pre px-3 py-2 text-[var(--text-muted)]">{diff || '(no diff)'}</pre>
              )}
              {hunks.map((h, i) => (
                <div key={i} className="border-b border-[var(--panel-border)]">
                  <div className="flex items-center justify-between bg-[var(--bg-tertiary)] px-3 py-1">
                    <code className="text-[11px] text-[var(--accent)]">{h.header}</code>
                    <button
                      type="button"
                      onClick={() => askFix(h)}
                      className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
                      title="Send this hunk to the chat input"
                    >
                      Fix this →
                    </button>
                  </div>
                  {h.lines.map((line, j) => (
                    <pre key={j} className={`m-0 whitespace-pre px-3 ${lineClass(line)}`}>
                      {line || ' '}
                    </pre>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
