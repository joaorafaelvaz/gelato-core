import { describe, it, expect } from 'vitest'
import { earnFromSale, loyaltyBalance } from '../src/loyalty/points'

describe('earnFromSale', () => {
  it('points per whole euro + stamps per item', () => {
    expect(earnFromSale(1190, 3, { pointsPerEuro: 1, stampsPerItem: 1 })).toEqual({ points: 11, stamps: 3 })
    expect(earnFromSale(1190, 3, { pointsPerEuro: 2, stampsPerItem: 0 })).toEqual({ points: 22, stamps: 0 })
  })
  it('zero config → zero', () => {
    expect(earnFromSale(5000, 9, { pointsPerEuro: 0, stampsPerItem: 0 })).toEqual({ points: 0, stamps: 0 })
  })
  it('negative gross/items (Storno) → negative earn', () => {
    expect(earnFromSale(-1190, -3, { pointsPerEuro: 1, stampsPerItem: 1 })).toEqual({ points: -11, stamps: -3 })
  })
})

describe('loyaltyBalance', () => {
  it('sums signed point/stamp deltas', () => {
    expect(loyaltyBalance([
      { points: 11, stamps: 3 },
      { points: -5, stamps: 0 },
      { points: 0, stamps: -1 },
    ])).toEqual({ points: 6, stamps: 2 })
  })
  it('empty → zero', () => {
    expect(loyaltyBalance([])).toEqual({ points: 0, stamps: 0 })
  })
})
