import { describe, it, expect } from 'vitest'
import { signWithFallback } from '../src/tse/sign-with-fallback'
import { FakeTseProvider } from '../src/tse/fake'
import { FailingTseProvider, HangingTseProvider } from '../src/tse/test-doubles'
import type { TseSignRequest } from '../src/tse/types'

const req: TseSignRequest = {
  clientId: 'c1',
  processType: 'Kassenbeleg-V1',
  amountsByVatRate: [{ rate: 0.19, gross: 119 }],
  paymentType: 'Bar',
  grossTotal: 119,
}

describe('signWithFallback', () => {
  it('returns signed outcome when the TSE signs', async () => {
    const out = await signWithFallback(new FakeTseProvider({ serialNumber: 'X' }), req)
    expect(out.kind).toBe('signed')
    if (out.kind === 'signed') expect(out.tse.signatureValue).toContain('FAKE-SIG')
  })

  it('returns ausfall when the TSE throws', async () => {
    const out = await signWithFallback(new FailingTseProvider('boom'), req)
    expect(out.kind).toBe('ausfall')
    if (out.kind === 'ausfall') expect(out.reason).toContain('boom')
  })

  it('returns ausfall(timeout) when the TSE hangs past the timeout', async () => {
    const out = await signWithFallback(new HangingTseProvider(), req, { timeoutMs: 10 })
    expect(out.kind).toBe('ausfall')
    if (out.kind === 'ausfall') expect(out.reason).toBe('timeout')
  })
})
