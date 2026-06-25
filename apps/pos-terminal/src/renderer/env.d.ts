export {}

interface RProduct {
  id: string
  name: string
  netCents: number
  mwstCodeImHaus: string
  mwstCodeAusserHaus: string
}

interface RDayTotals {
  byVatRate: { rate: number; net: number; mwst: number; gross: number }[]
  byPayment: { method: string; amount: number }[]
  totalGross: number
  grandTotal: number
}

declare global {
  interface Window {
    gelato: {
      loginPin(
        kasseId: string,
        pin: string,
      ): Promise<{ ok: boolean; permissions?: string[]; error?: string }>
      products(): Promise<RProduct[]>
      finalize(
        cart: Array<RProduct & { qty: number }>,
        mode: 'im_haus' | 'ausser_haus',
      ): Promise<{
        ok: boolean
        receipt?: { qrPayload: string; total: { net: number; mwst: number; gross: number } }
        error?: string
      }>
      shiftOpen(openingFloat: number): Promise<{ id: string }>
      shiftClose(counted: number): Promise<{ differenz?: number; expected?: number }>
      cashMovement(type: 'sangria' | 'suprimento', amount: number): Promise<unknown>
      drawer(): Promise<unknown>
      reportX(): Promise<{ totals: RDayTotals }>
      reportZ(): Promise<{ seqNr: number; totals: RDayTotals }>
    }
  }
}
