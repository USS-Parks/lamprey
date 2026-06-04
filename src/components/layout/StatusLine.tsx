import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useModelStore } from '@/stores/model-store'
import { useWorkflowsStore } from '@/stores/workflows-store'
import { useRagStore } from '@/stores/rag-store'
import { useChatStore } from '@/stores/chat-store'

// H6 — Persistent status line at the bottom of the main window.
//
// Reads from existing renderer stores (model, workflows, rag, chat) plus
// polls `loops:list` for pending wake-up count. The visible slots + their
// labels come from the main-process `statusline:get` config, which is
// loaded from `userData/statusline.md`. Unknown slot ids in the user's file
// are dropped silently in `electron/services/statusline-config.ts`.

type SlotId = 'model' | 'workflow' | 'wakeups' | 'tokens' | 'rag'

interface StatusLineConfig {
  slots: SlotId[]
  formats: Partial<Record<SlotId, string>>
  source: 'default' | 'user'
}

const DEFAULT_CONFIG: StatusLineConfig = {
  slots: ['model', 'workflow', 'wakeups', 'tokens', 'rag'],
  formats: {
    model: '{name}',
    workflow: '{label}',
    wakeups: '{count} wake-up{plural}',
    tokens: '{kilo}k tokens',
    rag: '{count} corpus'
  },
  source: 'default'
}

function applyFormat(template: string | undefined, vars: Record<string, string | number>): string {
  const tpl = template ?? ''
  return tpl.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key]
    return v === undefined || v === null ? '' : String(v)
  })
}

function pluralize(count: number): string {
  return count === 1 ? '' : 's'
}

export function StatusLine() {
  const [config, setConfig] = useState<StatusLineConfig>(DEFAULT_CONFIG)
  const [pendingWakeups, setPendingWakeups] = useState<number>(0)

  const activeModelId = useModelStore((s) => s.activeModel)
  const models = useModelStore((s) => s.models)
  const runs = useWorkflowsStore((s) => s.runs)
  const ragCollections = useRagStore((s) => s.collections)
  const messages = useChatStore((s) => s.messages)

  // Load config on mount
  useEffect(() => {
    let cancelled = false
    void window.api?.statusline.get().then((res) => {
      if (cancelled) return
      if (res && res.success && res.data && typeof res.data === 'object') {
        const incoming = res.data as Partial<StatusLineConfig>
        setConfig({
          slots: Array.isArray(incoming.slots) ? (incoming.slots as SlotId[]) : DEFAULT_CONFIG.slots,
          formats: incoming.formats ?? DEFAULT_CONFIG.formats,
          source: incoming.source === 'user' ? 'user' : 'default'
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Poll wakeups every 10s + on loop-fired event
  useEffect(() => {
    let cancelled = false
    function refresh(): void {
      void window.api?.loops.list({ status: 'pending', limit: 200 }).then((res) => {
        if (cancelled) return
        if (res && res.success && Array.isArray(res.data)) setPendingWakeups(res.data.length)
      })
    }
    refresh()
    const interval = setInterval(refresh, 10_000)
    const dispose = window.api?.loops.onFired?.(() => refresh())
    return () => {
      cancelled = true
      clearInterval(interval)
      if (typeof dispose === 'function') dispose()
    }
  }, [])

  const activeWorkflow = useMemo(
    () => runs.find((r) => r.status === 'running'),
    [runs]
  )

  const tokenSpend = useMemo(() => {
    let total = 0
    for (const m of messages) {
      if (typeof m.content === 'string') total += Math.ceil(m.content.length / 4)
    }
    return total
  }, [messages])

  const ragAttached = useMemo(() => ragCollections.length, [ragCollections])

  const modelInfo = useMemo(
    () => models.find((m) => m.id === activeModelId),
    [models, activeModelId]
  )

  const renderSlot = (slot: SlotId) => {
    const fmt = config.formats[slot]
    switch (slot) {
      case 'model': {
        if (!modelInfo) return null
        const text = applyFormat(fmt, {
          name: modelInfo.name,
          tier: modelInfo.tier ?? '',
          id: modelInfo.id
        })
        return (
          <Slot
            key={slot}
            tone="model"
            label={text || modelInfo.name}
            title={`Active model: ${modelInfo.name}${modelInfo.tier ? ` (${modelInfo.tier})` : ''}`}
          />
        )
      }
      case 'workflow': {
        if (!activeWorkflow) return null
        const text = applyFormat(fmt, {
          label: activeWorkflow.name,
          runId: activeWorkflow.runId.slice(0, 8)
        })
        return (
          <Slot
            key={slot}
            tone="workflow"
            label={text || activeWorkflow.name}
            title={`Workflow ${activeWorkflow.name} running (${activeWorkflow.runId})`}
            onClick={() => {
              // The WorkflowsPanel mounts a palette; a future iteration can
              // route to a dedicated sidebar entry. For now we surface the
              // palette via the same Ctrl+K keystroke H2 wired up.
              window.dispatchEvent(new CustomEvent('workflows:openPalette'))
            }}
          />
        )
      }
      case 'wakeups': {
        if (pendingWakeups === 0) return null
        const text = applyFormat(fmt, {
          count: pendingWakeups,
          plural: pluralize(pendingWakeups)
        })
        return (
          <Slot
            key={slot}
            tone="wakeups"
            label={text || `${pendingWakeups} wake-up${pluralize(pendingWakeups)}`}
            title={`${pendingWakeups} pending scheduled wake-up(s)`}
          />
        )
      }
      case 'tokens': {
        if (tokenSpend === 0) return null
        const kilo = (tokenSpend / 1000).toFixed(1)
        const text = applyFormat(fmt, { spent: tokenSpend, kilo, k: kilo })
        return <Slot key={slot} tone="tokens" label={text} title={`~${tokenSpend} tokens this session`} />
      }
      case 'rag': {
        if (ragAttached === 0) return null
        const text = applyFormat(fmt, {
          count: ragAttached,
          plural: pluralize(ragAttached)
        })
        return (
          <Slot
            key={slot}
            tone="rag"
            label={text || `${ragAttached} corpus`}
            title={`${ragAttached} RAG collection(s) available`}
          />
        )
      }
      default:
        return null
    }
  }

  const renderedSlots = config.slots.map(renderSlot).filter(Boolean) as ReactElement[]

  return (
    <div
      role="status"
      aria-label="Lamprey status line"
      className="flex h-7 shrink-0 items-center gap-2 border-t border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-[11px] text-[var(--text-muted)]"
      data-testid="statusline"
    >
      {renderedSlots.length === 0 ? (
        <span className="italic">idle</span>
      ) : (
        renderedSlots
      )}
      {config.source === 'user' && (
        <span
          className="ml-auto text-[10px] uppercase tracking-wider opacity-60"
          title="Loaded from userData/statusline.md"
        >
          custom
        </span>
      )}
    </div>
  )
}

interface SlotProps {
  tone: 'model' | 'workflow' | 'wakeups' | 'tokens' | 'rag'
  label: string
  title: string
  onClick?: () => void
}

const TONE_BG: Record<SlotProps['tone'], string> = {
  model: 'bg-[var(--bg-tertiary)]',
  workflow: 'bg-[var(--accent)]/15 text-[var(--accent)]',
  wakeups: 'bg-amber-500/15 text-amber-600',
  tokens: 'bg-[var(--bg-tertiary)]',
  rag: 'bg-blue-500/15 text-blue-500'
}

function Slot({ tone, label, title, onClick }: SlotProps) {
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      title={title}
      onClick={onClick}
      className={
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ' +
        TONE_BG[tone] +
        (onClick ? ' hover:opacity-80' : '')
      }
    >
      {label}
    </Tag>
  )
}
