import { create } from 'zustand'
import type { Skill } from '@/lib/types'

interface SkillsState {
  skills: Skill[]
  activeSkillIds: string[]
  loadSkills: () => Promise<void>
  setSkillsFromEvent: (skills: Skill[]) => void
  toggleSkill: (id: string) => void
  setActiveSkillIds: (ids: string[]) => void
  createSkill: (input: { name: string; description: string; content: string }) => Promise<void>
  updateSkill: (
    id: string,
    input: { name: string; description: string; content: string }
  ) => Promise<void>
  deleteSkill: (id: string) => Promise<void>
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  activeSkillIds: [],

  loadSkills: async () => {
    if (!window.api) return
    const result = await window.api.skills.list()
    if (result.success) {
      set({ skills: (result.data as Skill[]) ?? [] })
    }
  },

  setSkillsFromEvent: (skills: Skill[]) => {
    const valid = new Set(skills.map((s) => s.id))
    set((state) => ({
      skills,
      activeSkillIds: state.activeSkillIds.filter((id) => valid.has(id))
    }))
  },

  toggleSkill: (id: string) => {
    set((state) => ({
      activeSkillIds: state.activeSkillIds.includes(id)
        ? state.activeSkillIds.filter((x) => x !== id)
        : [...state.activeSkillIds, id]
    }))
  },

  setActiveSkillIds: (ids: string[]) => {
    set({ activeSkillIds: ids })
  },

  createSkill: async (input) => {
    if (!window.api) return
    await window.api.skills.create(input)
    await get().loadSkills()
  },

  updateSkill: async (id, input) => {
    if (!window.api) return
    await window.api.skills.update(id, input)
    await get().loadSkills()
  },

  deleteSkill: async (id) => {
    if (!window.api) return
    await window.api.skills.delete(id)
    set((state) => ({
      activeSkillIds: state.activeSkillIds.filter((x) => x !== id)
    }))
    await get().loadSkills()
  }
}))
