import { useState } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { toast } from '@/stores/toast-store'

// Renders a research-report markdown artifact with a Download button that
// invokes the main-process save-as dialog. Used by the right panel when
// the user clicks an `artifact://research/<filename>` link.

interface ResearchArtifactProps {
  /** Source markdown body — already cited, with bibliography appended. */
  content: string
  /** Optional filename hint for the download dialog. When omitted the
   * Download button is hidden (e.g. a preview from chat history that
   * was never persisted). */
  filename?: string
  /** Optional citation count shown in the header chip. */
  sourceCount?: number
}

export function ResearchArtifact({ content, filename, sourceCount }: ResearchArtifactProps) {
  const [busy, setBusy] = useState(false)

  const handleDownload = async () => {
    if (!filename) return
    const w = window as unknown as {
      api?: {
        research?: { download?: (f: string) => Promise<{ success: boolean; data?: { saved: boolean; path?: string }; error?: string }> }
      }
    }
    if (!w.api?.research?.download) {
      // Fallback: copy markdown to clipboard.
      try {
        await navigator.clipboard.writeText(content)
        toast.success('Markdown copied to clipboard')
      } catch {
        toast.error('Could not access clipboard; please use the system save dialog.')
      }
      return
    }
    setBusy(true)
    try {
      const r = await w.api.research.download(filename)
      if (r.success && r.data?.saved) {
        toast.success(`Saved to ${r.data.path ?? 'chosen location'}`)
      } else if (r.success && r.data && !r.data.saved) {
        // User cancelled the dialog; no toast.
      } else {
        toast.error(`Download failed: ${r.error ?? 'unknown error'}`)
      }
    } catch (err) {
      toast.error(`Download failed: ${(err as Error).message ?? 'unknown'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          Research report
        </span>
        {typeof sourceCount === 'number' && (
          <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--accent)]">
            {sourceCount} sources
          </span>
        )}
        <div className="flex-1" />
        {filename && (
          <button
            onClick={handleDownload}
            disabled={busy}
            className="rounded border border-[var(--border)] bg-transparent px-3 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Download .md'}
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  )
}
