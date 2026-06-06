import { useEffect, useRef, useState } from 'react'
import type { BundledLanguage, Highlighter } from 'shiki'

const ARTIFACT_LANGUAGES = new Set(['html', 'svg', 'mermaid', 'jsx', 'tsx', 'react'])

function detectArtifactType(code: string, lang: string): string | null {
  if (ARTIFACT_LANGUAGES.has(lang)) {
    return lang === 'react' || lang === 'jsx' || lang === 'tsx' ? 'jsx' : lang
  }
  const trimmed = code.trimStart()
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
    return 'html'
  }
  if (!lang || lang === 'javascript' || lang === 'typescript') {
    if (/\breturn\s*\(?\s*<[A-Z]/.test(code) || /<[A-Z][a-zA-Z]*[\s/>]/.test(code)) {
      return 'jsx'
    }
  }
  return null
}

let shikiPromise: Promise<Highlighter> | null = null

function getShiki(): Promise<Highlighter> {
  if (!shikiPromise) {
    shikiPromise = import('shiki').then((mod) =>
      mod.createHighlighter({
        themes: ['one-dark-pro'],
        langs: [
          'javascript',
          'typescript',
          'python',
          'rust',
          'go',
          'java',
          'c',
          'cpp',
          'csharp',
          'html',
          'css',
          'json',
          'yaml',
          'toml',
          'markdown',
          'bash',
          'shell',
          'sql',
          'jsx',
          'tsx',
          'svelte',
          'vue',
          'ruby',
          'php',
          'swift',
          'kotlin',
          'lua',
          'r',
          'dockerfile',
          'xml',
          'svg',
          'graphql',
          'diff',
        ],
      })
    ) as Promise<Highlighter>
  }
  return shikiPromise
}

interface CodeBlockProps {
  code: string
  language?: string
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const codeRef = useRef<HTMLDivElement>(null)

  const lang = language?.toLowerCase() ?? ''
  const detectedType = detectArtifactType(code, lang)
  const isArtifact = detectedType !== null

  useEffect(() => {
    if (isArtifact) return

    let cancelled = false
    getShiki()
      .then((highlighter) => {
        if (cancelled) return
        const supported = highlighter.getLoadedLanguages()
        const langId = supported.includes(lang as BundledLanguage) ? lang : 'text'
        const result = highlighter.codeToHtml(code, {
          lang: langId as BundledLanguage,
          theme: 'one-dark-pro',
        })
        setHtml(result)
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, lang, isArtifact])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleOpenArtifact = () => {
    if (!detectedType) return
    window.api?.artifact?.render(detectedType, code)
    const opener = (window as unknown as Record<string, unknown>).__openArtifact
    if (typeof opener === 'function') {
      ;(opener as (t: string, s: string) => void)(detectedType, code)
    }
  }

  if (isArtifact) {
    const previewLines = code.split('\n').slice(0, 4).join('\n')
    return (
      <div className="my-2 rounded-lg border border-[var(--panel-border)] bg-[var(--bg-primary)] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--panel-border)] bg-[var(--bg-tertiary)]">
          <span className="text-xs font-mono text-[var(--accent)]">{detectedType}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
        </div>
        <pre className="px-3 py-2 text-xs font-mono text-[var(--text-muted)] overflow-hidden">
          <code>{previewLines}</code>
        </pre>
        <button
          onClick={handleOpenArtifact}
          className="w-full px-3 py-2 text-xs font-medium text-[var(--accent)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border-t border-[var(--panel-border)] transition-colors"
        >
          Open artifact
        </button>
      </div>
    )
  }

  return (
    <div className="my-2 rounded-lg border border-[var(--panel-border)] bg-[var(--bg-primary)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--panel-border)] bg-[var(--bg-tertiary)]">
        <span className="text-xs font-mono text-[var(--text-muted)]">{lang || 'text'}</span>
        <button
          onClick={handleCopy}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      {html ? (
        <div
          ref={codeRef}
          className="overflow-x-auto text-xs [&_pre]:!bg-[var(--bg-primary)] [&_pre]:p-3 [&_pre]:m-0 [&_code]:!font-[IBM_Plex_Mono,Fira_Code,monospace]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-3 text-xs font-mono text-[var(--text-secondary)]">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
