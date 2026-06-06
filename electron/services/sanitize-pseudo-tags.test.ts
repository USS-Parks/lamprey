import { describe, it, expect } from 'vitest'
import { sanitizePseudoTags } from './sanitize-pseudo-tags'

// HX3 — Robustness Hotfix v0.8.4. The sanitizer is the persist-side
// belt-and-braces for HX2's prompt guard: even when a model ignores the
// PSEUDO_TAG_GUARD and emits `<bash>find …</bash>` as final prose, the
// chat bubble must not render the pseudo-XML verbatim.

describe('sanitizePseudoTags — basic shell-shaped tag rewrites', () => {
  it('rewrites a single <bash> pair to a ```bash fence', () => {
    const input = 'before <bash>ls -la</bash> after'
    const out = sanitizePseudoTags(input)
    expect(out).toBe('before ```bash\nls -la\n``` after')
  })

  it('rewrites <tool>, <run>, <shell>, <execute>, <command>, <terminal> to ```bash fences', () => {
    for (const tag of ['tool', 'run', 'shell', 'execute', 'command', 'terminal']) {
      const out = sanitizePseudoTags(`<${tag}>cmd</${tag}>`)
      expect(out).toBe('```bash\ncmd\n```')
    }
  })

  it('preserves multi-line bodies inside shell-shaped fences', () => {
    const input = '<bash>\nfind . -name "*.md"\ngrep "TODO" *.ts\n</bash>'
    const out = sanitizePseudoTags(input)
    expect(out).toBe('```bash\nfind . -name "*.md"\ngrep "TODO" *.ts\n```')
  })
})

describe('sanitizePseudoTags — output-shaped tag rewrites', () => {
  it('rewrites <output>, <result>, <stdout>, <stderr> to ```text fences (honest about content)', () => {
    for (const tag of ['output', 'result', 'stdout', 'stderr']) {
      const out = sanitizePseudoTags(`<${tag}>command output</${tag}>`)
      expect(out).toBe('```text\ncommand output\n```')
    }
  })
})

describe('sanitizePseudoTags — case-insensitive tag matching', () => {
  it('matches uppercase tag names', () => {
    expect(sanitizePseudoTags('<BASH>cmd</BASH>')).toBe('```bash\ncmd\n```')
  })

  it('matches mixed-case tag names', () => {
    expect(sanitizePseudoTags('<Bash>cmd</Bash>')).toBe('```bash\ncmd\n```')
  })

  it('preserves body case + whitespace verbatim', () => {
    const input = '<bash>FIND . -NAME "X.md"</bash>'
    const out = sanitizePseudoTags(input)
    expect(out).toBe('```bash\nFIND . -NAME "X.md"\n```')
  })
})

describe('sanitizePseudoTags — multiple pseudo-tags in one string', () => {
  it('rewrites every pair', () => {
    const input = '<bash>a</bash> middle <bash>b</bash>'
    const out = sanitizePseudoTags(input)
    expect(out).toBe('```bash\na\n``` middle ```bash\nb\n```')
  })

  it('mixes shell + output pairs correctly', () => {
    const input = '<bash>cmd</bash>\n<output>result</output>'
    const out = sanitizePseudoTags(input)
    expect(out).toBe('```bash\ncmd\n```\n```text\nresult\n```')
  })
})

describe('sanitizePseudoTags — fence-aware (skips inside existing ```)', () => {
  it('leaves pseudo-tags inside an existing fence alone', () => {
    const input = '```\n<bash>cmd</bash>\n```'
    const out = sanitizePseudoTags(input)
    expect(out).toBe(input)
  })

  it('leaves pseudo-tags inside a language-tagged fence alone', () => {
    const input = '```markdown\nHere is an example: <bash>cmd</bash>\n```'
    const out = sanitizePseudoTags(input)
    expect(out).toBe(input)
  })

  it('rewrites outside-fence but leaves inside-fence alone in mixed input', () => {
    const input = '<bash>outside</bash>\n```markdown\nexample: <bash>inside</bash>\n```'
    const out = sanitizePseudoTags(input)
    expect(out).toBe('```bash\noutside\n```\n```markdown\nexample: <bash>inside</bash>\n```')
  })
})

describe('sanitizePseudoTags — unbalanced and edge cases', () => {
  it('leaves an open tag with no close intact', () => {
    const input = 'unclosed <bash> here'
    const out = sanitizePseudoTags(input)
    expect(out).toBe(input)
  })

  it('leaves an orphan close tag intact', () => {
    const input = 'orphan close </bash> here'
    const out = sanitizePseudoTags(input)
    expect(out).toBe(input)
  })

  it('returns input unchanged when there are no pseudo-tags', () => {
    const input = 'plain prose. some `code`. a ```fenced``` block.'
    expect(sanitizePseudoTags(input)).toBe(input)
  })

  it('returns empty string unchanged', () => {
    expect(sanitizePseudoTags('')).toBe('')
  })

  it('handles non-string input safely', () => {
    // @ts-expect-error — defensive runtime guard for malformed callers
    expect(sanitizePseudoTags(null)).toBe(null)
    // @ts-expect-error — defensive runtime guard for malformed callers
    expect(sanitizePseudoTags(undefined)).toBe(undefined)
  })

  it('strips a single leading + trailing newline inside the body', () => {
    const input = '<bash>\nls\n</bash>'
    const out = sanitizePseudoTags(input)
    // No \n\n at the start of the body inside the fence.
    expect(out).toBe('```bash\nls\n```')
  })
})

describe('sanitizePseudoTags — idempotency', () => {
  it('running it twice produces the same result as once (no pseudo-tags)', () => {
    const input = 'plain prose with no tags'
    expect(sanitizePseudoTags(sanitizePseudoTags(input))).toBe(sanitizePseudoTags(input))
  })

  it('running it twice produces the same result as once (with pseudo-tags)', () => {
    const input = '<bash>cmd</bash> middle <output>res</output>'
    const once = sanitizePseudoTags(input)
    const twice = sanitizePseudoTags(once)
    expect(twice).toBe(once)
  })

  it('running it twice on mixed fenced + pseudo input is idempotent', () => {
    const input = '<bash>outside</bash>\n```markdown\nexample: <bash>inside</bash>\n```'
    const once = sanitizePseudoTags(input)
    const twice = sanitizePseudoTags(once)
    expect(twice).toBe(once)
  })
})

describe('sanitizePseudoTags — real-world user-reported case', () => {
  // The exact text from the 2026-06-06 user-reported screenshots — a coder
  // stage that emitted bash-as-prose instead of invoking a real tool.
  it('cleans the canonical bash-as-prose ghost-reply', () => {
    const input =
      'I cannot meaningfully review the implementation without seeing the actual generated file. ' +
      'Let me locate and inspect it first. ' +
      '<bash>find . -name "debug-session-audit.md" -maxdepth 3 2>/dev/null </bash> ' +
      '<bash> # Also check git for recently created files git ls-files --others --exclude-standard ' +
      `-- '*.md' 2>/dev/null; ls -la *.md 2>/dev/null </bash>`
    const out = sanitizePseudoTags(input)
    // Two ```bash fences produced; the user-facing bubble no longer renders
    // pseudo-XML as literal prose.
    expect(out).toContain('```bash\nfind . -name "debug-session-audit.md"')
    expect(out).toContain('```bash\n # Also check git for recently created files')
    expect(out).not.toContain('<bash>')
    expect(out).not.toContain('</bash>')
  })
})
