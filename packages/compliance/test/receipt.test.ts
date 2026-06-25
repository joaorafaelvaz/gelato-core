import { describe, it, expect } from 'vitest'
import { buildReceipt } from '../src/receipt/build'
import { FakeTseProvider } from '../src/tse/fake'
import { computeMwst } from '../src/mwst/engine'
import type { MwstProductRef, TaxRate } from '../src/mwst/types'

const rates: TaxRate[] = [{ code: 'standard_19', rate: 0.19, validFrom: new Date('2020-01-01') }]
const gelato: MwstProductRef = {
  id: 'p1',
  netCents: 200,
  mwstCodeImHaus: 'standard_19',
  mwstCodeAusserHaus: 'standard_19',
}

describe('buildReceipt', () => {
  it('assembles totals, tse data and a DFKA QR payload', async () => {
    const at = new Date('2026-06-23T10:00:00.000Z')
    const breakdown = computeMwst([{ product: gelato, qty: 2 }], 'im_haus', at, rates)
    const tse = await new FakeTseProvider({ clock: () => at, serialNumber: 'TSE-1' }).sign({
      clientId: 'c1',
      processType: 'Kassenbeleg-V1',
      amountsByVatRate: breakdown.groups.map((g) => ({ rate: g.rate, gross: g.gross })),
      paymentType: 'Bar',
      grossTotal: breakdown.totalGross,
    })

    const receipt = buildReceipt({
      seller: { name: 'Gelateria Demo' },
      issuedAt: at.toISOString(),
      mode: 'im_haus',
      lines: [{ name: 'Eisbecher', qty: 2, unitGross: 238, lineGross: 476, mwstCode: 'standard_19' }],
      breakdown,
      payment: { method: 'cash', amount: 476 },
      tse,
    })

    expect(receipt.total).toEqual({ net: 400, mwst: 76, gross: 476 })
    expect(receipt.vatGroups).toHaveLength(1)
    expect(receipt.qrPayload.split(';')).toHaveLength(12)
    expect(receipt.qrPayload).toContain('Kassenbeleg-V1')
    expect(receipt.qrPayload).toContain('TSE-1')
    expect(receipt.tse?.txNumber).toBe(1)
  })
})
