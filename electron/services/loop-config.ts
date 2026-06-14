import { app } from 'electron'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// Loop Phase LP-7 — resolved loop configuration from settings.json. The pure
// `resolveLoopConfig` is unit-tested; `readLoopConfig` is the fs wrapper used
// by the controller + IPC. Defaults mirror DEFAULT_APP_SETTINGS exactly.

export interface LoopConfig {
  enabled: boolean
  maxIterations: number
  maxWallclockMs: number
  tokenBudget: number
  maxConcurrent: number
  minIntervalSeconds: number
}

export const LOOP_CONFIG_DEFAULTS: LoopConfig = {
  enabled: false,
  maxIterations: 25,
  maxWallclockMs: 1_800_000,
  tokenBudget: 500_000,
  maxConcurrent: 1,
  minIntervalSeconds: 30
}

function posIntOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
}

/** Pure: resolve a LoopConfig from a raw settings object (or null). */
export function resolveLoopConfig(raw: Record<string, unknown> | null): LoopConfig {
  if (!raw) return { ...LOOP_CONFIG_DEFAULTS }
  return {
    enabled: typeof raw.loopsEnabled === 'boolean' ? raw.loopsEnabled : LOOP_CONFIG_DEFAULTS.enabled,
    maxIterations: posIntOr(raw.loopMaxIterations, LOOP_CONFIG_DEFAULTS.maxIterations),
    maxWallclockMs: posIntOr(raw.loopMaxWallclockMs, LOOP_CONFIG_DEFAULTS.maxWallclockMs),
    tokenBudget: posIntOr(raw.loopTokenBudget, LOOP_CONFIG_DEFAULTS.tokenBudget),
    maxConcurrent: Math.max(1, posIntOr(raw.loopMaxConcurrent, LOOP_CONFIG_DEFAULTS.maxConcurrent)),
    minIntervalSeconds: Math.max(
      1,
      posIntOr(raw.loopMinIntervalSeconds, LOOP_CONFIG_DEFAULTS.minIntervalSeconds)
    )
  }
}

export function readLoopConfig(): LoopConfig {
  try {
    const path = join(app.getPath('userData'), 'settings.json')
    if (!existsSync(path)) return { ...LOOP_CONFIG_DEFAULTS }
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    return resolveLoopConfig(raw)
  } catch {
    return { ...LOOP_CONFIG_DEFAULTS }
  }
}
