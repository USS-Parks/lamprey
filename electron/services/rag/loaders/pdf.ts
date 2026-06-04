import { readFile } from 'fs/promises'

// PDF loader. Uses `pdf-parse` to extract per-page text. Returns one page
// record per page so the chunker can stamp the `page` column on each chunk.
//
// Failure modes that get explicit error messages:
//   - Encrypted PDFs (`pdf-parse` throws on these).
//   - Scanned PDFs (no extractable text) — fall through and check the
//     total text length post-extraction.

export interface LoadedPdf {
  pages: { page: number; text: string }[]
  mime: 'application/pdf'
}

const MIN_EXTRACTED_CHARS = 100

type PdfParseFn = (
  buffer: Buffer,
  options?: {
    pagerender?: (pageData: unknown) => Promise<string> | string
  }
) => Promise<{ numpages: number; text: string }>

export async function loadPdf(path: string): Promise<LoadedPdf> {
  const buf = await readFile(path)
  // Late require to keep tests that don't exercise this path from pulling
  // pdf-parse into their module graph. pdf-parse self-tests by trying to
  // open `./test/data/05-versions-space.pdf` at import time; the late
  // require makes that loader load lazily, after our tests skip it.
  let pdfParse: PdfParseFn
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pdfParse = require('pdf-parse') as PdfParseFn
  } catch (err) {
    throw new Error(
      `pdf-parse unavailable: ${(err as Error)?.message ?? 'unknown'}`,
      { cause: err }
    )
  }

  const pages: { page: number; text: string }[] = []
  // Use the pagerender hook to capture per-page text. pdf-parse's default
  // renderer concatenates pages into one big string; the hook lets us
  // intercept per-page so the chunker can stamp the page number.
  try {
    const result = await pdfParse(buf, {
      pagerender: async (pageData: unknown) => {
        // pageData is a pdfjs page; the textContent fetcher returns
        // {items: [{str, transform, ...}, ...]}. We join `str` with
        // whitespace, then collapse form-feeds.
        const tc = await (pageData as {
          getTextContent: () => Promise<{ items: { str: string }[] }>
        }).getTextContent()
        const text = tc.items.map((i) => i.str).join(' ')
        pages.push({ page: pages.length + 1, text: cleanPageText(text) })
        return text
      }
    })
    // pdf-parse's overall `text` is empty when our hook captures pages, so
    // we use the per-page accumulator. The `numpages` field is a useful
    // sanity check.
    if (result.numpages !== pages.length) {
      // Some pages may yield empty text but still count toward numpages.
      // Fill in any missing trailing pages with empty records so the
      // caller's page indices line up.
      while (pages.length < result.numpages) {
        pages.push({ page: pages.length + 1, text: '' })
      }
    }
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err)
    if (/password|encrypted/i.test(msg)) {
      throw new Error('PDF is encrypted', { cause: err })
    }
    throw new Error(`PDF parse failed: ${msg}`, { cause: err })
  }

  const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0)
  if (totalChars < MIN_EXTRACTED_CHARS) {
    throw new Error(
      `PDF appears scanned (no extractable text — only ${totalChars} chars across ${pages.length} pages)`
    )
  }

  return { pages, mime: 'application/pdf' }
}

export function cleanPageText(s: string): string {
  // Strip form feed (U+000C) and collapse 3+ newlines into 2.
  let out = s.replace(/\f/g, '').replace(/\n{3,}/g, '\n\n').trim()
  // The "V C O D E A N A L Y S I S R E P O R T" pathology — pdfjs's
  // textContent emits one item per positioned glyph when the PDF uses
  // glyph-precise positioning (typesetter output, layout-heavy headers).
  // Joining items with space then leaves us with single letters separated
  // by single spaces. We can't recover original word boundaries without a
  // dictionary, but collapsing 4+ consecutive single-letter tokens into a
  // single token at least restores searchability and stops the chip from
  // looking like junk.
  out = collapseSpacedLetters(out)
  // Tighten any double-spaces that the collapse left behind.
  out = out.replace(/[ \t]{2,}/g, ' ')
  return out
}

/**
 * Walk a per-page text string and collapse runs of 4 or more single
 * ASCII alphanumeric "tokens" separated by single spaces. "V C O D E"
 * → "VCODE". Tokens of length ≥2 are preserved verbatim, so real words
 * like "the" or "USS-Parks" never get touched.
 *
 * Limited to ASCII because JavaScript's `\b` word-boundary anchor is
 * ASCII-only, and supporting Unicode boundaries reliably would require
 * custom segmentation (Intl.Segmenter). The real-world pathology this
 * fixes — typesetter PDFs with glyph-positioned English text — is
 * overwhelmingly ASCII anyway.
 *
 * Exported for unit testing the regex / heuristic behavior.
 */
export function collapseSpacedLetters(s: string): string {
  if (!s) return s
  const RUN = /(?:\b[A-Za-z0-9]\s){3,}[A-Za-z0-9]\b/g
  return s.replace(RUN, (run) => run.replace(/\s/g, ''))
}
