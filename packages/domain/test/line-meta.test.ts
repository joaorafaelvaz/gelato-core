import { describe, it, expect } from 'vitest'
import { BestellungItemSchema, OrderItemSchema } from '../src/events'

describe('line variant/modifiers metadata', () => {
  it('BestellungItem accepts variant_id + modifiers snapshot', () => {
    const parsed = BestellungItemSchema.parse({
      product_id: 'p1', variant_id: 'v1', qty: 1, unit_net: 650, mwst_rate: 0.19, mwst_code: 'standard_19',
      modifiers: [{ id: 'm1', name: 'extra Sahne', net: 50 }],
    })
    expect(parsed.variant_id).toBe('v1')
    expect(parsed.modifiers).toHaveLength(1)
  })
  it('OrderItem accepts modifiers', () => {
    const parsed = OrderItemSchema.parse({
      product_id: 'p1', variant_id: 'v1', qty: 1, unit_net: 650, mwst_rate: 0.19, mwst_code: 'standard_19',
      modifiers: [{ id: 'm1', name: 'extra Sahne', net: 50 }],
    })
    expect(parsed.modifiers?.[0]?.net).toBe(50)
  })
})
