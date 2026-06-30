import { describe, it, expect } from 'vitest'
import { explodeProduction } from '../src/production/explode'

describe('explodeProduction', () => {
  const ingredients = [{ stockItemId: 'milch', qty: 8000 }, { stockItemId: 'zucker', qty: 2000 }]

  it('scales produce and consume by batches', () => {
    expect(explodeProduction('base', 10000, ingredients, 2)).toEqual({
      produce: { stockItemId: 'base', qty: 20000 },
      consume: [{ stockItemId: 'milch', qty: 16000 }, { stockItemId: 'zucker', qty: 4000 }],
    })
  })

  it('one batch = the recipe; zero batches = zero', () => {
    expect(explodeProduction('base', 10000, ingredients, 1).produce.qty).toBe(10000)
    expect(explodeProduction('base', 10000, ingredients, 0)).toEqual({
      produce: { stockItemId: 'base', qty: 0 },
      consume: [{ stockItemId: 'milch', qty: 0 }, { stockItemId: 'zucker', qty: 0 }],
    })
  })
})
