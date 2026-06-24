import { describe, it, expect } from 'vitest'
import { eventKey, isDuplicate, remember } from '../src/idempotency'

describe('idempotency helpers', () => {
  it('eventKey returns the client_event_id', () => {
    expect(eventKey({ client_event_id: 'abc' })).toBe('abc')
  })

  it('detects a duplicate client_event_id', () => {
    const seen = new Set<string>()
    expect(isDuplicate(seen, 'e1')).toBe(false)
    remember(seen, 'e1')
    expect(isDuplicate(seen, 'e1')).toBe(true)
    expect(isDuplicate(seen, 'e2')).toBe(false)
  })
})
