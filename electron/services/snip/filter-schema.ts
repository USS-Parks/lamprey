// Pure runtime validator for filter YAML. We don't bring in ajv or
// json-schema — keeping bundle weight flat. The validator returns a
// structured result so the loader (K3) can report bad files in the
// dashboard's "Filter health" panel without crashing.
//
// The shape we accept is documented in docs/snip-filter-primer.md
// (K14). It mirrors snip's YAML schema with one wrinkle: pipeline
// actions are validated by tag, with required fields per tag.

import type { Filter, MatchSpec, PipelineAction } from './types'

export interface FilterLoadError {
  path: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  filter?: Filter
  error?: string
}

const ACTION_TAGS: ReadonlySet<string> = new Set([
  'strip_ansi',
  'keep_lines',
  'remove_lines',
  'truncate_lines',
  'head',
  'tail',
  'dedup',
  'replace',
  'aggregate',
  'format_template',
  'match_output',
  'on_empty'
])

function isString(v: unknown): v is string {
  return typeof v === 'string'
}
function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}
function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean'
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString)
}
function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every(isNumber)
}
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validateMatch(raw: unknown): MatchSpec | string {
  if (!isObject(raw)) return 'match must be an object'
  if (!isString(raw.command) || raw.command.trim() === '') {
    return 'match.command must be a non-empty string'
  }
  const out: MatchSpec = { command: raw.command }
  if (raw.subcommand !== undefined) {
    if (!isString(raw.subcommand)) return 'match.subcommand must be a string'
    out.subcommand = raw.subcommand
  }
  if (raw.viaNpx !== undefined) {
    if (!isBoolean(raw.viaNpx)) return 'match.viaNpx must be a boolean'
    out.viaNpx = raw.viaNpx
  }
  if (raw.excludeFlags !== undefined) {
    if (!isStringArray(raw.excludeFlags)) return 'match.excludeFlags must be a string array'
    out.excludeFlags = raw.excludeFlags
  }
  if (raw.exitCodes !== undefined) {
    if (!isNumberArray(raw.exitCodes)) return 'match.exitCodes must be a number array'
    out.exitCodes = raw.exitCodes
  }
  return out
}

function validateAction(raw: unknown, index: number): PipelineAction | string {
  if (!isObject(raw)) return `pipeline[${index}] must be an object`
  const tag = raw.action
  if (!isString(tag) || !ACTION_TAGS.has(tag)) {
    return `pipeline[${index}].action must be one of: ${Array.from(ACTION_TAGS).join(', ')}`
  }
  switch (tag) {
    case 'strip_ansi':
    case 'dedup':
      return { action: tag }
    case 'keep_lines':
    case 'remove_lines':
    case 'match_output': {
      if (!isString(raw.pattern)) return `pipeline[${index}].pattern must be a string`
      if (raw.flags !== undefined && !isString(raw.flags)) {
        return `pipeline[${index}].flags must be a string`
      }
      if (tag === 'match_output' && !isString(raw.message)) {
        return `pipeline[${index}].message must be a string`
      }
      if (tag === 'match_output') {
        return {
          action: 'match_output',
          pattern: raw.pattern,
          flags: raw.flags as string | undefined,
          message: raw.message as string
        }
      }
      return {
        action: tag,
        pattern: raw.pattern,
        flags: raw.flags as string | undefined
      }
    }
    case 'truncate_lines': {
      if (!isNumber(raw.max)) return `pipeline[${index}].max must be a number`
      return { action: 'truncate_lines', max: raw.max }
    }
    case 'head':
    case 'tail': {
      if (!isNumber(raw.n)) return `pipeline[${index}].n must be a number`
      return { action: tag, n: raw.n }
    }
    case 'replace': {
      if (!isString(raw.pattern)) return `pipeline[${index}].pattern must be a string`
      if (!isString(raw.replacement)) return `pipeline[${index}].replacement must be a string`
      if (raw.flags !== undefined && !isString(raw.flags)) {
        return `pipeline[${index}].flags must be a string`
      }
      return {
        action: 'replace',
        pattern: raw.pattern,
        flags: raw.flags as string | undefined,
        replacement: raw.replacement
      }
    }
    case 'aggregate': {
      if (!Array.isArray(raw.counters)) return `pipeline[${index}].counters must be an array`
      const counters: Array<{ name: string; pattern: string; flags?: string }> = []
      for (let i = 0; i < raw.counters.length; i++) {
        const c = raw.counters[i]
        if (!isObject(c)) return `pipeline[${index}].counters[${i}] must be an object`
        if (!isString(c.name) || !isString(c.pattern)) {
          return `pipeline[${index}].counters[${i}] needs string name + pattern`
        }
        const entry: { name: string; pattern: string; flags?: string } = {
          name: c.name,
          pattern: c.pattern
        }
        if (c.flags !== undefined) {
          if (!isString(c.flags)) return `pipeline[${index}].counters[${i}].flags must be a string`
          entry.flags = c.flags
        }
        counters.push(entry)
      }
      const action: PipelineAction = { action: 'aggregate', counters }
      if (raw.totalAs !== undefined) {
        if (!isString(raw.totalAs)) return `pipeline[${index}].totalAs must be a string`
        action.totalAs = raw.totalAs
      }
      return action
    }
    case 'format_template': {
      if (!isString(raw.template)) return `pipeline[${index}].template must be a string`
      return { action: 'format_template', template: raw.template }
    }
    case 'on_empty': {
      if (!isString(raw.message)) return `pipeline[${index}].message must be a string`
      return { action: 'on_empty', message: raw.message }
    }
    default:
      return `pipeline[${index}] unrecognised action tag`
  }
}

function validatePipeline(raw: unknown, key: 'pipeline' | 'stderrPipeline'): PipelineAction[] | string {
  if (!Array.isArray(raw)) return `${key} must be an array`
  const out: PipelineAction[] = []
  for (let i = 0; i < raw.length; i++) {
    const a = validateAction(raw[i], i)
    if (typeof a === 'string') return `${key}: ${a}`
    out.push(a)
  }
  return out
}

/**
 * Validate a raw JS object (the result of YAML.load) against the
 * Filter schema. Strict — partial fields fail loud. Returns a
 * `ValidationResult` with either a typed `Filter` or a structured
 * error.
 */
export function validateFilter(raw: unknown): ValidationResult {
  if (!isObject(raw)) return { ok: false, error: 'filter must be a YAML mapping' }
  if (!isString(raw.name) || raw.name.trim() === '') {
    return { ok: false, error: 'filter.name must be a non-empty string' }
  }
  if (!isString(raw.description)) {
    return { ok: false, error: 'filter.description must be a string' }
  }
  const match = validateMatch(raw.match)
  if (typeof match === 'string') return { ok: false, error: match }
  const pipeline = validatePipeline(raw.pipeline, 'pipeline')
  if (typeof pipeline === 'string') return { ok: false, error: pipeline }
  const filter: Filter = {
    name: raw.name,
    description: raw.description,
    match,
    pipeline
  }
  if (raw.stderrPipeline !== undefined) {
    const stderrPipeline = validatePipeline(raw.stderrPipeline, 'stderrPipeline')
    if (typeof stderrPipeline === 'string') return { ok: false, error: stderrPipeline }
    filter.stderrPipeline = stderrPipeline
  }
  if (raw.onError !== undefined) {
    if (raw.onError !== 'passthrough' && raw.onError !== 'error') {
      return { ok: false, error: 'filter.onError must be "passthrough" or "error"' }
    }
    filter.onError = raw.onError
  }
  return { ok: true, filter }
}
