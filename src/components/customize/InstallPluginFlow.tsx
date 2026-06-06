import { useEffect, useMemo, useState } from 'react'
import type { DiscoveredCcPlugin, PluginManifest } from '@/lib/types'
import { toast } from '@/stores/toast-store'
import { usePluginsStore } from '@/stores/plugins-store'
import { useCcImportStore } from '@/stores/cc-import-store'

export type InstallPluginFlowTab = 'directory' | 'manifest' | 'bundled' | 'cc-import'

interface InstallPluginFlowProps {
  onClose: () => void
  /** Which tab is selected on first paint. Defaults to 'directory'. */
  initialTab?: InstallPluginFlowTab
}

type Tab = InstallPluginFlowTab

// Skills with well-known external tooling dependencies. Surface a one-line
// disclosure in the CC-import tab so users aren't surprised when, e.g.,
// the `docx` skill calls out to `pandoc` and gets nothing.
const EXTERNAL_TOOL_NOTES: Record<string, string> = {
  docx: 'needs `pandoc`, `python` (scripts/)',
  pdf: 'needs `extract-text`, `python`',
  pptx: 'needs `python` (pptxgenjs scripts)',
  xlsx: 'needs `python` (openpyxl)',
  'web-artifacts-builder': 'shadcn/ui scaffolding scripts'
}

const MANIFEST_PLACEHOLDER = `{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "One-sentence summary.",
  "version": "0.1.0",
  "category": "Custom",
  "files": {
    "skills/example.md": "---\\nname: example\\ndescription: A skill that does something useful.\\n---\\n\\nWhen invoked, do the thing."
  }
}`

export function InstallPluginFlow({ onClose, initialTab }: InstallPluginFlowProps) {
  const pickDirectoryAndInstall = usePluginsStore((s) => s.pickDirectoryAndInstall)
  const installedPlugins = usePluginsStore((s) => s.plugins)
  const ccDiscovered = useCcImportStore((s) => s.discovered)
  const ccLoading = useCcImportStore((s) => s.loading)
  const ccPending = useCcImportStore((s) => s.pendingByPath)
  const ccRefresh = useCcImportStore((s) => s.refresh)
  const ccInstall = useCcImportStore((s) => s.install)
  const ccPickExtra = useCcImportStore((s) => s.pickExtraRootAndRefresh)

  const [tab, setTab] = useState<Tab>(initialTab ?? 'directory')
  const [manifestText, setManifestText] = useState(MANIFEST_PLACEHOLDER)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bundled, setBundled] = useState<PluginManifest[]>([])
  const [bundledLoading, setBundledLoading] = useState(false)

  useEffect(() => {
    setError(null)
  }, [manifestText, tab])

  const loadBundled = useMemo(
    () => async () => {
      if (!window.api?.plugins?.listBundledAvailable) return
      setBundledLoading(true)
      try {
        const result = await window.api.plugins.listBundledAvailable()
        if (result.success) setBundled((result.data as PluginManifest[]) ?? [])
      } finally {
        setBundledLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (tab === 'bundled') void loadBundled()
  }, [tab, loadBundled])

  useEffect(() => {
    // Discovery is on-demand: only run when the user opens the CC tab
    // (or the dialog opens with cc-import as initialTab) and only when
    // we don't already have a snapshot.
    if (tab !== 'cc-import') return
    if (ccDiscovered !== null) return
    void ccRefresh()
  }, [tab, ccDiscovered, ccRefresh])

  const installedPluginIds = useMemo(
    () => new Set(installedPlugins.map((p) => p.manifest.id)),
    [installedPlugins]
  )

  function slugifyForPreview(name: string): string {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!base || !/^[a-z0-9]/.test(base)) return `cc-${base || 'plugin'}`
    return base
  }

  const onInstallDirectory = async () => {
    setBusy(true)
    try {
      const r = await pickDirectoryAndInstall()
      if (r.ok) {
        onClose()
      } else if (r.error) {
        setError(r.error)
      }
    } finally {
      setBusy(false)
    }
  }

  const onInstallManifest = async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(manifestText)
    } catch (err) {
      setError(`Not valid JSON: ${(err as Error).message}`)
      return
    }
    if (!parsed || typeof parsed !== 'object') {
      setError('Manifest must be a JSON object')
      return
    }
    const obj = parsed as Record<string, unknown>
    const files = (obj.files ?? undefined) as Record<string, string> | undefined
    const manifest = { ...obj }
    delete manifest.files
    setBusy(true)
    try {
      if (!window.api?.plugins?.installFromManifest) {
        setError('Plugins API missing')
        return
      }
      const result = await window.api.plugins.installFromManifest(manifest, files)
      if (result.success) {
        toast.success(`Installed plugin "${(result.data as { id?: string })?.id ?? ''}"`)
        onClose()
      } else {
        setError(result.error)
      }
    } finally {
      setBusy(false)
    }
  }

  const onInstallCcBundle = async (plugin: DiscoveredCcPlugin, overwrite: boolean) => {
    const result = await ccInstall(plugin.sourcePath, overwrite)
    if (result.ok) onClose()
  }

  const onInstallBundled = async (id: string) => {
    setBusy(true)
    try {
      if (!window.api?.plugins?.installBundled) return
      const result = await window.api.plugins.installBundled(id)
      if (result.success) {
        toast.success(`Installed bundled plugin "${id}"`)
        await loadBundled()
      } else {
        setError(result.error)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex h-[620px] w-[700px] flex-col overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--bg-secondary)] shadow-2xl">
        <header className="flex h-12 shrink-0 items-center border-b border-[var(--panel-border)] px-4">
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">
            Install plugin
          </span>
          <div className="ml-3 flex items-center gap-1">
            {(['directory', 'manifest', 'bundled', 'cc-import'] as const).map((id) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`rounded px-2 py-0.5 text-[12px] capitalize ${
                  tab === id
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                }`}
              >
                {id === 'directory'
                  ? 'From directory'
                  : id === 'manifest'
                    ? 'Paste manifest'
                    : id === 'bundled'
                      ? 'Bundled catalog'
                      : 'From Claude Code'}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'directory' && (
            <div className="space-y-3">
              <p className="text-[13px] text-[var(--text-primary)]">
                Pick a directory containing a valid <code>plugin.json</code>. Lamprey will
                copy it into the plugins folder and load it immediately.
              </p>
              <p className="text-[12px] text-[var(--text-secondary)]">
                The directory must contain a top-level <code>plugin.json</code> with at
                least <code>id</code>, <code>name</code>, <code>description</code>, and
                <code> version</code>. Sibling <code>skills/</code>, <code>slash-commands/</code>,
                and <code>connectors.json</code> are picked up automatically.
              </p>
              <button
                onClick={() => void onInstallDirectory()}
                disabled={busy}
                className="rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Picking…' : 'Pick directory'}
              </button>
            </div>
          )}

          {tab === 'manifest' && (
            <div className="space-y-3">
              <p className="text-[12px] text-[var(--text-secondary)]">
                Paste a JSON object with the manifest fields. Optionally include a{' '}
                <code>files</code> map keyed by relative path; each value becomes a file
                under the new plugin directory (e.g. <code>skills/foo.md</code>).
              </p>
              <textarea
                value={manifestText}
                onChange={(e) => setManifestText(e.target.value)}
                spellCheck={false}
                rows={18}
                className="w-full resize-y rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-2 font-mono text-[12px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </div>
          )}

          {tab === 'bundled' && (
            <div className="space-y-3">
              <p className="text-[12px] text-[var(--text-secondary)]">
                Bundled plugins ship with Lamprey. Anything you removed earlier appears
                here so you can re-install it without rebuilding the app.
              </p>
              {bundledLoading && (
                <div className="text-[12px] text-[var(--text-muted)]">Loading…</div>
              )}
              {!bundledLoading && bundled.length === 0 && (
                <div className="text-[12px] text-[var(--text-muted)]">
                  No bundled plugins are missing from the installed set.
                </div>
              )}
              {bundled.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-[var(--text-primary)]">
                        {entry.name}
                      </span>
                      <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                        v{entry.version}
                      </span>
                      {entry.category && (
                        <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-[var(--accent)]">
                          {entry.category}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                      {entry.description}
                    </p>
                  </div>
                  <button
                    onClick={() => void onInstallBundled(entry.id)}
                    disabled={busy}
                    className="shrink-0 rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-[11px] text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Install
                  </button>
                </div>
              ))}
            </div>
          )}

          {tab === 'cc-import' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <p className="flex-1 text-[12px] text-[var(--text-secondary)]">
                  Lamprey can adopt Claude Code skill bundles stored on this machine and
                  install them as Lamprey plugins. Each bundle's skills appear in the Skills
                  column namespaced as <code>&lt;plugin&gt;:&lt;skill&gt;</code>.
                </p>
                <button
                  onClick={() => void ccRefresh()}
                  disabled={ccLoading}
                  className="shrink-0 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] hover:border-[var(--accent)] disabled:opacity-50"
                  title="Re-scan disk"
                >
                  {ccLoading ? 'Scanning…' : '↻ Refresh'}
                </button>
                <button
                  onClick={() => void ccPickExtra()}
                  disabled={ccLoading}
                  className="shrink-0 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] hover:border-[var(--accent)] disabled:opacity-50"
                  title="Add another root to scan"
                >
                  + Add root
                </button>
              </div>

              <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-[11px] text-[var(--text-secondary)]">
                <div className="mb-1 font-medium text-[var(--text-primary)]">
                  What you're getting
                </div>
                Skill bodies (the SKILL.md prompt instructions) work out of the box. Skills
                that shell out — e.g. <code>docx</code>, <code>pdf</code>, <code>pptx</code>,
                <code> xlsx</code> — call external tools like <code>pandoc</code>,
                <code> python</code>, and <code>extract-text</code>. Install those separately
                if you want the full skill behaviour. Built-in Claude Code skills bundled
                inside <code>claude.exe</code> (verify, code-review, simplify, run, …) live
                inside the binary and aren't importable; Lamprey ships its own equivalents
                under <code>resources/skills/</code>.
              </div>

              {ccLoading && (
                <div className="text-[12px] text-[var(--text-muted)]">Scanning…</div>
              )}

              {!ccLoading && ccDiscovered !== null && ccDiscovered.length === 0 && (
                <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-4 text-center text-[12px] text-[var(--text-muted)]">
                  No Claude Code skill bundles found on disk. They normally live under
                  <code className="mx-1">%APPDATA%\Claude\local-agent-mode-sessions\skills-plugin\</code>
                  on Windows. Use "+ Add root" if your bundle is elsewhere.
                </div>
              )}

              {!ccLoading &&
                ccDiscovered?.map((plugin) => {
                  const id = slugifyForPreview(plugin.pluginName)
                  const installed = installedPluginIds.has(id)
                  const pending = !!ccPending[plugin.sourcePath]
                  return (
                    <div
                      key={plugin.sourcePath}
                      className="flex flex-col gap-2 rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[13px] font-medium text-[var(--text-primary)]">
                              {plugin.pluginName}
                            </span>
                            <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                              v{plugin.version}
                            </span>
                            <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-[var(--accent)]">
                              {plugin.skills.length} skill
                              {plugin.skills.length === 1 ? '' : 's'}
                            </span>
                            {installed && (
                              <span className="rounded border border-[var(--success)] bg-[var(--success)]/10 px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-[var(--success)]">
                                installed
                              </span>
                            )}
                          </div>
                          {plugin.description && (
                            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                              {plugin.description}
                            </p>
                          )}
                          <div
                            className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]"
                            title={plugin.sourcePath}
                          >
                            {plugin.sourcePath}
                          </div>
                        </div>
                        <button
                          onClick={() => void onInstallCcBundle(plugin, installed)}
                          disabled={pending}
                          className="shrink-0 rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-[11px] text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {pending
                            ? 'Importing…'
                            : installed
                              ? 'Re-sync'
                              : 'Install'}
                        </button>
                      </div>

                      <details className="text-[11px] text-[var(--text-secondary)]">
                        <summary className="cursor-pointer select-none text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                          Show skills ({plugin.skills.length})
                        </summary>
                        <ul className="mt-1.5 space-y-1.5 pl-3">
                          {plugin.skills.map((s) => (
                            <li key={s.slug} className="flex items-start gap-2">
                              <span
                                className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                                  s.enabled
                                    ? 'bg-[var(--success)]'
                                    : 'bg-[var(--text-muted)]'
                                }`}
                                title={s.enabled ? 'enabled in CC' : 'disabled in CC'}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-mono text-[11px] text-[var(--text-primary)]">
                                    {s.slug}
                                  </span>
                                  {s.supportingFileCount > 0 && (
                                    <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0 font-mono text-[9px] text-[var(--text-muted)]">
                                      +{s.supportingFileCount} file
                                      {s.supportingFileCount === 1 ? '' : 's'}
                                    </span>
                                  )}
                                  {EXTERNAL_TOOL_NOTES[s.slug] && (
                                    <span
                                      className="rounded bg-[var(--warning)]/15 px-1 py-0 text-[10px] text-[var(--warning)]"
                                      title={`External tooling: ${EXTERNAL_TOOL_NOTES[s.slug]}`}
                                    >
                                      ext
                                    </span>
                                  )}
                                </div>
                                {s.description && (
                                  <div className="text-[10px] leading-snug text-[var(--text-muted)]">
                                    {s.description}
                                  </div>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  )
                })}
            </div>
          )}

          {error && (
            <div className="mt-3 rounded border border-[var(--error)] bg-[var(--error)]/10 px-2 py-1.5 text-[11px] text-[var(--error)]">
              {error}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-[var(--panel-border)] px-4 py-3">
          <button
            onClick={onClose}
            className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-3 py-1.5 text-[12px] hover:border-[var(--accent)]"
          >
            Close
          </button>
          <div className="flex-1" />
          {tab === 'manifest' && (
            <button
              onClick={() => void onInstallManifest()}
              disabled={busy}
              className="rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Installing…' : 'Install'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
