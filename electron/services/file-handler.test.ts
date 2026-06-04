import { describe, expect, it } from 'vitest'
import {
  decideRoute,
  DEFAULT_ROUTING,
  resolveThresholds,
  type RoutingThresholds
} from './file-handler'

// Routing matrix tests. Every cell in the H4 design table gets a case,
// plus boundary conditions on each threshold.

const KB = 1024
const MB = 1024 * 1024

describe('decideRoute — global hard cap', () => {
  it('rejects anything over 100 MB', () => {
    const r = decideRoute('.ts', 101 * MB)
    expect(r.action).toBe('reject')
    if (r.action === 'reject') expect(r.reason).toContain('100MB')
  })
  it('100 MB exact is the boundary (allows)', () => {
    // Code at 100 MB hits codeInlineWarnMaxBytes (5 MB by default), so
    // it'd be rejected by the per-type cap. Use a doc to test the global.
    const r = decideRoute('.pdf', 100 * MB)
    expect(r.action).toBe('rag')
  })
})

describe('decideRoute — documents always RAG', () => {
  it('.pdf small → rag', () => {
    expect(decideRoute('.pdf', 50 * KB).action).toBe('rag')
  })
  it('.pdf large → rag', () => {
    expect(decideRoute('.pdf', 80 * MB).action).toBe('rag')
  })
  it('.docx small → rag', () => {
    expect(decideRoute('.docx', 50 * KB).action).toBe('rag')
  })
  it('.docx large → rag', () => {
    expect(decideRoute('.docx', 80 * MB).action).toBe('rag')
  })
})

describe('decideRoute — prose', () => {
  it('.md under 50 KB → inline', () => {
    expect(decideRoute('.md', 10 * KB).action).toBe('inline')
  })
  it('.md exactly 50 KB → inline (boundary inclusive)', () => {
    expect(decideRoute('.md', 50 * KB).action).toBe('inline')
  })
  it('.md just over 50 KB → rag', () => {
    expect(decideRoute('.md', 50 * KB + 1).action).toBe('rag')
  })
  it('.mdx routes the same as .md', () => {
    expect(decideRoute('.mdx', 10 * KB).action).toBe('inline')
    expect(decideRoute('.mdx', 500 * KB).action).toBe('rag')
  })
  it('.txt under 50 KB → inline', () => {
    expect(decideRoute('.txt', 10 * KB).action).toBe('inline')
  })
  it('.rst, .adoc follow the same lane', () => {
    expect(decideRoute('.rst', 10 * KB).action).toBe('inline')
    expect(decideRoute('.adoc', 100 * KB).action).toBe('rag')
  })
})

describe('decideRoute — structured data', () => {
  it('.json under 10 MB → inline', () => {
    expect(decideRoute('.json', 5 * MB).action).toBe('inline')
  })
  it('.json at 10 MB → inline (boundary inclusive)', () => {
    expect(decideRoute('.json', 10 * MB).action).toBe('inline')
  })
  it('.json between 10 MB and 50 MB → inline-warn', () => {
    const r = decideRoute('.json', 25 * MB)
    expect(r.action).toBe('inline-warn')
    if (r.action === 'inline-warn') {
      expect(r.warning).toMatch(/Large/)
      expect(r.warning).toMatch(/tokens/)
    }
  })
  it('.json over 50 MB → reject (use read_file with offset)', () => {
    const r = decideRoute('.json', 75 * MB)
    expect(r.action).toBe('reject')
    if (r.action === 'reject') expect(r.reason).toContain('read_file')
  })
  it('csv/tsv/yaml/toml/xml all go through the structured lane', () => {
    expect(decideRoute('.csv', 5 * MB).action).toBe('inline')
    expect(decideRoute('.csv', 25 * MB).action).toBe('inline-warn')
    expect(decideRoute('.tsv', 5 * MB).action).toBe('inline')
    expect(decideRoute('.yaml', 5 * MB).action).toBe('inline')
    expect(decideRoute('.yml', 5 * MB).action).toBe('inline')
    expect(decideRoute('.toml', 100 * KB).action).toBe('inline')
    expect(decideRoute('.xml', 1 * MB).action).toBe('inline')
    expect(decideRoute('.jsonl', 5 * MB).action).toBe('inline')
    expect(decideRoute('.ndjson', 5 * MB).action).toBe('inline')
  })
  it('CRITICAL — .json is structured, NOT prose', () => {
    // Easy regression: someone adds .json to PROSE_EXTS by mistake. A
    // 12 MB JSON file should NOT go to RAG.
    expect(decideRoute('.json', 12 * MB).action).not.toBe('rag')
  })
})

describe('decideRoute — source code', () => {
  it('.ts under 2 MB → inline', () => {
    expect(decideRoute('.ts', 1 * MB).action).toBe('inline')
  })
  it('.ts at exactly 2 MB → inline (boundary inclusive)', () => {
    expect(decideRoute('.ts', 2 * MB).action).toBe('inline')
  })
  it('.ts between 2 MB and 5 MB → inline-warn (use agentic tools)', () => {
    const r = decideRoute('.ts', 3 * MB)
    expect(r.action).toBe('inline-warn')
    if (r.action === 'inline-warn') expect(r.warning).toContain('grep_workspace')
  })
  it('.ts over 5 MB → reject (definitely use agentic tools)', () => {
    const r = decideRoute('.ts', 8 * MB)
    expect(r.action).toBe('reject')
    if (r.action === 'reject') expect(r.reason).toContain('grep_workspace')
  })
  it('CRITICAL — .ts is NOT RAG (regression of v0.1.43 misroute)', () => {
    // The whole point of H4: a 6 MB .tsx should NOT go to RAG.
    expect(decideRoute('.tsx', 6 * MB).action).not.toBe('rag')
  })
  it('all common code extensions follow the lane', () => {
    for (const ext of ['.py', '.go', '.rs', '.java', '.cs', '.cpp', '.swift']) {
      expect(decideRoute(ext, 1 * MB).action).toBe('inline')
      expect(decideRoute(ext, 8 * MB).action).toBe('reject')
    }
  })
  it('shell scripts and stylesheets route as code', () => {
    expect(decideRoute('.sh', 100 * KB).action).toBe('inline')
    expect(decideRoute('.ps1', 100 * KB).action).toBe('inline')
    expect(decideRoute('.css', 100 * KB).action).toBe('inline')
    expect(decideRoute('.scss', 100 * KB).action).toBe('inline')
  })
  it('html routes as code (not prose)', () => {
    expect(decideRoute('.html', 100 * KB).action).toBe('inline')
    expect(decideRoute('.html', 10 * MB).action).toBe('reject')
  })
})

describe('decideRoute — images', () => {
  it('.png always inline (vision needs bytes)', () => {
    expect(decideRoute('.png', 10 * KB).action).toBe('image')
    expect(decideRoute('.png', 50 * MB).action).toBe('image')
  })
  it('jpg/jpeg/gif/webp all image', () => {
    expect(decideRoute('.jpg', 1 * MB).action).toBe('image')
    expect(decideRoute('.jpeg', 1 * MB).action).toBe('image')
    expect(decideRoute('.gif', 1 * MB).action).toBe('image')
    expect(decideRoute('.webp', 1 * MB).action).toBe('image')
  })
  it('image over 100 MB still hits the global hard cap', () => {
    expect(decideRoute('.png', 200 * MB).action).toBe('reject')
  })
})

describe('decideRoute — no-extension files', () => {
  it('treated as prose', () => {
    expect(decideRoute('', 10 * KB).action).toBe('inline')
    expect(decideRoute('', 100 * KB).action).toBe('rag')
  })
})

describe('decideRoute — unknown extensions', () => {
  it('.zip / .exe / .mp4 → reject', () => {
    expect(decideRoute('.zip', 1 * KB).action).toBe('reject')
    expect(decideRoute('.exe', 1 * KB).action).toBe('reject')
    expect(decideRoute('.mp4', 1 * KB).action).toBe('reject')
  })
})

describe('resolveThresholds — Settings → router merge', () => {
  it('null override returns defaults', () => {
    expect(resolveThresholds(null)).toEqual(DEFAULT_ROUTING)
  })
  it('undefined override returns defaults', () => {
    expect(resolveThresholds(undefined)).toEqual(DEFAULT_ROUTING)
  })
  it('partial override fills missing fields from defaults', () => {
    const r = resolveThresholds({ proseInlineMaxBytes: 100 * KB })
    expect(r.proseInlineMaxBytes).toBe(100 * KB)
    expect(r.codeInlineMaxBytes).toBe(DEFAULT_ROUTING.codeInlineMaxBytes)
  })
  it('invalid values (NaN, 0, negative) fall back to defaults', () => {
    const r = resolveThresholds({
      proseInlineMaxBytes: 0,
      structuredInlineMaxBytes: -1,
      codeInlineMaxBytes: Number.NaN
    } as Partial<RoutingThresholds>)
    expect(r.proseInlineMaxBytes).toBe(DEFAULT_ROUTING.proseInlineMaxBytes)
    expect(r.structuredInlineMaxBytes).toBe(DEFAULT_ROUTING.structuredInlineMaxBytes)
    expect(r.codeInlineMaxBytes).toBe(DEFAULT_ROUTING.codeInlineMaxBytes)
  })
})

describe('decideRoute — custom thresholds (Settings H5 preview)', () => {
  it('proseInlineMaxBytes override', () => {
    const custom: RoutingThresholds = { ...DEFAULT_ROUTING, proseInlineMaxBytes: 200 * KB }
    // 100 KB now inlines (would have RAG'd at default 50 KB)
    expect(decideRoute('.md', 100 * KB, custom).action).toBe('inline')
  })
  it('structuredInlineMaxBytes override', () => {
    const custom: RoutingThresholds = {
      ...DEFAULT_ROUTING,
      structuredInlineMaxBytes: 30 * MB
    }
    expect(decideRoute('.csv', 25 * MB, custom).action).toBe('inline')
  })
  it('codeInlineMaxBytes override (smaller cap for Claude pricing)', () => {
    const claudePreset: RoutingThresholds = {
      ...DEFAULT_ROUTING,
      codeInlineMaxBytes: 500 * KB
    }
    expect(decideRoute('.ts', 1 * MB, claudePreset).action).toBe('inline-warn')
  })
})
