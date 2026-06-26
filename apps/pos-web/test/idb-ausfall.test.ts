import { describe, it, expect } from 'vitest'
import { IdbStore } from '../src/idb-store'
import { makeAusfallEnvelope } from '@gelato/sync'

describe('IdbStore — ausfall outbox + period state', () => {
  it('enqueues an ausfall event and persists period state', async () => {
    const store = new IdbStore('test-ausfall-' + Math.random().toString(36).slice(2))
    const ev = makeAusfallEnvelope('demo-kasse', { event_type: 'started', at: 'now', reason: 'timeout' })
    await store.enqueueOutbox(ev.client_event_id, JSON.stringify(ev), 0)
    expect(await store.countOutbox('pending')).toBe(1)
    expect(await store.countSales()).toBe(0)

    expect(await store.getAusfallState()).toBeNull()
    await store.setAusfallState({ startedAt: 't0', reason: 'timeout' })
    expect(await store.getAusfallState()).toEqual({ startedAt: 't0', reason: 'timeout' })
    await store.setAusfallState(null)
    expect(await store.getAusfallState()).toBeNull()
  })
})
