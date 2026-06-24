import { describe, it, expect } from 'vitest'
import { effectivePermissions } from './effective'

describe('effectivePermissions (union of roles)', () => {
  it('unions permissions across multiple roles and dedupes', () => {
    const roles = [
      { permissions: [{ key: 'pos.sale.create' }, { key: 'product.view' }] },
      { permissions: [{ key: 'stock.adjust' }, { key: 'product.view' }] },
    ]
    expect(effectivePermissions(roles)).toEqual(['pos.sale.create', 'product.view', 'stock.adjust'])
  })

  it('returns empty for no roles', () => {
    expect(effectivePermissions([])).toEqual([])
  })
})
