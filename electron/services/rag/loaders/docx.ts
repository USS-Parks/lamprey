// DOCX loader. Uses `mammoth` to extract raw text from the document.

export interface LoadedDocx {
  text: string
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

type MammothModule = {
  extractRawText: (input: { path: string }) => Promise<{ value: string }>
}

export async function loadDocx(path: string): Promise<LoadedDocx> {
  let mammoth: MammothModule
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mammoth = require('mammoth') as MammothModule
  } catch (err) {
    throw new Error(
      `mammoth unavailable: ${(err as Error)?.message ?? 'unknown'}`
    )
  }
  try {
    const result = await mammoth.extractRawText({ path })
    // Normalize Windows line endings; the chunker assumes \n.
    const text = result.value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    return {
      text,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }
  } catch (err) {
    throw new Error(`DOCX parse failed: ${(err as Error)?.message ?? 'unknown'}`)
  }
}
