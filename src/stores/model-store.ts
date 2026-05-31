import { create } from 'zustand'
import type { ModelInfo } from '@/lib/types'

interface ModelState {
  models: ModelInfo[]
  activeModel: string
  loadModels: () => Promise<void>
  setActiveModel: (id: string) => Promise<void>
}

export const useModelStore = create<ModelState>((set) => ({
  models: [],
  activeModel: 'deepseek-v4-pro',

  loadModels: async () => {
    const [modelsResult, activeResult] = await Promise.all([
      window.api.model.list(),
      window.api.model.getActive()
    ])
    if (modelsResult.success) set({ models: modelsResult.data })
    if (activeResult.success) set({ activeModel: activeResult.data })
  },

  setActiveModel: async (id: string) => {
    set({ activeModel: id })
    await window.api.model.setActive(id)
  }
}))
