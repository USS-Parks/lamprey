import type { RetrievedChunk } from './retrieve'

// Assemble retrieved chunks into a <retrieved_context> block for the
// system prompt. Per LAMPREY_RAG_PLAN.md §R10.
//
// Format:
//   <retrieved_context>
//     <source id="1" path="docs/architecture.md" lines="42-78">
//     ...chunk text...
//     </source>
//     ...
//   </retrieved_context>
//
//   Instruction: cite sources by id, e.g. [1] or [1, 2]. If no source
//   supports a claim, say so explicitly.
//
// Token cap: approximated as Math.ceil(chars / 4). Drop lowest-ranked
// sources until under cap.

export interface ContextBuildInput {
  chunks: RetrievedChunk[]
  /** Soft token cap. Approximated by chars/4. Default 3000 tokens. */
  maxTokens?: number
  /** When true, the closing instruction tells the model to refuse rather
   *  than answer if no source supports a claim. Default false. */
  citationRequired?: boolean
}

export interface SourceMapEntry {
  id: number
  chunkId: string
  documentId: string
  displayName: string
  /** Compact location string: "lines=42-78" or "page=3" or "heading=..." */
  locator: string
}

export interface ContextBuildOutput {
  /** The block to inject into the system prompt. Empty string when chunks=0. */
  block: string
  sourceMap: SourceMapEntry[]
}

const DEFAULT_MAX_TOKENS = 3000

export function buildContext(input: ContextBuildInput): ContextBuildOutput {
  if (!input.chunks || input.chunks.length === 0) {
    return { block: '', sourceMap: [] }
  }
  const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS
  const maxChars = maxTokens * 4

  // Sources are assigned ids 1..N in fused-score order (the input order).
  // Drop the lowest-ranked entries until we fit the cap.
  const sourceMap: SourceMapEntry[] = input.chunks.map((c, idx) => ({
    id: idx + 1,
    chunkId: c.chunkId,
    documentId: c.documentId,
    displayName: c.displayName,
    locator: formatLocator(c)
  }))

  // Walk top-down accumulating chars; truncate when we hit the cap.
  const accepted: { src: SourceMapEntry; chunk: RetrievedChunk }[] = []
  let totalChars = 0
  for (let i = 0; i < input.chunks.length; i++) {
    const tag = formatSourceTag(sourceMap[i], input.chunks[i].text)
    if (totalChars + tag.length > maxChars && accepted.length > 0) break
    accepted.push({ src: sourceMap[i], chunk: input.chunks[i] })
    totalChars += tag.length
  }

  const body = accepted
    .map((a) => formatSourceTag(a.src, a.chunk.text))
    .join('\n')
  const instruction = input.citationRequired
    ? 'Cite sources by id in square brackets, e.g. [1] or [1, 2]. If NO source supports a claim, you MUST say "No source supports an answer to this." rather than answering from prior knowledge.'
    : 'Cite sources by id in square brackets, e.g. [1] or [1, 2]. If no source supports a claim, say so explicitly.'

  const block = [
    '<retrieved_context>',
    body,
    '</retrieved_context>',
    '',
    `Instruction: ${instruction}`
  ].join('\n')

  return { block, sourceMap: accepted.map((a) => a.src) }
}

function formatSourceTag(src: SourceMapEntry, text: string): string {
  const safeText = text.replace(/<\//g, '< /')
  return `  <source id="${src.id}" name="${escapeAttr(src.displayName)}" ${src.locator}>\n${safeText}\n  </source>`
}

function formatLocator(chunk: RetrievedChunk): string {
  if (chunk.lineStart !== undefined && chunk.lineEnd !== undefined) {
    return `lines="${chunk.lineStart}-${chunk.lineEnd}"`
  }
  if (chunk.page !== undefined) {
    return `page="${chunk.page}"`
  }
  if (chunk.headingPath) {
    return `heading="${escapeAttr(chunk.headingPath)}"`
  }
  return 'locator="chunk"'
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
