import { describe, it, expect } from 'vitest'
import { formatModelIdFallback } from './model-label'

describe('formatModelIdFallback (model chip fallback label)', () => {
  it('compacts modern provider ids', () => {
    expect(formatModelIdFallback('deepseek-v4-pro')).toBe('Deepseek V4 Pro')
    expect(formatModelIdFallback('deepseek-v4-flash')).toBe('Deepseek V4 Flash')
    expect(formatModelIdFallback('qwen3-coder-plus')).toBe('Qwen3 Coder Plus')
  })

  it('handles legacy ids the old chip special-cased', () => {
    expect(formatModelIdFallback('deepseek-reasoner')).toBe('Deepseek Reasoner')
    expect(formatModelIdFallback('deepseek-chat')).toBe('Deepseek Chat')
  })

  it('uppercases version-shaped tokens', () => {
    expect(formatModelIdFallback('gemma-3-27b')).toBe('Gemma 3 27B')
  })

  it('tolerates slashes and underscores', () => {
    expect(formatModelIdFallback('google/gemma_3')).toBe('Google Gemma 3')
  })
})
