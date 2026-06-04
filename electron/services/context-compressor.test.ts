import { describe, expect, it } from 'vitest'
import {
  estimateTokens,
  estimateTokensForMessages,
  DEFAULT_COMPRESS_THRESHOLD_PCT,
  DEFAULT_COMPRESS_TARGET_PCT
} from './context-compressor'

// Track 2 / E5 — context compressor pure-function tests. The
// `shouldCompress` / `selectMessagesToCompress` / `compressOldestMessages`
// branches touch the SQLite DB (via getDb()) which requires Electron at
// import time. We exercise the public token estimator + threshold
// helpers here and leave the DB-bound paths for integration smoke (the
// E5 verify gate documents the manual steps).
//
// The estimator is `Math.ceil(text.length / 4)` — a 100-char message
// becomes 25 tokens. This is the same conservative ratio used by the
// rest of the harness for budget projection.

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('rounds up via ceil', () => {
    // "abc" → 3 chars / 4 = 0.75 → ceil = 1
    expect(estimateTokens('abc')).toBe(1)
    // "abcd" → 1
    expect(estimateTokens('abcd')).toBe(1)
    // "abcde" → 2
    expect(estimateTokens('abcde')).toBe(2)
  })

  it('matches the documented chars-per-token ratio', () => {
    // 400 chars → 100 tokens.
    expect(estimateTokens('x'.repeat(400))).toBe(100)
  })
})

describe('estimateTokensForMessages', () => {
  it('sums per-message tokens', () => {
    const msgs = [
      { content: 'x'.repeat(40) }, // 10 tokens
      { content: 'y'.repeat(80) }, // 20 tokens
      { content: '' }              //  0 tokens
    ]
    expect(estimateTokensForMessages(msgs)).toBe(30)
  })

  it('handles a missing content field gracefully', () => {
    const msgs = [{ content: undefined as unknown as string }, { content: 'ok' }]
    expect(estimateTokensForMessages(msgs)).toBe(1)
  })
})

describe('default thresholds', () => {
  it('threshold is 75%', () => {
    expect(DEFAULT_COMPRESS_THRESHOLD_PCT).toBe(0.75)
  })

  it('target is 40%', () => {
    expect(DEFAULT_COMPRESS_TARGET_PCT).toBe(0.4)
  })
})
