import { create } from 'zustand'

interface UiState {
  searchQuery: string
  searchFocusToken: number
  settingsOpen: boolean
  composeDraft: string
  composeSeedToken: number
  setSearchQuery: (q: string) => void
  requestSearchFocus: () => void
  openSettings: () => void
  closeSettings: () => void
  toggleSettings: () => void
  seedComposeDraft: (text: string) => void
  consumeComposeDraft: () => string
}

export const useUiStore = create<UiState>((set, get) => ({
  searchQuery: '',
  searchFocusToken: 0,
  settingsOpen: false,
  composeDraft: '',
  composeSeedToken: 0,
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
  }
}))
