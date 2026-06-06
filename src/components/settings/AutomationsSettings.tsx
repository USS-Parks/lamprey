import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/stores/toast-store'
import { useModelStore } from '@/stores/model-store'

interface Automation {
  id: string
  label: string
  cron: string
  prompt: string
  model: string | null
  enabled: boolean
  createdAt: number
  lastRunAt: number | null
  lastResult: string | null
}

const CRON_HINTS: { label: string; expr: string }[] = [
  { label: 'every minute', expr: '* * * * *' },
  { label: 'every 5 minutes', expr: '*/5 * * * *' },
  { label: 'top of every hour', expr: '0 * * * *' },
  { label: 'daily at 9am', expr: '0 9 * * *' },
  { label: 'weekdays at 5pm', expr: '0 17 * * 1-5' }
]

export function AutomationsSettings() {
  const [items, setItems] = useState<Automation[]>([])
  const [label, setLabel] = useState('')
  const [cron, setCron] = useState('0 9 * * *')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const models = useModelStore((s) => s.models)

  const refresh = useCallback(async () => {
    if (!window.api?.automations) return
    const res = await window.api.automations.list()
    if (res.success) setItems(res.data as Automation[])
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleCreate = async () => {
    if (!label.trim() || !cron.trim() || !prompt.trim()) {
      toast.error('label, cron, and prompt are required')
      return
    }
    setBusy(true)
    const res = await window.api?.automations?.create({
      label: label.trim(),
      cron: cron.trim(),
      prompt: prompt.trim(),
      model: model || undefined
    })
    setBusy(false)
    if (!res?.success) {
      toast.error(res?.error ?? 'create failed')
      return
    }
    setLabel('')
    setPrompt('')
    void refresh()
  }

  const toggleEnabled = async (a: Automation) => {
    await window.api?.automations?.update(a.id, { enabled: !a.enabled })
    void refresh()
  }
  const runNow = async (a: Automation) => {
    toast.info(`Running "${a.label}"…`)
    const res = await window.api?.automations?.runNow(a.id)
    if (!res?.success) toast.error(res?.error ?? 'run failed')
    else toast.success('Done')
    void refresh()
  }
  const remove = async (a: Automation) => {
    if (!confirm(`Delete automation "${a.label}"?`)) return
    await window.api?.automations?.delete(a.id)
    void refresh()
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[14px] font-medium text-[var(--text-primary)]">Automations</h2>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          Cron-scheduled prompts. Each automation runs its prompt as a one-shot call to the
          selected model. Results are saved as "last run output" — no streaming UI. Local-only:
          your computer must be running for the schedule to fire.
        </p>
      </div>

      <div className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3">
        <h3 className="mb-2 text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
          New automation
        </h3>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="label, e.g. 'morning PR triage'"
            className="rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1 text-[13px] outline-none focus:border-[var(--accent)]"
          />
          <input
            type="text"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="cron (min hour dom month dow), e.g. 0 9 * * *"
            className="rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-[12px] outline-none focus:border-[var(--accent)]"
          />
          <div className="flex flex-wrap gap-1">
            {CRON_HINTS.map((h) => (
              <button
                key={h.expr}
                type="button"
                onClick={() => setCron(h.expr)}
                className="rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
              >
                {h.label}
              </button>
            ))}
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="prompt — e.g. 'Summarize today's open issues across the repo.'"
            className="rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1 text-[13px] outline-none focus:border-[var(--accent)]"
          />
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1 text-[13px] outline-none"
          >
            <option value="">(use default model)</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.id}
              </option>
            ))}
          </select>
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={busy}
              className="rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-3 py-1 text-[12px] hover:border-[var(--accent)] disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Add automation'}
            </button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
          Configured ({items.length})
        </h3>
        {items.length === 0 && (
          <p className="text-[12px] text-[var(--text-muted)]">No automations yet.</p>
        )}
        {items.map((a) => (
          <div
            key={a.id}
            className="mb-2 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-2 text-[12px]"
          >
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={a.enabled}
                onChange={() => void toggleEnabled(a)}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.label}</span>
                  <span className="font-mono text-[10px] text-[var(--accent)]">{a.cron}</span>
                  {a.model && (
                    <span className="text-[10px] text-[var(--text-muted)]">· {a.model}</span>
                  )}
                </div>
                <p className="mt-1 break-all text-[11px] text-[var(--text-muted)]">{a.prompt}</p>
                {a.lastRunAt && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[10px] text-[var(--text-muted)]">
                      last run {new Date(a.lastRunAt).toLocaleString()}
                    </summary>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-[var(--bg-secondary)] p-2 font-mono text-[10px] text-[var(--text-secondary)]">
                      {a.lastResult || '(no output)'}
                    </pre>
                  </details>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  onClick={() => void runNow(a)}
                  className="rounded px-2 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  run now
                </button>
                <button
                  onClick={() => void remove(a)}
                  className="rounded px-2 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--error)]"
                >
                  delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
