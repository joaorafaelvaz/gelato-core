import { describe, it, expect } from 'vitest'
import { computeDayTotals } from '../src/reports/day-totals'

describe('computeDayTotals', () => {
  it('groups by VAT rate and payment method, counts, grand total', () => {
    const r = computeDayTotals({
      lines: [
        { mwstRate: 0.19, net: 400, gross: 476 },
        { mwstRate: 0.07, net: 100, gross: 107 },
      ],
      payments: [
        { method: 'cash', amount: 476 },
        { method: 'card', amount: 107 },
      ],
      receiptCount: 2,
      stornoCount: 0,
      priorGrandTotal: 1000,
    })
    expect(r.byVatRate).toEqual([
      { rate: 0.07, net: 100, mwst: 7, gross: 107 },
      { rate: 0.19, net: 400, mwst: 76, gross: 476 },
    ])
    expect(r.byPayment).toEqual([
      { method: 'card', amount: 107 },
      { method: 'cash', amount: 476 },
    ])
    expect(r).toMatchObject({
      totalNet: 500,
      totalMwst: 83,
      totalGross: 583,
      receiptCount: 2,
      stornoCount: 0,
      grandTotal: 1583, // 1000 + 583
    })
  })

  it('aggregates multiple lines of the same rate', () => {
    const r = computeDayTotals({
      lines: [
        { mwstRate: 0.19, net: 200, gross: 238 },
        { mwstRate: 0.19, net: 200, gross: 238 },
      ],
      payments: [{ method: 'cash', amount: 476 }],
      receiptCount: 1,
      stornoCount: 0,
      priorGrandTotal: 0,
    })
    expect(r.byVatRate).toEqual([{ rate: 0.19, net: 400, mwst: 76, gross: 476 }])
    expect(r.grandTotal).toBe(476)
  })

  it('empty day => empty groups, grandTotal = prior', () => {
    const r = computeDayTotals({
      lines: [],
      payments: [],
      receiptCount: 0,
      stornoCount: 0,
      priorGrandTotal: 5000,
    })
    expect(r.byVatRate).toEqual([])
    expect(r.byPayment).toEqual([])
    expect(r.grandTotal).toBe(5000)
    expect(r.totalGross).toBe(0)
  })
})
