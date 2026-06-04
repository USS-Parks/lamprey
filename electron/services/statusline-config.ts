import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import matter from 'gray-matter'

// H6 — Status line config.
//
// The renderer mounts a persistent status bar at the bottom of the main
// window. The visible slots + their order are loaded from
// `userData/statusline.md`. The body of the file is informational only; the
// frontmatter is the source of truth:
//
//   ---
//   slots:
//     - model
//     - workflow
//     - wakeups
//     - tokens
//     - rag
//   formats:
//     model: "{name} · {tier}"
//     tokens: "{spent}k tokens"
//   ---
//
// Unknown slot ids are dropped silently so a user-written file can not crash
// the renderer. Missing file → DEFAULTS.

// Fluidity J8: `context` + `branch` slots added; default slot order changed
// to `model · context · workflow · branch · wakeups`. `tokens` and `rag`
// remain valid for user-authored `userData/statusline.md` overrides but
// drop out of the default list.
export type StatusLineSlot =
  | 'model'
  | 'context'
  | 'workflow'
  | 'branch'
  | 'wakeups'
  | 'tokens'
  | 'rag'

const ALL_SLOTS: StatusLineSlot[] = [
  'model',
  'context',
  'workflow',
  'branch',
  'wakeups',
  'tokens',
  'rag'
]

const DEFAULT_VISIBLE_SLOTS: StatusLineSlot[] = [
  'model',
  'context',
  'workflow',
  'branch',
  'wakeups'
]

export interface StatusLineConfig {
  slots: StatusLineSlot[]
  formats: Partial<Record<StatusLineSlot, string>>
  source: 'default' | 'user'
}

export const DEFAULT_STATUSLINE_CONFIG: StatusLineConfig = {
  slots: [...DEFAULT_VISIBLE_SLOTS],
  formats: {
    model: '{name}',
    context: '{percent}% ctx',
    workflow: '{label}',
    branch: '{name}',
    wakeups: '{count} wake-up{plural}',
    tokens: '{kilo}k tokens',
    rag: '{count} corpus'
  },
  source: 'default'
}

function configPath(): string {
  return join(app.getPath('userData'), 'statusline.md')
}

function normalizeSlots(value: unknown): StatusLineSlot[] {
  // Empty / missing frontmatter falls back to the default-visible set, not
  // every possible slot — this matches the no-file case so the two paths
  // behave the same.
  if (!Array.isArray(value)) return [...DEFAULT_VISIBLE_SLOTS]
  const seen = new Set<StatusLineSlot>()
  const out: StatusLineSlot[] = []
  for (const v of value) {
    if (typeof v !== 'string') continue
    const key = v.trim().toLowerCase() as StatusLineSlot
    if (!ALL_SLOTS.includes(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out.length > 0 ? out : [...DEFAULT_VISIBLE_SLOTS]
}

function normalizeFormats(value: unknown): Partial<Record<StatusLineSlot, string>> {
  if (!value || typeof value !== 'object') return {}
  const out: Partial<Record<StatusLineSlot, string>> = {}
  for (const key of ALL_SLOTS) {
    const raw = (value as Record<string, unknown>)[key]
    if (typeof raw === 'string' && raw.trim()) out[key] = raw
  }
  return out
}

export function loadStatusLineConfig(pathOverride?: string): StatusLineConfig {
  const p = pathOverride ?? configPath()
  if (!existsSync(p)) {
    return { ...DEFAULT_STATUSLINE_CONFIG }
  }
  try {
    const raw = readFileSync(p, 'utf8')
    const parsed = matter(raw)
    const data = parsed.data ?? {}
    const slots = normalizeSlots((data as Record<string, unknown>).slots)
    const formats = {
      ...DEFAULT_STATUSLINE_CONFIG.formats,
      ...normalizeFormats((data as Record<string, unknown>).formats)
    }
    return { slots, formats, source: 'user' }
  } catch (err) {
    console.error('[statusline-config] failed to read statusline.md:', err)
    return { ...DEFAULT_STATUSLINE_CONFIG }
  }
}

export function saveStatusLineConfig(
  input: Pick<StatusLineConfig, 'slots' | 'formats'>,
  pathOverride?: string
): StatusLineConfig {
  const p = pathOverride ?? configPath()
  const slots = normalizeSlots(input.slots)
  const formats = {
    ...DEFAULT_STATUSLINE_CONFIG.formats,
    ...normalizeFormats(input.formats)
  }
  const fm = matter.stringify(
    [
      '# Lamprey status-line configuration',
      '',
      'Edit the frontmatter above to reorder slots or customise format strings.',
      'Available slots: ' + ALL_SLOTS.join(', ') + '.',
      'Format placeholders depend on the slot — see docs.'
    ].join('\n'),
    { slots, formats }
  )
  const dir = dirname(p)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(p, fm, 'utf8')
  return { slots, formats, source: 'user' }
}

export const STATUSLINE_ALL_SLOTS = ALL_SLOTS
