import { describe, it, expect } from 'vitest'
import { buildDfkaQrPayload, type DfkaQrInput } from '../src/receipt/qr'

const input: DfkaQrInput = {
  version: 'V0',
  kasseSerialNumber: 'TSE-1',
  processType: 'Kassenbeleg-V1',
  processData: 'Beleg^0.19:476^Bar:476',
  transactionNumber: 1,
  signatureCounter: 5,
  startTime: '2026-06-23T10:00:00.000Z',
  logTime: '2026-06-23T10:00:01.000Z',
  signatureAlgorithm: 'ecdsa-plain-SHA256',
  logTimeFormat: 'utcTime',
  signature: 'BASE64SIG',
  publicKey: 'BASE64PUB',
}

describe('buildDfkaQrPayload', () => {
  it('joins the 12 DFKA fields with semicolons in order', () => {
    const s = buildDfkaQrPayload(input)
    expect(s.split(';')).toHaveLength(12)
    expect(s.startsWith('V0;TSE-1;Kassenbeleg-V1;')).toBe(true)
    expect(s.endsWith(';BASE64SIG;BASE64PUB')).toBe(true)
  })

  it('matches snapshot (locks current behavior — NOT legal conformance)', () => {
    expect(buildDfkaQrPayload(input)).toMatchSnapshot()
  })
})
