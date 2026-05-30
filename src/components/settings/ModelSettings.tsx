import { useEffect, useMemo, useState } from 'react'
import { useModelStore } from '@/stores/model-store'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/stores/toast-store'
import { DEFAULT_MODEL_CONFIG, type ModelConfig } from '@/lib/types'

function mergeConfig(stored: Partial<ModelConfig> | undefined): ModelConfig {
  return { ...DEFAULT_MODEL_CONFIG, ...(stored ?? {}) }
}

export function ModelSettings() {
  const models = useModelStore((s) => s.models)
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [selectedId, setSelectedId] = useState<string>(
    settings.defaultModel || (models[0]?.id ?? 'deepseek-chat')
  )
  const [testStatus, setTestStatus] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!models.find((m) => m.id === selectedId) && models.length > 0) {
      setSelectedId(models[0].id)
    }
  }, [models, selectedId])

  const selectedModel = models.find((m) => m.id === selectedId)
  const cfg = useMemo(
    () => mergeConfig(settings.modelConfig?.[selectedId]),
    [settings.modelConfig, selectedId]
  )

  const writeConfig = async (partial: Partial<ModelConfig>) => {
    const next = {
      ...settings.modelConfig,
      [selectedId]: { ...cfg, ...partial }
    }
    await updateSettings({ modelConfig: next })
  }

  const handleSetDefault = async () => {
    await updateSettings({ defaultModel: selectedId })
    toast.success(`${selectedModel?.name ?? selectedId} set as default`)
  }

  const handleTest = async () => {
    if (!window.api) return
    setTesting(true)
    setTestStatus(null)
    try {
      const conv = await window.api.conversation.create(selectedId)
      if (!conv.success) {
        setTestStatus(`Error: ${conv.error}`)
        toast.error(`Model test failed: ${conv.error}`)
        return
      }
      const conversationId = (conv.data as { id: string }).id
      const start = Date.now()
      const result = await window.api.chat.send({
        conversationId,
        model: selectedId,
        content: 'Respond with only the word PONG.',
        activeSkillIds: []
      })
      if (!result.success) {
        setTestStatus(`Error: ${result.error}`)
        toast.error(`Model test failed: ${result.error}`)
      } else {
        const elapsed = Date.now() - start
        setTestStatus(`Responded in ${elapsed} ms`)
        toast.success(`${selectedModel?.name ?? selectedId} responded in ${elapsed} ms`)
      }
      await window.api.conversation.delete(conversationId)
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown error'
      setTestStatus(`Error: ${msg}`)
      toast.error(`Model test failed: ${msg}`)
    }
    setTesting(false)
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">Models</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Per-model temperature, top-p, max tokens, and an optional system prompt override applied
          on every chat with this model.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {models.map((m) => (
          <button
            key={m.id}
            onClick={() => setSelectedId(m.id)}
            className={`rounded border px-3 py-1.5 font-mono text-xs transition-colors ${
              selectedId === m.id
                ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]'
                : 'border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {m.name}
            {settings.defaultModel === m.id && (
              <span className="ml-1.5 text-[9px] uppercase text-[var(--text-muted)]">default</span>
            )}
          </button>
        ))}
      </div>

      {selectedModel && (
        <div className="space-y-3 rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Temperature ({cfg.temperature.toFixed(2)})
              </span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={cfg.temperature}
                onChange={(e) => writeConfig({ temperature: Number(e.target.value) })}
                className="accent-[var(--accent)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Top-p ({cfg.topP.toFixed(2)})
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={cfg.topP}
                onChange={(e) => writeConfig({ topP: Number(e.target.value) })}
                className="accent-[var(--accent)]"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Max tokens (blank = model default)
            </span>
            <input
              type="number"
              min={1}
              value={cfg.maxTokens ?? ''}
              onChange={(e) => {
                const raw = e.target.value
                writeConfig({ maxTokens: raw === '' ? null : Math.max(1, Number(raw)) })
              }}
              placeholder="Unlimited"
              className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              System prompt override (blank = use Lamprey default)
            </span>
            <textarea
              value={cfg.systemPromptOverride}
              onChange={(e) => writeConfig({ systemPromptOverride: e.target.value })}
              rows={3}
              spellCheck={false}
              placeholder="Replaces 'You are Lamprey, a helpful AI assistant…' when set."
              className="resize-none rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={handleSetDefault}
              disabled={settings.defaultModel === selectedId}
              className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              Set as default
            </button>
            <button
              onClick={handleTest}
              disabled={testing}
              className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {testing ? 'Testing…' : 'Test model'}
            </button>
            {testStatus && (
              <span
                className={`text-[11px] ${
                  testStatus.startsWith('Error')
                    ? 'text-[var(--error)]'
                    : 'text-[var(--success)]'
                }`}
              >
                {testStatus}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-[var(--border)] pt-4 opacity-60">
        <h4 className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          Coming in v0.2
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-dashed border-[var(--border)] bg-[var(--bg-primary)] p-2 text-[11px] text-[var(--text-muted)]">
            <div className="font-mono text-xs text-[var(--text-secondary)]">Ollama (local)</div>
            <div className="mt-0.5">Bring-your-own local model endpoint.</div>
          </div>
          <div className="rounded border border-dashed border-[var(--border)] bg-[var(--bg-primary)] p-2 text-[11px] text-[var(--text-muted)]">
            <div className="font-mono text-xs text-[var(--text-secondary)]">Custom endpoint</div>
            <div className="mt-0.5">Point Lamprey at any OpenAI-compatible URL.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
