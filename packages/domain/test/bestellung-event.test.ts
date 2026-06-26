import { describe, it, expect } from 'vitest'
import { BestellungEventSchema } from '../src/events'

describe('BestellungEventSchema', () => {
  it('accepts a bestellung with items (negative qty allowed for Storno) + tse', () => {
    const ev = {
      client_event_id: '11111111-1111-1111-1111-111111111111',
      type: 'bestellung',
      session_id: 's1',
      kasse_id: 'demo-kasse',
      items: [
        { product_id: 'p1', qty: 2, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' },
        { product_id: 'p1', qty: -1, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19', storno_of: 'b0' },
      ],
      tse_transaction: { tx_number: 1, signature_value: 'S', signature_counter: 1, log_time: 'now', process_type: 'Bestellung-V1' },
    }
    expect(BestellungEventSchema.parse(ev).items).toHaveLength(2)
  })
})
