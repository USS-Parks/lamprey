// Shared URL canonicalisation for the deep-research pipeline.
//
// Two consumers:
//   * D2 cascade (`adapter-cascade.ts`) for cross-provider dedup.
//   * D5 collector (`collector.ts`) for the curated source set and the
//     domain-cap accounting.
//
// Rules applied (deterministic, no LLM):
//   * lowercase the host
//   * strip the leading `www.`
//   * drop the URL fragment
//   * drop common tracking parameters (utm_*, fbclid, gclid, msclkid,
//     yclid, dclid, igshid, _hsenc, _hsmi, mc_eid, mc_cid)
//   * sort remaining query parameters alphabetically (for stable equality)
//   * trim a trailing slash from the pathname (but keep root "/")
//
// Two helpers:
//   * `canonicalUrl(url)` — full canonical form for equality/dedup keys.
//   * `registrableDomain(url)` — eTLD+1-ish for the domain-cap counter.
//     We use a small hard-coded list of multi-segment public suffixes
//     (`.co.uk`, `.com.au`, `.ac.uk`, etc.) rather than pulling in the
//     full `publicsuffix-list` (which is megabytes). That covers the
//     ~99% case for the trust-score + domain-cap heuristic without an
//     extra dependency. Any miss degrades to "last two segments" which is
//     a conservative-enough fallback.

const TRACKING_PARAM_PREFIXES = ['utm_', 'mc_eid', 'mc_cid']
const TRACKING_PARAMS_EXACT = new Set([
  'fbclid', 'gclid', 'msclkid', 'yclid', 'dclid', 'igshid', '_hsenc', '_hsmi',
  'ref', 'ref_src', 'ref_url', 'source'
])

export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hostname = u.hostname.toLowerCase()
    if (u.hostname.startsWith('www.')) u.hostname = u.hostname.slice(4)
    u.hash = ''
    const keep: Array<[string, string]> = []
    u.searchParams.forEach((v, k) => {
      if (TRACKING_PARAMS_EXACT.has(k)) return
      if (TRACKING_PARAM_PREFIXES.some((p) => k.startsWith(p))) return
      keep.push([k, v])
    })
    u.search = ''
    keep.sort(([a], [b]) => a.localeCompare(b))
    for (const [k, v] of keep) u.searchParams.append(k, v)
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '')
    }
    return u.toString()
  } catch {
    return url
  }
}

// Multi-segment public suffixes that need an extra label of context to
// resolve to a registrable domain. Not exhaustive — covers the most
// common cases in practice. Any miss falls back to "last two labels"
// which is acceptable for cap accounting.
const MULTI_SEGMENT_TLDS = new Set([
  'co.uk', 'org.uk', 'me.uk', 'gov.uk', 'ac.uk', 'sch.uk', 'net.uk',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
  'com.br', 'org.br', 'net.br', 'gov.br', 'edu.br',
  'com.cn', 'org.cn', 'net.cn', 'gov.cn', 'edu.cn',
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'edu.in',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 'ac.kr',
  'co.za', 'org.za', 'net.za', 'gov.za', 'ac.za',
  'com.mx', 'org.mx', 'gob.mx', 'edu.mx',
  'github.io', 'gitlab.io', 'pages.dev', 'vercel.app', 'netlify.app',
  'cloudfront.net', 'azureedge.net', 's3.amazonaws.com'
])

/**
 * Return the registrable domain of a URL — `example.com` for both
 * `https://www.example.com/foo` and `https://blog.example.com/bar`, and
 * `bbc.co.uk` for `https://news.bbc.co.uk`.
 *
 * Used by the domain-cap accounting (≤ N results per domain) so siblings
 * are counted together.
 */
export function registrableDomain(url: string): string {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
  if (host.startsWith('www.')) host = host.slice(4)
  const labels = host.split('.')
  if (labels.length < 2) return host
  // Try the multi-segment suffixes first (longest match wins).
  for (let len = Math.min(3, labels.length - 1); len >= 2; len--) {
    const candidate = labels.slice(-len).join('.')
    if (MULTI_SEGMENT_TLDS.has(candidate)) {
      return labels.slice(-(len + 1)).join('.')
    }
  }
  // Fallback: last two labels.
  return labels.slice(-2).join('.')
}

/**
 * Dedupe a list of items by canonical-URL equality. Stable: keeps the
 * first occurrence in input order so the caller's intended ranking is
 * preserved.
 */
export function dedupeByCanonicalUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const it of items) {
    const key = canonicalUrl(it.url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}
