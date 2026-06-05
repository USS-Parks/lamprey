// Tiny URL-safe slug helper used to derive a filename from a research
// question. Conservative: ASCII output only, hyphens between words, max
// 80 characters. Empty/punctuation-only inputs fall back to "research".

const MAX_SLUG_LEN = 80

export function slugify(input: string): string {
  if (!input) return 'research'
  let s = input.normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip combining diacritics
  s = s.toLowerCase()
  s = s.replace(/[^a-z0-9]+/g, '-')
  s = s.replace(/^-+|-+$/g, '')
  if (!s) return 'research'
  if (s.length > MAX_SLUG_LEN) {
    s = s.slice(0, MAX_SLUG_LEN)
    s = s.replace(/-+$/g, '')
  }
  return s || 'research'
}
