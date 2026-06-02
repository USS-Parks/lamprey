import { create } from 'zustand'

const SIDEBAR_WIDTH_KEY = 'lamprey.ui.sidebarWidth'
const SIDEBAR_COLLAPSED_KEY = 'lamprey.ui.sidebarCollapsed'
const RIGHT_WIDTH_KEY = 'lamprey.ui.rightPanelWidth'
const RIGHT_COLLAPSED_KEY = 'lamprey.ui.rightPanelCollapsed'
const PERMISSIONS_KEY = 'lamprey.ui.permissionsMode'
const CONV_FILTERS_KEY = 'lamprey.ui.convFilters'
const ACTIVE_SHELL_KEY = 'lamprey.ui.activeShell'

export type PermissionsMode = 'default' | 'auto-review' | 'full'

export type ToolId =
  | 'files'
  | 'sidechat'
  | 'browser'
  | 'review'
  | 'terminal'
  | 'environment'
  | 'sources'
  | 'artifacts'

export type ShellKind = 'powershell' | 'cmd' | 'git-bash' | 'wsl'

function readShell(): ShellKind {
  if (typeof window === 'undefined') return 'powershell'
  const raw = window.localStorage?.getItem(ACTIVE_SHELL_KEY)
  if (raw === 'powershell' || raw === 'cmd' || raw === 'git-bash' || raw === 'wsl') return raw
  return 'powershell'
}

export type ConvStatus = 'active' | 'all'
export type ConvProject = 'all'
export type ConvEnvironment = 'all'
export type ConvLastActivity = 'all' | 'today' | 'week' | 'month'
export type ConvGroupBy = 'none' | 'date' | 'model'
export type ConvSortBy = 'recency' | 'created' | 'az' | 'za'

export interface ConvFilters {
  status: ConvStatus
  project: ConvProject
  environment: ConvEnvironment
  lastActivity: ConvLastActivity
  groupBy: ConvGroupBy
  sortBy: ConvSortBy
}

const DEFAULT_CONV_FILTERS: ConvFilters = {
  status: 'active',
  project: 'all',
  environment: 'all',
  lastActivity: 'all',
  groupBy: 'date',
  sortBy: 'recency'
}

function readConvFilters(): ConvFilters {
  if (typeof window === 'undefined') return DEFAULT_CONV_FILTERS
  try {
    const raw = window.localStorage?.getItem(CONV_FILTERS_KEY)
    if (!raw) return DEFAULT_CONV_FILTERS
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_CONV_FILTERS, ...parsed }
  } catch {
    return DEFAULT_CONV_FILTERS
  }
}

function readPermissions(): PermissionsMode {
  if (typeof window === 'undefined') return 'default'
  const raw = window.localStorage?.getItem(PERMISSIONS_KEY)
  if (raw === 'auto-review' || raw === 'full' || raw === 'default') return raw
  return 'default'
}

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 240
const RIGHT_MIN = 280
const RIGHT_MAX = 800
const RIGHT_DEFAULT = 420

function readNumber(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage?.getItem(key)
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage?.getItem(key)
  if (raw === null || raw === undefined) return fallback
  return raw === '1' || raw === 'true'
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage?.setItem(key, value)
  } catch {
    // ignore quota / unavailable
  }
}

export type SettingsTabId =
  | 'general'
  | 'models'
  | 'agents'
  | 'agenticCoding'
  | 'api'
  | 'appearance'
  | 'mcp'
  | 'webTools'
  | 'currentInfo'
  | 'imageGen'
  | 'permissions'
  | 'planGoal'
  | 'hooks'
  | 'automations'

interface UiState {
  searchQuery: string
  searchFocusToken: number
  settingsOpen: boolean
  settingsInitialTab: SettingsTabId | null
  memoryOpen: boolean
  composeDraft: string
  composeSeedToken: number
  sidebarCollapsed: boolean
  sidebarWidth: number
  rightPanelCollapsed: boolean
  rightPanelWidth: number
  permissionsMode: PermissionsMode
  activeTool: ToolId | null
  setActiveTool: (tool: ToolId | null) => void
  closeActiveTool: () => void
  toggleTool: (tool: ToolId) => void
  activeShell: ShellKind
  setActiveShell: (kind: ShellKind) => void
  quickOpenVisible: boolean
  openQuickOpen: () => void
  closeQuickOpen: () => void
  toggleQuickOpen: () => void
  worktreeModalOpen: boolean
  openWorktreeModal: () => void
  closeWorktreeModal: () => void
  planMode: boolean
  togglePlanMode: () => void
  setPlanMode: (v: boolean) => void
  requestedOpenFilePath: string | null
  requestedOpenFileToken: number
  requestOpenFile: (path: string) => void
  convFilters: ConvFilters
  setConvFilters: (partial: Partial<ConvFilters>) => void
  resetConvFilters: () => void
  setSearchQuery: (q: string) => void
  requestSearchFocus: () => void
  openSettings: (tab?: SettingsTabId) => void
  closeSettings: () => void
  toggleSettings: () => void
  openMemory: () => void
  closeMemory: () => void
  toggleMemory: () => void
  seedComposeDraft: (text: string) => void
  consumeComposeDraft: () => string
  setSidebarCollapsed: (v: boolean) => void
  toggleSidebar: () => void
  setSidebarWidth: (w: number) => void
  setRightPanelCollapsed: (v: boolean) => void
  toggleRightPanel: () => void
  setRightPanelWidth: (w: number) => void
  setPermissionsMode: (mode: PermissionsMode) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  searchQuery: '',
  searchFocusToken: 0,
  settingsOpen: false,
  settingsInitialTab: null,
  memoryOpen: false,
  composeDraft: '',
  composeSeedToken: 0,
  sidebarCollapsed: readBool(SIDEBAR_COLLAPSED_KEY, false),
  sidebarWidth: readNumber(SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX),
  rightPanelCollapsed: readBool(RIGHT_COLLAPSED_KEY, false),
  rightPanelWidth: readNumber(RIGHT_WIDTH_KEY, RIGHT_DEFAULT, RIGHT_MIN, RIGHT_MAX),
  permissionsMode: readPermissions(),
  activeTool: null,
  activeShell: readShell(),
  quickOpenVisible: false,
  requestedOpenFilePath: null,
  requestedOpenFileToken: 0,
  worktreeModalOpen: false,
  planMode: false,
  convFilters: readConvFilters(),
  setSearchQuery: (q: string) => set({ searchQuery: q }),
  requestSearchFocus: () =>
    set((s) => ({ searchFocusToken: s.searchFocusToken + 1, searchQuery: get().searchQuery })),
  openSettings: (tab?: SettingsTabId) =>
    set({ settingsOpen: true, settingsInitialTab: tab ?? null }),
  closeSettings: () => set({ settingsOpen: false, settingsInitialTab: null }),
  toggleSettings: () =>
    set((s) => ({
      settingsOpen: !s.settingsOpen,
      settingsInitialTab: s.settingsOpen ? null : s.settingsInitialTab
    })),
  openMemory: () => set({ memoryOpen: true }),
  closeMemory: () => set({ memoryOpen: false }),
  toggleMemory: () => set((s) => ({ memoryOpen: !s.memoryOpen })),
  seedComposeDraft: (text: string) =>
    set((s) => ({ composeDraft: text, composeSeedToken: s.composeSeedToken + 1 })),
  consumeComposeDraft: () => {
    const text = get().composeDraft
    set({ composeDraft: '' })
    return text
  },
  setSidebarCollapsed: (v: boolean) => {
    writeLocal(SIDEBAR_COLLAPSED_KEY, v ? '1' : '0')
    set({ sidebarCollapsed: v })
  },
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    writeLocal(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
    set({ sidebarCollapsed: next })
  },
  setSidebarWidth: (w: number) => {
    const clamped = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(w)))
    writeLocal(SIDEBAR_WIDTH_KEY, String(clamped))
    set({ sidebarWidth: clamped })
  },
  setRightPanelCollapsed: (v: boolean) => {
    writeLocal(RIGHT_COLLAPSED_KEY, v ? '1' : '0')
    set({ rightPanelCollapsed: v })
  },
  toggleRightPanel: () => {
    const next = !get().rightPanelCollapsed
    writeLocal(RIGHT_COLLAPSED_KEY, next ? '1' : '0')
    set({ rightPanelCollapsed: next })
  },
  setRightPanelWidth: (w: number) => {
    const clamped = Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, Math.round(w)))
    writeLocal(RIGHT_WIDTH_KEY, String(clamped))
    set({ rightPanelWidth: clamped })
  },
  setPermissionsMode: (mode: PermissionsMode) => {
    writeLocal(PERMISSIONS_KEY, mode)
    set({ permissionsMode: mode })
  },
  setActiveTool: (tool: ToolId | null) => {
    if (tool && get().rightPanelCollapsed) {
      writeLocal(RIGHT_COLLAPSED_KEY, '0')
      set({ rightPanelCollapsed: false })
    }
    set({ activeTool: tool })
  },
  closeActiveTool: () => set({ activeTool: null }),
  setActiveShell: (kind: ShellKind) => {
    writeLocal(ACTIVE_SHELL_KEY, kind)
    set({ activeShell: kind })
  },
  toggleTool: (tool: ToolId) => {
    const current = get().activeTool
    if (current === tool) {
      set({ activeTool: null })
    } else {
      if (get().rightPanelCollapsed) {
        writeLocal(RIGHT_COLLAPSED_KEY, '0')
        set({ rightPanelCollapsed: false })
      }
      set({ activeTool: tool })
    }
  },
  openQuickOpen: () => set({ quickOpenVisible: true }),
  closeQuickOpen: () => set({ quickOpenVisible: false }),
  toggleQuickOpen: () => set((s) => ({ quickOpenVisible: !s.quickOpenVisible })),
  openWorktreeModal: () => set({ worktreeModalOpen: true }),
  closeWorktreeModal: () => set({ worktreeModalOpen: false }),
  togglePlanMode: () => set((s) => ({ planMode: !s.planMode })),
  setPlanMode: (v: boolean) => set({ planMode: v }),
  requestOpenFile: (path: string) => {
    if (get().rightPanelCollapsed) {
      writeLocal(RIGHT_COLLAPSED_KEY, '0')
      set({ rightPanelCollapsed: false })
    }
    set((s) => ({
      activeTool: 'files',
      requestedOpenFilePath: path,
      requestedOpenFileToken: s.requestedOpenFileToken + 1,
      quickOpenVisible: false
    }))
  },
  setConvFilters: (partial: Partial<ConvFilters>) => {
    const next = { ...get().convFilters, ...partial }
    writeLocal(CONV_FILTERS_KEY, JSON.stringify(next))
    set({ convFilters: next })
  },
  resetConvFilters: () => {
    writeLocal(CONV_FILTERS_KEY, JSON.stringify(DEFAULT_CONV_FILTERS))
    set({ convFilters: { ...DEFAULT_CONV_FILTERS } })
  }
}))

export const SIDEBAR_BOUNDS = { min: SIDEBAR_MIN, max: SIDEBAR_MAX, default: SIDEBAR_DEFAULT }
export const RIGHT_PANEL_BOUNDS = { min: RIGHT_MIN, max: RIGHT_MAX, default: RIGHT_DEFAULT }
