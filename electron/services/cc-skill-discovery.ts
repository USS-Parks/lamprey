import { homedir } from 'os'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'
import matter from 'gray-matter'

// Skill Import Phase I1 — discover Claude Code skill-plugin bundles on disk.
//
// CC stores skill bundles under
//   <CC_DATA_ROOT>/local-agent-mode-sessions/skills-plugin/<outer-id>/<inner-id>/
//
// Each leaf dir contains:
//   .claude-plugin/plugin.json   (required)
//   manifest.json                (optional — per-skill enabled flags)
//   skills/<slug>/SKILL.md       (frontmatter: name, description)
//   skills/<slug>/...             (supporting trees: scripts/, references/, ...)
//
// This service is pure read-only and electron-free so it can be unit-tested
// without main-process mocks. The IPC layer (I3) wraps it.

export interface DiscoveredCcSkill {
  /** Directory name under skills/. Used as the slug. */
  slug: string
  /** From SKILL.md frontmatter; falls back to slug if missing. */
  name: string
  /** From SKILL.md frontmatter; "" if missing. */
  description: string
  /** From the sibling manifest.json enabled list; defaults to true when
   *  the manifest doesn't list the skill or there's no manifest at all. */
  enabled: boolean
  /** Recursive count of files inside the skill dir other than SKILL.md
   *  itself. Surfaced to the UI as a "supporting tree size" hint. */
  supportingFileCount: number
}

export interface DiscoveredCcPlugin {
  /** Absolute path to the inner-session dir holding .claude-plugin/ and
   *  skills/. This is the path the importer copies from. */
  sourcePath: string
  /** From .claude-plugin/plugin.json — used to derive the Lamprey
   *  plugin id during import. */
  pluginName: string
  /** From .claude-plugin/plugin.json, or "0.0.0" if missing. */
  version: string
  /** From .claude-plugin/plugin.json, or "" if missing. */
  description: string
  /** Ordered alphabetically by slug. */
  skills: DiscoveredCcSkill[]
}

export interface DiscoverOptions {
  /** Additional roots to scan beyond the default CC data dirs. Each is
   *  treated like a `<CC_DATA_ROOT>/local-agent-mode-sessions/skills-plugin`
   *  candidate — i.e., we walk two levels deep below this path looking
   *  for `.claude-plugin/plugin.json`. */
  extraRoots?: string[]
  /** Override for tests. When provided, default OS roots are skipped. */
  rootsOverride?: string[]
}

interface CcPluginJson {
  name?: unknown
  version?: unknown
  description?: unknown
}

interface CcManifestJsonSkill {
  skillId?: unknown
  name?: unknown
  enabled?: unknown
}

interface CcManifestJson {
  skills?: unknown
}

/** Default skill-plugin roots per platform. Returns absolute paths that
 *  may or may not exist on disk; the caller filters non-existent ones. */
export function defaultCcSkillPluginRoots(): string[] {
  const home = homedir()
  const roots: string[] = []
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    if (appData) {
      roots.push(join(appData, 'Claude', 'local-agent-mode-sessions', 'skills-plugin'))
    }
  } else if (process.platform === 'darwin') {
    roots.push(
      join(home, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions', 'skills-plugin')
    )
  } else {
    roots.push(join(home, '.config', 'Claude', 'local-agent-mode-sessions', 'skills-plugin'))
  }
  return roots
}

function safeReadJson<T = unknown>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function isDirSafe(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function isFileSafe(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** Recursively counts files under `dir`, excluding any file named
 *  SKILL.md (case-insensitive) at the top level. Used as a UI hint
 *  for "how much supporting material does this skill carry". */
function countSupportingFiles(dir: string): number {
  let count = 0
  const walk = (cur: string, depth: number): void => {
    for (const entry of safeReaddir(cur)) {
      const full = join(cur, entry)
      if (isDirSafe(full)) {
        walk(full, depth + 1)
        continue
      }
      if (!isFileSafe(full)) continue
      // Skip the canonical SKILL.md at the top level only — nested files
      // named skill.md (unlikely) still count.
      if (depth === 0 && entry.toLowerCase() === 'skill.md') continue
      count++
    }
  }
  walk(dir, 0)
  return count
}

function readEnabledMap(innerDir: string): Map<string, boolean> {
  const m = new Map<string, boolean>()
  const manifest = safeReadJson<CcManifestJson>(join(innerDir, 'manifest.json'))
  if (!manifest || !Array.isArray(manifest.skills)) return m
  for (const raw of manifest.skills) {
    if (!raw || typeof raw !== 'object') continue
    const skill = raw as CcManifestJsonSkill
    const name = typeof skill.name === 'string' ? skill.name.trim() : ''
    if (!name) continue
    const enabled = typeof skill.enabled === 'boolean' ? skill.enabled : true
    m.set(name, enabled)
  }
  return m
}

function findSkillMdFile(skillDir: string): string | null {
  for (const entry of safeReaddir(skillDir)) {
    if (entry.toLowerCase() === 'skill.md') {
      const full = join(skillDir, entry)
      if (isFileSafe(full)) return full
    }
  }
  return null
}

function parseSkillFrontmatter(filePath: string): { name?: string; description?: string } {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = matter(raw)
    const out: { name?: string; description?: string } = {}
    if (typeof parsed.data.name === 'string') out.name = parsed.data.name.trim()
    if (typeof parsed.data.description === 'string')
      out.description = parsed.data.description.trim()
    return out
  } catch {
    return {}
  }
}

function discoverSkillsInBundle(innerDir: string): DiscoveredCcSkill[] {
  const skillsDir = join(innerDir, 'skills')
  if (!isDirSafe(skillsDir)) return []
  const enabledMap = readEnabledMap(innerDir)
  const out: DiscoveredCcSkill[] = []
  for (const entry of safeReaddir(skillsDir)) {
    const slug = entry
    const skillDir = join(skillsDir, entry)
    if (!isDirSafe(skillDir)) continue
    const skillFile = findSkillMdFile(skillDir)
    if (!skillFile) continue
    const fm = parseSkillFrontmatter(skillFile)
    const name = fm.name && fm.name.length > 0 ? fm.name : slug
    out.push({
      slug,
      name,
      description: fm.description ?? '',
      enabled: enabledMap.has(name) ? enabledMap.get(name)! : true,
      supportingFileCount: countSupportingFiles(skillDir)
    })
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug))
  return out
}

function parsePluginJson(innerDir: string): {
  pluginName: string
  version: string
  description: string
} | null {
  const pj = safeReadJson<CcPluginJson>(join(innerDir, '.claude-plugin', 'plugin.json'))
  if (!pj) return null
  const pluginName = typeof pj.name === 'string' && pj.name.trim() ? pj.name.trim() : ''
  if (!pluginName) return null
  const version = typeof pj.version === 'string' && pj.version.trim() ? pj.version.trim() : '0.0.0'
  const description = typeof pj.description === 'string' ? pj.description.trim() : ''
  return { pluginName, version, description }
}

/** A skills-plugin root may contain one or more outer-session dirs, each
 *  containing one or more inner-session dirs. We discover all valid leaves
 *  (those holding .claude-plugin/plugin.json) up to two levels deep. */
function discoverInRoot(root: string): DiscoveredCcPlugin[] {
  if (!isDirSafe(root)) return []
  const found: DiscoveredCcPlugin[] = []
  const tryLeaf = (dir: string): boolean => {
    const meta = parsePluginJson(dir)
    if (!meta) return false
    const skills = discoverSkillsInBundle(dir)
    found.push({
      sourcePath: dir,
      pluginName: meta.pluginName,
      version: meta.version,
      description: meta.description,
      skills
    })
    return true
  }
  // Layer 0: root itself might be the leaf (single-tenant install).
  if (tryLeaf(root)) return found
  // Layer 1 + 2: walk up to two levels under root.
  for (const lvl1 of safeReaddir(root)) {
    const lvl1Full = join(root, lvl1)
    if (!isDirSafe(lvl1Full)) continue
    if (tryLeaf(lvl1Full)) continue
    for (const lvl2 of safeReaddir(lvl1Full)) {
      const lvl2Full = join(lvl1Full, lvl2)
      if (!isDirSafe(lvl2Full)) continue
      tryLeaf(lvl2Full)
    }
  }
  return found
}

export async function discoverCcPlugins(
  opts: DiscoverOptions = {}
): Promise<DiscoveredCcPlugin[]> {
  const roots = opts.rootsOverride
    ? [...opts.rootsOverride]
    : [...defaultCcSkillPluginRoots(), ...(opts.extraRoots ?? [])]

  const seen = new Set<string>()
  const out: DiscoveredCcPlugin[] = []
  for (const root of roots) {
    for (const plugin of discoverInRoot(root)) {
      if (seen.has(plugin.sourcePath)) continue
      seen.add(plugin.sourcePath)
      out.push(plugin)
    }
  }
  out.sort((a, b) => a.pluginName.localeCompare(b.pluginName))
  return out
}

export const __ccSkillDiscoveryTest = {
  countSupportingFiles,
  readEnabledMap,
  parsePluginJson,
  discoverSkillsInBundle,
  discoverInRoot,
  defaultCcSkillPluginRoots,
  // exposed so tests can label the platform branch they care about
  basename
}
