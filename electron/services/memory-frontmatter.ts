// File-backed memory frontmatter (parity Track 3, prompt D1).
//
// Memory is stored on disk as <slug>.md files under
// `userData/lamprey-memory/<projectSlug>/`. SQLite is a mirror used for
// FTS / index reads; the files are canonical, so external edits and
// version-control are both first-class.

import matter from 'gray-matter'

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

export const MEMORY_TYPES: readonly MemoryType[] = ['user', 'feedback', 'project', 'reference']

export interface MemoryFrontmatter {
  name: string
  description: string
  metadata: { type: MemoryType }
}

export interface ParsedMemoryFile {
  name: string
  description: string
  type: MemoryType
  body: string
}

export interface MemoryWriteInput {
  name: string
  description?: string
  type: MemoryType
  body: string
}

const SLUG_MAX = 60

function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === 'string' && (MEMORY_TYPES as readonly string[]).includes(value)
}

// Convert a free-form display name to a filesystem-safe slug used as the
// `<slug>.md` filename. Slugs collapse non-alphanumerics into `_`, force
// lowercase, and clamp length so users can write "Why we ripped out X"
// and get something stable on disk.
export function memorySlug(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!cleaned) return 'untitled'
  return cleaned.length <= SLUG_MAX ? cleaned : cleaned.slice(0, SLUG_MAX).replace(/_+$/, '')
}

export function parseMemoryMarkdown(raw: string, fallbackName: string): ParsedMemoryFile {
  const parsed = matter(raw)
  const data = parsed.data ?? {}

  const name =
    typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallbackName
  const description =
    typeof data.description === 'string' ? data.description.trim() : ''

  const metadataRaw = (data as { metadata?: unknown }).metadata
  let type: MemoryType = 'project'
  if (metadataRaw && typeof metadataRaw === 'object') {
    const candidate = (metadataRaw as { type?: unknown }).type
    if (isMemoryType(candidate)) type = candidate
  } else if (isMemoryType((data as { type?: unknown }).type)) {
    // Tolerate flat `type:` at the top level even though our canonical
    // shape nests it under `metadata`. External editors / hand-rolled
    // memory files often skip the nesting.
    type = (data as { type: MemoryType }).type
  }

  return {
    name,
    description,
    type,
    body: parsed.content.trim()
  }
}

export function serializeMemoryMarkdown(input: MemoryWriteInput): string {
  const frontmatter: MemoryFrontmatter = {
    name: input.name,
    description: (input.description ?? '').trim(),
    metadata: { type: input.type }
  }
  // gray-matter.stringify wraps with `---` fences and serializes to YAML.
  // Pass the body as the first arg; the data object is the frontmatter.
  return matter.stringify(input.body.trim() + '\n', frontmatter)
}
