import { create } from 'zustand'

const SIDEBAR_WIDTH_KEY = 'lamprey.ui.sidebarWidth'
const SIDEBAR_COLLAPSED_KEY = 'lamprey.ui.sidebarCollapsed'
const RIGHT_WIDTH_KEY = 'lamprey.ui.rightPanelWidth'
const RIGHT_COLLAPSED_KEY = 'lamprey.ui.rightPanelCollapsed'
const PERMISSIONS_KEY = 'lamprey.ui.permissionsMode'

export type PermissionsMode = 'default' | 'auto-review' | 'full'

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

interface UiState {
  searchQuery: string
  searchFocusToken: number
  settingsOpen: boolean
  composeDraft: string
  composeSeedToken: number
  sidebarCollapsed: boolean
  sidebarWidth: number
  rightPanelCollapsed: boolean
  rightPanelWidth: number
  permissionsMode: PermissionsMode
  setSearchQuery: (q: string) => void
  requestSearchFocus: () => void
  openSettings: () => void
  closeSettings: () => void
  toggleSettings: () => void
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
  composeDraft: '',
  composeSeedToken: 0,
  sidebarCollapsed: readBool(SIDEBAR_COLLAPSED_KEY, false),
  sidebarWidth: readNumber(SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX),
  rightPanelCollapsed: readBool(RIGHT_COLLAPSED_KEY, false),
  rightPanelWidth: readNumber(RIGHT_WIDTH_KEY, RIGHT_DEFAULT, RIGHT_MIN, RIGHT_MAX),
  permissionsMode: readPermissions(),
  setSearchQuery: (q: string) => set({ searchQuery: q }),
  requestSearchFocus: () =>
    set((s) => ({ searchFocusToken: s.searchFocusToken + 1, searchQuery: get().searchQuery })),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
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
  }
}))

export const SIDEBAR_BOUNDS = { min: SIDEBAR_MIN, max: SIDEBAR_MAX, default: SIDEBAR_DEFAULT }
export const RIGHT_PANEL_BOUNDS = { min: RIGHT_MIN, max: RIGHT_MAX, default: RIGHT_DEFAULT }
