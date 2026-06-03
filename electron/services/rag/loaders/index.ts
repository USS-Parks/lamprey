import { extname } from 'path'
import { isSupportedTextExtension, loadFromBuffer, loadText } from './text'
import { loadPdf } from './pdf'
import { loadDocx } from './docx'

// Discriminated union — chunker.ts dispatches on `kind` to apply page-level
// stamping for paged docs and recursive split for unpaged ones.

export type LoadedDocument =
  | { kind: 'text'; text: string; mime: string }
  | { kind: 'paged'; pages: { page: number; text: string }[]; mime: string }

export async function loadDocument(path: string): Promise<LoadedDocument> {
  const ext = extname(path).toLowerCase()
  if (ext === '.pdf') {
    const pdf = await loadPdf(path)
    return { kind: 'paged', pages: pdf.pages, mime: pdf.mime }
  }
  if (ext === '.docx') {
    const docx = await loadDocx(path)
    return { kind: 'text', text: docx.text, mime: docx.mime }
  }
  if (isSupportedTextExtension(path)) {
    const t = await loadText(path)
    return { kind: 'text', text: t.text, mime: t.mime }
  }
  throw new Error(`Unsupported document extension: ${ext || '(none)'}`)
}

export { loadText, loadFromBuffer, isSupportedTextExtension } from './text'
export { loadPdf } from './pdf'
export { loadDocx } from './docx'
