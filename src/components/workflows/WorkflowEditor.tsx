import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { toast } from '@/stores/toast-store'
import { useToolsStore } from '@/stores/tools-store'
import { useWorkflowsStore } from '@/stores/workflows-store'
import { DryRunPanel, dryRunWorkflowSource, type DryRunResult } from './DryRunPanel'
import { MetaScaffolder, workflowScaffold } from './MetaScaffolder'

interface WorkflowEditorProps {
  onSaved: () => void
}

export function WorkflowEditor({ onSaved }: WorkflowEditorProps): ReactElement {
  const [script, setScript] = useState(() => workflowScaffold())
  const [validation, setValidation] = useState<{ ok: true; label: string } | { ok: false; error: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)
  const validateWorkflow = useWorkflowsStore((s) => s.validateWorkflow)
  const saveWorkflow = useWorkflowsStore((s) => s.saveWorkflow)
  const stubs = useToolsStore((s) => s.stubs)
  const loadStubs = useToolsStore((s) => s.loadStubs)

  useEffect(() => {
    void loadStubs()
  }, [loadStubs])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void validateWorkflow(script).then((result) => {
        if (result.ok) {
          const meta = result.meta as { name?: string }
          setValidation({ ok: true, label: meta.name ?? 'valid' })
        } else {
          setValidation({ ok: false, error: result.error })
        }
      })
    }, 300)
    return () => window.clearTimeout(id)
  }, [script, validateWorkflow])

  const suggestions = useMemo(
    () => stubs.filter((stub) => /agent|task|workflow|preview|monitor/i.test(`${stub.name} ${stub.description}`)).slice(0, 6),
    [stubs]
  )

  const save = async () => {
    setSaving(true)
    const saved = await saveWorkflow(script)
    setSaving(false)
    if (!saved) {
      toast.error('Workflow save failed')
      return
    }
    toast.success(`Saved ${saved.name}`)
    onSaved()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-l border-[var(--panel-border)] bg-[var(--bg-primary)]" data-testid="workflow-editor">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-3 py-2">
        <div>
          <div className="text-[13px] font-medium text-[var(--text-primary)]">New workflow</div>
          {validation && (
            <div className={`font-mono text-[10px] ${validation.ok ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
              {validation.ok ? `meta: ${validation.label}` : validation.error}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <MetaScaffolder onInsert={setScript} />
          <button
            type="button"
            onClick={() => setDryRun(dryRunWorkflowSource(script))}
            className="rounded border border-[var(--panel-border)] px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            Dry run
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || validation?.ok === false}
            className="rounded bg-[var(--accent)] px-2 py-1 font-mono text-[11px] text-white transition-opacity disabled:opacity-50"
          >
            {saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_220px]">
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          spellCheck={false}
          className="min-h-0 resize-none border-0 bg-[var(--bg-primary)] p-3 font-mono text-[12px] leading-5 text-[var(--text-primary)] outline-none"
        />
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto border-l border-[var(--panel-border)] p-2">
          <div className="rounded-md border border-[var(--panel-border)] bg-[var(--bg-secondary)] p-2">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Registry
            </div>
            <button
              type="button"
              onClick={() => setScript((current) => `${current}\nconst reply = await agent('Prompt', { label: 'agent-1', agentType: 'general', model: 'cheap' })\n`)}
              className="mb-1 w-full rounded bg-[var(--bg-primary)] px-2 py-1 text-left font-mono text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            >
              agent(...)
            </button>
            {suggestions.map((stub) => (
              <div key={stub.name} className="truncate font-mono text-[10px] text-[var(--text-muted)]" title={stub.description}>
                {stub.name}
              </div>
            ))}
          </div>
          <DryRunPanel result={dryRun} />
        </div>
      </div>
    </div>
  )
}
