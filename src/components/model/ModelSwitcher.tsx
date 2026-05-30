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
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
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
          {model.id === 'deepseek-reasoner' && (
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
  const fallbackName = activeModel === 'deepseek-reasoner' ? 'DeepSeek R1' : 'DeepSeek V3'
  const activeName = active?.name ?? fallbackName

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
          activeModel === 'deepseek-reasoner'
            ? 'R1 does not support tool use. MCP tools unavailable while R1 is active.'
            : 'Switch model'
        }
        className="flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <span>{activeName}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {activeModel === 'deepseek-reasoner' && (
        <span
          className="ml-2 font-mono text-[10px] text-[var(--warning)]"
          title="R1 does not support tool use. MCP tools unavailable while R1 is active."
        >
          No tools
        </span>
      )}

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-secondary)] shadow-xl">
          <div className="border-b border-[var(--border)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Active model
          </div>
          <div className="max-h-80 overflow-y-auto">
            {(models.length > 0
              ? models
              : [
                  {
                    id: 'deepseek-chat',
                    name: 'DeepSeek V3',
                    contextWindow: 65536,
                    supportsTools: true,
                    supportsVision: false
                  } as ModelInfo,
                  {
                    id: 'deepseek-reasoner',
                    name: 'DeepSeek R1',
                    contextWindow: 65536,
                    supportsTools: false,
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
            className="block w-full border-t border-[var(--border)] px-3 py-2 text-left text-[11px] text-[var(--accent)] transition-colors hover:bg-[var(--bg-tertiary)]"
          >
            Configure models →
          </button>
        </div>
      )}
    </div>
  )
}
