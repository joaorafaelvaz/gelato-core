import { useCallback, useEffect, useState } from 'react'

export interface Fetched<T> {
  data: T | null
  loading: boolean
  error: boolean
  reload: () => void
}

/** Contrato padrão de leitura: loading → Spinner, error → ErrorState, data. */
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[]): Fetched<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    fn()
      .then((d) => { if (alive) { setData(d); setLoading(false) } })
      .catch(() => { if (alive) { setError(true); setLoading(false) } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { data, loading, error, reload }
}
