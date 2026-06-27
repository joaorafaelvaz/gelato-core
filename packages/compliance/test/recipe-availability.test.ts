import { describe, it, expect } from 'vitest'
import { maxProducible } from '../src/recipe/availability'

describe('maxProducible', () => {
  const stock = new Map<string, number>([['milch', 1000], ['zucker', 300]])

  it('is the limiting ingredient (min over floor(stock/qty))', () => {
    // milch: floor(1000/200)=5 ; zucker: floor(300/80)=3 → 3
    expect(maxProducible([{ stockItemId: 'milch', qty: 200 }, { stockItemId: 'zucker', qty: 80 }], stock)).toBe(3)
  })

  it('0 when an ingredient is missing or stock is negative', () => {
    expect(maxProducible([{ stockItemId: 'unknown', qty: 1 }], stock)).toBe(0)
    expect(maxProducible([{ stockItemId: 'x', qty: 10 }], new Map([['x', -5]]))).toBe(0)
  })

  it('0 for an empty recipe; ignores ingredients with qty <= 0', () => {
    expect(maxProducible([], stock)).toBe(0)
    // só milch limita (zucker qty 0 ignorado) → floor(1000/200)=5
    expect(maxProducible([{ stockItemId: 'milch', qty: 200 }, { stockItemId: 'zucker', qty: 0 }], stock)).toBe(5)
  })
})
