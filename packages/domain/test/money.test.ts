import { describe, it, expect } from 'vitest'
import { applyRate, sumCents, splitGross } from '../src/money'

describe('money', () => {
  it('sums cents without float drift', () => {
    expect(sumCents([10, 20, 33])).toBe(63)
    expect(sumCents([])).toBe(0)
  })

  it('applies a VAT rate on a net amount (kaufmännisch round, half-up)', () => {
    // 100 cents net @ 7% = 7 cents tax
    expect(applyRate(100, 0.07)).toBe(7)
    // 199 cents net @ 19% = 37.81 -> 38
    expect(applyRate(199, 0.19)).toBe(38)
    // 0 stays 0
    expect(applyRate(0, 0.19)).toBe(0)
  })

  it('splits a gross amount into net + tax for a given rate', () => {
    // gross 119 @ 19% -> net 100, tax 19
    expect(splitGross(119, 0.19)).toEqual({ net: 100, tax: 19, gross: 119 })
    // gross 107 @ 7% -> net 100, tax 7
    expect(splitGross(107, 0.07)).toEqual({ net: 100, tax: 7, gross: 107 })
  })
})
