import { create } from 'zustand'
import type { Automation } from '@/stores/automations-store'
import type { Hook } from '@/stores/hooks-store'

const PINNED_KEY = 'lamprey.activity.pinnedIds'
const COLLAPSED_KEY = 'lamprey.activity.collapsed'

export type ActivityKind = 'conversation' | 'workflow' | 'agent' | 'cron' | 'loop' | 'hook'
export type ActivityStatus =
  | 'running'
  | 'pending'
  | 'idle'
  | 'done'
  | 'error'
  | 'aborted'
  | 'disabled'

export interface ActivityNodeModel {
  id: string
  kind: ActivityKind
  title: string
  subtitle?: string
  status: ActivityStatus
  startedAt?: number | null
  finishedAt?: number | null
  tokenEstimate?: number | null
  canAbort?: boolean
  children?: ActivityNodeModel[]
}

export interface AgentRunSnapshot {
  id: string
  parentConvId: string | null
  parentRunId: string | null
  agentType: string
  label: string
  status: 'running' | 'done' | 'error' | 'aborted'
  startedAt: number
  finishedAt: number | null
  resultText: string | null
  error: string | null
  worktreePath: string | null
  background: boolean
}

export interface LoopWakeupSnapshot {
  id: string
  conversationId: string
  fireAt: number
  prompt: string
  reason: string | null
  status: 'pending' | 'fired' | 'cancelled' | 'error'
  createdAt: number
  firedAt: number | null
  error: string | null
}

interface IpcEnvelope<T> {
  success: boolean
  data?: T
  error?: string
}

interface ActivityStoreState {
  agentRuns: AgentRunSnapshot[]
  automations: Automation[]
  wakeups: LoopWakeupSnapshot[]
  hooks: Hook[]
  loading: boolean
  error: string | null
  pinnedIds: string[]
  collapsed: boolean
  refresh: () => Promise<void>
  refreshAgents: () => Promise<void>
  refreshAutomations: () => Promise<void>
  refreshWakeups: () => Promise<void>
  refreshHooks: () => Promise<void>
  stopAgent: (id: string) => Promise<boolean>
  cancelWakeup: (id: string) => Promise<boolean>
  togglePinned: (id: string) => void
  isPinned: (id: string) => boolean
  setCollapsed: (collapsed: boolean) => void
}

function readPinned(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage?.getItem(PINNED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  const raw = window.localStorage?.getItem(COLLAPSED_KEY)
  return raw === '1' || raw === 'true'
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage?.setItem(key, value)
  } catch {
    // Ignore unavailable storage.
  }
}

function unwrapList<T>(result: unknown): T[] {
  const envelope = result as IpcEnvelope<T[]>
  if (envelope?.success && Array.isArray(envelope.data)) return envelope.data
  return []
}

export const useActivityStore = create<ActivityStoreState>((set, get) => ({
  agentRuns: [],
  automations: [],
  wakeups: [],
  hooks: [],
  loading: false,
  error: null,
  pinnedIds: readPinned(),
  collapsed: readCollapsed(),

  refresh: async () => {
    set({ loading: true, error: null })
    await Promise.all([
      get().refreshAgents(),
      get().refreshAutomations(),
      get().refreshWakeups(),
      get().refreshHooks()
    ])
    set({ loading: false })
  },

  refreshAgents: async () => {
    if (!window.api?.tasks?.list) return
    const result = await window.api.tasks.list({ limit: 30 })
    const rows = unwrapList<AgentRunSnapshot>(result)
    set({ agentRuns: rows })
  },

  refreshAutomations: async () => {
    if (!window.api?.automations?.list) return
    const result = await window.api.automations.list()
    const rows = unwrapList<Automation>(result)
    set({ automations: rows })
  },

  refreshWakeups: async () => {
    if (!window.api?.loops?.list) return
    const result = await window.api.loops.list({ limit: 30 })
    const rows = unwrapList<LoopWakeupSnapshot>(result)
    set({ wakeups: rows })
  },

  refreshHooks: async () => {
    if (!window.api?.hooks?.list) return
    const result = await window.api.hooks.list()
    const rows = unwrapList<Hook>(result)
    set({ hooks: rows })
  },

  stopAgent: async (id: string) => {
    if (!window.api?.tasks?.stop) return false
    const result = (await window.api.tasks.stop(id)) as IpcEnvelope<unknown>
    if (result?.success) {
      await get().refreshAgents()
      return true
    }
    return false
  },

  cancelWakeup: async (id: string) => {
    if (!window.api?.loops?.cancel) return false
    const result = (await window.api.loops.cancel(id)) as IpcEnvelope<unknown>
    if (result?.success) {
      await get().refreshWakeups()
      return true
    }
    return false
  },

  togglePinned: (id: string) => {
    set((state) => {
      const pinnedIds = state.pinnedIds.includes(id)
        ? state.pinnedIds.filter((pinnedId) => pinnedId !== id)
        : [...state.pinnedIds, id]
      writeLocal(PINNED_KEY, JSON.stringify(pinnedIds))
      return { pinnedIds }
    })
  },

  isPinned: (id: string) => get().pinnedIds.includes(id),

  setCollapsed: (collapsed: boolean) => {
    writeLocal(COLLAPSED_KEY, collapsed ? '1' : '0')
    set({ collapsed })
  }
}))
