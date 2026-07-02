import { useEffect, useState } from 'react'
import { DEFAULT_ROUTE, buildHash, parseRoute, type Route } from '../router'

export function useRoute(): { route: Route; navigate: (r: Route) => void } {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash) ?? DEFAULT_ROUTE)

  useEffect(() => {
    const onChange = (): void => setRoute(parseRoute(window.location.hash) ?? DEFAULT_ROUTE)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return { route, navigate: (r) => { window.location.hash = buildHash(r) } }
}
