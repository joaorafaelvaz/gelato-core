import { describe, it, expect } from 'vitest'
import { finalizeSale } from '../src/sale/finalize'
import { LocalRepo } from '../src/db/local-repo'
import {
  FakeTseProvider,
  FailingTseProvider,
  AusfallTracker,
  type TaxRate,
} from '@gelato/compliance'

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
const base = {
  cart,
  mode: 'ausser_haus' as const,
  rates,
  kasseId: 'demo-kasse',
  tseClientId: 'c1',
  seller: { name: 'Demo' },
}

describe('finalizeSale — Ausfall', () => {
  it('completes the sale in Ausfall mode and emits a started event once, then ended on recovery', async () => {
    const repo = new LocalRepo(':memory:')
    const tracker = new AusfallTracker()
    let n = 0
    const idGen = () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`

    const r1 = await finalizeSale({
      ...base, at: new Date('2026-06-25T10:00:00Z'), tse: new FailingTseProvider('down'),
      repo, tracker, idGen,
    })
    expect(r1.outcome.kind).toBe('ausfall')
    expect(r1.receipt.isAusfall).toBe(true)
    expect(r1.receipt.qrPayload).toBe('')
    expect(repo.countSales()).toBe(1)
    expect(repo.countOutbox('pending')).toBe(2) // venda + 'started'
    expect(repo.getAusfallState()).not.toBeNull()

    const r2 = await finalizeSale({
      ...base, at: new Date('2026-06-25T10:01:00Z'), tse: new FailingTseProvider('down'),
      repo, tracker, idGen,
    })
    expect(r2.outcome.kind).toBe('ausfall')
    expect(repo.countSales()).toBe(2)
    expect(repo.countOutbox('pending')).toBe(3) // +venda, sem novo started

    const r3 = await finalizeSale({
      ...base, at: new Date('2026-06-25T10:05:00Z'), tse: new FakeTseProvider({ serialNumber: 'X' }),
      repo, tracker, idGen,
    })
    expect(r3.outcome.kind).toBe('signed')
    expect(r3.receipt.isAusfall).toBe(false)
    expect(repo.countSales()).toBe(3)
    expect(repo.countOutbox('pending')).toBe(5) // +venda +ended
    expect(repo.getAusfallState()).toBeNull()
    repo.close()
  })
})
