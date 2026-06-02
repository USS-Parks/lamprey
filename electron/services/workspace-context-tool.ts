import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { isAbsolute, relative, resolve } from 'path'

import { runGit } from './git-runner'
import { resolveWorkspaceRelative } from './path-utils'

// Codex-style workspace preflight. One read-only call returns:
//   - cwd
//   - git: branch, ahead/behind, dirty, capped list of changed files
//   - package: name + version + scripts (when package.json is present)
//   - frameworks: detected from dependency names
//   - instructionFiles: AGENTS.md / CLAUDE.md / README.md / CONTRIBUTING.md
//   - verificationCommands: scripts that look like verify commands, plus
//     direct `npx tsc --noEmit -p <tsconfig>` lines for multi-tsconfig repos
//     when no typecheck script exists
//
// The point is one tool call early in a coding task that answers "where am
// I, what's the state, and what should I run to verify?" — so the model
// doesn't have to launch four separate reads (ls / package.json / git
// status / instruction file). Pure functions throughout so the parser
// helpers test without spawning git.

export interface WorkspaceContextArgs {
  cwd?: string
  cap_bytes?: number
}

const DEFAULT_CAP = 8192
const MAX_CAP = 32768
const CHANGED_FILES_CAP = 20
const VERIFY_CMD_CAP = 8

// Subset that earns the "framework" label. Order is stable so tests can
// pin it; matching is by exact package name (including @scope/name forms).
const KNOWN_FRAMEWORKS: Array<{ pkg: string; label: string }> = [
  { pkg: 'react', label: 'react' },
  { pkg: 'vue', label: 'vue' },
  { pkg: 'svelte', label: 'svelte' },
  { pkg: 'next', label: 'nextjs' },
  { pkg: 'nuxt', label: 'nuxt' },
  { pkg: 'electron', label: 'electron' },
  { pkg: 'vite', label: 'vite' },
  { pkg: 'webpack', label: 'webpack' },
  { pkg: 'rollup', label: 'rollup' },
  { pkg: 'tailwindcss', label: 'tailwindcss' },
  { pkg: 'typescript', label: 'typescript' },
  { pkg: 'jest', label: 'jest' },
  { pkg: 'vitest', label: 'vitest' },
  { pkg: 'mocha', label: 'mocha' },
  { pkg: 'eslint', label: 'eslint' },
  { pkg: 'prettier', label: 'prettier' },
  { pkg: '@angular/core', label: 'angular' },
  { pkg: 'express', label: 'express' },
  { pkg: 'fastify', label: 'fastify' },
  { pkg: '@nestjs/core', label: 'nestjs' },
  { pkg: 'hono', label: 'hono' }
]

const INSTRUCTION_FILE_NAMES = [
  'AGENTS.md',
  'agents.md',
  'Agents.md',
  'CLAUDE.md',
  'README.md',
  'Readme.md',
  'readme.md',
  'CONTRIBUTING.md'
]

// Scripts that look like verification commands. Allows colon-suffixed
// variants ("typecheck:web", "test:e2e") so multi-config repos surface.
const VERIFY_SCRIPT_PATTERNS =
  /^(test|typecheck|type-check|type:check|lint|check|verify|format|tsc)(:.*)?$/i

const TSCONFIG_NAME_PATTERN = /^tsconfig(\.[\w-]+)?\.json$/

export interface PackageManifest {
  name?: string
  version?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export interface GitSummary {
  branch: string | null
  isDirty: boolean
  ahead: number
  behind: number
  changedFiles: Array<{ status: string; path: string }>
  totalChanged: number
  truncated: boolean
  error?: string
}

export interface WorkspaceContextResult {
  cwd: string
  git: GitSummary
  package: { name?: string; version?: string; scripts: Record<string, string> } | null
  frameworks: string[]
  instructionFiles: string[]
  verificationCommands: string[]
  notes: string[]
}

// ──────────────────────────── helpers ────────────────────────────

export function resolveInsideWorkspace(
  workspaceRoot: string,
  candidate: string | undefined
): string | null {
  if (!candidate || candidate.trim() === '') return resolve(workspaceRoot)
  const absolute = resolveWorkspaceRelative(candidate, workspaceRoot)
  const rel = relative(resolve(workspaceRoot), absolute)
  if (rel === '') return absolute
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return absolute
}

export function readPackageManifest(cwd: string): PackageManifest | null {
  const p = resolve(cwd, 'package.json')
  if (!existsSync(p)) return null
  try {
    const raw = readFileSync(p, 'utf8')
    const json = JSON.parse(raw)
    return json as PackageManifest
  } catch {
    return null
  }
}

export function detectFrameworks(pkg: PackageManifest | null): string[] {
  if (!pkg) return []
  const all: Record<string, string> = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {})
  }
  const found: string[] = []
  for (const { pkg: name, label } of KNOWN_FRAMEWORKS) {
    if (name in all) found.push(label)
  }
  return found
}

export function findInstructionFiles(cwd: string): string[] {
  const found = new Set<string>()
  for (const name of INSTRUCTION_FILE_NAMES) {
    const p = resolve(cwd, name)
    try {
      if (existsSync(p) && statSync(p).isFile()) {
        // Normalize Capitalised variants under a single canonical label.
        const lower = name.toLowerCase()
        if (lower === 'agents.md') found.add('AGENTS.md')
        else if (lower === 'readme.md') found.add('README.md')
        else found.add(name)
      }
    } catch {
      // ignore
    }
  }
  return Array.from(found)
}

export function inferVerificationCommands(
  cwd: string,
  pkg: PackageManifest | null
): string[] {
  const cmds: string[] = []
  const haveTypecheckScript =
    !!pkg?.scripts &&
    Object.keys(pkg.scripts).some((n) => /^typecheck|^type-check|^type:check/i.test(n))

  if (pkg?.scripts) {
    for (const name of Object.keys(pkg.scripts)) {
      if (VERIFY_SCRIPT_PATTERNS.test(name)) {
        cmds.push(name === 'test' ? 'npm test' : `npm run ${name}`)
      }
    }
  }

  // Only surface direct tsc invocations when the repo lacks a typecheck
  // script — projects with multi-root tsconfigs (like Lamprey itself) often
  // skip the npm script and rely on the model knowing the file names.
  if (!haveTypecheckScript) {
    try {
      const entries = readdirSync(cwd)
      for (const entry of entries) {
        if (TSCONFIG_NAME_PATTERN.test(entry)) {
          cmds.push(`npx tsc --noEmit -p ${entry}`)
        }
      }
    } catch {
      // ignore
    }
  }

  // De-dup while preserving order, then cap.
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const c of cmds) {
    if (!seen.has(c)) {
      seen.add(c)
      deduped.push(c)
    }
  }
  return deduped.slice(0, VERIFY_CMD_CAP)
}

export function parseGitStatusOutput(stdout: string): Omit<GitSummary, 'error'> {
  const lines = stdout.split(/\r?\n/).filter((l) => l.length > 0)
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  const files: Array<{ status: string; path: string }> = []
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const rest = line.slice(3)
      const upstreamIdx = rest.indexOf('...')
      const branchPart = upstreamIdx >= 0 ? rest.slice(0, upstreamIdx) : rest.split(/\s/)[0]
      branch = branchPart.trim() || null
      const aheadMatch = rest.match(/ahead (\d+)/)
      const behindMatch = rest.match(/behind (\d+)/)
      if (aheadMatch) ahead = Number(aheadMatch[1])
      if (behindMatch) behind = Number(behindMatch[1])
      continue
    }
    if (line.length >= 3) {
      const xy = line.slice(0, 2)
      const path = line.slice(3)
      files.push({ status: xy.trim() === '' ? xy : xy.trim(), path })
    }
  }
  const totalChanged = files.length
  const truncated = totalChanged > CHANGED_FILES_CAP
  return {
    branch,
    isDirty: totalChanged > 0,
    ahead,
    behind,
    changedFiles: files.slice(0, CHANGED_FILES_CAP),
    totalChanged,
    truncated
  }
}

async function summarizeGitStatus(cwd: string): Promise<GitSummary> {
  const r = await runGit(['status', '--porcelain=v1', '--branch'], cwd)
  if (r.code !== 0) {
    return {
      branch: null,
      isDirty: false,
      ahead: 0,
      behind: 0,
      changedFiles: [],
      totalChanged: 0,
      truncated: false,
      error: r.stderr.trim() || 'git status failed (not a git repository?)'
    }
  }
  return parseGitStatusOutput(r.stdout)
}

// ──────────────────────────── executor ────────────────────────────

export async function executeWorkspaceContext(
  args: WorkspaceContextArgs | undefined,
  workspaceRoot: string
): Promise<string> {
  const requestedCwd = resolveInsideWorkspace(workspaceRoot, args?.cwd)
  if (!requestedCwd) {
    // Throw so chat.ts catches and records an error audit status. Returning
    // a JSON body with an `error` field would slip through the legacy
    // classifier as a green success.
    throw new Error(`workspace_context: cwd "${args?.cwd}" resolves outside the workspace root.`)
  }
  const capBytes =
    typeof args?.cap_bytes === 'number' && args.cap_bytes > 0
      ? Math.min(args.cap_bytes, MAX_CAP)
      : DEFAULT_CAP

  const pkg = readPackageManifest(requestedCwd)
  const frameworks = detectFrameworks(pkg)
  const instructionFiles = findInstructionFiles(requestedCwd)
  const git = await summarizeGitStatus(requestedCwd)
  const verificationCommands = inferVerificationCommands(requestedCwd, pkg)

  const result: WorkspaceContextResult = {
    cwd: requestedCwd,
    git,
    package: pkg
      ? {
          name: pkg.name,
          version: pkg.version,
          scripts: pkg.scripts ?? {}
        }
      : null,
    frameworks,
    instructionFiles,
    verificationCommands,
    notes: []
  }

  let json = JSON.stringify(result, null, 2)

  // Two-stage size collapse so the cap survives unusually dirty trees.
  if (json.length > capBytes && result.git.changedFiles.length > 5) {
    result.git.changedFiles = result.git.changedFiles.slice(0, 5)
    result.git.truncated = true
    result.notes.push(
      `changedFiles truncated to first 5 (workspace has ${result.git.totalChanged} changed)`
    )
    json = JSON.stringify(result, null, 2)
  }
  if (json.length > capBytes) {
    json = json.slice(0, Math.max(0, capBytes - 32)) + '\n[… truncated …]'
  }
  return json
}
