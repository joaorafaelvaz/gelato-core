import { describe, it, expect, beforeEach } from 'vitest'
import { IdbStore } from '../src/idb-store'
import type { SaleEvent } from '@gelato/domain'

function sampleEvent(clientEventId: string): SaleEvent {
  return {
    client_event_id: clientEventId,
    type: 'sale',
    kasse_id: 'k1',
    payload: {
      order: { mode: 'im_haus', total_net: 100, total_mwst: 19, total_gross: 119 },
      items: [],
      payment: { method: 'cash', amount: 119 },
      receipt: { qr_payload: 'V0;...' },
      tse_transaction: { tx_number: 1, signature_counter: 1, signature_value: 'sig', log_time: 'x' },
    },
  }
}

describe('IdbStore (IndexedDB)', () => {
  let store: IdbStore
  beforeEach(() => {
    // DB nova por teste (fake-indexeddb é global) para isolar estado
    store = new IdbStore(`t-${Math.random().toString(36).slice(2)}`)
  })

  it('saves an append-only sale + one pending outbox row, idempotently', async () => {
    await store.saveFinalizedSale(sampleEvent('id1'), 1000)
    await store.saveFinalizedSale(sampleEvent('id1'), 1000)
    expect(await store.countSales()).toBe(1)
    expect(await store.countOutbox()).toBe(1)
    expect(await store.pendingOutbox(2000)).toHaveLength(1)
  })

  it('markSent removes from the pending set', async () => {
    await store.saveFinalizedSale(sampleEvent('id1'), 1000)
    await store.markSent('id1')
    expect(await store.pendingOutbox(2000)).toHaveLength(0)
    expect(await store.countOutbox('sent')).toBe(1)
  })

  it('markFailed reschedules with backoff', async () => {
    await store.saveFinalizedSale(sampleEvent('id1'), 1000)
    await store.markFailed('id1', 10000)
    expect(await store.pendingOutbox(5000)).toHaveLength(0)
    expect(await store.pendingOutbox(10000)).toHaveLength(1)
  })
})
