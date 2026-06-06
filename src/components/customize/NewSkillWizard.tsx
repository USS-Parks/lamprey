import { useMemo, useState } from 'react'
import { useSkillsStore } from '@/stores/skills-store'
import { useMcpStore } from '@/stores/mcp-store'
import { toast } from '@/stores/toast-store'

interface NewSkillWizardProps {
  onClose: () => void
}

type StepId = 'identity' | 'trigger' | 'preview'

interface DraftState {
  name: string
  description: string
  content: string
  autoInvoke: boolean
  allowedToolsText: string
  model: string
  directoryMode: boolean
  scaffoldReference: boolean
}

const INITIAL: DraftState = {
  name: '',
  description: '',
  content: 'When this skill is active, …\n',
  autoInvoke: true,
  allowedToolsText: '',
  model: '',
  directoryMode: false,
  scaffoldReference: false
}

const NATIVE_TOOL_HINTS = [
  'shell_command',
  'apply_patch',
  'view_image',
  'web_find',
  'workspace_context',
  'verify_workspace'
]

function parseAllowedTools(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function generatePreview(draft: DraftState): string {
  const front: string[] = ['---', `name: ${draft.name || 'untitled-skill'}`]
  if (draft.description) front.push(`description: ${JSON.stringify(draft.description)}`)
  const allowed = parseAllowedTools(draft.allowedToolsText)
  if (allowed.length) {
    front.push('allowedTools:')
    for (const t of allowed) front.push(`  - ${t}`)
  }
  if (draft.model) front.push(`model: ${draft.model}`)
  if (!draft.autoInvoke) front.push('autoInvoke: false')
  front.push('---')
  return `${front.join('\n')}\n\n${draft.content}`
}

export function NewSkillWizard({ onClose }: NewSkillWizardProps) {
  const createSkill = useSkillsStore((s) => s.createSkill)
  const mcpServers = useMcpStore((s) => s.servers)

  const [step, setStep] = useState<StepId>('identity')
  const [draft, setDraft] = useState<DraftState>(INITIAL)
  const [busy, setBusy] = useState(false)

  const update = (patch: Partial<DraftState>) => setDraft((s) => ({ ...s, ...patch }))

  const validation = useMemo(() => {
    const errors: Record<StepId, string[]> = {
      identity: [],
      trigger: [],
      preview: []
    }
    if (!draft.name.trim()) errors.identity.push('name is required')
    if (!draft.description.trim()) errors.identity.push('description is required')
    if (!draft.content.trim()) errors.preview.push('content is required')
    return errors
  }, [draft])

  const identityOk = validation.identity.length === 0
  const previewOk = validation.preview.length === 0

  const preview = useMemo(() => generatePreview(draft), [draft])

  const toolSuggestions = useMemo(() => {
    const fromMcp = mcpServers.map((s) => `mcp:${s.id}-*`)
    return [...NATIVE_TOOL_HINTS, ...fromMcp]
  }, [mcpServers])

  const addSuggestion = (tool: string) => {
    const current = parseAllowedTools(draft.allowedToolsText)
    if (current.includes(tool)) return
    update({ allowedToolsText: [...current, tool].join('\n') })
  }

  const onCreate = async () => {
    if (!identityOk || !previewOk) {
      toast.error('Fill in name, description, and content first')
      return
    }
    setBusy(true)
    try {
      const allowed = parseAllowedTools(draft.allowedToolsText)
      await createSkill({
        name: draft.name.trim(),
        description: draft.description.trim(),
        content: draft.content.trim(),
        autoInvoke: draft.autoInvoke,
        ...(allowed.length ? { allowedTools: allowed } : {}),
        ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
        directoryMode: draft.directoryMode,
        scaffoldReference: draft.directoryMode && draft.scaffoldReference
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex h-[600px] w-[640px] flex-col overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--bg-secondary)] shadow-2xl">
        {/* Header */}
        <header className="flex h-12 shrink-0 items-center border-b border-[var(--panel-border)] px-4">
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">
            New skill
          </span>
          <div className="ml-3 flex items-center gap-1">
            {(['identity', 'trigger', 'preview'] as const).map((id, idx) => (
              <div key={id} className="flex items-center gap-1">
                {idx > 0 && <span className="text-[var(--text-muted)]">›</span>}
                <span
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    step === id
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                  }`}
                >
                  {idx + 1}. {id}
                </span>
              </div>
            ))}
          </div>
          <div className="flex-1" />
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === 'identity' && (
            <div className="space-y-4">
              <label className="block text-[12px] text-[var(--text-muted)]">
                Name
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder="my-research-helper"
                  className="mt-1 w-full rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
              </label>
              <label className="block text-[12px] text-[var(--text-muted)]">
                Description
                <textarea
                  value={draft.description}
                  onChange={(e) => update({ description: e.target.value })}
                  rows={3}
                  placeholder="One or two sentences describing when this skill should activate."
                  className="mt-1 w-full resize-y rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
              </label>
              <label className="block text-[12px] text-[var(--text-muted)]">
                Content (Markdown body the agent reads when the skill is active)
                <textarea
                  value={draft.content}
                  onChange={(e) => update({ content: e.target.value })}
                  rows={6}
                  spellCheck={false}
                  className="mt-1 w-full resize-y rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-2 font-mono text-[12px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
              </label>
              {!identityOk && (
                <div className="rounded border border-[var(--error)] bg-[var(--error)]/10 px-2 py-1.5 text-[11px] text-[var(--error)]">
                  {validation.identity.join(', ')}
                </div>
              )}
            </div>
          )}

          {step === 'trigger' && (
            <div className="space-y-4">
              <fieldset className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3">
                <legend className="px-1 text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  Trigger style
                </legend>
                <label className="mt-1 flex items-start gap-2 text-[12px] text-[var(--text-primary)]">
                  <input
                    type="radio"
                    name="autoInvoke"
                    checked={draft.autoInvoke}
                    onChange={() => update({ autoInvoke: true })}
                    className="mt-1"
                  />
                  <span>
                    <strong>Auto-invoke</strong> — the model decides when to use this skill based on
                    the description.
                  </span>
                </label>
                <label className="mt-2 flex items-start gap-2 text-[12px] text-[var(--text-primary)]">
                  <input
                    type="radio"
                    name="autoInvoke"
                    checked={!draft.autoInvoke}
                    onChange={() => update({ autoInvoke: false })}
                    className="mt-1"
                  />
                  <span>
                    <strong>Manual only</strong> — the user must reference the skill by name before
                    it's loaded.
                  </span>
                </label>
              </fieldset>

              <label className="block text-[12px] text-[var(--text-muted)]">
                Allowed tools (one glob per line or comma-separated; leave empty for no
                restriction)
                <textarea
                  value={draft.allowedToolsText}
                  onChange={(e) => update({ allowedToolsText: e.target.value })}
                  rows={3}
                  placeholder="shell_command&#10;mcp:gmail-*"
                  className="mt-1 w-full resize-y rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-2 font-mono text-[12px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
                <div className="mt-1 flex flex-wrap gap-1">
                  {toolSuggestions.map((t) => (
                    <button
                      key={t}
                      onClick={() => addSuggestion(t)}
                      className="rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-0.5 font-mono text-[10px] hover:border-[var(--accent)]"
                    >
                      + {t}
                    </button>
                  ))}
                </div>
              </label>

              <label className="block text-[12px] text-[var(--text-muted)]">
                Model override (optional, e.g. `qwen-max`)
                <input
                  value={draft.model}
                  onChange={(e) => update({ model: e.target.value })}
                  placeholder="leave empty to use the conversation default"
                  className="mt-1 w-full rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
              </label>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <fieldset className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3">
                <legend className="px-1 text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  Layout
                </legend>
                <label className="flex items-start gap-2 text-[12px] text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={draft.directoryMode}
                    onChange={(e) => update({ directoryMode: e.target.checked })}
                    className="mt-1"
                  />
                  <span>
                    Directory-mode skill (folder containing <code>skill.md</code> + sibling files).
                  </span>
                </label>
                {draft.directoryMode && (
                  <label className="mt-2 flex items-start gap-2 text-[12px] text-[var(--text-primary)]">
                    <input
                      type="checkbox"
                      checked={draft.scaffoldReference}
                      onChange={(e) => update({ scaffoldReference: e.target.checked })}
                      className="mt-1"
                    />
                    <span>
                      Also scaffold a <code>reference.md</code> stub.
                    </span>
                  </label>
                )}
              </fieldset>

              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  Preview of skill.md
                </div>
                <pre className="max-h-[260px] overflow-auto rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">
                  {preview}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex shrink-0 items-center gap-2 border-t border-[var(--panel-border)] px-4 py-3">
          <button
            onClick={onClose}
            className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-3 py-1.5 text-[12px] hover:border-[var(--accent)]"
          >
            Cancel
          </button>
          <div className="flex-1" />
          {step !== 'identity' && (
            <button
              onClick={() => setStep(step === 'preview' ? 'trigger' : 'identity')}
              className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-3 py-1.5 text-[12px] hover:border-[var(--accent)]"
            >
              Back
            </button>
          )}
          {step === 'identity' && (
            <button
              onClick={() => identityOk && setStep('trigger')}
              disabled={!identityOk}
              className="rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Next
            </button>
          )}
          {step === 'trigger' && (
            <button
              onClick={() => setStep('preview')}
              className="rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
            >
              Next
            </button>
          )}
          {step === 'preview' && (
            <button
              onClick={() => void onCreate()}
              disabled={busy || !identityOk || !previewOk}
              className="rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
