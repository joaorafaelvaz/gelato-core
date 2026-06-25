import { describe, it, expect } from 'vitest'
import { buildReceipt } from '../src/receipt/build'
import type { MwstBreakdown } from '../src/mwst/types'

const breakdown: MwstBreakdown = {
  groups: [{ code: 'reduced', rate: 0.07, net: 100, mwst: 7, gross: 107 }],
  totalNet: 100,
  totalMwst: 7,
  totalGross: 107,
}

const baseInput = {
  seller: { name: 'Demo' },
  issuedAt: '2026-06-25T10:00:00Z',
  mode: 'ausser_haus' as const,
  lines: [{ name: 'Eis', qty: 1, unitGross: 107, lineGross: 107, mwstCode: 'reduced' }],
  breakdown,
  payment: { method: 'cash', amount: 107 },
}

describe('buildReceipt — Ausfall', () => {
  it('omits the QR and marks isAusfall when tse is null', () => {
    const r = buildReceipt({ ...baseInput, tse: null })
    expect(r.isAusfall).toBe(true)
    expect(r.qrPayload).toBe('')
    expect(r.tse).toBeNull()
    expect(r.total.gross).toBe(107) // Belegausgabepflicht: recibo emitido normalmente
  })
})
