import { useCallback, useEffect, useRef, useState } from 'react'
import type { EnvironmentSnapshot } from '@/lib/types'

interface UseEnvironmentResult {
  snapshot: EnvironmentSnapshot
  loading: boolean
  refresh: () => Promise<void>
}

const EMPTY: EnvironmentSnapshot = {
  branch: null,
  additions: 0,
  deletions: 0,
  hasChanges: false,
  ahead: 0,
  behind: 0,
  cwd: ''
}

interface ReviewStatus {
  files: Array<{ path: string }>
  branch: string | null
  ahead: number
  behind: number
  cwd: string
}

interface ReviewSummary {
  additions: number
  deletions: number
}

// Subscribes to the main process's review:changed event AND polls every 15s
// as a safety net (chokidar on Windows can miss events when files are atomic
// -replaced by git). Refreshes status + summary in parallel.
export function useEnvironment(): UseEnvironmentResult {
  const [snapshot, setSnapshot] = useState<EnvironmentSnapshot>(EMPTY)
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    if (!window.api?.review) return
    setLoading(true)
    try {
      const [statusRes, summaryRes] = await Promise.all([
        window.api.review.status({}),
        window.api.review.summary?.() ?? Promise.resolve({ success: false } as const)
      ])
      if (!mountedRef.current) return
      const status = statusRes.success ? (statusRes.data as ReviewStatus) : null
      const summary = summaryRes.success ? (summaryRes.data as ReviewSummary) : null
      setSnapshot({
        branch: status?.branch ?? null,
        additions: summary?.additions ?? 0,
        deletions: summary?.deletions ?? 0,
        hasChanges: (status?.files?.length ?? 0) > 0,
        ahead: status?.ahead ?? 0,
        behind: status?.behind ?? 0,
        cwd: status?.cwd ?? ''
      })
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    const unsubscribe = window.api?.review?.onChanged?.(() => {
      void refresh()
    })
    const id = window.setInterval(() => {
      void refresh()
    }, 15000)
    return () => {
      mountedRef.current = false
      window.clearInterval(id)
      unsubscribe?.()
    }
  }, [refresh])

  return { snapshot, loading, refresh }
}
