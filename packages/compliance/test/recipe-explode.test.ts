import { describe, it, expect } from 'vitest'
import { explodeRecipe, aggregateConsumption } from '../src/recipe/explode'

describe('explodeRecipe', () => {
  it('multiplies each ingredient by qtySold', () => {
    const ing = [
      { stockItemId: 'milch', qty: 100 },
      { stockItemId: 'zucker', qty: 40 },
    ]
    expect(explodeRecipe(ing, 3)).toEqual([
      { stockItemId: 'milch', qty: 300 },
      { stockItemId: 'zucker', qty: 120 },
    ])
  })

  it('qtySold 0 → all zero', () => {
    expect(explodeRecipe([{ stockItemId: 'milch', qty: 100 }], 0)).toEqual([{ stockItemId: 'milch', qty: 0 }])
  })
})

describe('aggregateConsumption', () => {
  it('sums consumption per stock item across a basket, ordered by stockItemId', () => {
    // 2× L (200ml+80g) + 1× S (100ml+40g) = 500ml milch, 200g zucker
    const out = aggregateConsumption([
      { ingredients: [{ stockItemId: 'milch', qty: 200 }, { stockItemId: 'zucker', qty: 80 }], qtySold: 2 },
      { ingredients: [{ stockItemId: 'milch', qty: 100 }, { stockItemId: 'zucker', qty: 40 }], qtySold: 1 },
    ])
    expect(out).toEqual([
      { stockItemId: 'milch', qty: 500 },
      { stockItemId: 'zucker', qty: 200 },
    ])
  })

  it('empty basket → []', () => {
    expect(aggregateConsumption([])).toEqual([])
  })
})
