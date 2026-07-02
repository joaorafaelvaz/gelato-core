import { describe, expect, it } from 'vitest'
import { ROUTES, DEFAULT_ROUTE, parseRoute, buildHash } from './router'

describe('parseRoute', () => {
  it('parses a full two-segment hash', () => {
    expect(parseRoute('#/operations/stock')).toEqual({ group: 'operations', page: 'stock' })
    expect(parseRoute('#/fiscal/haccp')).toEqual({ group: 'fiscal', page: 'haccp' })
  })

  it('normalizes a group-only hash to the first page of the group', () => {
    expect(parseRoute('#/today')).toEqual({ group: 'today', page: 'dashboard' })
    expect(parseRoute('#/customers')).toEqual({ group: 'customers', page: 'crm' })
  })

  it('returns null for empty or invalid hashes', () => {
    expect(parseRoute('')).toBeNull()
    expect(parseRoute('#/')).toBeNull()
    expect(parseRoute('#/nope')).toBeNull()
    expect(parseRoute('#/operations/nope')).toBeNull()
    expect(parseRoute('#/a/b/c')).toBeNull()
  })

  it('round-trips every route through buildHash', () => {
    for (const [group, pages] of Object.entries(ROUTES)) {
      for (const page of pages) {
        expect(parseRoute(buildHash({ group, page }))).toEqual({ group, page })
      }
    }
  })

  it('exposes the 5 groups / 13 pages and the default route', () => {
    expect(Object.keys(ROUTES)).toEqual(['today', 'operations', 'catalog', 'customers', 'fiscal'])
    expect(Object.values(ROUTES).flat()).toHaveLength(13)
    expect(DEFAULT_ROUTE).toEqual({ group: 'today', page: 'dashboard' })
  })
})
