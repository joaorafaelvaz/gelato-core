import { describe, it, expect } from 'vitest'
import { voucherDiscountGross, allocateDiscountByRate } from '../src/voucher/discount'

describe('voucherDiscountGross', () => {
  it('percent', () => {
    expect(voucherDiscountGross('percent', 10, 1190)).toBe(119) // floor(1190*10/100)
    expect(voucherDiscountGross('percent', 33, 1000)).toBe(330)
  })
  it('fixed (capped at base)', () => {
    expect(voucherDiscountGross('fixed', 500, 1190)).toBe(500)
    expect(voucherDiscountGross('fixed', 5000, 1190)).toBe(1190) // não passa do total
  })
})

describe('allocateDiscountByRate', () => {
  it('single rate: net-centric negative line', () => {
    expect(allocateDiscountByRate([{ rate: 0.19, gross: 1190 }], 119)).toEqual([
      { rate: 0.19, net: -100, mwst: -19, gross: -119 },
    ])
  })
  it('two rates: proportional, last takes the remainder, Σ = -discount', () => {
    const out = allocateDiscountByRate([{ rate: 0.19, gross: 1190 }, { rate: 0.07, gross: 214 }], 140)
    expect(out.reduce((s, l) => s + l.gross, 0)).toBe(-140)
    expect(out[0]).toEqual({ rate: 0.19, net: -100, mwst: -19, gross: -119 })
    expect(out[1].gross).toBe(-21)
  })
  it('zero / no base → []', () => {
    expect(allocateDiscountByRate([], 100)).toEqual([])
    expect(allocateDiscountByRate([{ rate: 0.19, gross: 1190 }], 0)).toEqual([])
  })
})
