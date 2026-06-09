/**
 * FC-1A — Shared tool argument validator.
 *
 * Every tool call path (native API-returned tool_calls and fallback-parsed
 * calls) must pass through `validateToolArguments()` before dispatch. The
 * function accepts already-parsed objects, JSON strings, empty input, and
 * missing input, and returns a typed validation result.
 *
 * The validator handles the JSON Schema subset that Lamprey tool
 * descriptors use:
 *   - `type: "object"` at the top level
 *   - `properties` with `{ type, description, enum?, items? }`
 *   - `required` array
 *   - `additionalProperties: false`
 *   - Nested objects (same shape, recursive)
 *   - Arrays with `items` type definition
 *
 * Unsupported JSON Schema keywords (`$ref`, `oneOf`, `anyOf`, `allOf`,
 * `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`) are ignored
 * rather than rejected — the validator validates what it understands and
 * lets through what it doesn't. This prevents a schema addition from
 * blocking tool dispatch; the model's provider-side validation and the
 * tool handler's own parsing are the second line of defense.
 */

export interface ToolArgValidationValid {
  valid: true
  parsed: Record<string, unknown>
}

export interface ToolArgValidationInvalid {
  valid: false
  errors: string[]
}

export type ToolArgValidationResult = ToolArgValidationValid | ToolArgValidationInvalid

interface JsonSchemaProperty {
  type?: string
  description?: string
  enum?: unknown[]
  items?: JsonSchemaProperty
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
  additionalProperties?: boolean
}

interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchemaProperty
}

/**
 * Validate tool arguments against the tool's `inputSchema`.
 *
 * @param toolName  Human-readable name for error messages.
 * @param args      Already-parsed object, JSON string, undefined, or null.
 * @param schema    The tool's `inputSchema` (JSON Schema subset).
 */
export function validateToolArguments(
  toolName: string,
  args: unknown,
  schema: unknown
): ToolArgValidationResult {
  const schemaObj = schema as JsonSchema | undefined

  // ── 1. Parse the argument payload ──────────────────────────────────

  let parsed: Record<string, unknown>

  if (args === undefined || args === null) {
    // No arguments provided at all. Valid only if the schema has no
    // required properties (or no properties at all).
    if (
      schemaObj?.required &&
      Array.isArray(schemaObj.required) &&
      schemaObj.required.length > 0
    ) {
      return {
        valid: false,
        errors: [
          `${toolName}: no arguments provided but expected: ${schemaObj.required.join(', ')}`
        ]
      }
    }
    parsed = {}
    return { valid: true, parsed }
  }

  if (typeof args === 'string') {
    const trimmed = args.trim()
    if (trimmed.length === 0) {
      if (
        schemaObj?.required &&
        Array.isArray(schemaObj.required) &&
        schemaObj.required.length > 0
      ) {
        return {
          valid: false,
          errors: [
            `${toolName}: empty argument string but expected: ${schemaObj.required.join(', ')}`
          ]
        }
      }
      parsed = {}
      return { valid: true, parsed }
    }
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return {
        valid: false,
        errors: [`${toolName}: failed to parse arguments as JSON`]
      }
    }
  } else if (typeof args === 'object') {
    parsed = args as Record<string, unknown>
  } else {
    return {
      valid: false,
      errors: [
        `${toolName}: arguments must be an object or JSON string, got ${typeof args}`
      ]
    }
  }

  // ── 2. Validate against the schema ─────────────────────────────────

  const errors: string[] = []

  // Top-level type check
  if (schemaObj?.type && schemaObj.type !== 'object') {
    // Non-object schemas (e.g. array-only tools) are deferred — validate
    // what we can and pass through.
    return { valid: true, parsed }
  }

  // Required properties
  if (schemaObj?.required && Array.isArray(schemaObj.required)) {
    for (const key of schemaObj.required) {
      if (!(key in parsed) || parsed[key] === undefined) {
        errors.push(`${toolName}: missing required property "${key}"`)
      }
    }
  }

  // Property-by-property validation
  if (schemaObj?.properties) {
    for (const [key, propSchema] of Object.entries(schemaObj.properties)) {
      const value = parsed[key]
      if (value === undefined) continue // Not provided — required check above catches if needed

      validatePropertyValue(toolName, key, value, propSchema, errors, [key])
    }
  }

  // Nested required checks — walk properties that are present and themselves
  // have `required` arrays. Do this AFTER the required-key loop so that a
  // missing nested object doesn't trigger a confusing cascade of errors.
  if (schemaObj?.properties) {
    for (const [key, propSchema] of Object.entries(schemaObj.properties)) {
      const value = parsed[key]
      if (value === undefined) continue
      if (propSchema.required && Array.isArray(propSchema.required) && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>
        for (const nestedKey of propSchema.required) {
          if (!(nestedKey in nested) || nested[nestedKey] === undefined) {
            errors.push(`${toolName}: missing required property "${nestedKey}" in "${key}"`)
          }
        }
      }
    }
  }

  // Additional properties check
  if (schemaObj?.additionalProperties === false && schemaObj?.properties) {
    const knownKeys = new Set(Object.keys(schemaObj.properties))
    for (const key of Object.keys(parsed)) {
      if (!knownKeys.has(key) && parsed[key] !== undefined) {
        errors.push(`${toolName}: unexpected property "${key}"`)
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return { valid: true, parsed }
}

/**
 * Validate a single property value against its schema definition.
 * Recurses into nested objects and array items.
 */
function validatePropertyValue(
  toolName: string,
  key: string,
  value: unknown,
  propSchema: JsonSchemaProperty,
  errors: string[],
  path: string[]
): void {
  const fullPath = path.join('.')

  // Null is technically an object but we treat it as a missing value
  if (value === null) {
    return
  }

  const expectedType = propSchema.type

  if (expectedType) {
    const actualType = Array.isArray(value) ? 'array' : typeof value

    // "number" type — allow both number and integer
    if (expectedType === 'number' || expectedType === 'integer') {
      if (actualType !== 'number') {
        errors.push(`${toolName}: "${fullPath}" expected ${expectedType}, got ${actualType}`)
        return
      }
    } else if (expectedType === 'array') {
      if (!Array.isArray(value)) {
        errors.push(`${toolName}: "${fullPath}" expected array, got ${actualType}`)
        return
      }
    } else if (expectedType === 'object') {
      if (actualType !== 'object' || Array.isArray(value)) {
        errors.push(
          `${toolName}: "${fullPath}" expected object, got ${Array.isArray(value) ? 'array' : actualType}`
        )
        return
      }
    } else {
      // string, boolean
      if (actualType !== expectedType) {
        errors.push(`${toolName}: "${fullPath}" expected ${expectedType}, got ${actualType}`)
        return
      }
    }
  }

  // Enum constraint
  if (propSchema.enum && Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
    if (!propSchema.enum.includes(value)) {
      const preview = propSchema.enum.map((e) => JSON.stringify(e)).join(', ')
      errors.push(
        `${toolName}: "${fullPath}" must be one of [${preview}], got ${JSON.stringify(value)}`
      )
    }
  }

  // Nested object properties
  if (propSchema.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const objValue = value as Record<string, unknown>
    for (const [nestedKey, nestedSchema] of Object.entries(propSchema.properties)) {
      const nestedValue = objValue[nestedKey]
      if (nestedValue === undefined) continue
      validatePropertyValue(toolName, nestedKey, nestedValue, nestedSchema, errors, [
        ...path,
        nestedKey
      ])
    }
    // Additional properties on nested objects
    if (propSchema.additionalProperties === false) {
      const known = new Set(Object.keys(propSchema.properties))
      for (const nestedKey of Object.keys(objValue)) {
        if (!known.has(nestedKey) && objValue[nestedKey] !== undefined) {
          errors.push(`${toolName}: "${fullPath}" unexpected property "${nestedKey}"`)
        }
      }
    }
  }

  // Array items validation
  if (propSchema.items && Array.isArray(value)) {
    const arr = value as unknown[]
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      if (item === undefined || item === null) continue
      const itemType = propSchema.items.type
      const actualItemType = Array.isArray(item) ? 'array' : typeof item
      if (itemType && actualItemType !== itemType) {
        errors.push(
          `${toolName}: "${fullPath}[${i}]" expected ${itemType}, got ${actualItemType}`
        )
      }
    }
  }
}
