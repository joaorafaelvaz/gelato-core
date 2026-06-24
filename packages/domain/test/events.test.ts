import { describe, it, expect } from 'vitest'
import { SaleEventSchema } from '../src/events'
import { CONSUMPTION_MODES } from '../src/consumption'

const valid = {
  client_event_id: '11111111-1111-4111-8111-111111111111',
  type: 'sale',
  kasse_id: 'k1',
  payload: {
    order: { mode: 'im_haus', total_net: 100, total_mwst: 7, total_gross: 107 },
    items: [],
    payment: { method: 'cash', amount: 107 },
    receipt: { qr_payload: 'x' },
    tse_transaction: { tx_number: 1 },
  },
}

describe('SaleEvent', () => {
  it('accepts a valid event', () => {
    expect(SaleEventSchema.parse(valid)).toBeTruthy()
  })

  it('rejects invalid consumption mode', () => {
    const bad = {
      ...valid,
      payload: { ...valid.payload, order: { ...valid.payload.order, mode: 'x' } },
    }
    expect(() => SaleEventSchema.parse(bad)).toThrow()
  })

  it('rejects non-uuid client_event_id', () => {
    expect(() => SaleEventSchema.parse({ ...valid, client_event_id: 'nope' })).toThrow()
  })

  it('rejects non-integer cents', () => {
    const bad = {
      ...valid,
      payload: { ...valid.payload, order: { ...valid.payload.order, total_net: 1.5 } },
    }
    expect(() => SaleEventSchema.parse(bad)).toThrow()
  })

  it('exposes the two consumption modes', () => {
    expect(CONSUMPTION_MODES).toEqual(['im_haus', 'ausser_haus'])
  })
})
