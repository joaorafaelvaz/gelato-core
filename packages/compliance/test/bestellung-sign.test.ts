import { describe, it, expect } from 'vitest'
import { FakeTseProvider } from '../src/tse/fake'

describe('FakeTseProvider — Bestellung-V1', () => {
  it('signs a Bestellung-V1 process type', async () => {
    const tse = new FakeTseProvider({ serialNumber: 'X' })
    const r = await tse.sign({
      clientId: 'c1',
      processType: 'Bestellung-V1',
      amountsByVatRate: [{ rate: 0.19, gross: 119 }],
      paymentType: 'Bar',
      grossTotal: 119,
    })
    expect(r.processType).toBe('Bestellung-V1')
    expect(r.signatureValue).toContain('FAKE-SIG')
  })
})
