import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

const settingsPath = () => join(app.getPath('userData'), 'settings.json')

export function readSettings(): Record<string, unknown> {
  const path = settingsPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return {}
  }
}

export function patchSettings(patch: Record<string, unknown>): void {
  const current = readSettings()
  writeFileSync(settingsPath(), JSON.stringify({ ...current, ...patch }, null, 2), 'utf-8')
}
