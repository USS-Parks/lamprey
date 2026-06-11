// SP-1 (Sweet Spot Phase, 2026-06-10) — the canonical AppSettings defaults.
//
// Before this phase the default object was maintained BY HAND in two places —
// `src/stores/settings-store.ts` (renderer) and `electron/ipc/settings.ts`
// (main) — and had drifted on two keys: the renderer said `agentMode: 'auto'`
// (L8) while main said `'single'`, and main was missing
// `includePastReasoningInContext` entirely. Because `settings:get` merges
// `{...defaults, ...data}` main-side, the MAIN values silently won for any key
// the user never set. That is defect D1 in PLANNING/SP_BASELINE.md.
//
// This module is now the single source of truth for the main process. The
// renderer cannot import across the tsconfig project boundary (web includes
// `src/**` only; node includes `electron/**` only — see the WC-8 precedent of
// source-reading parity tests), so `src/stores/settings-store.ts` keeps a
// literal copy that `default-app-settings.test.ts` locks byte-for-byte against
// this object. Change a default here → the parity test names the renderer line
// that must move with it.
//
// Era values (Sweet Spot Phase §4 decision register):
//   agentMode 'single'  — the Opus 4.5-era product never auto-fanned a turn
//                         into a planner→coder→reviewer pipeline. 'auto' and
//                         'multi' remain one click away in Settings → Agents.
//   proofGate 'off'     — no trust-pill machinery on default turns.
//   toolSurface 'full'  — the model gets its full tool set every turn, like
//                         the era product. 'lazy' remains the MCP-heavy opt-in.

// UB-7 (Unburdening Phase, 2026-06-10) — `agentMode`, `agentRoster`,
// `proofGate`, and `agenticCodingComposer` retired with the pipeline, proof
// machinery, and composer excisions. Stale keys in existing settings.json
// files are inert: nothing reads them.
export interface DefaultAppSettings {
  theme: 'dark'
  themePreset: string
  themeMode: 'light' | 'dark'
  fontSize: number
  defaultModel: string
  sidebarCollapsed: boolean
  artifactPanelWidth: number
  minimizeToTray: boolean
  autoCheckUpdates: boolean
  aiGeneratedTitles: boolean
  modelConfig: Record<string, unknown>
  customModels: unknown[]
  toolSurface: 'lazy' | 'full'
  agenticCodingMode: boolean
  agenticCodingSkills: string[]
  snipEnabled: boolean
  snipVerbose: boolean
  safeSeedLength: number
  includePastReasoningInContext: boolean
}

export const DEFAULT_APP_SETTINGS: DefaultAppSettings = {
  theme: 'dark',
  themePreset: 'arcgis-blue',
  themeMode: 'dark',
  fontSize: 14,
  defaultModel: 'deepseek-v4-pro',
  sidebarCollapsed: false,
  artifactPanelWidth: 420,
  minimizeToTray: false,
  autoCheckUpdates: true,
  aiGeneratedTitles: false,
  modelConfig: {},
  customModels: [],
  toolSurface: 'full',
  agenticCodingMode: false,
  agenticCodingSkills: ['plan', 'context', 'verify'],
  snipEnabled: true,
  snipVerbose: false,
  safeSeedLength: 8192,
  includePastReasoningInContext: true
}
