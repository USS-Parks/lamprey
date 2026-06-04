import { describe, expect, it } from 'vitest'
import { cleanPageText, collapseSpacedLetters } from './pdf'

describe('collapseSpacedLetters', () => {
  it('collapses the "V C O D E A N A L Y S I S R E P O R T" pathology', () => {
    const input = 'V C O D E A N A L Y S I S R E P O R T'
    expect(collapseSpacedLetters(input)).toBe('VCODEANALYSISREPORT')
  })
  it('preserves real word boundaries', () => {
    expect(collapseSpacedLetters('hello world')).toBe('hello world')
  })
  it('only triggers on 4+ consecutive single letters', () => {
    // 3 single letters → don't collapse (could be "a b c" coordinates, etc.)
    expect(collapseSpacedLetters('a b c')).toBe('a b c')
    // 4 → collapse
    expect(collapseSpacedLetters('a b c d')).toBe('abcd')
  })
  it('collapses inside a longer sentence', () => {
    const input = 'See the V C O D E A N A L Y S I S below.'
    expect(collapseSpacedLetters(input)).toBe('See the VCODEANALYSIS below.')
  })
  it('handles digits in the run', () => {
    expect(collapseSpacedLetters('1 2 3 4 5')).toBe('12345')
  })
  it('handles mixed alphanumeric', () => {
    expect(collapseSpacedLetters('A 1 B 2 C 3')).toBe('A1B2C3')
  })
  it('handles multiple runs in one string', () => {
    expect(collapseSpacedLetters('R E P O R T and S U M M A R Y')).toBe('REPORT and SUMMARY')
  })
  it('does not eat hyphenated words', () => {
    // "USS-Parks" is a single token, no spaces between letters
    expect(collapseSpacedLetters('USS-Parks')).toBe('USS-Parks')
  })
  it('does not eat URLs', () => {
    const url = 'https://github.com/USS-Parks/im-mighty-eel-mai'
    expect(collapseSpacedLetters(url)).toBe(url)
  })
  it('Unicode letters are intentionally NOT collapsed (ASCII-only by design)', () => {
    // JS \b is ASCII-only; supporting Unicode boundaries reliably needs
    // Intl.Segmenter. Pinning current behavior so a future "fix" doesn't
    // accidentally break collapse for the ASCII case.
    expect(collapseSpacedLetters('é è ê à ô')).toBe('é è ê à ô')
  })
  it('preserves words with internal punctuation', () => {
    expect(collapseSpacedLetters("don't worry about it")).toBe("don't worry about it")
  })
  it('empty string passes through', () => {
    expect(collapseSpacedLetters('')).toBe('')
  })
})

describe('cleanPageText', () => {
  it('strips form-feeds and collapses 3+ newlines', () => {
    const input = 'page one\f\n\n\n\npage two'
    expect(cleanPageText(input)).toBe('page one\n\npage two')
  })
  it('runs collapseSpacedLetters on the result', () => {
    const input = 'V C O D E A N A L Y S I S R E P O R T'
    expect(cleanPageText(input)).toBe('VCODEANALYSISREPORT')
  })
  it('collapses double-spaces left by the letter-collapse', () => {
    const input = 'see V C O D E A N A L Y S I S today'
    // After collapse: "see VCODEANALYSIS today" — no doubles, but if there
    // were doubles upstream, they'd be tightened.
    const got = cleanPageText('see  V C O D E A N A L Y S I S  today')
    expect(got).toBe('see VCODEANALYSIS today')
  })
  it('trims leading/trailing whitespace', () => {
    expect(cleanPageText('   hello   ')).toBe('hello')
  })
})
