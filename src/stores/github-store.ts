import { create } from 'zustand'
import { github as githubClient } from '@/lib/ipc-client'
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

export const useGitHubStore = create<GitHubState>((set, get) => ({
  status: null,
  loadingStatus: false,
  repos: [],
  loadingRepos: false,
  reposError: null,

  refreshStatus: async () => {
    if (!window.api?.github) return
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
