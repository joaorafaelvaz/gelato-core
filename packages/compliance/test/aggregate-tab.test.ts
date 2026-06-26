import { describe, it, expect } from 'vitest'
import { aggregateTab, type TabItemInput } from '../src/tab/aggregate'

const items: TabItemInput[] = [
  { productId: 'p1', qty: 2, unitNet: 100, mwstRate: 0.19, mwstCode: 'standard_19' },
  { productId: 'p2', qty: 1, unitNet: 200, mwstRate: 0.07, mwstCode: 'reduced_7' },
  { productId: 'p1', qty: -1, unitNet: 100, mwstRate: 0.19, mwstCode: 'standard_19' }, // Storno
]

describe('aggregateTab', () => {
  it('aggregates quantities per product, cancelling Stornos', () => {
    const t = aggregateTab(items)
    const p1 = t.lines.find((l) => l.productId === 'p1')!
    expect(p1.qty).toBe(1) // 2 - 1
    expect(p1.net).toBe(100)
  })

  it('groups totals by vat rate (mwst on summed net)', () => {
    const t = aggregateTab(items)
    const g19 = t.byVatRate.find((g) => g.rate === 0.19)!
    expect(g19).toMatchObject({ net: 100, mwst: 19, gross: 119 })
    const g7 = t.byVatRate.find((g) => g.rate === 0.07)!
    expect(g7).toMatchObject({ net: 200, mwst: 14, gross: 214 })
  })

  it('computes grand totals', () => {
    const t = aggregateTab(items)
    expect(t.totalNet).toBe(300)
    expect(t.totalMwst).toBe(33)
    expect(t.totalGross).toBe(333)
  })

  it('returns empty state for no items', () => {
    expect(aggregateTab([])).toMatchObject({ lines: [], byVatRate: [], totalGross: 0 })
  })
})
