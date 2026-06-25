import { describe, it, expect } from 'vitest'
import { computeShiftCash } from '../src/reports/shift-cash'

describe('computeShiftCash', () => {
  it('expected = float + cashSales + suprimentos - sangrias; differenz = counted - expected', () => {
    const r = computeShiftCash({
      openingFloat: 10000,
      cashSales: 5000,
      suprimentos: 2000,
      sangrias: 3000,
      counted: 13500,
    })
    expect(r.expected).toBe(14000) // 10000 + 5000 + 2000 - 3000
    expect(r.counted).toBe(13500)
    expect(r.differenz).toBe(-500) // faltou 500 cents
  })

  it('zera quando bate', () => {
    const r = computeShiftCash({
      openingFloat: 10000,
      cashSales: 0,
      suprimentos: 0,
      sangrias: 0,
      counted: 10000,
    })
    expect(r.differenz).toBe(0)
  })
})
