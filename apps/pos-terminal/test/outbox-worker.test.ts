import { describe, it, expect, afterEach } from 'vitest'
import { runOutboxOnce, type SyncClient } from '../src/sync/outbox-worker'
import { LocalRepo } from '../src/db/local-repo'
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
      receipt: { qr_payload: 'x' },
      tse_transaction: { tx_number: 1, signature_counter: 1, signature_value: 'sig', log_time: 'x' },
    },
  }
}

let repo: LocalRepo
afterEach(() => repo?.close())

const id = '11111111-1111-4111-8111-111111111111'

describe('runOutboxOnce', () => {
  it('marks sent on a 2xx response', async () => {
    repo = new LocalRepo()
    repo.saveFinalizedSale(sampleEvent(id), 1000)
    const client: SyncClient = { post: () => Promise.resolve({ ok: true, status: 200 }) }
    const result = await runOutboxOnce(repo, client, 2000)
    expect(result).toEqual({ sent: 1, failed: 0 })
    expect(repo.pendingOutbox(3000)).toHaveLength(0)
  })

  it('treats a duplicate response as sent (idempotent)', async () => {
    repo = new LocalRepo()
    repo.saveFinalizedSale(sampleEvent(id), 1000)
    const client: SyncClient = {
      post: () => Promise.resolve({ ok: true, duplicate: true, status: 200 }),
    }
    await runOutboxOnce(repo, client, 2000)
    expect(repo.countOutbox('sent')).toBe(1)
  })

  it('keeps pending and backs off on a network error', async () => {
    repo = new LocalRepo()
    repo.saveFinalizedSale(sampleEvent(id), 1000)
    const client: SyncClient = { post: () => Promise.reject(new Error('network down')) }
    const result = await runOutboxOnce(repo, client, 2000, 5000)
    expect(result).toEqual({ sent: 0, failed: 1 })
    // reagendado para o futuro → fora do pending agora
    expect(repo.pendingOutbox(2000)).toHaveLength(0)
    // volta ao pending depois do backoff
    expect(repo.pendingOutbox(2000 + 5000)).toHaveLength(1)
  })
})
