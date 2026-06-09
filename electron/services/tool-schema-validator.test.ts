import { describe, it, expect } from 'vitest'
import { validateToolArguments } from './tool-schema-validator'

const simpleSchema = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'The command to run' },
    cwd: { type: 'string', description: 'Working directory' }
  },
  required: ['command'],
  additionalProperties: false
}

const nestedSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    options: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number' },
        shell: { type: 'string', enum: ['auto', 'bash', 'powershell'] }
      },
      required: ['timeout_ms'],
      additionalProperties: false
    }
  },
  required: ['name']
}

const arraySchema = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of file paths'
    }
  },
  required: ['files']
}

describe('validateToolArguments', () => {
  // ── Already-parsed objects ──────────────────────────────────────────

  it('accepts valid flat args as object', () => {
    const result = validateToolArguments('test_tool', { command: 'ls' }, simpleSchema)
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.parsed.command).toBe('ls')
  })

  it('accepts valid args with all optional fields', () => {
    const result = validateToolArguments(
      'test_tool',
      { command: 'ls', cwd: '/tmp' },
      simpleSchema
    )
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.parsed.command).toBe('ls')
      expect(result.parsed.cwd).toBe('/tmp')
    }
  })

  it('rejects missing required property', () => {
    const result = validateToolArguments('test_tool', { cwd: '/tmp' }, simpleSchema)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('missing required property "command"')
    }
  })

  it('rejects wrong type for a property', () => {
    const result = validateToolArguments('test_tool', { command: 123 }, simpleSchema)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors[0]).toContain('expected string')
    }
  })

  it('rejects extra property when additionalProperties is false', () => {
    const result = validateToolArguments(
      'test_tool',
      { command: 'ls', extra_field: 'nope' },
      simpleSchema
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual(expect.stringContaining('unexpected property "extra_field"'))
    }
  })

  // ── JSON string input ───────────────────────────────────────────────

  it('parses and validates JSON string arguments', () => {
    const result = validateToolArguments('test_tool', '{"command":"ls"}', simpleSchema)
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.parsed.command).toBe('ls')
  })

  it('rejects invalid JSON string', () => {
    const result = validateToolArguments('test_tool', '{broken', simpleSchema)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors[0]).toContain('failed to parse arguments as JSON')
    }
  })

  it('validates schema after JSON parsing', () => {
    const result = validateToolArguments('test_tool', '{"wrong_key":"val"}', simpleSchema)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toHaveLength(2) // missing command + unexpected property
    }
  })

  // ── Empty / missing input ───────────────────────────────────────────

  it('treats undefined as empty object', () => {
    const result = validateToolArguments('test_tool', undefined, simpleSchema)
    expect(result.valid).toBe(false) // command is required
    if (!result.valid) {
      expect(result.errors[0]).toContain('no arguments provided')
    }
  })

  it('treats null as empty object', () => {
    const result = validateToolArguments('test_tool', null, simpleSchema)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors[0]).toContain('no arguments provided')
    }
  })

  it('treats undefined as valid for no-required schema', () => {
    const result = validateToolArguments('test_tool', undefined, {
      type: 'object',
      properties: { comment: { type: 'string' } }
    })
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.parsed).toEqual({})
  })

  it('treats empty string as empty object for no-required schema', () => {
    const result = validateToolArguments('test_tool', '', {
      type: 'object',
      properties: { comment: { type: 'string' } }
    })
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.parsed).toEqual({})
  })

  it('rejects empty string when required fields exist', () => {
    const result = validateToolArguments('test_tool', '', simpleSchema)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors[0]).toContain('empty argument string')
    }
  })

  // ── Nested objects ──────────────────────────────────────────────────

  it('validates nested objects successfully', () => {
    const result = validateToolArguments(
      'test_tool',
      { name: 'task1', options: { timeout_ms: 5000, shell: 'bash' } },
      nestedSchema
    )
    expect(result.valid).toBe(true)
  })

  it('rejects missing nested required property', () => {
    const result = validateToolArguments(
      'test_tool',
      { name: 'task1', options: { shell: 'bash' } },
      nestedSchema
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors[0]).toContain('missing required property "timeout_ms"')
    }
  })

  it('rejects invalid nested property type', () => {
    const result = validateToolArguments(
      'test_tool',
      { name: 'task1', options: { timeout_ms: 'slow', shell: 'bash' } },
      nestedSchema
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors[0]).toContain('expected number')
    }
  })

  it('rejects extra nested property', () => {
    const result = validateToolArguments(
      'test_tool',
      { name: 'task1', options: { timeout_ms: 5000, extra: true } },
      nestedSchema
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual(expect.stringContaining('unexpected property "extra"'))
    }
  })

  // ── Enum validation ─────────────────────────────────────────────────

  it('accepts valid enum value', () => {
    const result = validateToolArguments(
      'test_tool',
      { name: 'task1', options: { timeout_ms: 5000, shell: 'bash' } },
      nestedSchema
    )
    expect(result.valid).toBe(true)
  })

  it('rejects invalid enum value', () => {
    const result = validateToolArguments(
      'test_tool',
      { name: 'task1', options: { timeout_ms: 5000, shell: 'zsh' } },
      nestedSchema
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual(expect.stringContaining('must be one of'))
    }
  })

  // ── Array validation ────────────────────────────────────────────────

  it('validates array items correctly', () => {
    const result = validateToolArguments(
      'test_tool',
      { files: ['a.txt', 'b.txt'] },
      arraySchema
    )
    expect(result.valid).toBe(true)
  })

  it('rejects wrong array item type', () => {
    const result = validateToolArguments(
      'test_tool',
      { files: ['a.txt', 42, 'c.txt'] },
      arraySchema
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual(expect.stringContaining('[1]'))
    }
  })

  it('rejects non-array for array-typed property', () => {
    const result = validateToolArguments(
      'test_tool',
      { files: 'not_an_array' },
      arraySchema
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual(expect.stringContaining('expected array'))
    }
  })

  it('rejects missing required array', () => {
    const result = validateToolArguments('test_tool', {}, arraySchema)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContainEqual(expect.stringContaining('missing required property "files"'))
    }
  })

  // ── Non-object input type ───────────────────────────────────────────

  it('rejects number input', () => {
    const result = validateToolArguments('test_tool', 42, simpleSchema)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors[0]).toContain('must be an object or JSON string')
    }
  })

  it('rejects boolean input', () => {
    const result = validateToolArguments('test_tool', true, simpleSchema)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors[0]).toContain('must be an object or JSON string')
    }
  })

  // ── Boolean property type ───────────────────────────────────────────

  it('validates boolean property correctly', () => {
    const boolSchema = {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' }
      },
      required: ['enabled']
    }
    const result = validateToolArguments('test_tool', { enabled: true }, boolSchema)
    expect(result.valid).toBe(true)
  })

  it('rejects non-boolean for boolean property', () => {
    const boolSchema = {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' }
      },
      required: ['enabled']
    }
    const result = validateToolArguments('test_tool', { enabled: 'yes' }, boolSchema)
    expect(result.valid).toBe(false)
  })
})
