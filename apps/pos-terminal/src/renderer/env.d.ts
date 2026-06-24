export {}

interface RProduct {
  id: string
  name: string
  netCents: number
  mwstCodeImHaus: string
  mwstCodeAusserHaus: string
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
    }
  }
}
