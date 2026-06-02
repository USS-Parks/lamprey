import { describe, it, expect } from 'vitest'
import { classifyToolResult } from './tool-result-status'

// Per-tool error prefixes ("view_image error:", "Shell error:", etc.) and
// shell exit codes are handled by the structured-status path in chat.ts,
// not this fallback. Those tests live where the structured-return contract
// is enforced; here we cover only the legacy string-return path.

describe('classifyToolResult (legacy fallback)', () => {
  it('treats the canonical denial string as denied', () => {
    expect(classifyToolResult('Action denied by user.')).toBe('denied')
  })

  it('treats Error: prefix as error', () => {
    expect(classifyToolResult('Error: thing went wrong')).toBe('error')
  })

  it('treats Unknown tool: prefix as error', () => {
    expect(classifyToolResult('Unknown tool: foo')).toBe('error')
  })

  it('treats arbitrary success strings as done', () => {
    expect(classifyToolResult('Saved to memory.')).toBe('done')
    expect(classifyToolResult('{"steps": [], "totals": {}}')).toBe('done')
    expect(classifyToolResult('Approved (scope=shell)')).toBe('done')
  })

  it('does not false-match on words containing "error" mid-string', () => {
    expect(classifyToolResult('All checks passed; previous error was fixed.')).toBe('done')
  })

  it('does not false-match on "error:" inside a longer body', () => {
    expect(classifyToolResult('Saved; warning: stderr was empty')).toBe('done')
  })

  it('passes through any unknown prefix as done', () => {
    // Per-tool "X error:" prefixes used to be caught here; they now go
    // through structured status. The fallback intentionally stays narrow
    // so a successful tool that happens to mention "error" in its body
    // (e.g. a help text) is not misclassified.
    expect(classifyToolResult('view_image error: legacy path')).toBe('done')
    expect(classifyToolResult('Exit: 1 · Duration: 5ms')).toBe('done')
  })
})
