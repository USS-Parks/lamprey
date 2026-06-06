import { create } from 'zustand'
import type { CcImportResult, DiscoveredCcPlugin } from '@/lib/types'
import { toast } from '@/stores/toast-store'

// Skill Import Phase I4 — renderer state holder for the Claude Code
// skill-bundle importer. The store owns three things:
//   1. The most recent discovery snapshot (with per-plugin loading state)
//   2. The last install result (for toast / "Re-sync" affordances)
//   3. A `pendingByPath` map so the UI can disable an "Install" button
//      while its import is in flight without re-rendering the whole list.
//
// Discovery is on-demand: the renderer calls `refresh()` when the user
// opens the "From Claude Code" tab and again on user-triggered re-scan.
// We don't auto-refresh on a timer — discovery hits disk and there's
// no notification channel from CC's data dir.

interface CcImportState {
  /** Last discovery result, or null if discovery hasn't run yet. */
  discovered: DiscoveredCcPlugin[] | null
  /** True while a discovery is in flight. */
  loading: boolean
  /** Source paths currently being installed (so the UI can disable per-card buttons). */
  pendingByPath: Record<string, boolean>
  /** Last install result, kept so the UI can show a follow-up toast or
   *  surface the imported-id in the Plugins column. */
  lastResult: CcImportResult | null
  /** Last error from discovery or install. Surfaced as a toast on first
   *  observation; cleared on next successful action. */
  error: string | null

  /** Re-run discovery. Returns the discovered count so callers can show
   *  an empty-state CTA when zero bundles are found. */
  refresh: (extraRoots?: string[]) => Promise<number>

  /** Install (or re-import with `overwrite: true`) a discovered bundle. */
  install: (
    sourcePath: string,
    overwrite?: boolean
  ) => Promise<{ ok: boolean; pluginId?: string; error?: string; bundleSkippedReason?: string }>

  /** Prompt for an additional roots directory and re-discover including it. */
  pickExtraRootAndRefresh: () => Promise<number>
}

export const useCcImportStore = create<CcImportState>((set, get) => ({
  discovered: null,
  loading: false,
  pendingByPath: {},
  lastResult: null,
  error: null,

  refresh: async (extraRoots) => {
    if (!window.api?.ccImport) {
      const msg = 'ccImport API not available in this environment'
      set({ error: msg })
      return 0
    }
    set({ loading: true, error: null })
    try {
      const result = await window.api.ccImport.discover(
        extraRoots && extraRoots.length ? { extraRoots } : {}
      )
      if (!result.success) {
        set({ loading: false, error: result.error })
        toast.error(`Skill discovery failed: ${result.error}`)
        return 0
      }
      const data = (result.data as DiscoveredCcPlugin[]) ?? []
      set({ discovered: data, loading: false })
      return data.length
    } catch (err) {
      const msg = (err as Error).message
      set({ loading: false, error: msg })
      toast.error(`Skill discovery failed: ${msg}`)
      return 0
    }
  },

  install: async (sourcePath, overwrite) => {
    if (!window.api?.ccImport) return { ok: false, error: 'ccImport API not available' }
    set((s) => ({ pendingByPath: { ...s.pendingByPath, [sourcePath]: true }, error: null }))
    try {
      const result = await window.api.ccImport.install({
        sourcePath,
        ...(overwrite ? { overwrite: true } : {})
      })
      if (!result.success) {
        const reason = (result as { bundleSkippedReason?: string }).bundleSkippedReason
        const out: { ok: boolean; error?: string; bundleSkippedReason?: string } = {
          ok: false,
          error: result.error
        }
        if (reason) out.bundleSkippedReason = reason
        if (reason === 'already-installed') {
          toast.info(`Already imported — use "Re-sync" to overwrite.`)
        } else {
          toast.error(`Import failed: ${result.error}`)
        }
        return out
      }
      const data = result.data as CcImportResult
      set({ lastResult: data })
      toast.success(
        `Imported "${data.pluginId}" with ${data.skillsImported.length} skill${
          data.skillsImported.length === 1 ? '' : 's'
        }`
      )
      // Refresh discovery so UI badges flip to "installed".
      void get().refresh()
      return { ok: true, pluginId: data.pluginId }
    } catch (err) {
      const msg = (err as Error).message
      toast.error(`Import failed: ${msg}`)
      return { ok: false, error: msg }
    } finally {
      set((s) => {
        const next = { ...s.pendingByPath }
        delete next[sourcePath]
        return { pendingByPath: next }
      })
    }
  },

  pickExtraRootAndRefresh: async () => {
    if (!window.api?.ccImport) return 0
    const picked = await window.api.ccImport.pickExtraRoot()
    if (!picked.success) {
      toast.error(`Could not open directory picker: ${picked.error}`)
      return 0
    }
    const path = picked.data as string | null
    if (!path) return get().discovered?.length ?? 0
    return get().refresh([path])
  }
}))
