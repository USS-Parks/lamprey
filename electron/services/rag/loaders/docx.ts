// DOCX loader. Uses `mammoth` to convert the document to markdown, so the
// chunker's heading-aware path picks up Heading 1/2/3 styles as `#`/`##`/`###`
// markers. Falling back to extractRawText loses the heading hierarchy and
// produces wall-of-text chunks with no headingPath in retrieval citations.
//
// Returns `mime: text/markdown` (not the docx mime) so the chunker dispatches
// to chunkMarkdown — that's the whole point of the conversion. The original
// docx mime would also be correct in a strict format-vs-content sense, but
// the chunker dispatch is what matters here.

export interface LoadedDocx {
  text: string
  mime: 'text/markdown'
}

type MammothMessage = { type?: string; message?: string }

type MammothModule = {
  convertToMarkdown?: (input: { path: string }) => Promise<{
    value: string
    messages?: MammothMessage[]
  }>
  extractRawText: (input: { path: string }) => Promise<{ value: string }>
}

export async function loadDocx(path: string): Promise<LoadedDocx> {
  let mammoth: MammothModule
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mammoth = require('mammoth') as MammothModule
  } catch (err) {
    throw new Error(
      `mammoth unavailable: ${(err as Error)?.message ?? 'unknown'}`,
      { cause: err }
    )
  }

  // Prefer the markdown converter when available (mammoth ≥ 1.6). Fall back
  // to extractRawText for older installs — the result still indexes, just
  // without heading-path citations.
  try {
    if (typeof mammoth.convertToMarkdown === 'function') {
      const result = await mammoth.convertToMarkdown({ path })
      const text = normalize(result.value)
      return { text, mime: 'text/markdown' }
    }
    const result = await mammoth.extractRawText({ path })
    return { text: normalize(result.value), mime: 'text/markdown' }
  } catch (err) {
    throw new Error(
      `DOCX parse failed: ${(err as Error)?.message ?? 'unknown'}`,
      { cause: err }
    )
  }
}

function normalize(value: string): string {
  // Normalize Windows line endings; the chunker assumes \n.
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}
