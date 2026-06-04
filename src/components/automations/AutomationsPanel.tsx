import { useEffect, useState } from 'react'
import { useAutomationsStore } from '@/stores/automations-store'
import type { Automation } from '@/stores/automations-store'
import { CronEditor } from './CronEditor'
import { RunHistoryViewer } from './RunHistoryViewer'

// G1 — Automations / cron panel.
//
// List of scheduled tasks. "+ New" opens an inline editor row. Each
// row exposes enable-toggle, run-now, edit, delete, and a collapsible
// last-run preview. The CronEditor handles validation + human preview.

interface DraftForm {
  id?: string
  label: string
  cron: string
  prompt: string
  model: string
  enabled: boolean
}

const emptyDraft = (): DraftForm => ({
  label: '',
  cron: '*/5 * * * *',
  prompt: '',
  model: '',
  enabled: true
})

export function AutomationsPanel() {
  const automations = useAutomationsStore((s) => s.automations)
  const refresh = useAutomationsStore((s) => s.refresh)
  const create = useAutomationsStore((s) => s.create)
  const update = useAutomationsStore((s) => s.update)
  const remove = useAutomationsStore((s) => s.remove)
  const runNow = useAutomationsStore((s) => s.runNow)
  const loading = useAutomationsStore((s) => s.loading)

  const [draft, setDraft] = useState<DraftForm | null>(null)
  const [cronValid, setCronValid] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openNew = () => {
    setDraft(emptyDraft())
    setCronValid(false)
  }

  const openEdit = (a: Automation) => {
    setDraft({
      id: a.id,
      label: a.label,
      cron: a.cron,
      prompt: a.prompt,
      model: a.model ?? '',
      enabled: a.enabled
    })
    setCronValid(true)
  }

  const closeDraft = () => setDraft(null)

  const handleSave = async () => {
    if (!draft) return
    if (!draft.label.trim() || !draft.prompt.trim() || !cronValid) return
    if (draft.id) {
      const ok = await update(draft.id, {
        label: draft.label.trim(),
        cron: draft.cron,
        prompt: draft.prompt,
        model: draft.model.trim() || undefined,
        enabled: draft.enabled
      })
      if (ok) closeDraft()
    } else {
      const created = await create({
        label: draft.label.trim(),
        cron: draft.cron,
        prompt: draft.prompt,
        model: draft.model.trim() || undefined
      })
      if (created) closeDraft()
    }
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2 text-[12px] text-[var(--text-primary)]">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Automations · {automations.length}
        </span>
        <button
          type="button"
          onClick={openNew}
          className="rounded bg-[var(--accent)] px-2 py-0.5 text-[11px] font-medium text-[var(--bg-primary)]"
        >
          + New
        </button>
      </div>

      {draft && (
        <div className="flex flex-col gap-2 rounded border border-[var(--border)] bg-[var(--bg-secondary)] p-2">
          <div className="grid grid-cols-[80px_1fr] items-center gap-2">
            <label className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              Label
            </label>
            <input
              type="text"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="Friendly name"
              className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] text-[var(--text-primary)]"
            />
            <label className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              Cron
            </label>
            <CronEditor
              value={draft.cron}
              onChange={(cron) => setDraft({ ...draft, cron })}
              onValidityChange={setCronValid}
            />
            <label className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              Model
            </label>
            <input
              type="text"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              placeholder="(optional — defaults to deepseek-chat)"
              className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] text-[var(--text-primary)]"
            />
            <label className="self-start pt-1 text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              Prompt
            </label>
            <textarea
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              rows={3}
              placeholder="Body sent to the model on each fire"
              className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[12px] text-[var(--text-primary)]"
            />
          </div>
          {draft.id && (
            <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              Enabled
            </label>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeDraft}
              className="rounded px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!draft.label.trim() || !draft.prompt.trim() || !cronValid}
              className="rounded bg-[var(--accent)] px-3 py-1 text-[11px] font-medium text-[var(--bg-primary)] disabled:opacity-50"
            >
              {draft.id ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-1">
        {loading && automations.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-[var(--text-muted)]">Loading…</p>
        ) : automations.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-[var(--text-muted)]">
            No automations yet. Click + New to schedule a task.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {automations.map((a) => (
              <li
                key={a.id}
                className="rounded border border-[var(--border)] bg-[var(--bg-secondary)]"
              >
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={a.enabled}
                    onChange={(e) => update(a.id, { enabled: e.target.checked })}
                    title={a.enabled ? 'Disable' : 'Enable'}
                  />
                  <button
                    type="button"
                    onClick={() => setExpanded((curr) => (curr === a.id ? null : a.id))}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate font-medium text-[var(--text-primary)]">
                      {a.label}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-[var(--text-muted)]">
                      {a.cron} · {a.model || 'deepseek-chat'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runNow(a.id)}
                    className="rounded px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--accent)]"
                    title="Run now"
                  >
                    Run
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(a)}
                    className="rounded px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete "${a.label}"?`)) void remove(a.id)
                    }}
                    className="rounded px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--error)]"
                  >
                    Del
                  </button>
                </div>
                {expanded === a.id && (
                  <div className="border-t border-[var(--border)] bg-[var(--bg-primary)]">
                    <pre className="px-2 py-1.5 text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap">
                      {a.prompt}
                    </pre>
                    <RunHistoryViewer lastRunAt={a.lastRunAt} lastResult={a.lastResult} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
