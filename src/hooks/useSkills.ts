import { useEffect } from 'react'
import { useSkillsStore } from '@/stores/skills-store'
import type { Skill } from '@/lib/types'

export function useSkills(): void {
  useEffect(() => {
    if (!window.api) return
    useSkillsStore.getState().loadSkills()
    const dispose = window.api.skills.onChanged((skills) => {
      useSkillsStore.getState().setSkillsFromEvent(skills as Skill[])
    })
    return typeof dispose === 'function' ? dispose : undefined
  }, [])
}
