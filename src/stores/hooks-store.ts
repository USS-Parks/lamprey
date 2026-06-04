import { create } from 'zustand'

// Track 2 / C2 — renderer hooks store. The full list is fetched once on
// mount; create / update / delete invalidates and refetches. Test-run
// results are kept in a transient `lastTest` slot so the active editor
// can render the most recent run without holding it in component state.

export type HookEvent =
  | 'sessionStart'
  | 'promptSubmit'
  | 'preToolUse'
  | 'postToolUse'
  | 'agentStop'

export type HookLanguage = 'js' | 'shell'

export interface Hook {
  id: string
  event: HookEvent
  label: string
  command: string
  enabled: boolean
  createdAt: number
  language: HookLanguage
  timeoutMs: number
}

export interface HookLogEntry {
  hookId: string
  hookLabel: string
  kind: 'log' | 'error'
  message: string
}

export interface HookTestResult {
  thrown?: string
  logs: HookLogEntry[]
}

export interface HookSampleContext {
  conversationId?: string
  toolName?: string
  args?: Record<string, unknown>
  result?: string
  promptBody?: string
  cwd?: string
}

interface HooksState {
  hooks: Hook[]
  loaded: boolean
  loading: boolean
  lastTest: { code: string; event: HookEvent; result: HookTestResult } | null
  load: () => Promise<void>
  create: (input: {
    event: HookEvent
    label: string
    command: string
    language?: HookLanguage
    timeoutMs?: number
  }) => Promise<Hook | null>
  update: (
    id: string,
    patch: Partial<{
      event: HookEvent
      label: string
      command: string
      enabled: boolean
      language: HookLanguage
      timeoutMs: number
    }>
  ) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  test: (input: {
    code: string
    event: HookEvent
    context?: HookSampleContext
    timeoutMs?: number
  }) => Promise<HookTestResult | null>
  clearLastTest: () => void
}

export const useHooksStore = create<HooksState>((set, get) => ({
  hooks: [],
  loaded: false,
  loading: false,
  lastTest: null,

  load: async () => {
    if (!window.api?.hooks) return
    set({ loading: true })
    const res = await window.api.hooks.list()
    if (res.success) set({ hooks: res.data as Hook[], loaded: true })
    set({ loading: false })
  },

  create: async (input) => {
    if (!window.api?.hooks) return null
    const res = await window.api.hooks.create(input)
    if (!res.success) return null
    await get().load()
    return res.data as Hook
  },

  update: async (id, patch) => {
    if (!window.api?.hooks) return false
    const res = await window.api.hooks.update(id, patch)
    if (!res.success) return false
    await get().load()
    return true
  },

  remove: async (id) => {
    if (!window.api?.hooks) return false
    const res = await window.api.hooks.delete(id)
    if (!res.success) return false
    await get().load()
    return true
  },

  test: async (input) => {
    if (!window.api?.hooks?.test) return null
    const res = await window.api.hooks.test(input)
    if (!res.success) return null
    const result = res.data as HookTestResult
    set({ lastTest: { code: input.code, event: input.event, result } })
    return result
  },

  clearLastTest: () => set({ lastTest: null })
}))
