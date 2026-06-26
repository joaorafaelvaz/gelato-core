import { describe, it, expect, afterEach } from 'vitest'
import { finalizeSale, type CartLine } from '../src/sale/finalize'
import { LocalRepo } from '../src/db/local-repo'
import { FakeTseProvider, AusfallTracker, type TaxRate } from '@gelato/compliance'
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

let repo: LocalRepo
afterEach(() => repo?.close())

describe('finalizeSale', () => {
  it('computes MwSt, signs, builds receipt+QR, and persists locally + outbox', async () => {
    repo = new LocalRepo()
    const tse = new FakeTseProvider({ clock: () => at, serialNumber: 'TSE-1' })
    const { event, receipt } = await finalizeSale({
      cart,
      mode: 'im_haus',
      at,
      rates,
      kasseId: 'demo-kasse',
      tseClientId: 'c1',
      tse,
      repo,
      seller: { name: 'Gelateria Demo' },
      tracker: new AusfallTracker(),
      idGen: () => '99999999-9999-4999-8999-999999999999',
    })

    // im_haus => 19%: 400 net, 76 mwst, 476 gross
    expect(event.payload.order).toMatchObject({ total_net: 400, total_mwst: 76, total_gross: 476 })
    expect(() => SaleEventSchema.parse(event)).not.toThrow()
    expect(receipt.qrPayload).toContain('Kassenbeleg-V1')
    expect(repo.countSales()).toBe(1)
    expect(repo.pendingOutbox(at.getTime() + 1)).toHaveLength(1)
  })

  // O modo de falha (TSE indisponível → venda em Ausfall, não bloqueia) é coberto
  // por finalize-ausfall.test.ts (fatia 1d). No C0 a falha bloqueava; isso mudou.
})
