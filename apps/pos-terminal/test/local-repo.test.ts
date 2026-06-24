import { describe, it, expect, afterEach } from 'vitest'
import { LocalRepo } from '../src/db/local-repo'
import type { SaleEvent } from '@gelato/domain'

function sampleEvent(clientEventId: string): SaleEvent {
  return {
    client_event_id: clientEventId,
    type: 'sale',
    kasse_id: 'k1',
    payload: {
      order: { mode: 'im_haus', total_net: 100, total_mwst: 19, total_gross: 119 },
      items: [{ product_id: 'p1', qty: 1, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' }],
      payment: { method: 'cash', amount: 119 },
      receipt: { qr_payload: 'V0;...' },
      tse_transaction: { tx_number: 1, signature_counter: 1, signature_value: 'sig', log_time: 'x' },
    },
  }
}

let repo: LocalRepo
afterEach(() => repo?.close())

describe('LocalRepo', () => {
  const id = '11111111-1111-4111-8111-111111111111'

  it('saves an append-only sale and enqueues one pending outbox row', () => {
    repo = new LocalRepo()
    repo.saveFinalizedSale(sampleEvent(id), 1000)
    expect(repo.countSales()).toBe(1)
    const pending = repo.pendingOutbox(2000)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.client_event_id).toBe(id)
  })

  it('is idempotent: re-saving the same event is a no-op', () => {
    repo = new LocalRepo()
    repo.saveFinalizedSale(sampleEvent(id), 1000)
    repo.saveFinalizedSale(sampleEvent(id), 1000)
    expect(repo.countSales()).toBe(1)
    expect(repo.countOutbox()).toBe(1)
  })

  it('markSent removes a row from the pending set', () => {
    repo = new LocalRepo()
    repo.saveFinalizedSale(sampleEvent(id), 1000)
    repo.markSent(id)
    expect(repo.pendingOutbox(2000)).toHaveLength(0)
    expect(repo.countOutbox('sent')).toBe(1)
  })

  it('markFailed reschedules with backoff (excluded until next_attempt_at)', () => {
    repo = new LocalRepo()
    repo.saveFinalizedSale(sampleEvent(id), 1000)
    repo.markFailed(id, 10000)
    expect(repo.pendingOutbox(5000)).toHaveLength(0)
    expect(repo.pendingOutbox(10000)).toHaveLength(1)
  })
})
