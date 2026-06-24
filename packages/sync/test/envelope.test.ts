import { describe, it, expect } from 'vitest'
import { makeEnvelope } from '../src/envelope'
import { SaleEventSchema, type SalePayload } from '@gelato/domain'

const payload: SalePayload = {
  order: { mode: 'im_haus', total_net: 400, total_mwst: 76, total_gross: 476 },
  items: [{ product_id: 'p1', qty: 2, unit_net: 200, mwst_rate: 0.19, mwst_code: 'standard_19' }],
  payment: { method: 'cash', amount: 476 },
  receipt: { qr_payload: 'V0;TSE-1;Kassenbeleg-V1;...' },
  tse_transaction: { tx_number: 1, signature_counter: 1, signature_value: 'sig' },
}

describe('makeEnvelope', () => {
  it('builds a valid SaleEvent with an injected uuid client_event_id', () => {
    const env = makeEnvelope('k1', payload, () => '11111111-1111-4111-8111-111111111111')
    expect(env.kasse_id).toBe('k1')
    expect(env.type).toBe('sale')
    expect(env.client_event_id).toBe('11111111-1111-4111-8111-111111111111')
    expect(() => SaleEventSchema.parse(env)).not.toThrow()
  })

  it('generates a unique id per call by default', () => {
    const a = makeEnvelope('k1', payload)
    const b = makeEnvelope('k1', payload)
    expect(a.client_event_id).not.toBe(b.client_event_id)
  })

  it('rejects an invalid payload', () => {
    const bad = { ...payload, order: { ...payload.order, total_net: 1.5 } } as SalePayload
    expect(() => makeEnvelope('k1', bad)).toThrow()
  })
})
