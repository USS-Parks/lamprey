import { useEffect, useMemo, useState } from 'react'
import { useModelStore } from '@/stores/model-store'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/stores/toast-store'
import { DEFAULT_MODEL_CONFIG, type ModelConfig, type ModelInfo } from '@/lib/types'

type CatalogStatus = 'verified' | 'missing' | 'no-key' | 'unsupported-endpoint' | 'auth-failed' | 'error'

interface CatalogVerification {
  generatedAt: number
  providers: Array<{
    provider: string
    status: 'ok' | 'no-key' | 'unsupported-endpoint' | 'auth-failed' | 'error'
    reason?: string
    liveCount?: number
  }>
  models: Array<{
    modelId: string
    name: string
    provider: string
    apiModelId: string
    status: CatalogStatus
    reason?: string
  }>
}

function statusChip(status: CatalogStatus | undefined): { label: string; tone: string } {
  switch (status) {
    case 'verified':
      return { label: 'verified', tone: 'bg-[var(--success)]/15 text-[var(--success)]' }
    case 'missing':
      return { label: 'missing', tone: 'bg-[var(--error)]/15 text-[var(--error)]' }
    case 'auth-failed':
      return { label: 'auth failed', tone: 'bg-[var(--error)]/15 text-[var(--error)]' }
    case 'no-key':
      return { label: 'no key', tone: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]' }
    case 'unsupported-endpoint':
      return { label: 'unverifiable', tone: 'bg-[var(--warning)]/15 text-[var(--warning)]' }
    case 'error':
      return { label: 'error', tone: 'bg-[var(--error)]/15 text-[var(--error)]' }
    default:
      return { label: 'unchecked', tone: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]' }
  }
}

const BUILTIN_IDS = new Set([
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'deepseek-chat',
  'deepseek-reasoner',
  'gemma-3-27b-it',
  'qwen3-coder-plus'
])

const PRESET_TEMPLATES: ModelInfo[] = [
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    contextWindow: 131072,
    supportsTools: true,
    supportsVision: false
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    contextWindow: 131072,
    supportsTools: true,
    supportsVision: false
  },
  {
    id: 'gemma-3-27b-it',
    name: 'Gemma 3 27B',
    provider: 'google',
    contextWindow: 131072,
    supportsTools: true,
    supportsVision: true
  },
  {
    id: 'qwen3-coder-plus',
    name: 'Qwen3 Coder Plus',
    provider: 'dashscope',
    contextWindow: 1000000,
    supportsTools: true,
    supportsVision: false
  }
]

function mergeConfig(stored: Partial<ModelConfig> | undefined): ModelConfig {
  return { ...DEFAULT_MODEL_CONFIG, ...(stored ?? {}) }
}

export function ModelSettings() {
  const models = useModelStore((s) => s.models)
  const loadModels = useModelStore((s) => s.loadModels)
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [selectedId, setSelectedId] = useState<string>(
    settings.defaultModel || (models[0]?.id ?? 'deepseek-v4-pro')
  )
  const [testStatus, setTestStatus] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [verification, setVerification] = useState<CatalogVerification | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [draft, setDraft] = useState<ModelInfo>({
    id: '',
    name: '',
    contextWindow: 65536,
    supportsTools: true,
    supportsVision: false
  })

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

  const customModels = useMemo(
    () => models.filter((m) => !BUILTIN_IDS.has(m.id)),
    [models]
  )

  const applyPreset = (preset: ModelInfo) => {
    setDraft({ ...preset })
  }

  const handleAddCustom = async () => {
    if (!window.api) return
    if (!draft.id.trim()) {
      toast.warning('Model id is required (e.g., deepseek-v4-pro)')
      return
    }
    if (!draft.name.trim()) {
      toast.warning('Display name is required')
      return
    }
    const result = await window.api.model.addCustom({
      id: draft.id.trim(),
      name: draft.name.trim(),
      contextWindow: draft.contextWindow,
      supportsTools: draft.supportsTools,
      supportsVision: draft.supportsVision
    })
    if (!result.success) {
      toast.error(`Failed to add model: ${result.error}`)
      return
    }
    await loadModels()
    toast.success(`${draft.name.trim()} added`)
    setDraft({
      id: '',
      name: '',
      contextWindow: 65536,
      supportsTools: true,
      supportsVision: false
    })
  }

  const handleRemoveCustom = async (id: string) => {
    if (!window.api) return
    if (!confirm(`Remove custom model "${id}"?`)) return
    const result = await window.api.model.removeCustom(id)
    if (!result.success) {
      toast.error(`Failed to remove model: ${result.error}`)
      return
    }
    await loadModels()
    toast.success(`${id} removed`)
    if (selectedId === id) {
      setSelectedId(models.find((m) => m.id !== id)?.id ?? 'deepseek-v4-pro')
    }
  }

  const statusByModelId = useMemo(() => {
    const map = new Map<string, CatalogStatus>()
    verification?.models.forEach((m) => map.set(m.modelId, m.status))
    return map
  }, [verification])

  const handleVerifyCatalog = async () => {
    if (!window.api) return
    setVerifying(true)
    try {
      const result = await window.api.model.verifyCatalog()
      if (!result.success) {
        toast.error(`Catalog verification failed: ${result.error}`)
        return
      }
      const report = result.data as CatalogVerification
      setVerification(report)
      const verifiedCount = report.models.filter((m) => m.status === 'verified').length
      const missingCount = report.models.filter((m) => m.status === 'missing').length
      const noKeyCount = report.models.filter((m) => m.status === 'no-key').length
      if (missingCount > 0) {
        toast.warning(
          `${verifiedCount} verified, ${missingCount} missing from live /v1/models, ${noKeyCount} pending a key`
        )
      } else if (verifiedCount > 0) {
        toast.success(
          `${verifiedCount} verified against live /v1/models${noKeyCount > 0 ? `, ${noKeyCount} pending a key` : ''}`
        )
      } else {
        toast.warning('No models could be verified. Add a provider key in Settings → API Keys.')
      }
    } catch (err) {
      toast.error(`Catalog verification failed: ${(err as Error).message ?? 'unknown error'}`)
    } finally {
      setVerifying(false)
    }
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
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Per-model temperature, top-p, max tokens, and an optional system prompt override applied
          on every chat with this model. Use "Verify against providers" to confirm every model id
          in the picker actually exists at the provider it's routed to — the check calls each
          provider's live /v1/models endpoint with your stored key, no inferences.
        </p>
      </div>

      <div className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleVerifyCatalog}
            disabled={verifying}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {verifying ? 'Verifying...' : 'Verify against providers'}
          </button>
          {verification && (
            <span className="font-mono text-[12px] text-[var(--text-muted)]">
              {verification.providers.map((p) => {
                const tone =
                  p.status === 'ok'
                    ? 'text-[var(--success)]'
                    : p.status === 'no-key'
                    ? 'text-[var(--text-muted)]'
                    : p.status === 'unsupported-endpoint'
                    ? 'text-[var(--warning)]'
                    : 'text-[var(--error)]'
                return (
                  <span key={p.provider} className={`mr-3 ${tone}`}>
                    {p.provider}:
                    {p.status === 'ok' ? ` ${p.liveCount ?? 0} live ids` : ` ${p.status}`}
                  </span>
                )
              })}
            </span>
          )}
        </div>
        {verification && (
          <p className="mt-2 text-[12px] text-[var(--text-muted)]">
            Chips on each model below show whether the apiModelId is present in the provider's
            live /v1/models response. Missing = the provider does not currently serve that id;
            unverifiable = the provider does not expose /v1/models (no auto-check possible).
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {models.map((m) => {
          const status = statusByModelId.get(m.id)
          const chip = statusChip(status)
          const found = verification?.models.find((x) => x.modelId === m.id)
          return (
            <button
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              title={found?.reason ?? `${m.id}`}
              className={`rounded border px-3 py-1.5 font-mono text-xs transition-colors ${
                selectedId === m.id
                  ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]'
                  : 'border-[var(--panel-border)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {m.name}
              {settings.defaultModel === m.id && (
                <span className="ml-1.5 text-[11px] uppercase text-[var(--text-muted)]">default</span>
              )}
              {verification && (
                <span
                  className={`ml-1.5 rounded px-1 py-0.5 text-[10px] uppercase tracking-wider ${chip.tone}`}
                >
                  {chip.label}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {selectedModel && (
        <div className="space-y-3 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
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
              <span className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
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
            <span className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
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
              className="rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
              System prompt override (blank = use Lamprey default)
            </span>
            <textarea
              value={cfg.systemPromptOverride}
              onChange={(e) => writeConfig({ systemPromptOverride: e.target.value })}
              rows={3}
              spellCheck={false}
              placeholder="Replaces 'You are Lamprey, a helpful AI assistant...' when set."
              className="resize-none rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={handleSetDefault}
              disabled={settings.defaultModel === selectedId}
              className="rounded border border-[var(--panel-border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              Set as default
            </button>
            <button
              onClick={handleTest}
              disabled={testing}
              className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {testing ? 'Testing...' : 'Test model'}
            </button>
            {testStatus && (
              <span
                className={`text-[13px] ${
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

      <div className="space-y-3 border-t border-[var(--panel-border)] pt-4">
        <div>
          <h4 className="font-mono text-[13px] uppercase tracking-wider text-[var(--text-muted)]">
            Custom models
          </h4>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
            Add any model id your DeepSeek key can call - e.g. <span className="font-mono">deepseek-v4-pro</span>.
            Builtins stay; customs override built-ins with the same id.
          </p>
        </div>

        {customModels.length > 0 && (
          <div className="space-y-1.5">
            {customModels.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-2 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[var(--text-primary)]">{m.name}</div>
                  <div className="mt-0.5 truncate font-mono text-[12px] text-[var(--text-muted)]">
                    {m.id} · {Math.round(m.contextWindow / 1024)}K
                    {m.supportsTools ? ' · tools' : ''}
                    {m.supportsVision ? ' · vision' : ''}
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveCustom(m.id)}
                  className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--error)]"
                  title="Remove"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
              Quick presets:
            </span>
            {PRESET_TEMPLATES.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p)}
                className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 font-mono text-[12px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
              >
                {p.name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
                Model id
              </span>
              <input
                type="text"
                value={draft.id}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                placeholder="deepseek-v4-pro"
                className="rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
                Display name
              </span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="DeepSeek V4 Pro"
                className="rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
                Context window
              </span>
              <input
                type="number"
                min={1024}
                step={1024}
                value={draft.contextWindow}
                onChange={(e) =>
                  setDraft({ ...draft, contextWindow: Math.max(1024, Number(e.target.value) || 65536) })
                }
                className="rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>
            <div className="flex flex-col justify-end gap-1">
              <span className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
                Capabilities
              </span>
              <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.supportsTools}
                    onChange={(e) => setDraft({ ...draft, supportsTools: e.target.checked })}
                    className="h-3 w-3 accent-[var(--accent)]"
                  />
                  Tools
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.supportsVision}
                    onChange={(e) => setDraft({ ...draft, supportsVision: e.target.checked })}
                    className="h-3 w-3 accent-[var(--accent)]"
                  />
                  Vision
                </label>
              </div>
            </div>
          </div>

          <button
            onClick={handleAddCustom}
            disabled={!draft.id.trim() || !draft.name.trim()}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Add model
          </button>
        </div>
      </div>
    </div>
  )
}
