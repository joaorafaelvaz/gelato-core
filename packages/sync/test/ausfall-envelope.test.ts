import { describe, it, expect } from 'vitest'
import { makeAusfallEnvelope } from '../src/envelope'

describe('makeAusfallEnvelope', () => {
  it('builds a valid tse_ausfall event with an injected id', () => {
    const id = '33333333-3333-3333-3333-333333333333'
    const ev = makeAusfallEnvelope(
      'demo-kasse',
      { event_type: 'started', at: '2026-06-25T10:00:00Z', reason: 'timeout' },
      () => id,
    )
    expect(ev).toEqual({
      client_event_id: id,
      type: 'tse_ausfall',
      kasse_id: 'demo-kasse',
      payload: { event_type: 'started', at: '2026-06-25T10:00:00Z', reason: 'timeout' },
    })
  })
})
