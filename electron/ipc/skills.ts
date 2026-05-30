import { ipcMain } from 'electron'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import matter from 'gray-matter'
import { getSkillsDir, listSkills, getSkill } from '../services/skill-loader'

interface SkillInput {
  name: string
  description: string
  content: string
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'skill'
}

function uniqueId(baseSlug: string): string {
  const dir = getSkillsDir()
  if (!existsSync(join(dir, `${baseSlug}.md`))) return baseSlug
  let i = 2
  while (existsSync(join(dir, `${baseSlug}-${i}.md`))) i++
  return `${baseSlug}-${i}`
}

function serializeSkill(input: SkillInput): string {
  const front = matter.stringify(input.content.trim() + '\n', {
    name: input.name,
    description: input.description
  })
  return front
}

export function registerSkillsHandlers(): void {
  ipcMain.handle('skills:list', async () => {
    try {
      return { success: true, data: listSkills() }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('skills:create', async (_event, skill: SkillInput) => {
    try {
      if (!skill?.name || typeof skill.name !== 'string') {
        return { success: false, error: 'Skill name is required' }
      }
      const id = uniqueId(slugify(skill.name))
      const filePath = join(getSkillsDir(), `${id}.md`)
      writeFileSync(filePath, serializeSkill(skill), 'utf-8')
      return {
        success: true,
        data: {
          id,
          name: skill.name,
          description: skill.description,
          content: skill.content,
          filePath,
          enabled: false
        }
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('skills:update', async (_event, id: string, skill: SkillInput) => {
    try {
      const existing = getSkill(id)
      if (!existing) return { success: false, error: `Skill not found: ${id}` }
      writeFileSync(existing.filePath, serializeSkill(skill), 'utf-8')
      return { success: true, data: null }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('skills:delete', async (_event, id: string) => {
    try {
      const existing = getSkill(id)
      if (!existing) return { success: false, error: `Skill not found: ${id}` }
      unlinkSync(existing.filePath)
      return { success: true, data: null }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
