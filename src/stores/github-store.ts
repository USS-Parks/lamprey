import { create } from 'zustand'
import { github as githubClient } from '@/lib/ipc-client'
import { toast } from '@/stores/toast-store'
import { useUiStore } from '@/stores/ui-store'
import type {
  GitHubConnectionStatus,
  GitHubRepository
} from '@/lib/github-types'

interface GitHubState {
  status: GitHubConnectionStatus | null
  loadingStatus: boolean
  repos: GitHubRepository[]
  loadingRepos: boolean
  reposError: string | null
  refreshStatus: () => Promise<void>
  refreshRepos: () => Promise<void>
  clearRepos: () => void
}

// Phase 3b: subscribe once at module load to the token-rejected event so
// any panel that opens later inherits the reconnect prompt. The IPC
// emit is throttled main-side so we don't have to dedupe here.
let tokenRejectedSubscribed = false
function subscribeTokenRejectedOnce(): void {
  if (tokenRejectedSubscribed) return
  if (!window.api?.github?.onTokenRejected) return
  tokenRejectedSubscribed = true
  window.api.github.onTokenRejected(() => {
    // Mark the store as disconnected so the EnvironmentPanel + Settings
    // page reflect reality even before the user re-probes.
    useGitHubStore.setState((s) => ({
      status: s.status
        ? { ...s.status, connected: false, reason: 'Token rejected — reconnect from Settings' }
        : s.status
    }))
    toast.error('GitHub rejected the token. Open Settings → GitHub to reconnect.', 8000)
    // Best-effort: pop the Settings dialog onto the GitHub tab so the
    // action button is one click away.
    try {
      useUiStore.getState().openSettings?.('github')
    } catch {
      /* UI store may not expose openSettings yet — toast still surfaces */
    }
  })
}

export const useGitHubStore = create<GitHubState>((set, get) => ({
  status: null,
  loadingStatus: false,
  repos: [],
  loadingRepos: false,
  reposError: null,

  refreshStatus: async () => {
    if (!window.api?.github) return
    subscribeTokenRejectedOnce()
    set({ loadingStatus: true })
    try {
      const res = await githubClient.status()
      set({ status: res.success ? res.data : null })
    } finally {
      set({ loadingStatus: false })
    }
  },

  refreshRepos: async () => {
    if (!window.api?.github) return
    if (!get().status?.connected) {
      set({ repos: [], reposError: 'Not connected to GitHub' })
      return
    }
    set({ loadingRepos: true, reposError: null })
    try {
      const res = await githubClient.repositories({ perPage: 100 })
      if (res.success) {
        set({ repos: res.data })
      } else {
        set({ repos: [], reposError: res.error })
      }
    } finally {
      set({ loadingRepos: false })
    }
  },

  clearRepos: () => set({ repos: [], reposError: null })
}))
