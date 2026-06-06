import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useModelStore } from '@/stores/model-store'
import { useWorkflowsStore } from '@/stores/workflows-store'
import { useRagStore } from '@/stores/rag-store'
import { useChatStore } from '@/stores/chat-store'
import { contextPercent, contextTone, type ContextTone } from '@/lib/context-meter'

// H6 — Persistent status line at the bottom of the main window.
//
// Reads from existing renderer stores (model, workflows, rag, chat) plus
// polls `loops:list` for pending wake-up count. The visible slots + their
// labels come from the main-process `statusline:get` config, which is
// loaded from `userData/statusline.md`. Unknown slot ids in the user's file
// are dropped silently in `electron/services/statusline-config.ts`.

type SlotId =
  | 'model'
  | 'context'
  | 'workflow'
  | 'branch'
  | 'wakeups'
  | 'snip'
  | 'tokens'
  | 'rag'

interface StatusLineConfig {
  slots: SlotId[]
  formats: Partial<Record<SlotId, string>>
  source: 'default' | 'user'
}

const DEFAULT_CONFIG: StatusLineConfig = {
  slots: ['model', 'context', 'workflow', 'branch', 'wakeups', 'snip'],
  formats: {
    model: '{name}',
    context: '{percent}% ctx',
    workflow: '{label}',
    branch: '{name}',
    wakeups: '{count} wake-up{plural}',
    snip: 'snip: {saved} saved',
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
  // Fluidity J8: current git branch for the `branch` slot. Polled on mount
  // and whenever the working folder changes; cheap enough at 30s intervals
  // to not need a dedicated IPC channel.
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)

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

  // Fluidity J8: load current branch from review:branches IPC. Polled at
  // 30s so a branch switch outside Lamprey shows up reasonably soon.
  useEffect(() => {
    let cancelled = false
    function refresh(): void {
      const reviewApi = (window.api as { review?: { branches?: (a?: { cwd?: string }) => Promise<unknown> } })?.review
      if (!reviewApi?.branches) return
      void reviewApi.branches().then((res: unknown) => {
        if (cancelled) return
        const r = res as {
          success?: boolean
          data?: { branches?: Array<{ name: string; current: boolean }> }
        }
        if (!r?.success || !r?.data?.branches) {
          setCurrentBranch(null)
          return
        }
        const cur = r.data.branches.find((b) => b.current)
        setCurrentBranch(cur ? cur.name : null)
      })
    }
    refresh()
    const interval = setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  // Snip Phase K13: poll today's tokens-saved every 30s. The slot
  // hides itself when the count is 0 so brand-new installs don't see
  // a "snip: 0 saved" placeholder.
  const [snipTodaySaved, setSnipTodaySaved] = useState<number>(0)
  useEffect(() => {
    let cancelled = false
    function refresh(): void {
      void window.api?.snip?.stats().then((res) => {
        if (cancelled) return
        if (res?.success && res.data) {
          const s = res.data as { sparkline?: number[] }
          const today = s.sparkline?.[(s.sparkline?.length ?? 1) - 1] ?? 0
          setSnipTodaySaved(today)
        }
      })
    }
    refresh()
    const interval = setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
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
      case 'context': {
        // Hide the slot when the active model's context window is unknown,
        // rather than showing 0% or NaN%.
        const percent = contextPercent(tokenSpend, modelInfo?.contextWindow)
        if (percent === null) return null
        const tone = contextTone(percent)
        const text = applyFormat(fmt, { percent, spent: tokenSpend, window: modelInfo?.contextWindow ?? '' })
        const title = `${tokenSpend.toLocaleString()} tokens of ~${(modelInfo?.contextWindow ?? 0).toLocaleString()} window (${percent}%)`
        return (
          <ContextSlot
            key={slot}
            label={text || `${percent}% ctx`}
            title={title}
            tone={tone}
          />
        )
      }
      case 'branch': {
        if (!currentBranch) return null
        const text = applyFormat(fmt, { name: currentBranch })
        return (
          <Slot
            key={slot}
            tone="branch"
            label={text || currentBranch}
            title={`Current git branch: ${currentBranch}`}
          />
        )
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
      case 'snip': {
        // Hide the slot until at least one event has been recorded today.
        if (snipTodaySaved === 0) return null
        const text = applyFormat(fmt, { saved: formatSnipCount(snipTodaySaved) })
        return (
          <Slot
            key={slot}
            tone="snip"
            label={text || `snip: ${formatSnipCount(snipTodaySaved)} saved`}
            title={`${snipTodaySaved} tokens saved by snip today — click to open Snip dashboard`}
            onClick={() => window.dispatchEvent(new CustomEvent('settings:open', { detail: { tab: 'snip' } }))}
          />
        )
      }
      default:
        return null
    }
  }

  function formatSnipCount(n: number): string {
    if (n < 1000) return String(n)
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
    return `${(n / 1_000_000).toFixed(1)}M`
  }

  const renderedSlots = config.slots.map(renderSlot).filter(Boolean) as ReactElement[]

  return (
    <div
      role="status"
      aria-label="Lamprey status line"
      className="flex h-7 shrink-0 items-center gap-2 border-t border-[var(--panel-border)] bg-[var(--bg-secondary)] px-3 text-[11px] text-[var(--text-muted)]"
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
  tone: 'model' | 'workflow' | 'wakeups' | 'tokens' | 'rag' | 'branch' | 'snip'
  label: string
  title: string
  onClick?: () => void
}

const TONE_BG: Record<SlotProps['tone'], string> = {
  model: 'bg-[var(--bg-tertiary)]',
  workflow: 'bg-[var(--accent)]/15 text-[var(--accent)]',
  wakeups: 'bg-amber-500/15 text-amber-600',
  tokens: 'bg-[var(--bg-tertiary)]',
  rag: 'bg-blue-500/15 text-blue-500',
  branch: 'bg-[var(--bg-tertiary)]',
  snip: 'bg-emerald-500/15 text-emerald-600'
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

// Fluidity J8: dedicated slot variant for the context% indicator — the
// background + text tone change at the 70/90% thresholds. Kept separate
// from `Slot` so the existing TONE_BG map stays a flat lookup.
function ContextSlot({
  label,
  title,
  tone
}: {
  label: string
  title: string
  tone: ContextTone
}) {
  const cls =
    tone === 'red'
      ? 'bg-[var(--error)]/15 text-[var(--error)]'
      : tone === 'amber'
      ? 'bg-amber-500/15 text-amber-600'
      : 'bg-[var(--bg-tertiary)]'
  return (
    <span
      title={title}
      data-tone={tone}
      className={
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ' + cls
      }
    >
      {label}
    </span>
  )
}
