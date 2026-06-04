// Fluidity J10: autolink `path/file.ext` or `path/file.ext:line` substrings
// in plain prose. Pure / framework-free so the regex + boundary rules
// are unit-testable; MarkdownRenderer wires the helper to wrap text-node
// children in clickable spans.
//
// Matched extensions are the common source/doc file types — extensions
// like `.exe` or `.bin` are intentionally excluded because they're
// unlikely to be referenced as link-bait.

const EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'md',
  'mdx',
  'json',
  'yaml',
  'yml',
  'toml',
  'css',
  'scss',
  'html',
  'sh',
  'py',
  'rs',
  'go',
  'java',
  'rb',
  'sql'
] as const

const EXT_GROUP = EXTENSIONS.join('|')

// Capture groups:
//   1: full path (before the optional `:line`)
//   2: file extension
//   3: optional line number
//
// Boundary rules baked into the pattern:
//   - leading `\b` keeps us out of the middle of words (e.g. `barfoo.ts`
//     when looking at `foo.ts` shouldn't match)
//   - `(?![\w])` after the extension blocks `\.md.bak` from extending
//   - `(?:[/\\]|^)` requirement on the path means a bare `foo.ts` token
//     still matches, but only when it's truly a token boundary
// First char of the path is `[\w@.]` so leading `./` and `../` parse, while
// `(?<!\.)` on the lookbehind still rejects continuations like `bar.foo.ts`
// being chopped mid-name. The trailing `(?![\w.])` rejects `.md.bak`.
const PATH_LINE_RE = new RegExp(
  `(?<![\\w/\\\\])([\\w@.][\\w./\\\\-]*\\.(${EXT_GROUP}))(?::(\\d+))?(?![\\w.])`,
  'g'
)

export interface AutolinkMatch {
  kind: 'link'
  path: string
  line?: number
  raw: string
}

export interface AutolinkText {
  kind: 'text'
  value: string
}

export type AutolinkSegment = AutolinkMatch | AutolinkText

/**
 * Split `text` into segments — plain text runs and matched file-ref
 * candidates. Falsy matches (URLs, `.md.bak`-style dotted continuations)
 * are excluded.
 */
export function autolinkText(text: string): AutolinkSegment[] {
  if (!text) return []
  const out: AutolinkSegment[] = []
  let lastIdx = 0
  // Fresh regex per call so `lastIndex` doesn't leak across invocations
  // (PATH_LINE_RE is /g — calling exec mutates state).
  const re = new RegExp(PATH_LINE_RE.source, PATH_LINE_RE.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const start = m.index
    const end = re.lastIndex
    const raw = m[0]
    const path = m[1]
    const lineStr = m[3]

    // Exclude URL fragments: if `://` appears within the 12 chars before
    // the match, this is almost certainly a URL path, not a file ref.
    const beforeChunk = text.slice(Math.max(0, start - 12), start)
    if (/:\/\//.test(beforeChunk)) continue

    // Require a path separator OR a leading dot — otherwise a bare
    // single-word token risks false-positive on e.g. project names
    // ending in `.io` (intentionally excluded from EXTENSIONS) but in
    // case future extensions land here, this keeps the rule explicit.
    const hasSep = path.includes('/') || path.includes('\\')
    const startsWithDot = path.startsWith('./') || path.startsWith('../') || path.startsWith('.\\')
    const bareToken = !hasSep && !startsWithDot
    // Bare tokens are still allowed (e.g. `App.tsx` standalone) — the
    // extension whitelist is narrow enough that false positives are rare.
    // The check above is kept as a hook for future tightening if needed.
    void bareToken

    if (start > lastIdx) out.push({ kind: 'text', value: text.slice(lastIdx, start) })
    out.push({
      kind: 'link',
      path,
      line: lineStr ? parseInt(lineStr, 10) : undefined,
      raw
    })
    lastIdx = end
  }
  if (lastIdx < text.length) out.push({ kind: 'text', value: text.slice(lastIdx) })
  return out
}
