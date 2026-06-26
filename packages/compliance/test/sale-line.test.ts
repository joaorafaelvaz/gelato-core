import { describe, it, expect } from 'vitest'
import { buildSaleLine } from '../src/catalog/line'

describe('buildSaleLine', () => {
  it('uses the product net when there is no variant', () => {
    const l = buildSaleLine({ baseNetCents: 150, mwstCode: 'standard_19' }, undefined, [])
    expect(l.unitNet).toBe(150)
    expect(l.mwstCode).toBe('standard_19')
    expect(l.modifiers).toEqual([])
  })

  it('uses the variant absolute net and adds modifiers, inheriting the mwstCode', () => {
    const l = buildSaleLine(
      { baseNetCents: 150, mwstCode: 'standard_19' },
      { netCents: 600 },
      [{ id: 'm1', name: 'extra Sahne', net: 50 }, { id: 'm2', name: 'Streusel', net: 30 }],
    )
    expect(l.unitNet).toBe(680) // 600 + 50 + 30
    expect(l.mwstCode).toBe('standard_19')
    expect(l.modifiers).toHaveLength(2)
  })
})
