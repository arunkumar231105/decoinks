import { useCallback, useEffect, useState } from 'react'
import { get } from '../services/api'

export interface Resource<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Fetches a single endpoint and exposes the three states every screen needs:
 * loading, error (with retry) and data. Requests are aborted on unmount so a
 * slow response can never set state on a page the customer already left.
 */
export function useResource<T>(path: string): Resource<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce(n => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    get<T>(path, controller.signal)
      .then(result => setData(result))
      .catch((e: Error) => {
        if (e.name === 'AbortError') return
        setData(null)
        setError(e.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [path, nonce])

  return { data, loading, error, reload }
}
