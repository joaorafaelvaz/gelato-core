import { describe, it, expect } from 'vitest'
import { AusfallEventSchema, PosEventSchema, TseTransactionSchema } from '../src/events'

describe('Ausfall event schemas', () => {
  it('accepts a tse_transaction with is_ausfall and no signature/tx_number', () => {
    const parsed = TseTransactionSchema.parse({ is_ausfall: true })
    expect(parsed.is_ausfall).toBe(true)
    expect(parsed.tx_number).toBeUndefined()
  })

  it('validates a tse_ausfall started event', () => {
    const ev = {
      client_event_id: '11111111-1111-1111-1111-111111111111',
      type: 'tse_ausfall',
      kasse_id: 'demo-kasse',
      payload: { event_type: 'started', at: '2026-06-25T10:00:00Z', reason: 'timeout' },
    }
    expect(AusfallEventSchema.parse(ev).payload.event_type).toBe('started')
  })

  it('PosEvent discriminates by type', () => {
    const ausfall = PosEventSchema.parse({
      client_event_id: '22222222-2222-2222-2222-222222222222',
      type: 'tse_ausfall',
      kasse_id: 'k',
      payload: { event_type: 'ended', at: '2026-06-25T10:05:00Z' },
    })
    expect(ausfall.type).toBe('tse_ausfall')
  })
})
