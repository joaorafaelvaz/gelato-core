import { describe, it, expect } from 'vitest'
import { computeMwst } from '../src/mwst/engine'
import type { MwstProductRef, TaxRate } from '../src/mwst/types'

const rates: TaxRate[] = [
  { code: 'standard_19', rate: 0.19, validFrom: new Date('2020-01-01') },
  { code: 'reduced_7', rate: 0.07, validFrom: new Date('2020-01-01') },
]

const gelato: MwstProductRef = {
  id: 'p1',
  netCents: 200,
  mwstCodeImHaus: 'standard_19',
  mwstCodeAusserHaus: 'reduced_7',
}

const at = new Date('2026-06-23')

describe('computeMwst', () => {
  it('same product, different mode => different rate', () => {
    expect(computeMwst([{ product: gelato, qty: 1 }], 'im_haus', at, rates).totalMwst).toBe(38)
    expect(computeMwst([{ product: gelato, qty: 1 }], 'ausser_haus', at, rates).totalMwst).toBe(14)
  })

  it('groups totals by VAT rate', () => {
    const r = computeMwst([{ product: gelato, qty: 2 }], 'im_haus', at, rates)
    expect(r.groups).toEqual([{ code: 'standard_19', rate: 0.19, net: 400, mwst: 76, gross: 476 }])
    expect(r).toMatchObject({ totalNet: 400, totalMwst: 76, totalGross: 476 })
  })

  it('aggregates multiple products sharing a rate into one group', () => {
    const water: MwstProductRef = {
      id: 'p2',
      netCents: 100,
      mwstCodeImHaus: 'standard_19',
      mwstCodeAusserHaus: 'standard_19',
    }
    const r = computeMwst([{ product: gelato, qty: 1 }, { product: water, qty: 1 }], 'im_haus', at, rates)
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0]).toEqual({ code: 'standard_19', rate: 0.19, net: 300, mwst: 57, gross: 357 })
  })

  it('produces multiple groups sorted by code when rates differ', () => {
    const water: MwstProductRef = {
      id: 'p2',
      netCents: 100,
      mwstCodeImHaus: 'reduced_7',
      mwstCodeAusserHaus: 'reduced_7',
    }
    const r = computeMwst([{ product: gelato, qty: 1 }, { product: water, qty: 1 }], 'im_haus', at, rates)
    expect(r.groups.map((g) => g.code)).toEqual(['reduced_7', 'standard_19'])
    expect(r.totalNet).toBe(300)
    expect(r.totalMwst).toBe(7 + 38)
    expect(r.totalGross).toBe(345)
  })

  it('throws if a required rate is not valid at the date', () => {
    expect(() => computeMwst([{ product: gelato, qty: 1 }], 'im_haus', new Date('2019-01-01'), rates)).toThrow()
  })
})
