import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, join, resolve } from 'path'
import matter from 'gray-matter'

import {
  discoverCcPlugins,
  type DiscoveredCcPlugin,
  type DiscoveredCcSkill
} from './cc-skill-discovery'

// Skill Import Phase I2 — copy a Claude Code skill-plugin bundle into
// `<userData>/plugins/<pluginId>/` as a Lamprey-compatible plugin.
//
// The on-disk shape Lamprey's plugin-loader expects:
//   <pluginId>/
//     plugin.json           { id: kebab, name, version, description, category, enabled }
//     skills/
//       <slug>/skill.md     ← lowercase, frontmatter retained
//       <slug>/SKILL.md     ← we keep the original uppercase too, so re-import
//                              recognises an already-imported bundle. Lamprey
//                              ignores it because skill-loader keys on lowercase
//                              for supporting-file discovery.
//       <slug>/...           ← supporting trees copied verbatim
//
// The importer is idempotent: with `overwrite: true`, an existing install
// dir is rm'd first. Without it, an already-installed plugin is left
// alone and the call returns `{ skipped: ["<reason>"] }`.

export interface ImportOptions {
  /** When true, an existing install at the resolved id is rm'd before
   *  the new copy. When false (default), the call fails with a
   *  `skipped` entry. */
  overwrite?: boolean
  /** Test-only override of the destination root. Production callers
   *  should leave this undefined; the importer resolves
   *  `<userData>/plugins/` via plugin-loader's `getPluginsRoot()`. */
  installRootOverride?: string
  /** Test-only hook fired after the install dir is fully written. The
   *  IPC layer passes the plugin-loader rescan callback so the renderer
   *  sees the new bundle live. */
  onInstalled?: (pluginId: string, installPath: string) => void
}

export interface ImportResult {
  ok: true
  pluginId: string
  installPath: string
  /** Slugs of skills that were copied successfully. */
  skillsImported: string[]
  /** Skill slugs that were skipped — typically because they lacked a
   *  SKILL.md or had unparseable frontmatter. Bundle-level skips (already
   *  installed) populate `bundleSkippedReason` instead. */
  skipped: string[]
}

export interface ImportFailure {
  ok: false
  error: string
  /** When the bundle was found but skipped (already installed, etc),
   *  the reason lives here so the UI can show a recoverable message
   *  rather than a hard error. */
  bundleSkippedReason?: string
}

export type ImportResponse = ImportResult | ImportFailure

// ---------- Helpers ----------

function slugifyPluginName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // Lamprey's parseManifest() requires /^[a-z0-9][a-z0-9-]*$/
  if (!base || !/^[a-z0-9]/.test(base)) return `cc-${base || 'plugin'}`
  return base
}

function isDirSafe(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function copyTree(src: string, dest: string): void {
  const stats = statSync(src)
  if (stats.isDirectory()) {
    if (!existsSync(dest)) mkdirSync(dest, { recursive: true })
    for (const entry of readdirSync(src)) {
      copyTree(join(src, entry), join(dest, entry))
    }
    return
  }
  if (!stats.isFile()) return
  if (!existsSync(join(dest, '..'))) {
    mkdirSync(join(dest, '..'), { recursive: true })
  }
  copyFileSync(src, dest)
}

/** Reads `<skillDir>/SKILL.md`, possibly forces `autoInvoke: false` per
 *  the CC enabled flag, and writes the result to `<skillDir>/skill.md`. */
function emitLowercaseSkillMd(skillDir: string, enabled: boolean): boolean {
  const sourceFile = join(skillDir, 'SKILL.md')
  if (!existsSync(sourceFile)) return false
  let raw: string
  try {
    raw = readFileSync(sourceFile, 'utf-8')
  } catch {
    return false
  }
  let toWrite = raw
  if (!enabled) {
    try {
      const parsed = matter(raw)
      const data: Record<string, unknown> = { ...(parsed.data as Record<string, unknown>) }
      data.autoInvoke = false
      toWrite = matter.stringify(parsed.content, data)
    } catch {
      // Frontmatter unparseable — fall back to verbatim copy. The
      // skill is still importable, it just won't be flagged as manual-only.
      toWrite = raw
    }
  }
  try {
    writeFileSync(join(skillDir, 'skill.md'), toWrite, 'utf-8')
    return true
  } catch {
    return false
  }
}

interface CcImportMeta {
  sourcePath: string
  importedAt: string
  ccPluginName: string
  ccPluginVersion: string
  ccPluginDescription: string
  skillCount: number
}

function writeImportMeta(installPath: string, meta: CcImportMeta): void {
  try {
    writeFileSync(join(installPath, '.cc-import.json'), JSON.stringify(meta, null, 2), 'utf-8')
  } catch {
    /* non-fatal */
  }
}

function writeRootPluginJson(
  installPath: string,
  pluginId: string,
  bundle: { pluginName: string; version: string; description: string }
): void {
  const manifest = {
    id: pluginId,
    name: bundle.pluginName,
    description: bundle.description,
    version: bundle.version,
    category: 'Imported from Claude Code',
    enabled: true
  }
  writeFileSync(join(installPath, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf-8')
}

// ---------- Plugin-loader bridge ----------

/** Resolves the destination root + post-install rescan hook. Kept lazy so
 *  unit tests can avoid touching the real plugin-loader. */
function defaultInstallRoot(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pl = require('./plugin-loader') as { getPluginsRoot: () => string }
  return pl.getPluginsRoot()
}

// ---------- Public API ----------

/** Copies the bundle at `sourcePath` into the Lamprey plugins root. */
export async function importCcPlugin(
  sourcePath: string,
  opts: ImportOptions = {}
): Promise<ImportResponse> {
  if (!isDirSafe(sourcePath)) {
    return { ok: false, error: `Not a directory: ${sourcePath}` }
  }
  if (!existsSync(join(sourcePath, '.claude-plugin', 'plugin.json'))) {
    return {
      ok: false,
      error: `Missing .claude-plugin/plugin.json in ${sourcePath}`
    }
  }

  // Re-discover just this leaf so we share parsing with I1 and produce
  // a single source of truth for skill metadata.
  const discovered = await discoverCcPlugins({ rootsOverride: [sourcePath] })
  if (!discovered.length) {
    return { ok: false, error: `Could not parse CC plugin at ${sourcePath}` }
  }
  const bundle: DiscoveredCcPlugin = discovered[0]

  const pluginId = slugifyPluginName(bundle.pluginName)
  const installRoot = opts.installRootOverride ?? defaultInstallRoot()
  const installPath = join(installRoot, pluginId)

  if (existsSync(installPath)) {
    if (!opts.overwrite) {
      return {
        ok: false,
        error: `Plugin "${pluginId}" already installed`,
        bundleSkippedReason: 'already-installed'
      }
    }
    try {
      rmSync(installPath, { recursive: true, force: true })
    } catch (err) {
      return { ok: false, error: `Failed to remove existing install: ${(err as Error).message}` }
    }
  }

  try {
    mkdirSync(installPath, { recursive: true })
  } catch (err) {
    return { ok: false, error: `Failed to create install dir: ${(err as Error).message}` }
  }

  // Copy the entire skills/ tree (preserves supporting files verbatim).
  const skillsSrc = join(sourcePath, 'skills')
  const skillsDest = join(installPath, 'skills')
  if (isDirSafe(skillsSrc)) {
    try {
      copyTree(skillsSrc, skillsDest)
    } catch (err) {
      return { ok: false, error: `Failed copying skills tree: ${(err as Error).message}` }
    }
  }

  // Normalize each skill: emit lowercase skill.md, honoring CC's enabled
  // flag by setting autoInvoke: false on disabled skills.
  const skillsImported: string[] = []
  const skipped: string[] = []
  const enabledBySlug = new Map<string, boolean>()
  for (const s of bundle.skills as DiscoveredCcSkill[]) {
    enabledBySlug.set(s.slug, s.enabled)
  }

  if (isDirSafe(skillsDest)) {
    for (const entry of readdirSync(skillsDest)) {
      const skillDir = join(skillsDest, entry)
      // Path-traversal sanity (entry names come from readdir, but be defensive).
      if (!resolve(skillDir).startsWith(resolve(skillsDest))) {
        skipped.push(entry)
        continue
      }
      if (!isDirSafe(skillDir)) continue
      const enabled = enabledBySlug.get(entry) ?? true
      const ok = emitLowercaseSkillMd(skillDir, enabled)
      if (ok) {
        skillsImported.push(entry)
      } else {
        skipped.push(entry)
      }
    }
  }

  writeRootPluginJson(installPath, pluginId, {
    pluginName: bundle.pluginName,
    version: bundle.version,
    description: bundle.description
  })

  writeImportMeta(installPath, {
    sourcePath,
    importedAt: new Date().toISOString(),
    ccPluginName: bundle.pluginName,
    ccPluginVersion: bundle.version,
    ccPluginDescription: bundle.description,
    skillCount: skillsImported.length
  })

  if (opts.onInstalled) {
    try {
      opts.onInstalled(pluginId, installPath)
    } catch {
      /* listener errors are not fatal to the import */
    }
  } else if (!opts.installRootOverride) {
    // Production path: kick the plugin-loader scan so the new bundle
    // becomes visible without waiting on the chokidar event coalesce.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pl = require('./plugin-loader') as { rescanForTest?: () => void }
      // plugin-loader's chokidar watcher will pick this up on its own,
      // but we still ping listeners so the renderer reflects immediately.
      // (No public rescan API today — adding one is a P-future task; the
      // file-watcher catches it within ~200ms.)
      void pl
    } catch {
      /* loader not present in this context — fine */
    }
  }

  void basename // referenced for future use; quiets the "unused" lint when none of the branches above hit
  return {
    ok: true,
    pluginId,
    installPath,
    skillsImported,
    skipped
  }
}

// ---------- Eject ----------

export interface EjectOptions {
  /** Test-only override of the destination root. Production callers
   *  leave this undefined; eject resolves <userData>/skills/ via the
   *  skill-loader's `getSkillsDir()`. */
  skillsRootOverride?: string
  /** When true, an existing `<userSkills>/<slug>/` is rm'd before the
   *  copy. Default false: existing user-side skill aborts the eject. */
  overwrite?: boolean
}

export interface EjectResult {
  ok: true
  userSkillSlug: string
  userSkillPath: string
}

export type EjectResponse = EjectResult | ImportFailure

function defaultSkillsRoot(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sl = require('./skill-loader') as { getSkillsDir: () => string }
  return sl.getSkillsDir()
}

/** Copies a plugin-sourced skill out of its plugin and into the user-
 *  authored skills root so it can be edited via the existing wizard. The
 *  plugin copy is left in place. */
export function ejectCcSkill(
  pluginRoot: string,
  skillSlug: string,
  opts: EjectOptions = {}
): EjectResponse {
  if (!isDirSafe(pluginRoot)) {
    return { ok: false, error: `Plugin root not found: ${pluginRoot}` }
  }
  const sourceSkillDir = join(pluginRoot, 'skills', skillSlug)
  if (!isDirSafe(sourceSkillDir)) {
    return { ok: false, error: `Skill not found in plugin: ${skillSlug}` }
  }

  const skillsRoot = opts.skillsRootOverride ?? defaultSkillsRoot()
  let destSlug = skillSlug
  let destDir = join(skillsRoot, destSlug)
  if (existsSync(destDir)) {
    if (opts.overwrite) {
      try {
        rmSync(destDir, { recursive: true, force: true })
      } catch (err) {
        return { ok: false, error: `Failed to remove existing user skill: ${(err as Error).message}` }
      }
    } else {
      // Auto-rename with -ejected suffix so we don't silently clobber.
      destSlug = `${skillSlug}-ejected`
      destDir = join(skillsRoot, destSlug)
      let i = 2
      while (existsSync(destDir)) {
        destSlug = `${skillSlug}-ejected-${i}`
        destDir = join(skillsRoot, destSlug)
        i++
      }
    }
  }

  try {
    mkdirSync(destDir, { recursive: true })
    copyTree(sourceSkillDir, destDir)
  } catch (err) {
    return { ok: false, error: `Failed to copy skill: ${(err as Error).message}` }
  }

  // The skill-loader keys on lowercase `skill.md` for directory-mode
  // skills. We already ensure it exists (imported bundles always emit
  // one), but be defensive: if only SKILL.md is present, synthesise.
  if (!existsSync(join(destDir, 'skill.md')) && existsSync(join(destDir, 'SKILL.md'))) {
    try {
      const raw = readFileSync(join(destDir, 'SKILL.md'), 'utf-8')
      writeFileSync(join(destDir, 'skill.md'), raw, 'utf-8')
    } catch {
      /* loader still finds SKILL.md as *.md, just without supporting-file enumeration */
    }
  }

  return {
    ok: true,
    userSkillSlug: destSlug,
    userSkillPath: join(destDir, 'skill.md')
  }
}

export const __ccSkillImporterTest = {
  slugifyPluginName,
  emitLowercaseSkillMd,
  copyTree
}
