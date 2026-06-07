import { create } from 'zustand'
import type { ProviderInfo } from '@/lib/types'

export interface ProviderEntry extends ProviderInfo {
  hasKey: boolean
}

interface ProvidersState {
  providers: ProviderEntry[]
  loaded: boolean
  setProviders: (providers: ProviderEntry[]) => void
  refresh: () => Promise<void>
  hasKey: (providerId: string | undefined) => boolean
  byId: (providerId: string) => ProviderEntry | undefined
}

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  providers: [],
  loaded: false,
  setProviders: (providers) => {
    set({ providers, loaded: true })
  },
  refresh: async () => {
    if (!window.api?.settings?.listProviderKeys) return
    const result = await window.api.settings.listProviderKeys()
    if (result.success) {
      set({ providers: result.data as ProviderEntry[], loaded: true })
    }
  },
  hasKey: (providerId) => {
    if (!providerId) return false
    return get().providers.some((p) => p.id === providerId && p.hasKey)
  },
  byId: (providerId) => get().providers.find((p) => p.id === providerId)
}))
