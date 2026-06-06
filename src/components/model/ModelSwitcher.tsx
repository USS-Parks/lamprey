import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useModelStore } from '@/stores/model-store'
import { useUiStore } from '@/stores/ui-store'
import type { ModelInfo } from '@/lib/types'

function formatContext(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1024)}K`
  return String(n)
}

function ModelRow({
  model,
  active,
  onSelect
}: {
  model: ModelInfo
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors ${
        active ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-tertiary)]'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
            {model.name}
          </span>
          {active && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="text-[var(--accent)]"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[12px]">
          {model.provider && (
            <span className="rounded bg-[var(--bg-primary)] px-1.5 py-0.5 font-mono uppercase tracking-wider text-[var(--text-muted)]">
              {model.provider}
            </span>
          )}
          <span className="rounded bg-[var(--bg-primary)] px-1.5 py-0.5 text-[var(--text-secondary)]">
            {formatContext(model.contextWindow)} ctx
          </span>
          <span
            className={`rounded px-1.5 py-0.5 ${
              model.supportsTools
                ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                : 'bg-[var(--bg-primary)] text-[var(--text-muted)]'
            }`}
          >
            {model.supportsTools ? 'Tools' : 'No tools'}
          </span>
          {model.supportsVision && (
            <span className="rounded bg-[var(--accent-dim)] px-1.5 py-0.5 text-[var(--accent)]">
              Vision
            </span>
          )}
          {model.isReasoner && (
            <span className="rounded bg-[var(--accent-dim)] px-1.5 py-0.5 text-[var(--accent)]">
              Reasoning
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

export function ModelSwitcher() {
  const activeModel = useChatStore((s) => s.activeModel)
  const setModel = useChatStore((s) => s.setModel)
  const models = useModelStore((s) => s.models)
  const openSettings = useUiStore((s) => s.openSettings)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const active = models.find((m) => m.id === activeModel)
  const activeName = active?.name ?? activeModel
  const activeIsReasoner = !!active?.isReasoner

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  const handleSelect = (id: string) => {
    setOpen(false)
    void setModel(id)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={
          activeIsReasoner
            ? 'Reasoner does not support tool use. MCP tools unavailable while this model is active.'
            : 'Switch model'
        }
        className="flex items-center gap-1.5 rounded border border-[var(--panel-border)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <span>{activeName}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {activeIsReasoner && (
        <span
          className="ml-2 font-mono text-[12px] text-[var(--warning)]"
          title="Reasoner models do not support tool use. MCP tools unavailable while active."
        >
          No tools
        </span>
      )}

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-2xl border border-[var(--panel-border)] bg-[var(--bg-secondary)] shadow-xl">
          <div className="border-b border-[var(--panel-border)] px-3 py-1.5 text-[12px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Active model
          </div>
          <div className="max-h-80 overflow-y-auto">
            {(models.length > 0
              ? models
              : [
                  {
                    id: 'deepseek-v4-pro',
                    name: 'DeepSeek V4 Pro',
                    provider: 'deepseek',
                    contextWindow: 131072,
                    supportsTools: true,
                    supportsVision: false
                  } as ModelInfo,
                  {
                    id: 'deepseek-v4-flash',
                    name: 'DeepSeek V4 Flash',
                    provider: 'deepseek',
                    contextWindow: 131072,
                    supportsTools: true,
                    supportsVision: false
                  } as ModelInfo,
                  {
                    id: 'gemma-3-27b-it',
                    name: 'Gemma 3 27B',
                    provider: 'google',
                    contextWindow: 131072,
                    supportsTools: true,
                    supportsVision: true
                  } as ModelInfo,
                  {
                    id: 'qwen3-coder-plus',
                    name: 'Qwen3 Coder Plus',
                    provider: 'dashscope',
                    contextWindow: 1000000,
                    supportsTools: true,
                    supportsVision: false
                  } as ModelInfo
                ]
            ).map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                active={model.id === activeModel}
                onSelect={() => handleSelect(model.id)}
              />
            ))}
          </div>
          <button
            onClick={() => {
              setOpen(false)
              openSettings()
            }}
            className="block w-full border-t border-[var(--panel-border)] px-3 py-2 text-left text-[13px] text-[var(--accent)] transition-colors hover:bg-[var(--bg-tertiary)]"
          >
            Configure models →
          </button>
        </div>
      )}
    </div>
  )
}
