/** Roteamento por hash, sem dependência. Grupos/páginas da navegação (slugs em inglês). */
export interface Route {
  group: string
  page: string
}

export const ROUTES: Record<string, string[]> = {
  today: ['dashboard'],
  operations: ['stock', 'production', 'checklists'],
  catalog: ['products', 'recipes'],
  customers: ['crm', 'loyalty', 'vouchers', 'campaigns'],
  fiscal: ['sales', 'haccp', 'exports'],
}

export const DEFAULT_ROUTE: Route = { group: 'today', page: 'dashboard' }

export function parseRoute(hash: string): Route | null {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts.length === 0 || parts.length > 2) return null
  const group = parts[0] ?? ''
  const page = parts[1]
  const pages = ROUTES[group]
  if (!pages) return null
  const first = pages[0]
  if (first === undefined) return null
  if (page === undefined) return { group, page: first }
  if (!pages.includes(page)) return null
  return { group, page }
}

export function buildHash(route: Route): string {
  return `#/${route.group}/${route.page}`
}
