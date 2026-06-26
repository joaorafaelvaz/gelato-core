import { describe, it, expect } from 'vitest'
import { mapRecords, type DsfinvkInput } from '../src/dsfinvk/records'

const input: DsfinvkInput = {
  kasse: { id: 'k1', name: 'Kasse 1', serialNr: 'SER1', swVersion: '1.0' },
  location: { name: 'Filiale', country: 'DEU' },
  tse: { id: 'tse1', serial: 'SANDBOX', publicKey: 'PUB', sigAlgo: 'ecdsa-plain-SHA256', timeFormat: 'utcTime' },
  taxRates: [{ code: 'standard_19', rate: 0.19 }, { code: 'reduced_7', rate: 0.07 }],
  zClosings: [
    {
      zNr: 1,
      businessDay: '2026-06-25T20:00:00Z',
      createdAt: '2026-06-25T20:00:00Z',
      totals: {
        byVatRate: [{ rate: 0.07, net: 100, mwst: 7, gross: 107 }],
        byPayment: [{ method: 'cash', amount: 107 }],
        totalNet: 100, totalMwst: 7, totalGross: 107, receiptCount: 1, stornoCount: 0, grandTotal: 107,
      },
      bons: [
        {
          bonId: 'o1', bonNr: 1, type: 'Beleg', start: '2026-06-25T10:00:00Z', end: '2026-06-25T10:00:00Z',
          net: 100, gross: 107,
          vat: [{ rate: 0.07, net: 100, ust: 7, gross: 107 }],
          payments: [{ type: 'Bar', name: 'cash', currency: 'EUR', amount: 107 }],
          lines: [{ zeile: 1, text: 'Eis', qty: 1, unitGross: 107, lineGross: 107, rate: 0.07, net: 100, ust: 7 }],
          tse: { id: 'tse1', taNr: 5, start: '2026-06-25T10:00:00Z', end: '2026-06-25T10:00:00Z', sigCounter: 9, signature: 'SIG', isAusfall: false },
        },
        {
          bonId: 'o2', bonNr: 2, type: 'Beleg', start: '2026-06-25T11:00:00Z', end: '2026-06-25T11:00:00Z',
          net: 100, gross: 107,
          vat: [{ rate: 0.07, net: 100, ust: 7, gross: 107 }],
          payments: [{ type: 'Bar', name: 'cash', currency: 'EUR', amount: 107 }],
          lines: [{ zeile: 1, text: 'Eis', qty: 1, unitGross: 107, lineGross: 107, rate: 0.07, net: 100, ust: 7 }],
          tse: { id: 'tse1', isAusfall: true }, // Ausfall: sem assinatura
        },
      ],
    },
  ],
}

describe('dsfinvk/records', () => {
  it('maps bonkopf rows from bons', () => {
    const r = mapRecords(input)
    expect(r.bonkopf).toHaveLength(2)
    expect(r.bonkopf[0]).toMatchObject({ Z_KASSE_ID: 'k1', BON_ID: 'o1', BON_BRUTTO: '1.07' })
  })

  it('marks the Ausfall bon in tse.csv with TSE_TA_FEHLER and empty signature', () => {
    const r = mapRecords(input)
    const ausfall = r.tse.find((row) => row.BON_ID === 'o2')!
    expect(ausfall.TSE_TA_FEHLER).toBe('1')
    expect(ausfall.TSE_TA_SIG).toBe('')
    const ok = r.tse.find((row) => row.BON_ID === 'o1')!
    expect(ok.TSE_TA_FEHLER).toBe('')
    expect(ok.TSE_TA_SIG).toBe('SIG')
  })

  it('maps z_ust from the closing totals by vat rate', () => {
    const r = mapRecords(input)
    expect(r.z_ust[0]).toMatchObject({ Z_NR: '1', UST_SCHLUESSEL: '2', Z_UST_BRUTTO: '1.07' })
  })

  it('produces stammdaten rows (kasse, tse, ust, orte, abschluss)', () => {
    const r = mapRecords(input)
    expect(r.stamm_kassen[0]).toMatchObject({ Z_KASSE_ID: 'k1', KASSE_SERIENNR: 'SER1' })
    expect(r.stamm_tse[0]).toMatchObject({ TSE_SERIAL: 'SANDBOX' })
    expect(r.stamm_ust).toHaveLength(2)
    expect(r.stamm_orte[0]).toMatchObject({ LOC_NAME: 'Filiale', LOC_LAND: 'DEU' })
    expect(r.stamm_abschluss[0]).toMatchObject({ Z_NR: '1' })
  })
})
