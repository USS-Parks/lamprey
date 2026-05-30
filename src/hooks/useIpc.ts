import { useState, useCallback } from 'react'
import type { IpcResponse } from '@/lib/types'

interface UseIpcState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useIpc<T>() {
  const [state, setState] = useState<UseIpcState<T>>({
    data: null,
    loading: false,
    error: null
  })

  const execute = useCallback(async (fn: () => Promise<IpcResponse<T>>) => {
    setState({ data: null, loading: true, error: null })
    try {
      const result = await fn()
      if (result.success) {
        setState({ data: result.data, loading: false, error: null })
        return result.data
      } else {
        setState({ data: null, loading: false, error: result.error })
        return null
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setState({ data: null, loading: false, error: message })
      return null
    }
  }, [])

  return { ...state, execute }
}
