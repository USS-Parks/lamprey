import { create } from 'zustand'

const EXPANDED_KEY = 'lamprey.sidebar.expandedProjectIds'
const LIMITS_KEY = 'lamprey.sidebar.visibleSessionLimits'
const SELECTED_PROJECT_KEY = 'lamprey.sidebar.selectedProjectId'

const DEFAULT_LIMIT = 6
const SHOW_MORE_STEP = 10

function readStringArray(key: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage?.getItem(key)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : []
  } catch {
    return []
  }
}

function readNumberRecord(key: string): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage?.getItem(key)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function readString(key: string): string | undefined {
  if (typeof window === 'undefined') return undefined
  const raw = window.localStorage?.getItem(key)
  return raw ?? undefined
}

function write(key: string, value: string): void {
  try {
    window.localStorage?.setItem(key, value)
  } catch {
    // ignore
  }
}

function remove(key: string): void {
  try {
    window.localStorage?.removeItem(key)
  } catch {
    // ignore
  }
}

interface SidebarState {
  expandedProjectIds: string[]
  visibleSessionLimits: Record<string, number>
  selectedProjectId?: string
  isProjectExpanded: (id: string) => boolean
  toggleProjectExpanded: (id: string) => void
  setProjectExpanded: (id: string, expanded: boolean) => void
  visibleLimitFor: (id: string) => number
  showMore: (id: string) => void
  showLess: (id: string) => void
  selectProject: (id: string | undefined) => void
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  expandedProjectIds: readStringArray(EXPANDED_KEY),
  visibleSessionLimits: readNumberRecord(LIMITS_KEY),
  selectedProjectId: readString(SELECTED_PROJECT_KEY),

  isProjectExpanded: (id: string) => get().expandedProjectIds.includes(id),

  toggleProjectExpanded: (id: string) => {
    const ids = get().expandedProjectIds
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    write(EXPANDED_KEY, JSON.stringify(next))
    set({ expandedProjectIds: next })
  },

  setProjectExpanded: (id: string, expanded: boolean) => {
    const ids = get().expandedProjectIds
    const has = ids.includes(id)
    if (expanded === has) return
    const next = expanded ? [...ids, id] : ids.filter((x) => x !== id)
    write(EXPANDED_KEY, JSON.stringify(next))
    set({ expandedProjectIds: next })
  },

  visibleLimitFor: (id: string) => get().visibleSessionLimits[id] ?? DEFAULT_LIMIT,

  showMore: (id: string) => {
    const current = get().visibleSessionLimits[id] ?? DEFAULT_LIMIT
    const next = { ...get().visibleSessionLimits, [id]: current + SHOW_MORE_STEP }
    write(LIMITS_KEY, JSON.stringify(next))
    set({ visibleSessionLimits: next })
  },

  showLess: (id: string) => {
    const next = { ...get().visibleSessionLimits }
    delete next[id]
    write(LIMITS_KEY, JSON.stringify(next))
    set({ visibleSessionLimits: next })
  },

  selectProject: (id: string | undefined) => {
    if (id) write(SELECTED_PROJECT_KEY, id)
    else remove(SELECTED_PROJECT_KEY)
    set({ selectedProjectId: id })
  }
}))

export const SIDEBAR_DEFAULT_LIMIT = DEFAULT_LIMIT
