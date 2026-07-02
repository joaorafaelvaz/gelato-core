import type { Route } from '../router'

export interface PageProps {
  token: string
  navigate: (r: Route) => void
}
