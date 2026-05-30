import { app, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, copyFileSync } from 'fs'
import { join, basename } from 'path'
import matter from 'gray-matter'
import chokidar, { FSWatcher } from 'chokidar'
import { is } from '@electron-toolkit/utils'

export interface LoadedSkill {
  id: string
  name: string
  description: string
  content: string
  filePath: string
  enabled: boolean
}

const skills = new Map<string, LoadedSkill>()
let watcher: FSWatcher | null = null
let skillsDirPath: string | null = null

function resolveSkillsDir(): string {
  if (is.dev) {
    return join(__dirname, '../../skills')
  }
  return join(app.getPath('userData'), 'skills')
}

function bundledSkillsDir(): string {
  if (is.dev) return join(__dirname, '../../skills')
  return join(process.resourcesPath, 'skills')
}

function ensureSkillsDir(dir: string): void {
  if (existsSync(dir)) return
  mkdirSync(dir, { recursive: true })

  const bundled = bundledSkillsDir()
  if (!existsSync(bundled)) return

  for (const entry of readdirSync(bundled)) {
    if (!entry.endsWith('.md')) continue
    const src = join(bundled, entry)
    const dest = join(dir, entry)
    try {
      copyFileSync(src, dest)
    } catch (err) {
      console.error('[skill-loader] failed to copy bundled skill', entry, err)
    }
  }
}

function fileIdFromPath(filePath: string): string {
  return basename(filePath, '.md')
}

function parseSkillFile(filePath: string): LoadedSkill | null {
  try {
    if (!statSync(filePath).isFile()) return null
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = matter(raw)
    const name = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : ''
    const description =
      typeof parsed.data.description === 'string' ? parsed.data.description.trim() : ''
    const content = parsed.content.trim()
    if (!name) {
      console.warn('[skill-loader] skipping skill without name:', filePath)
      return null
    }
    return {
      id: fileIdFromPath(filePath),
      name,
      description,
      content,
      filePath,
      enabled: false
    }
  } catch (err) {
    console.error('[skill-loader] failed to parse', filePath, err)
    return null
  }
}

function broadcastChange(): void {
  const list = listSkills()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('skills:changed', list)
  }
}

function upsertFromPath(filePath: string): void {
  if (!filePath.endsWith('.md')) return
  const skill = parseSkillFile(filePath)
  if (!skill) return
  skills.set(skill.id, skill)
  broadcastChange()
}

function removeByPath(filePath: string): void {
  if (!filePath.endsWith('.md')) return
  const id = fileIdFromPath(filePath)
  if (skills.delete(id)) {
    broadcastChange()
  }
}

export function initializeSkillLoader(): void {
  if (skillsDirPath) return
  const dir = resolveSkillsDir()
  ensureSkillsDir(dir)
  skillsDirPath = dir

  // Initial scan
  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.md')) continue
      const skill = parseSkillFile(join(dir, entry))
      if (skill) skills.set(skill.id, skill)
    }
  } catch (err) {
    console.error('[skill-loader] initial scan failed:', err)
  }

  watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
  })

  watcher.on('add', upsertFromPath)
  watcher.on('change', upsertFromPath)
  watcher.on('unlink', removeByPath)
  watcher.on('error', (err) => console.error('[skill-loader] watcher error:', err))

  console.log(`[skill-loader] watching ${dir} (${skills.size} skills loaded)`)
}

export function shutdownSkillLoader(): void {
  if (watcher) {
    watcher.close().catch(() => {})
    watcher = null
  }
  skills.clear()
  skillsDirPath = null
}

export function getSkillsDir(): string {
  if (!skillsDirPath) {
    skillsDirPath = resolveSkillsDir()
    ensureSkillsDir(skillsDirPath)
  }
  return skillsDirPath
}

export function listSkills(): LoadedSkill[] {
  return Array.from(skills.values()).sort((a, b) => a.name.localeCompare(b.name))
}

export function getSkill(id: string): LoadedSkill | undefined {
  return skills.get(id)
}

export function getSkillContent(id: string): string | null {
  const skill = skills.get(id)
  return skill ? skill.content : null
}
