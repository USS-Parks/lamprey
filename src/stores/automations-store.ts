import { create } from 'zustand'
import { toast } from '@/stores/toast-store'

// Renderer-side store for the cron automations panel (G1).

export interface Automation {
  id: string
  label: string
  cron: string
  prompt: string
  model: string | null
  enabled: boolean
  createdAt: number
  lastRunAt: number | null
  lastResult: string | null
}

export interface CronValidation {
  valid: boolean
  description?: string | null
  nextFireAt?: number | null
  error?: string
}

interface AutomationsState {
  automations: Automation[]
  loading: boolean
  refresh: () => Promise<void>
  create: (input: {
    label: string
    cron: string
    prompt: string
    model?: string
  }) => Promise<Automation | null>
  update: (
    id: string,
    patch: Partial<{ label: string; cron: string; prompt: string; model: string; enabled: boolean }>
  ) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  runNow: (id: string) => Promise<boolean>
  validateCron: (expr: string) => Promise<CronValidation>
}

export const useAutomationsStore = create<AutomationsState>((set, get) => ({
  automations: [],
  loading: false,

  refresh: async () => {
    if (!window.api?.automations) return
    set({ loading: true })
    const res = await window.api.automations.list()
    if (res.success) set({ automations: (res.data as Automation[]) ?? [] })
    else toast.error(`Load automations failed: ${res.error}`)
    set({ loading: false })
  },

  create: async (input) => {
    if (!window.api?.automations) return null
    const res = await window.api.automations.create(input)
    if (!res.success) {
      toast.error(`Create failed: ${res.error}`)
      return null
    }
    await get().refresh()
    return (res.data as Automation) ?? null
  },

  update: async (id, patch) => {
    if (!window.api?.automations) return false
    const res = await window.api.automations.update(id, patch)
    if (!res.success) {
      toast.error(`Update failed: ${res.error}`)
      return false
    }
    await get().refresh()
    return true
  },

  remove: async (id) => {
    if (!window.api?.automations) return false
    const res = await window.api.automations.delete(id)
    if (!res.success) {
      toast.error(`Delete failed: ${res.error}`)
      return false
    }
    set((state) => ({ automations: state.automations.filter((a) => a.id !== id) }))
    return true
  },

  runNow: async (id) => {
    if (!window.api?.automations) return false
    const res = await window.api.automations.runNow(id)
    if (!res.success) {
      toast.error(`Run failed: ${res.error}`)
      return false
    }
    toast.success('Automation queued.')
    await get().refresh()
    return true
  },

  validateCron: async (expr: string) => {
    if (!window.api?.automations?.validateCron) {
      return { valid: false, error: 'IPC unavailable' }
    }
    const res = await window.api.automations.validateCron(expr)
    if (!res.success) return { valid: false, error: res.error }
    return res.data as CronValidation
  }
}))
