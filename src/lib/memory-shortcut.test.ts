import { describe, expect, it } from 'vitest'
import { detectMemoryShortcut } from './memory-shortcut'

describe('detectMemoryShortcut', () => {
  it('returns null for an empty input', () => {
    expect(detectMemoryShortcut('')).toBeNull()
  })

  it('returns an empty description when only `#` is typed', () => {
    expect(detectMemoryShortcut('#')).toEqual({ description: '' })
  })

  it('returns the trimmed body when `# <text>` is typed', () => {
    expect(detectMemoryShortcut('# remember the RAG audit')).toEqual({
      description: 'remember the RAG audit'
    })
  })

  it('rejects `#hashtag` without a space', () => {
    expect(detectMemoryShortcut('#hashtag')).toBeNull()
  })

  it('rejects leading whitespace before `#`', () => {
    expect(detectMemoryShortcut('  # remember')).toBeNull()
  })

  it('rejects `#` on a later line (must be col 0 of line 1)', () => {
    expect(detectMemoryShortcut('hi\n# remember')).toBeNull()
  })

  it('extracts only line 1 when the input spans multiple lines', () => {
    expect(detectMemoryShortcut('# remember\nmore body here')).toEqual({
      description: 'remember'
    })
  })

  it('returns null for plain `#` with no leading match', () => {
    expect(detectMemoryShortcut('look at #channel')).toBeNull()
  })
})
