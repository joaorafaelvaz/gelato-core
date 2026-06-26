import { describe, it, expect } from 'vitest'
import { finalizeSale } from '../src/sale'
import { IdbStore } from '../src/idb-store'
import { FakeTseProvider, FailingTseProvider, AusfallTracker, type TaxRate } from '@gelato/compliance'

const rates: TaxRate[] = [
  { code: 'reduced', rate: 0.07, validFrom: new Date('2020-01-01') },
  { code: 'standard', rate: 0.19, validFrom: new Date('2020-01-01') },
]
const cart = [
  {
    product: { id: 'p1', name: 'Eis', netCents: 100, mwstCodeImHaus: 'standard', mwstCodeAusserHaus: 'reduced' },
    qty: 1,
  },
]
const base = { cart, mode: 'ausser_haus' as const, rates, kasseId: 'demo-kasse', tseClientId: 'c1', seller: { name: 'Demo' } }

describe('finalizeSale (web) — Ausfall', () => {
  it('records the sale in Ausfall and emits started once, then ended on recovery', async () => {
    const store = new IdbStore('test-sale-' + Math.random().toString(36).slice(2))
    const tracker = new AusfallTracker()
    let n = 0
    const idGen = () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`

    const r1 = await finalizeSale({ ...base, at: new Date('2026-06-25T10:00:00Z'), tse: new FailingTseProvider('down'), store, tracker, idGen })
    expect(r1.outcome.kind).toBe('ausfall')
    expect(r1.receipt.qrPayload).toBe('')
    expect(await store.countOutbox('pending')).toBe(2) // venda + started
    expect(await store.getAusfallState()).not.toBeNull()

    await finalizeSale({ ...base, at: new Date('2026-06-25T10:01:00Z'), tse: new FailingTseProvider('down'), store, tracker, idGen })
    expect(await store.countOutbox('pending')).toBe(3) // +venda, sem started

    const r3 = await finalizeSale({ ...base, at: new Date('2026-06-25T10:05:00Z'), tse: new FakeTseProvider({ serialNumber: 'X' }), store, tracker, idGen })
    expect(r3.outcome.kind).toBe('signed')
    expect(await store.countOutbox('pending')).toBe(5) // +venda +ended
    expect(await store.getAusfallState()).toBeNull()
  })
})
