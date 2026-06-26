import { describe, it, expect } from 'vitest'
import { LocalRepo } from '../src/db/local-repo'
import { makeAusfallEnvelope } from '@gelato/sync'

describe('LocalRepo — ausfall outbox + period state', () => {
  it('enqueues an ausfall event into the outbox (no sale row)', () => {
    const repo = new LocalRepo(':memory:')
    const ev = makeAusfallEnvelope('demo-kasse', { event_type: 'started', at: 'now', reason: 'timeout' })
    repo.enqueueOutbox(ev.client_event_id, JSON.stringify(ev), 0)
    expect(repo.countOutbox('pending')).toBe(1)
    expect(repo.countSales()).toBe(0)
    repo.close()
  })

  it('persists and reads back the open ausfall state', () => {
    const repo = new LocalRepo(':memory:')
    expect(repo.getAusfallState()).toBeNull()
    repo.setAusfallState({ startedAt: 't0', reason: 'timeout' })
    expect(repo.getAusfallState()).toEqual({ startedAt: 't0', reason: 'timeout' })
    repo.setAusfallState(null)
    expect(repo.getAusfallState()).toBeNull()
    repo.close()
  })
})
