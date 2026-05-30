import { create } from 'zustand'

interface UiState {
  searchQuery: string
  searchFocusToken: number
  settingsOpen: boolean
  setSearchQuery: (q: string) => void
  requestSearchFocus: () => void
  openSettings: () => void
  closeSettings: () => void
  toggleSettings: () => void
}

export const useUiStore = create<UiState>((set, get) => ({
  searchQuery: '',
  searchFocusToken: 0,
  settingsOpen: false,
  setSearchQuery: (q: string) => set({ searchQuery: q }),
  requestSearchFocus: () =>
    set((s) => ({ searchFocusToken: s.searchFocusToken + 1, searchQuery: get().searchQuery })),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen }))
}))
