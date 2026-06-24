import { describe, it, expect, beforeEach } from 'vitest'
import { finalizeSale, runOutboxOnce, type CartLine, type SyncClient } from '../src/sale'
import { IdbStore } from '../src/idb-store'
import { FakeTseProvider, type TaxRate } from '@gelato/compliance'
import { SaleEventSchema } from '@gelato/domain'

const rates: TaxRate[] = [
  { code: 'standard_19', rate: 0.19, validFrom: new Date('2020-01-01') },
  { code: 'reduced_7', rate: 0.07, validFrom: new Date('2020-01-01') },
]

const cart: CartLine[] = [
  {
    product: {
      id: 'p1',
      name: 'Eiskugel',
      netCents: 200,
      mwstCodeImHaus: 'standard_19',
      mwstCodeAusserHaus: 'reduced_7',
    },
    qty: 2,
  },
]

const at = new Date('2026-06-24T10:00:00.000Z')

describe('web finalizeSale + outbox (entirely in-browser, IndexedDB)', () => {
  let store: IdbStore
  beforeEach(() => {
    store = new IdbStore(`s-${Math.random().toString(36).slice(2)}`)
  })

  it('finalizes im_haus (19%), persists to IndexedDB + enqueues outbox', async () => {
    const tse = new FakeTseProvider({ clock: () => at })
    const { event, receipt } = await finalizeSale({
      cart,
      mode: 'im_haus',
      at,
      rates,
      kasseId: 'demo-kasse',
      tseClientId: 'c1',
      tse,
      store,
      seller: { name: 'Demo' },
      idGen: () => '99999999-9999-4999-8999-999999999999',
    })
    expect(event.payload.order).toMatchObject({ total_net: 400, total_mwst: 76, total_gross: 476 })
    expect(() => SaleEventSchema.parse(event)).not.toThrow()
    expect(receipt.qrPayload).toContain('Kassenbeleg-V1')
    expect(await store.countSales()).toBe(1)
    expect(await store.pendingOutbox(at.getTime() + 1)).toHaveLength(1)
  })

  it('applies the reduced rate (7%) for ausser_haus', async () => {
    const tse = new FakeTseProvider({ clock: () => at })
    const { event } = await finalizeSale({
      cart,
      mode: 'ausser_haus',
      at,
      rates,
      kasseId: 'demo-kasse',
      tseClientId: 'c1',
      tse,
      store,
      seller: { name: 'Demo' },
    })
    expect(event.payload.order.total_mwst).toBe(28) // 400 * 0.07
  })

  it('outbox survives an outage then syncs (idempotent client)', async () => {
    const tse = new FakeTseProvider({ clock: () => at })
    await finalizeSale({
      cart,
      mode: 'im_haus',
      at,
      rates,
      kasseId: 'demo-kasse',
      tseClientId: 'c1',
      tse,
      store,
      seller: { name: 'Demo' },
    })
    const down: SyncClient = { post: () => Promise.reject(new Error('offline')) }
    expect(await runOutboxOnce(store, down, at.getTime())).toEqual({ sent: 0, failed: 1 })

    const up: SyncClient = { post: () => Promise.resolve({ ok: true, status: 200 }) }
    expect(await runOutboxOnce(store, up, at.getTime() + 60_000)).toEqual({ sent: 1, failed: 0 })
    expect(await store.countOutbox('sent')).toBe(1)
  })
})
