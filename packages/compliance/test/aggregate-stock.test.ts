import { describe, it, expect } from 'vitest'
import { aggregateStock } from '../src/stock/aggregate'

describe('aggregateStock', () => {
  it('sums signed deltas per item, ordered by stockItemId', () => {
    const out = aggregateStock([
      { stockItemId: 'b', qtyDelta: 100 },
      { stockItemId: 'a', qtyDelta: 1000 },
      { stockItemId: 'a', qtyDelta: -250 },
      { stockItemId: 'b', qtyDelta: -40 },
    ])
    expect(out).toEqual([
      { stockItemId: 'a', qty: 750 },
      { stockItemId: 'b', qty: 60 },
    ])
  })

  it('treats a count movement as just another signed delta', () => {
    // receive 1000, adjust -250 (atual 750), count que repõe a 700 = delta -50
    const out = aggregateStock([
      { stockItemId: 'x', qtyDelta: 1000 },
      { stockItemId: 'x', qtyDelta: -250 },
      { stockItemId: 'x', qtyDelta: -50 },
    ])
    expect(out).toEqual([{ stockItemId: 'x', qty: 700 }])
  })

  it('allows negative stock and returns [] for no movements', () => {
    expect(aggregateStock([])).toEqual([])
    expect(aggregateStock([{ stockItemId: 'x', qtyDelta: -30 }])).toEqual([{ stockItemId: 'x', qty: -30 }])
  })
})
