import { describe, it, expect } from 'vitest'
import { FakeTseProvider } from '../src/tse/fake'

describe('FakeTseProvider', () => {
  it('increments tx number and signature counter monotonically', async () => {
    const clock = () => new Date('2026-06-23T10:00:00.000Z')
    const tse = new FakeTseProvider({ clock, serialNumber: 'TSE-1' })

    const a = await tse.sign({
      clientId: 'c1',
      processType: 'Kassenbeleg-V1',
      amountsByVatRate: [{ rate: 0.19, gross: 476 }],
      paymentType: 'Bar',
      grossTotal: 476,
    })
    const b = await tse.sign({
      clientId: 'c1',
      processType: 'Kassenbeleg-V1',
      amountsByVatRate: [{ rate: 0.07, gross: 107 }],
      paymentType: 'Bar',
      grossTotal: 107,
    })

    expect(a.txNumber).toBe(1)
    expect(b.txNumber).toBe(2)
    expect(b.signatureCounter).toBeGreaterThan(a.signatureCounter)
    expect(a.serialNumber).toBe('TSE-1')
    expect(a.logTime).toBe('2026-06-23T10:00:00.000Z')
    expect(a.signatureValue).not.toBe(b.signatureValue)
    expect(a.processData).toContain('Bar:476')
  })
})
