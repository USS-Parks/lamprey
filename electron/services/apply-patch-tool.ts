import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, relative, resolve } from 'path'

// Codex-style "Begin/End Patch" envelope with Add/Update/Delete file
// directives. Hand-rolled parser and applier - no shell, no `git apply`,
// no `patch`. Pure module - no electron imports - so the executor is
// unit-testable. Descriptor + registry wiring live in apply-patch-tool-pack;
// permission gating runs at the chat layer.

export interface ApplyPatchArgs {
  patch: string
}

export interface ApplyPatchResult {
  result: string
}

type FileOp =
  | { kind: 'add'; path: string; lines: string[] }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; hunks: Hunk[] }

interface Hunk {
  // Optional anchor (the `@@ <context>` line). We don't currently use the
  // anchor for matching — the deletion+context block has to find itself in
  // file order — but we capture it so error messages can identify the hunk.
  anchor?: string
  // Mixed body: each entry is a tag + raw line. `keep` (context) and
  // `remove` lines must match the file in sequence; `add` lines insert.
  body: BodyLine[]
}

type BodyLine =
  | { tag: 'keep'; text: string }
  | { tag: 'remove'; text: string }
  | { tag: 'add'; text: string }

const BEGIN = '*** Begin Patch'
const END = '*** End Patch'

/**
 * Confine a candidate path to the workspace root. Returns the absolute
 * resolved path on success, or null on traversal. Rejects:
 *   - explicit `..` segments in the input
 *   - paths that, once resolved, sit outside the root
 *   - Windows drive-letter absolutes that don't resolve under the root
 */
export function resolvePathWithinWorkspace(
  workspaceRoot: string,
  candidate: string
): string | null {
  if (!candidate || candidate.trim() === '') return null
  // Reject `..` segments outright — even if `path.resolve` would flatten
  // them, an explicit traversal attempt is a smell we'd rather surface.
  const segments = candidate.replace(/\\/g, '/').split('/')
  if (segments.some((s) => s === '..')) return null

  const root = resolve(workspaceRoot)
  const target = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate)
  const rel = relative(root, target)
  if (rel === '') return null // refusing to operate on the root itself
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return target
}

/**
 * Parse a Codex-style patch envelope into a list of file operations.
 * Throws on malformed input with a message naming the offending line.
 */
export function parsePatch(patch: string): FileOp[] {
  if (typeof patch !== 'string' || patch.trim() === '') {
    throw new Error('patch is required and must be a non-empty string')
  }

  // Normalize line endings; keep trailing-newline information out of the
  // way by splitting and rebuilding.
  const lines = patch.replace(/\r\n/g, '\n').split('\n')

  // Find Begin/End. Allow surrounding blank lines but nothing meaningful
  // before/after.
  let beginIdx = -1
  let endIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === BEGIN) {
      beginIdx = i
      break
    }
    if (lines[i].trim() !== '') {
      throw new Error(`expected "${BEGIN}" header, found: ${JSON.stringify(lines[i])}`)
    }
  }
  if (beginIdx === -1) throw new Error(`missing "${BEGIN}" header`)

  for (let i = lines.length - 1; i > beginIdx; i--) {
    if (lines[i] === END) {
      endIdx = i
      break
    }
    if (lines[i].trim() !== '') {
      throw new Error(`expected "${END}" footer, found trailing content: ${JSON.stringify(lines[i])}`)
    }
  }
  if (endIdx === -1) throw new Error(`missing "${END}" footer`)

  const body = lines.slice(beginIdx + 1, endIdx)
  const ops: FileOp[] = []

  let i = 0
  while (i < body.length) {
    const line = body[i]
    if (line.trim() === '') {
      i++
      continue
    }

    if (line.startsWith('*** Add File: ')) {
      const path = line.slice('*** Add File: '.length).trim()
      if (!path) throw new Error(`Add File directive missing path at body line ${i + 1}`)
      i++
      const addLines: string[] = []
      while (i < body.length && !body[i].startsWith('*** ')) {
        const ln = body[i]
        if (ln === '') {
          // Allow trailing blanks between adds — but only if they're truly
          // empty. A non-empty line that doesn't start with `+` is malformed.
          i++
          continue
        }
        if (!ln.startsWith('+')) {
          throw new Error(
            `Add File "${path}": every content line must start with "+"; got ${JSON.stringify(ln)} at body line ${i + 1}`
          )
        }
        addLines.push(ln.slice(1))
        i++
      }
      ops.push({ kind: 'add', path, lines: addLines })
      continue
    }

    if (line.startsWith('*** Delete File: ')) {
      const path = line.slice('*** Delete File: '.length).trim()
      if (!path) throw new Error(`Delete File directive missing path at body line ${i + 1}`)
      i++
      // Delete has no body. If the next non-blank line isn't another
      // directive (or end), that's a grammar error.
      while (i < body.length && body[i] === '') i++
      ops.push({ kind: 'delete', path })
      continue
    }

    if (line.startsWith('*** Update File: ')) {
      const path = line.slice('*** Update File: '.length).trim()
      if (!path) throw new Error(`Update File directive missing path at body line ${i + 1}`)
      i++
      const hunks: Hunk[] = []
      let current: Hunk | null = null
      const flush = () => {
        if (current && current.body.length > 0) hunks.push(current)
        current = null
      }
      while (i < body.length && !body[i].startsWith('*** ')) {
        const ln = body[i]
        if (ln.startsWith('@@')) {
          flush()
          current = { anchor: ln.slice(2).trim() || undefined, body: [] }
          i++
          continue
        }
        if (ln === '') {
          // Empty raw line is treated as a context line of "" (blank line
          // in the source file). Models often produce this.
          if (!current) current = { body: [] }
          current.body.push({ tag: 'keep', text: '' })
          i++
          continue
        }
        const tag = ln[0]
        const rest = ln.slice(1)
        if (tag === '+') {
          if (!current) current = { body: [] }
          current.body.push({ tag: 'add', text: rest })
        } else if (tag === '-') {
          if (!current) current = { body: [] }
          current.body.push({ tag: 'remove', text: rest })
        } else if (tag === ' ') {
          if (!current) current = { body: [] }
          current.body.push({ tag: 'keep', text: rest })
        } else {
          throw new Error(
            `Update File "${path}": unexpected line prefix ${JSON.stringify(tag)} at body line ${i + 1}; expected "+", "-", " ", or "@@"`
          )
        }
        i++
      }
      flush()
      if (hunks.length === 0) {
        throw new Error(`Update File "${path}": no hunks found`)
      }
      ops.push({ kind: 'update', path, hunks })
      continue
    }

    throw new Error(`unrecognized directive at body line ${i + 1}: ${JSON.stringify(line)}`)
  }

  if (ops.length === 0) throw new Error('patch contains no file operations')
  return ops
}

/**
 * Apply a single update hunk to a list of file lines. Returns the new
 * line list, or throws if the hunk's context+deletion block can't be
 * located in order.
 */
function applyHunk(fileLines: string[], hunk: Hunk, hunkIndex: number): string[] {
  // Build the "expected" block (keep + remove, in order) and the
  // "replacement" block (keep + add). Then scan fileLines for the
  // expected block and splice in the replacement.
  const expected: string[] = []
  const replacement: string[] = []
  for (const b of hunk.body) {
    if (b.tag === 'keep') {
      expected.push(b.text)
      replacement.push(b.text)
    } else if (b.tag === 'remove') {
      expected.push(b.text)
    } else {
      replacement.push(b.text)
    }
  }

  if (expected.length === 0) {
    // Pure-add hunk with no context. Append at end of file — this is a
    // last-resort behavior; models should provide an anchor or context.
    return [...fileLines, ...replacement]
  }

  // Scan for an exact match of `expected` in `fileLines`.
  const max = fileLines.length - expected.length
  for (let start = 0; start <= max; start++) {
    let ok = true
    for (let j = 0; j < expected.length; j++) {
      if (fileLines[start + j] !== expected[j]) {
        ok = false
        break
      }
    }
    if (ok) {
      return [
        ...fileLines.slice(0, start),
        ...replacement,
        ...fileLines.slice(start + expected.length)
      ]
    }
  }
  throw new Error(`patch did not apply at hunk ${hunkIndex + 1}`)
}

/**
 * Apply parsed ops to disk. Performs path validation before any write.
 * On any error after validation, partial application may have occurred —
 * the model gets a clear error and the caller can decide to surface a
 * recovery prompt. We do not transactionally roll back.
 */
function applyOps(ops: FileOp[], workspaceRoot: string): string[] {
  // Pre-validate all paths before touching disk so a typo in the third
  // op doesn't leave the first two half-applied where avoidable.
  const resolved: { op: FileOp; abs: string }[] = []
  for (const op of ops) {
    const abs = resolvePathWithinWorkspace(workspaceRoot, op.path)
    if (abs === null) {
      throw new Error(`path "${op.path}" escapes the workspace root or is invalid`)
    }
    if (op.kind === 'add' && existsSync(abs)) {
      throw new Error(`Add File "${op.path}": file already exists`)
    }
    if ((op.kind === 'update' || op.kind === 'delete') && !existsSync(abs)) {
      throw new Error(`${op.kind === 'update' ? 'Update' : 'Delete'} File "${op.path}": file does not exist`)
    }
    resolved.push({ op, abs })
  }

  const summary: string[] = []
  for (const { op, abs } of resolved) {
    if (op.kind === 'add') {
      mkdirSync(dirname(abs), { recursive: true })
      // Re-join with `\n`; trailing newline if the patch had one (i.e.
      // the body wasn't empty). Matches typical text-file convention.
      const content = op.lines.join('\n') + (op.lines.length > 0 ? '\n' : '')
      writeFileSync(abs, content, 'utf8')
      summary.push(`+ ${op.path}`)
    } else if (op.kind === 'delete') {
      unlinkSync(abs)
      summary.push(`- ${op.path}`)
    } else {
      const raw = readFileSync(abs, 'utf8')
      // Preserve trailing-newline behavior: split, apply, rejoin with the
      // same newline policy. If the file had a trailing newline, the split
      // produces an empty final element which we restore.
      const hadTrailingNl = raw.endsWith('\n')
      const fileLines = raw.split('\n')
      if (hadTrailingNl) fileLines.pop()
      let next = fileLines
      for (let h = 0; h < op.hunks.length; h++) {
        next = applyHunk(next, op.hunks[h], h)
      }
      const out = next.join('\n') + (hadTrailingNl ? '\n' : '')
      writeFileSync(abs, out, 'utf8')
      summary.push(`~ ${op.path}`)
    }
  }
  return summary
}

/**
 * Entry point. Parses, validates, applies. Returns a structured result
 * the registration handler can stringify for the model. All errors are
 * surfaced as `Error: <reason>` strings — never thrown — so the tool
 * round trip completes normally.
 */
export async function executeApplyPatch(
  args: ApplyPatchArgs,
  workspaceRoot: string
): Promise<ApplyPatchResult> {
  try {
    const ops = parsePatch(args?.patch ?? '')
    const summary = applyOps(ops, workspaceRoot)
    const adds = ops.filter((o) => o.kind === 'add').length
    const updates = ops.filter((o) => o.kind === 'update').length
    const deletes = ops.filter((o) => o.kind === 'delete').length
    const header = `Applied ${ops.length} change(s): +${adds}, ~${updates}, -${deletes}`
    return { result: [header, ...summary].join('\n') }
  } catch (err: any) {
    return { result: `Error: ${err?.message ?? String(err)}` }
  }
}
